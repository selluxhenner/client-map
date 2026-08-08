// Doppelte Betriebe finden und zusammenfuehren.
//
// Die wichtigste Erkenntnis aus den echten Daten: **Naehe allein beweist
// nichts.** In der Wiler Altstadt liegen 128 Paare weniger als 80 Meter
// auseinander, und praktisch alle sind verschiedene Lokale ("Laghetto" neben
// "La Patrona"). Wer nach Abstand dedupliziert, führt Nachbarn zusammen und
// verliert echte Betriebe.
//
// Deshalb umgekehrt: es braucht ein NAMENS- oder KONTAKT-Indiz, und die Naehe
// bestaetigt es nur. Und selbst dann wird nichts automatisch zusammengelegt.

import { db } from '../db.js';
import { getVenue, updateVenue } from './venue-store.js';
import { kennWorte, fastGleich, slugify } from './text.js';
import { STATUS_KEYS } from '../scoring.js';

/** Wie nah zwei Eintraege sein muessen, damit Naehe als Bestaetigung zaehlt. */
const NAH_GRAD = 0.0025; // etwa 250 m

/**
 * Bis hierhin darf eine gemeinsame Website als Indiz gelten. Grosszuegiger als
 * NAH_GRAD, weil ein Lieferdienst zwei Standorte haben kann - aber weit unter
 * der Distanz, in der Kettenfilialen dieselbe Domain teilen.
 */
const WEB_NAH_METER = 2000;

// --- Finden -----------------------------------------------------------------

/**
 * Sucht Paare, die derselbe Betrieb sein koennten.
 *
 * Jedes Paar bringt seinen Grund mit - ohne den kann man eine Zusammenfuehrung
 * nicht verantworten.
 */
export function findDuplicates() {
  const alle = db
    .prepare(`SELECT id, name, city, street, lat, lng, phone, email, website, instagram,
                     source, source_id, status, score, notes, tags, demo_path,
                     analysis_path, verified, last_contact_at, permanently_closed, is_chain
              FROM venues ORDER BY id`)
    .all();

  const paare = new Map();
  const merken = (a, b, grund, sicherheit) => {
    const key = `${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}`;
    const da = paare.get(key);
    if (da) {
      if (!da.gruende.includes(grund)) da.gruende.push(grund);
      da.sicherheit = Math.max(da.sicherheit, sicherheit);
      return;
    }
    paare.set(key, {
      a: kurz(a), b: kurz(b), gruende: [grund], sicherheit,
      abstand: Math.round(meter(a, b)),
    });
  };

  // 1. Gleiche Telefonnummer oder gleiche Mailadresse. Das staerkste Indiz -
  //    zwei Lokale teilen keine Nummer, auch nicht in derselben Gasse.
  gruppieren(alle, (v) => telefonSchluessel(v.phone)).forEach((gruppe) =>
    jedesPaar(gruppe, (a, b) => merken(a, b, 'gleiche Telefonnummer', 0.95))
  );
  gruppieren(alle, (v) => (v.email || '').toLowerCase() || null).forEach((gruppe) =>
    jedesPaar(gruppe, (a, b) => merken(a, b, 'gleiche E-Mail', 0.9))
  );

  // 2. Gleiche Website-Domain oder gleicher Instagram-Account.
  //
  //    Schwaecher als es klingt, und die echten Daten zeigen auch warum: alle
  //    Migros-Filialen teilen migros.ch, zwei davon liegen 11 km auseinander.
  //    Deshalb zaehlt dieses Indiz nur in der Naehe, nie bei Ketten, und die
  //    Sicherheit haengt daran, ob die Namen dazu passen - "Boulevard" und
  //    "Swan21" im selben Haus teilen eine Website und sind doch zwei Lokale.
  const gemeinsamerAuftritt = (grund, basis) => (a, b) => {
    if (a.is_chain || b.is_chain) return;
    if (meter(a, b) > WEB_NAH_METER) return;
    merken(a, b, grund, basis * (0.6 + 0.4 * namensAehnlichkeit(a.name, b.name)));
  };

  gruppieren(alle, (v) => domain(v.website)).forEach((gruppe) =>
    jedesPaar(gruppe, gemeinsamerAuftritt('gleiche Website', 0.9))
  );
  gruppieren(alle, (v) => (v.instagram || '').toLowerCase() || null).forEach((gruppe) =>
    jedesPaar(gruppe, gemeinsamerAuftritt('gleicher Instagram-Account', 0.9))
  );

  // 3. Gleicher Name - aber nur zusammen mit Naehe. "Rössli" gibt es in jedem
  //    zweiten Dorf, das sind verschiedene Betriebe.
  gruppieren(alle, (v) => slugify(v.name) || null).forEach((gruppe) =>
    jedesPaar(gruppe, (a, b) => {
      if (meter(a, b) <= NAH_GRAD * 111_000) merken(a, b, 'gleicher Name, gleicher Ort', 0.9);
    })
  );

  // 4. Sehr aehnlicher Name UND nah beieinander. Faengt "Café Central" neben
  //    "Cafe Central AG" und Tippfehler aus dem manuellen Setzen.
  for (let i = 0; i < alle.length; i += 1) {
    for (let j = i + 1; j < alle.length; j += 1) {
      const a = alle[i];
      const b = alle[j];
      if (Math.abs(a.lat - b.lat) > NAH_GRAD || Math.abs(a.lng - b.lng) > NAH_GRAD) continue;
      const gleich = namensAehnlichkeit(a.name, b.name);
      if (gleich >= 0.8) merken(a, b, 'sehr ähnlicher Name in Gehweite', 0.7 + gleich * 0.2);
    }
  }

  return [...paare.values()].sort((x, y) => y.sicherheit - x.sicherheit || x.abstand - y.abstand);
}

