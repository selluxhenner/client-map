import { Router } from 'express';
import * as overpass from '../providers/overpass.js';
import * as google from '../providers/google.js';
import { geocode } from '../providers/nominatim.js';
import { upsertDiscovered } from '../lib/venue-store.js';
import { publish } from '../lib/bus.js';
import { db } from '../db.js';

export const discoverRouter = Router();

// Grosse Ausschnitte liefern tausende Treffer und quaelen den oeffentlichen
// Overpass-Server. Lieber ehrlich abbrechen als minutenlang haengen.
const MAX_AREA_DEG = 0.35;

discoverRouter.get('/geocode', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Suchbegriff fehlt' });
    res.json(await geocode(q));
  } catch (err) {
    next(err);
  }
});

discoverRouter.post('/discover', async (req, res, next) => {
  try {
    const bbox = readBbox(req.body);
    if (!bbox) return res.status(400).json({ error: 'Ungültiger Kartenausschnitt' });

    const height = bbox.north - bbox.south;
    const width = bbox.east - bbox.west;
    if (height > MAX_AREA_DEG || width > MAX_AREA_DEG) {
      return res.status(400).json({
        error: 'Ausschnitt zu gross. Zoome näher heran und suche den Bereich in Etappen ab.',
      });
    }

    // Die Suche dauert je nach Auslastung von Overpass zwischen zwei und
    // sechzig Sekunden. Ohne Zwischenstand sieht das aus wie ein Absturz,
    // deshalb meldet jeder Abschnitt, dass er begonnen hat.
    publish({ type: 'discover', phase: 'overpass', bbox });
    const found = await overpass.fetchVenues(bbox);

    // Google liefert Bewertungen und verifizierte Website-URLs. Laeuft nur,
    // wenn ein Key hinterlegt ist - sonst stillschweigend uebersprungen.
    let fromGoogle = [];
    if (google.isEnabled()) {
      publish({ type: 'discover', phase: 'google', gefunden: found.length });
      try {
        fromGoogle = await google.fetchVenues(bbox);
      } catch (err) {
        console.warn(`[discover] Google übersprungen: ${err.message}`);
      }
    }

    publish({
      type: 'discover',
      phase: 'speichern',
      gefunden: found.length + fromGoogle.length,
    });
    const result = upsertDiscovered([...found, ...fromGoogle]);

    db.prepare(
      `INSERT INTO scanned_areas (south, west, north, east, found)
       VALUES (@south, @west, @north, @east, @found)`
    ).run({ ...bbox, found: found.length + fromGoogle.length });

    const bericht = {
      ...result,
      found: found.length + fromGoogle.length,
      quellen: { osm: found.length, google: fromGoogle.length },
      // Google gibt hoechstens 20 Treffer je Anfrage. Wurde gekappt, ist der
      // Ausschnitt NICHT vollstaendig - das muss in der Oberflaeche stehen.
      gekappt: Boolean(fromGoogle.gekappt),
    };
    publish({ type: 'discover', phase: 'fertig', ...bericht });
    res.json(bericht);
  } catch (err) {
    publish({ type: 'discover', phase: 'fehler', meldung: err.message });
    next(err);
  }
});

discoverRouter.get('/scanned-areas', (_req, res) => {
  res.json(db.prepare('SELECT * FROM scanned_areas ORDER BY id DESC LIMIT 500').all());
});

function readBbox(body = {}) {
  const { south, west, north, east } = body;
  const values = [south, west, north, east].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [s, w, n, e] = values;
  if (n <= s || e <= w) return null;
  return { south: s, west: w, north: n, east: e };
}
