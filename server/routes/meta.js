import { Router } from 'express';
import { db } from '../db.js';
import {
  STATUS, WEBSITE_STATUS, INSTAGRAM_STATUS, SCORE_BANDS,
} from '../scoring.js';
import { isEnabled as googleEnabled } from '../providers/google.js';

export const metaRouter = Router();

// Farben, Labels und Startposition kommen aus einer einzigen Quelle im
// Backend. So koennen Karte, Liste und spaetere Ansichten nicht auseinander
// laufen, wenn du in scoring.js eine Farbe aenderst.
metaRouter.get('/config', (_req, res) => {
  res.json({
    status: STATUS,
    websiteStatus: WEBSITE_STATUS,
    instagramStatus: INSTAGRAM_STATUS,
    scoreBands: SCORE_BANDS,
    google: googleEnabled(),
    map: {
      lat: Number(process.env.MAP_START_LAT) || 47.4628,
      lng: Number(process.env.MAP_START_LNG) || 9.0453,
      zoom: Number(process.env.MAP_START_ZOOM) || 14,
    },
    staedte: db
      .prepare(
        "SELECT city, COUNT(*) AS n FROM venues WHERE city IS NOT NULL AND city <> '' GROUP BY city ORDER BY n DESC"
      )
      .all(),
  });
});

metaRouter.get('/filters', (_req, res) => {
  res.json(db.prepare('SELECT * FROM saved_filters ORDER BY builtin DESC, sort_order, id').all());
});

metaRouter.post('/filters', (req, res) => {
  const { name, query } = req.body || {};
  if (!name || !query) return res.status(400).json({ error: 'Name und Filter nötig' });
  const info = db
    .prepare('INSERT INTO saved_filters (name, query, builtin) VALUES (?, ?, 0)')
    .run(String(name), String(query));
  res.status(201).json(db.prepare('SELECT * FROM saved_filters WHERE id = ?').get(info.lastInsertRowid));
});

metaRouter.delete('/filters/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM saved_filters WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Nicht gefunden' });
  if (row.builtin) return res.status(400).json({ error: 'Eingebaute Filter lassen sich nicht löschen' });
  db.prepare('DELETE FROM saved_filters WHERE id = ?').run(row.id);
  res.status(204).end();
});
