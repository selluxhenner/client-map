// Sammel-Anreicherung: viele Betriebe auf einmal, ohne einen einzigen Agenten.
//
// Der Schnell-Check laesst Claude je Betrieb suchen. Das ist genau, kostet
// aber rund 30 Sekunden und Kontingent pro Laden - fuer 400 Betriebe im
// Kanton ist das der falsche Hebel. Hier passiert dasselbe fuer die Fragen,
// die sich messen statt beurteilen lassen: laeuft die Seite, Telefon, Mail,
// Instagram, Facebook. Acht Betriebe gleichzeitig, rund zwei Sekunden je
// Betrieb, null Token.
//
// Die Arbeitsteilung ist damit:
//   Web-Check   - breit, gratis, misst Tatsachen (diese Datei)
//   Schnell-Check - Claude sucht, wenn nichts zu messen ist
//   Analyse     - Claude urteilt (Story, Inhaber, Aufhaenger)
//
// Und wie ueberall: Breite darf Tiefe nicht ueberschreiben. Ein gemessenes
// "ok" ersetzt kein "gut" aus einer Analyse, und ein Zeitlimit ist kein
// Beweis fuer irgendetwas.

import { getVenue, updateVenue } from './venue-store.js';
import { publish } from './bus.js';
import { holen, beurteilen, kontakteAusHtml, kontaktseite, telefonnummer } from './webcheck.js';
import * as google from '../providers/google.js';

/** Wie viele Seiten gleichzeitig geholt werden. */
const GLEICHZEITIG = spanne(process.env.WEBCHECK_CONCURRENCY, 8, 1, 24);

/** Obergrenze fuer einen Lauf - ein Klick soll nicht den ganzen Kanton anfassen. */
export const MAX_PRO_LAUF = spanne(process.env.WEBCHECK_MAX, 500, 1, 5000);

/**
 * Wie viele Google-Abfragen ein Lauf hoechstens macht. Anders als der
 * HTTP-Teil kostet Google Geld, deshalb eine eigene, kleine Bremse.
 */
export const GOOGLE_MAX = spanne(process.env.WEBCHECK_GOOGLE_MAX, 100, 0, 2000);

/** Ab wann ein Betrieb wieder geprueft werden darf. */
export const WIEDERHOLUNG_TAGE = spanne(process.env.WEBCHECK_MAX_ALTER_TAGE, 30, 0, 3650);

function spanne(raw, fallback, min, max) {
  const wert = Number(raw);
  return Number.isFinite(wert) ? Math.min(max, Math.max(min, wert)) : fallback;
}

let laufend = null;

// --- Auswahl ---------------------------------------------------------------

/**
 * Teilt eine Liste Betriebe in "hat etwas zu holen" und "bringt nichts".
 *
 * Ohne Website und ohne Google ist nichts zu messen - solche Betriebe werden
 * gar nicht erst eingereiht, statt einen Lauf mit Leerlauf zu fuellen. Fuer
 * die ist der Schnell-Check da.
 */
export function kandidaten(venues, { google: mitGoogle = false, force = false, max = MAX_PRO_LAUF } = {}) {
  const grenze = Date.now() - WIEDERHOLUNG_TAGE * 86_400_000;
  const machen = [];
  let kuerzlich = 0;
  let nichtsZuHolen = 0;
  let googleNoetig = 0;

  for (const v of venues) {
    const hatWebsite = Boolean(v.website);
    if (!hatWebsite && !mitGoogle) { nichtsZuHolen += 1; continue; }

    if (!force && v.web_check_at && Date.parse(`${v.web_check_at}Z`) > grenze) {
      kuerzlich += 1;
      continue;
    }
    if (!hatWebsite) {
      if (googleNoetig >= GOOGLE_MAX) { nichtsZuHolen += 1; continue; }
      googleNoetig += 1;
    }
    machen.push(v);
  }

  return {
    machen: machen.slice(0, max),
    uebrig: Math.max(0, machen.length - max),
    kuerzlich,
    nichtsZuHolen,
    googleNoetig: Math.min(googleNoetig, max),
  };
}

// --- Ein Betrieb -----------------------------------------------------------

/**
 * Prueft einen Betrieb und schreibt das Ergebnis zurueck.
 * Wirft nicht: ein unerreichbarer Server ist ein Ergebnis, kein Fehler.
 */
