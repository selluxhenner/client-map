// Knopf "Daten sammeln": Websites, Telefonnummern und Social-Links fuer
// viele Betriebe auf einmal - ohne Agenten, ohne Kontingent.
//
// Fragt wie der Tiefen-Scan erst trocken nach, wie viel das betrifft. Nicht
// weil es teuer waere (es ist gratis), sondern weil die Zahlen die eigentliche
// Auskunft sind: "84 werden geprueft, 20 sind noch frisch, 16 haben gar keine
// Website hinterlegt" sagt mehr ueber den Datenbestand als jede Anzeige.

import { post, toast, fail } from './api.js';

/** Erfahrungswert: Abruf plus Kontaktseite, acht Betriebe gleichzeitig. */
const SEKUNDEN_PRO_BETRIEB = 2.5;
const GLEICHZEITIG = 8;

export async function startAnreicherung(filter, { force = false } = {}) {
  try {
    const v = await post('/anreicherung', { filter, force, dryRun: true });

    if (!v.kandidaten) {
      toast(meldungOhneKandidaten(v));
      return null;
    }

    const zeilen = [
      `${v.gefiltert} Betriebe im aktuellen Filter.`,
      `${v.kandidaten} werden geprüft: Website abrufen, Telefon, E-Mail, Instagram und Facebook einsammeln.`,
      `Kostet kein Kontingent und dauert ungefähr ${dauer(v.kandidaten)}.`,
      v.googleNoetig
        ? `${v.googleNoetig} davon haben keine hinterlegte Website — die werden bei Google nachgeschlagen (kostenpflichtig).`
        : null,
      v.kuerzlich
        ? `${v.kuerzlich} wurden in den letzten ${v.wiederholungTage} Tagen schon geprüft und bleiben aussen vor.`
        : null,
      v.nichtsZuHolen
        ? `Bei ${v.nichtsZuHolen} gibt es nichts zu messen (keine Website hinterlegt) — dafür ist der Schnell-Check da.`
        : null,
      v.uebrig ? `${v.uebrig} bleiben für einen zweiten Lauf übrig.` : null,
      '',
      'Starten?',
    ].filter(Boolean);

    if (!confirm(zeilen.join('\n'))) return null;

    const bericht = await post('/anreicherung', { filter, force });
    toast(`${bericht.kandidaten} Betriebe werden geprüft`);
    return bericht;
  } catch (err) {
    fail(err);
    return null;
  }
}

function meldungOhneKandidaten(v) {
  if (!v.gefiltert) return 'Keine Betriebe im aktuellen Filter.';
  if (v.kuerzlich === v.gefiltert) {
    return `Alle ${v.gefiltert} wurden in den letzten ${v.wiederholungTage} Tagen schon geprüft.`;
  }
  if (v.nichtsZuHolen) {
    return `Bei diesen ${v.nichtsZuHolen} Betrieben ist keine Website hinterlegt — hier hilft nur der Schnell-Check.`;
  }
  return 'Nichts zu prüfen.';
}

function dauer(anzahl) {
  const sekunden = Math.ceil((anzahl * SEKUNDEN_PRO_BETRIEB) / GLEICHZEITIG);
  if (sekunden < 90) return `${Math.max(5, Math.round(sekunden / 5) * 5)} Sekunden`;
  return `${Math.ceil(sekunden / 60)} Minuten`;
}
