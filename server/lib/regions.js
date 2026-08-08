// Regions-Stapel: mehrere Ortschaften auf einmal absuchen.
//
// Bisher war Discovery an den Kartenausschnitt gebunden - einen Kanton
// abzusuchen hiess vierzig Mal zoomen und klicken. Hier gibt man eine Liste
// von Ortsnamen und laesst laufen.
//
// Zwei Ruecksichten bestimmen den Ablauf, und beide sind der Grund, warum das
// nacheinander und nicht parallel laeuft:
//
// 1. Nominatim erlaubt eine Anfrage pro Sekunde. Das drosselt der Anbieter
//    selbst, aber nur, wenn man ihn nicht mit Parallelitaet umgeht.
// 2. Overpass ist ein oeffentlicher Gratisdienst. Ein Ort in Ruhe ist
//    freundlich, zehn gleichzeitig ist eine kleine Attacke.

import { geocode } from '../providers/nominatim.js';
import * as overpass from '../providers/overpass.js';
import * as google from '../providers/google.js';
import { upsertDiscovered } from './venue-store.js';
import { publish } from './bus.js';
import { db } from '../db.js';

/** Groesster Ausschnitt, den Overpass in einem Stueck verkraftet (Grad). */
const MAX_KACHEL = 0.28;

/** Pause zwischen zwei Overpass-Abfragen. Hoeflichkeit, kein technisches Muss. */
const PAUSE_MS = Math.max(500, Number(process.env.REGION_PAUSE_MS) || 1500);

/** Wie viele Ortsnamen ein Lauf annimmt. */
const MAX_ORTE = 40;

let laufend = null;

export function regionState() {
  return laufend ? { ...laufend, laeuft: true } : { laeuft: false };
}

/**
 * Startet den Lauf und kehrt sofort zurueck. Der Fortschritt kommt ueber den
 * Ereignisstrom, damit die Seite auch dann noch etwas zeigt, wenn der Lauf
 * eine halbe Stunde dauert.
 */
export function startRegionScan(namen) {
  if (laufend) {
    const err = new Error('Es läuft schon ein Regions-Lauf. Bitte abwarten.');
    err.status = 409;
    throw err;
  }

  const orte = [...new Set(
    (Array.isArray(namen) ? namen : String(namen || '').split('\n'))
      .map((n) => String(n).trim())
      .filter(Boolean)
  )].slice(0, MAX_ORTE);

  if (!orte.length) {
    const err = new Error('Keine Ortsnamen angegeben');
    err.status = 400;
    throw err;
  }

  laufend = {
    orte,
    gesamt: orte.length,
    erledigt: 0,
    aktuell: null,
    gefunden: 0,
    neu: 0,
    ergaenzt: 0,
    ergebnisse: [],
    gestartet: new Date().toISOString(),
    abbruch: false,
  };

  // Absichtlich nicht awaited: der Aufrufer bekommt sofort eine Antwort.
  lauf().catch((err) => {
    console.error('[regionen]', err);
    publish({ type: 'region', phase: 'fehler', meldung: err.message });
    laufend = null;
  });

  return { ...laufend, laeuft: true };
}

export function stopRegionScan() {
  if (!laufend) return false;
  laufend.abbruch = true;
  return true;
}

async function lauf() {
  publish({ type: 'region', phase: 'start', gesamt: laufend.gesamt, orte: laufend.orte });

  for (const ort of laufend.orte) {
    if (laufend.abbruch) break;

    laufend.aktuell = ort;
    publish({ type: 'region', phase: 'ort', ort, erledigt: laufend.erledigt, gesamt: laufend.gesamt });

    try {
      const ergebnis = await einOrt(ort);
      laufend.gefunden += ergebnis.gefunden;
      laufend.neu += ergebnis.inserted;
      laufend.ergaenzt += ergebnis.updated;
      laufend.ergebnisse.push({ ort, ...ergebnis });
      publish({ type: 'region', phase: 'ort-fertig', ort, ...ergebnis });
    } catch (err) {
      laufend.ergebnisse.push({ ort, fehler: err.message });
      publish({ type: 'region', phase: 'ort-fehler', ort, meldung: err.message });
    }

    laufend.erledigt += 1;
  }

  const bericht = {
    gesamt: laufend.gesamt,
    erledigt: laufend.erledigt,
    gefunden: laufend.gefunden,
    neu: laufend.neu,
    ergaenzt: laufend.ergaenzt,
    abgebrochen: laufend.abbruch,
    ergebnisse: laufend.ergebnisse,
  };
  publish({ type: 'region', phase: 'fertig', ...bericht });
  laufend = null;
  return bericht;
}

async function einOrt(ort) {
  const treffer = await geocode(ort);
  const passend = treffer.find((t) => t.bbox) || treffer[0];
  if (!passend) throw new Error('Ort nicht gefunden');
  if (!passend.bbox) throw new Error('Ort ohne Umrisse — bitte auf der Karte suchen');

  const kacheln = zerlegen(passend.bbox);
  let gefunden = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < kacheln.length; i += 1) {
    if (laufend?.abbruch) break;
    const kachel = kacheln[i];

    if (i > 0) await warten(PAUSE_MS);
    publish({
      type: 'region', phase: 'kachel', ort,
      kachel: i + 1, kacheln: kacheln.length,
    });

    const roh = await overpass.fetchVenues(kachel);
    let vonGoogle = [];
    if (google.isEnabled()) {
      try {
        vonGoogle = await google.fetchVenues(kachel);
      } catch (err) {
        console.warn(`[regionen] Google übersprungen (${ort}): ${err.message}`);
      }
    }

    const alle = [...roh, ...vonGoogle];
    const res = upsertDiscovered(alle);
    gefunden += alle.length;
    inserted += res.inserted;
    updated += res.updated;
    skipped += res.skipped;

    db.prepare(
      `INSERT INTO scanned_areas (south, west, north, east, found)
       VALUES (@south, @west, @north, @east, @found)`
    ).run({ ...kachel, found: alle.length });
  }

  return { label: passend.label, kacheln: kacheln.length, gefunden, inserted, updated, skipped };
}

/**
 * Zerlegt eine grosse Bounding-Box in Kacheln.
 *
 * Ein Kanton auf einmal laesst Overpass ins Zeitlimit laufen - und ein
 * Zeitlimit nach 40 Sekunden liefert gar nichts, waehrend vier Kacheln
 * vollstaendige Ergebnisse liefern.
 */
export function zerlegen({ south, west, north, east }) {
  const hoch = Math.max(1, Math.ceil((north - south) / MAX_KACHEL));
  const breit = Math.max(1, Math.ceil((east - west) / MAX_KACHEL));
  const dLat = (north - south) / hoch;
  const dLng = (east - west) / breit;

  const kacheln = [];
  for (let y = 0; y < hoch; y += 1) {
    for (let x = 0; x < breit; x += 1) {
      kacheln.push({
        south: south + y * dLat,
        north: south + (y + 1) * dLat,
        west: west + x * dLng,
        east: west + (x + 1) * dLng,
      });
    }
  }
  return kacheln;
}

function warten(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