export async function pruefeBetrieb(venueId, { google: mitGoogle = false } = {}) {
  const venue = getVenue(venueId);
  if (!venue) return null;

  let website = venue.website;
  let ausGoogle = null;

  // Ohne bekannte Adresse gibt es nichts zu messen. Google ist die einzige
  // Quelle, die "der Laden hat keine Website" belegen kann - ein fehlender
  // OSM-Tag belegt das nicht.
  if (!website && mitGoogle && google.isEnabled()) {
    ausGoogle = await google.lookupVenue(venue).catch((err) => ({ fehler: err.message }));
    if (ausGoogle?.website) website = ausGoogle.website;
  }

  let befund = null;
  let urteil = null;
  let kontakte = {};

  if (website) {
    befund = await holen(website);
    urteil = beurteilen(befund);

    if (befund.ok && befund.html) {
      kontakte = kontakteAusHtml(befund.html);

      // Telefon und Mail stehen in der Schweiz fast immer im Impressum und
      // nicht auf der Startseite. Ein zweiter Abruf verdoppelt die Ausbeute
      // und kostet eine halbe Sekunde.
      if (!kontakte.phone || !kontakte.email) {
        const seite = kontaktseite(befund.html, befund.finalUrl);
        if (seite) {
          const zweiter = await holen(seite);
          if (zweiter.ok && zweiter.html) {
            const mehr = kontakteAusHtml(zweiter.html);
            kontakte = {
              phone: kontakte.phone || mehr.phone,
              email: kontakte.email || mehr.email,
              instagram: kontakte.instagram || mehr.instagram,
              facebook: kontakte.facebook || mehr.facebook,
            };
          }
        }
      }
    }
  }

  const { patch, notiz, treffer } = bauePatch(venue, { befund, urteil, kontakte, ausGoogle });
  const aktualisiert = updateVenue(venueId, patch);
  return { venue: aktualisiert, notiz, treffer };
}

/**
 * Baut aus einem Befund den Patch fuer den Betrieb.
 *
 * Rein und exportiert, damit sich die Regeln pruefen lassen, ohne eine Seite
 * abzurufen - genau wie buildPatch() in analysis.js.
 */
export function bauePatch(venue, { befund, urteil, kontakte = {}, ausGoogle = null }) {
  const patch = { web_check_at: jetzt() };
  const treffer = { erreichbar: 0, tot: 0, unklar: 0, neu: [] };

  // Nur leere Felder fuellen. Was von Hand oder aus einer Analyse drinsteht,
  // ist besser als alles, was ein Muster aus einer Seite klaubt.
  const fuellen = (feld, wert) => {
    if (!wert || venue[feld]) return;
    patch[feld] = wert;
    treffer.neu.push(feld);
  };

  if (ausGoogle && !ausGoogle.fehler) {
    fuellen('website', ausGoogle.website);
    fuellen('phone', telefonnummer(ausGoogle.phone) || ausGoogle.phone);
    fuellen('opening_hours', ausGoogle.opening_hours);
    if (ausGoogle.rating != null && venue.rating == null) patch.rating = ausGoogle.rating;
    if (ausGoogle.review_count != null && venue.review_count == null) {
      patch.review_count = ausGoogle.review_count;
    }
    // Fakt, kein Pipeline-Status: 'geschlossen' setzt Kevin oder die Analyse.
    if (ausGoogle.permanently_closed) patch.permanently_closed = 1;

    // Google kennt die Website eines Betriebs zuverlaessig. Fehlt sie dort,
    // ist "keine" eine Aussage und keine Datenluecke - das ist der einzige
    // Weg, auf dem dieser Lauf 'keine' setzen darf.
    if (!ausGoogle.website && !venue.website) {
      patch.website_status = 'keine';
      patch.verified = 1;
      patch.web_check_note = 'Google kennt den Betrieb, aber keine Website';
      return { patch, notiz: patch.web_check_note, treffer };
    }
  }

  if (!befund) {
    patch.web_check_note = ausGoogle?.fehler
      ? `Google: ${ausGoogle.fehler}`
      : ausGoogle
        ? 'Bei Google nicht gefunden'
        : 'Keine Website hinterlegt — nichts zu prüfen';
    treffer.unklar = 1;
    return { patch, notiz: patch.web_check_note, treffer };
  }

  if (befund.ok) treffer.erreichbar = 1;
  else if (urteil?.hart) treffer.tot = 1;
  else treffer.unklar = 1;

  // Eine Adresse, die auf Facebook oder Instagram landet, ist keine Website.
  // Der Verweis geht ins passende Feld, damit die Information nicht verloren
  // geht - die website-Spalte wird frei.
  if (urteil?.sozial) {
    if (/instagram/i.test(befund.host)) {
      fuellen('instagram', befund.finalUrl.split('/').filter(Boolean).pop());
    } else {
      fuellen('facebook', befund.finalUrl);
    }
    patch.website = null;
  }

  fuellen('phone', kontakte.phone);
  fuellen('email', kontakte.email);
  fuellen('instagram', kontakte.instagram);
  fuellen('facebook', kontakte.facebook);

  // Gefunden heisst nicht aktiv: ob hinter dem Handle seit zwei Jahren nichts
  // mehr passiert, sieht man nur beim Hineinschauen. instagram_status bleibt
  // deshalb 'unbekannt' - dafuer ist der Schnell-Check da.

  const status = statusEntscheid(venue.website_status, urteil);
  if (status) {
    patch.website_status = status;
    patch.verified = 1;
  }

  patch.web_check_note = urteil?.notiz || null;
  return { patch, notiz: patch.web_check_note, treffer };
}