/** Anteil gemeinsamer Kennworte, Tippfehler zaehlen fast voll. */
export function namensAehnlichkeit(links, rechts) {
  const a = kennWorte(links);
  const b = kennWorte(rechts);
  if (!a.length || !b.length) return 0;

  let gewicht = 0;
  for (const wort of a) {
    if (b.includes(wort)) gewicht += 1;
    else if (b.some((w) => fastGleich(w, wort))) gewicht += 0.8;
  }
  return Math.min(1, gewicht / Math.min(a.length, b.length));
}

// --- Zusammenfuehren --------------------------------------------------------

/**
 * Fuehrt zwei Betriebe zusammen. `behalten` bleibt, `aufgeben` verschwindet.
 *
 * Grundregel: **es darf nichts verloren gehen.** Leere Felder werden gefuellt,
 * der weiter fortgeschrittene Status gewinnt, Notizen werden aneinandergehaengt
 * statt ueberschrieben, und die Kontakt-Historie zieht mit um. Was sich
 * widerspricht, landet in der Notiz - lieber ein Satz zu viel als eine
 * geloeschte Information.
 */
export function mergeVenues(behaltenId, aufgebenId) {
  if (behaltenId === aufgebenId) throw new Error('Ein Betrieb kann nicht mit sich selbst zusammengeführt werden');

  const bleibt = getVenue(behaltenId);
  const geht = getVenue(aufgebenId);
  if (!bleibt || !geht) throw new Error('Betrieb nicht gefunden');

  const patch = {};
  const bericht = [];

  // Leere Faktenfelder auffuellen.
  for (const feld of ['phone', 'email', 'website', 'instagram', 'facebook', 'opening_hours',
                      'cuisine', 'street', 'zip', 'city', 'canton', 'venue_type',
                      'demo_path', 'analysis_path', 'analysis_summary', 'analysis_kind',
                      'follow_up_at', 'follow_up_note', 'outreach_draft', 'outreach_draft_at']) {
    if (!bleibt[feld] && geht[feld]) {
      patch[feld] = geht[feld];
      bericht.push(`${feld} übernommen`);
    }
  }

  // Zahlen: die belastbarere Angabe gewinnt (mehr Bewertungen = mehr Substanz).
  if ((geht.review_count || 0) > (bleibt.review_count || 0)) {
    patch.review_count = geht.review_count;
    if (geht.rating != null) patch.rating = geht.rating;
    bericht.push('Bewertung übernommen');
  }

  // Geprueft schlaegt ungeprueft, und ein belegter Website-Zustand schlaegt
  // 'unbekannt'.
  if (!bleibt.verified && geht.verified) {
    patch.verified = 1;
    patch.website_status = geht.website_status;
    patch.instagram_status = geht.instagram_status;
    bericht.push('geprüften Zustand übernommen');
  } else if (bleibt.website_status === 'unbekannt' && geht.website_status !== 'unbekannt') {
    patch.website_status = geht.website_status;
    bericht.push('Website-Zustand übernommen');
  }

  if (geht.permanently_closed && !bleibt.permanently_closed) {
    patch.permanently_closed = 1;
    bericht.push('als geschlossen markiert');
  }

  // Der weiter fortgeschrittene Pipeline-Status gewinnt.
  if (STATUS_KEYS.indexOf(geht.status) > STATUS_KEYS.indexOf(bleibt.status)) {
    patch.status = geht.status;
    bericht.push(`Status auf "${geht.status}" gezogen`);
  }

  if (geht.last_contact_at && (!bleibt.last_contact_at || geht.last_contact_at > bleibt.last_contact_at)) {
    patch.last_contact_at = geht.last_contact_at;
  }

  // Tags vereinen.
  const tags = [...new Set([...(bleibt.tags || []), ...(geht.tags || [])])];
  if (tags.length !== (bleibt.tags || []).length) patch.tags = tags;

  // Notizen aneinanderhaengen. Nie ueberschreiben - das ist Handarbeit.
  const zusatz = [
    geht.notes?.trim() ? `Aus zusammengeführtem Eintrag "${geht.name}":\n${geht.notes.trim()}` : null,
    `Zusammengeführt am ${heute()}: #${geht.id} "${geht.name}" (${geht.source}) → #${bleibt.id}.`,
  ].filter(Boolean).join('\n\n');
  patch.notes = [bleibt.notes?.trim(), zusatz].filter(Boolean).join('\n\n');

  // Herkunft: fehlt dem Bleibenden eine Quell-Kennung, die des anderen nehmen.
  // Der eindeutige Index laesst nur zu, dass sie frei ist.
  if (!bleibt.source_id && geht.source_id && bleibt.source === geht.source) {
    patch.source_id = geht.source_id;
  }

  const kontakte = db
    .prepare('SELECT COUNT(*) AS n FROM interactions WHERE venue_id = ?')
    .get(geht.id).n;

  const durchfuehren = db.transaction(() => {
    // Historie umziehen, bevor der Eintrag verschwindet - sonst nimmt sie
    // ON DELETE CASCADE mit.
    db.prepare('UPDATE interactions SET venue_id = ? WHERE venue_id = ?').run(bleibt.id, geht.id);
    // Auftraege zeigen auf den Bleibenden, damit die Log-Historie erhalten bleibt.
    db.prepare('UPDATE jobs SET venue_id = ? WHERE venue_id = ?').run(bleibt.id, geht.id);
    db.prepare('DELETE FROM venues WHERE id = ?').run(geht.id);
  });

  durchfuehren();
  const zusammen = updateVenue(bleibt.id, patch);

  return {
    venue: zusammen,
    entfernt: { id: geht.id, name: geht.name },
    kontakteUmgezogen: kontakte,
    uebernommen: bericht,
  };
}

