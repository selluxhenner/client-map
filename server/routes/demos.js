import { Router } from 'express';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getVenue, listVenues, updateVenue } from '../lib/venue-store.js';
import {
  candidatesFor, demoRoot, listDemoFolders, resolveDemoPath, scanRoots,
} from '../lib/demos.js';
import { bestandFor } from '../lib/bestand.js';
import { db } from '../db.js';

export const demosRouter = Router();

/**
 * Der Abgleich: was liegt auf der Platte, und zu welchem Betrieb koennte es
 * gehoeren. Nur Vorschlaege - uebernommen wird ueber /demos/link.
 */
demosRouter.get('/demos', (_req, res) => {
  const { venues } = listVenues({ limit: 20_000, includeClosed: '1' });
  const verknuepft = new Map(
    venues.filter((v) => v.demo_path).map((v) => [String(v.demo_path).toLowerCase(), v])
  );

  const ordner = listDemoFolders().map((f) => {
    const schon = verknuepft.get(f.name.toLowerCase());
    const wissen = bestandFor(f.name);

    // Der Name aus PLAN §7b trifft oft besser als der Ordnername, weil dort
    // der echte Betriebsname steht ("Säntis Kebab" statt "saentis-kebab").
    const suchbegriff = wissen.name || f.name;
    const vorschlaege = candidatesFor(suchbegriff, venues);
    if (wissen.name && !vorschlaege.length) {
      vorschlaege.push(...candidatesFor(f.name, venues));
    }

    return {
      ...f,
      wissen,
      vorschlaege,
      verknuepftMit: schon ? { id: schon.id, name: schon.name, status: schon.status } : null,
    };
  });

  res.json({
    wurzeln: scanRoots().map((pfad) => ({ pfad, vorhanden: existsSync(pfad) })),
    bauZiel: demoRoot(),
    bauZielVorhanden: existsSync(demoRoot()),
    ordner,
    betriebe: venues
      .map((v) => ({ id: v.id, name: v.name, city: v.city, status: v.status }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de')),
  });
});

/**
 * Ordner mit Betrieben verknuepfen. Bewusst als Stapel, damit der Abgleich
 * ein einziger bestaetigter Schritt ist und nicht vierzehn Einzelklicks.
 */
demosRouter.post('/demos/link', (req, res, next) => {
  try {
    const paare = Array.isArray(req.body?.paare) ? req.body.paare : [];
    const ergebnis = [];

    const anwenden = db.transaction(() => {
      for (const { ordner, venue_id: venueId, status } of paare) {
        const venue = getVenue(Number(venueId));
        if (!venue || !ordner) {
          ergebnis.push({ ordner, ok: false, grund: 'Betrieb nicht gefunden' });
          continue;
        }
        const patch = { demo_path: String(ordner) };
        // Der Status kommt aus der Oberflaeche, also von Hand - deshalb wird
        // er hier genommen wie er ist. Ohne Angabe bleibt er, wie er war.
        if (status) patch.status = String(status);
        updateVenue(venue.id, patch);
        ergebnis.push({ ordner, ok: true, venue: venue.name, status: status || venue.status });
      }
    });
    anwenden();

    res.json({ verknuepft: ergebnis.filter((e) => e.ok).length, ergebnis });
  } catch (err) {
    next(err);
  }
});

/** Verknuepfung wieder loesen, ohne den Ordner anzufassen. */
demosRouter.post('/demos/unlink', (req, res, next) => {
  try {
    const venue = getVenue(Number(req.body?.venue_id));
    if (!venue) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(updateVenue(venue.id, { demo_path: null }));
  } catch (err) {
    next(err);
  }
});

/**
 * Ordner im Explorer zeigen. Das ist der Punkt, an dem ein Pfad in der
 * Datenbank ueberhaupt nuetzlich wird - sonst muesste man ihn abschreiben.
 * Geoeffnet wird nur, was unterhalb der bekannten Wurzeln liegt.
 */
demosRouter.post('/demos/open', (req, res) => {
  const pfad = resolveDemoPath(req.body?.ordner);
  if (!pfad) return res.status(404).json({ error: 'Ordner nicht gefunden' });
  if (process.platform !== 'win32') {
    return res.status(400).json({ error: `Ordner liegt hier: ${pfad}` });
  }
  spawn('explorer.exe', [pfad], { detached: true, stdio: 'ignore' }).unref();
  res.json({ geoeffnet: pfad });
});