/**
 * Darf dieser Befund den gespeicherten Website-Zustand ersetzen?
 *
 * Ein harter Befund (Domain tot, Weiterleitung auf Facebook) ist eine
 * Tatsache und schlaegt jedes Urteil. Alles andere ist gemessen: es fuellt
 * eine Luecke und korrigiert eine Messung, ruehrt aber ein Urteil aus einer
 * Analyse ('gut', 'veraltet') nicht an. Sonst wuerde ein HTTP-Abruf eine
 * moderne Seite auf "brauchbar" herabstufen, weil er Geschmack nicht messen
 * kann.
 */
export function statusEntscheid(alt, urteil) {
  if (!urteil?.status) return null;
  if (urteil.hart) return urteil.status;
  if (alt === 'gut' || alt === 'veraltet') return null;
  return urteil.status;
}

// --- Stapellauf ------------------------------------------------------------

export function anreicherungState() {
  return laufend ? { ...bericht(laufend), laeuft: true } : { laeuft: false };
}

export function stopAnreicherung() {
  if (!laufend) return false;
  laufend.abbruch = true;
  return true;
}

/**
 * Startet den Lauf und kehrt sofort zurueck - der Fortschritt kommt ueber den
 * Ereignisstrom, wie beim Regions-Lauf. 400 Betriebe dauern gut zwei Minuten,
 * so lange soll keine HTTP-Anfrage offen stehen.
 */
export function startAnreicherung(venues, { google: mitGoogle = false } = {}) {
  if (laufend) {
    const err = new Error('Es läuft schon eine Anreicherung. Bitte abwarten.');
    err.status = 409;
    throw err;
  }
  if (!venues.length) {
    const err = new Error('Keine Betriebe zum Prüfen');
    err.status = 400;
    throw err;
  }

  laufend = {
    gesamt: venues.length,
    erledigt: 0,
    erreichbar: 0,
    tot: 0,
    unklar: 0,
    neu: { phone: 0, email: 0, instagram: 0, facebook: 0, website: 0 },
    fehler: 0,
    mitGoogle,
    gestartet: new Date().toISOString(),
    abbruch: false,
  };

  // Absichtlich nicht awaited.
  lauf(venues, mitGoogle).catch((err) => {
    console.error('[anreicherung]', err);
    publish({ type: 'anreicherung', phase: 'fehler', meldung: err.message });
    laufend = null;
  });

  return { ...bericht(laufend), laeuft: true };
}

async function lauf(venues, mitGoogle) {
  publish({ type: 'anreicherung', phase: 'start', gesamt: venues.length, google: mitGoogle });

  let naechster = 0;
  const arbeiter = Array.from({ length: Math.min(GLEICHZEITIG, venues.length) }, async () => {
    while (naechster < venues.length && !laufend?.abbruch) {
      const venue = venues[naechster];
      naechster += 1;
      await einBetrieb(venue, mitGoogle);
    }
  });

  await Promise.all(arbeiter);

  const ergebnis = { ...bericht(laufend), abgebrochen: Boolean(laufend?.abbruch) };
  publish({ type: 'anreicherung', phase: 'fertig', ...ergebnis });
  laufend = null;
  return ergebnis;
}

async function einBetrieb(venue, mitGoogle) {
  try {
    const res = await pruefeBetrieb(venue.id, { google: mitGoogle });
    if (!res) return;

    laufend.erreichbar += res.treffer.erreichbar;
    laufend.tot += res.treffer.tot;
    laufend.unklar += res.treffer.unklar;
    for (const feld of res.treffer.neu) {
      if (feld in laufend.neu) laufend.neu[feld] += 1;
    }

    // Damit Karte und Liste mitlaufen - derselbe Weg, den ein Agentenlauf
    // nimmt.
    publish({ type: 'venue', venue: res.venue });
  } catch (err) {
    laufend.fehler += 1;
    console.warn(`[anreicherung] ${venue.name}: ${err.message}`);
  } finally {
    laufend.erledigt += 1;
    publish({ type: 'anreicherung', phase: 'fortschritt', ...bericht(laufend) });
  }
}

function bericht(l) {
  return {
    gesamt: l.gesamt,
    erledigt: l.erledigt,
    erreichbar: l.erreichbar,
    tot: l.tot,
    unklar: l.unklar,
    neu: { ...l.neu },
    fehler: l.fehler,
    google: l.mitGoogle,
  };
}

function jetzt() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