/**
 * Welcher der beiden sollte bleiben? Der mit mehr Handarbeit drin.
 *
 * Die Reihenfolge ist Absicht: ein Pipeline-Status weiter vorn wiegt mehr als
 * ein vollstaendigeres Adressfeld, weil er die Information ist, die man nicht
 * wiederherstellen kann.
 */
export function besserBehalten(a, b) {
  const punkte = (v) => (
    STATUS_KEYS.indexOf(v.status) * 100 +
    (v.notes ? 40 : 0) +
    (v.demo_path ? 30 : 0) +
    (v.analysis_path ? 20 : 0) +
    (v.last_contact_at ? 20 : 0) +
    (v.verified ? 10 : 0) +
    (v.phone ? 2 : 0) + (v.website ? 2 : 0) + (v.instagram ? 2 : 0)
  );
  return punkte(a) >= punkte(b) ? a.id : b.id;
}

// --- Helfer -----------------------------------------------------------------

function kurz(v) {
  return {
    id: v.id, name: v.name, city: v.city, street: v.street, source: v.source,
    status: v.status, score: v.score, verified: Boolean(v.verified),
    phone: v.phone, website: v.website, instagram: v.instagram,
    hatNotizen: Boolean(v.notes), hatDemo: Boolean(v.demo_path),
    hatAnalyse: Boolean(v.analysis_path), kontaktiert: v.last_contact_at,
  };
}

function gruppieren(liste, schluesselVon) {
  const map = new Map();
  for (const eintrag of liste) {
    const key = schluesselVon(eintrag);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(eintrag);
  }
  return [...map.values()].filter((g) => g.length > 1);
}

function jedesPaar(gruppe, fn) {
  for (let i = 0; i < gruppe.length; i += 1) {
    for (let j = i + 1; j < gruppe.length; j += 1) fn(gruppe[i], gruppe[j]);
  }
}

/** Nur die Ziffern, damit "071 911 22 33" und "+41719112233" gleich sind. */
function telefonSchluessel(phone) {
  if (!phone) return null;
  const ziffern = String(phone).replace(/\D/g, '').replace(/^0041/, '').replace(/^41/, '').replace(/^0/, '');
  return ziffern.length >= 7 ? ziffern.slice(-9) : null;
}

function domain(url) {
  if (!url) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
    return host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function meter(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function heute() {
  return new Date().toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
