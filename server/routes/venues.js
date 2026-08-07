import { Router } from 'express';
import {
  listVenues, getVenue, createVenue, updateVenue, deleteVenue, stats, HttpError,
} from '../lib/venue-store.js';
import { db } from '../db.js';

export const venuesRouter = Router();

venuesRouter.get('/venues', (req, res) => {
  res.json(listVenues(req.query));
});

venuesRouter.get('/venues/stats', (req, res) => {
  res.json(stats(req.query));
});

// CSV fuer Excel: Semikolon als Trenner und BOM, sonst zerlegt das deutsche
// Excel die Datei nicht korrekt und zerschiesst Umlaute.
venuesRouter.get('/venues/export.csv', (req, res) => {
  const { venues } = listVenues({ ...req.query, limit: 20_000 });
  const columns = [
    ['name', 'Name'], ['venue_type', 'Typ'], ['street', 'Strasse'], ['zip', 'PLZ'],
    ['city', 'Ort'], ['phone', 'Telefon'], ['email', 'E-Mail'], ['website', 'Website'],
    ['website_status', 'Website-Zustand'], ['instagram', 'Instagram'],
    ['instagram_status', 'Instagram-Zustand'], ['score', 'Score'],
    ['status', 'Status'], ['verified', 'Verifiziert'], ['rating', 'Bewertung'],
    ['review_count', 'Anzahl Bewertungen'], ['demo_path', 'Demo-Ordner'],
    ['last_contact_at', 'Letzter Kontakt'], ['notes', 'Notizen'],
    ['lat', 'Breite'], ['lng', 'Länge'],
  ];

  const escape = (value) => {
    if (value == null) return '';
    if (typeof value === 'boolean') value = value ? 'Ja' : 'Nein';
    const s = String(value).replace(/"/g, '""');
    // Fuehrende =, +, - macht Excel zu einer Formel. Telefonnummern mit +41
    // wuerden sonst als Fehler angezeigt.
    const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[";\n\r]/.test(guarded) ? `"${guarded}"` : guarded;
  };

  const lines = [columns.map(([, label]) => label).join(';')];
  for (const v of venues) {
    lines.push(columns.map(([key]) => escape(v[key])).join(';'));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="client-map-${today()}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

venuesRouter.get('/venues/:id', (req, res) => {
  const venue = getVenue(Number(req.params.id));
  if (!venue) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(venue);
});

venuesRouter.post('/venues', (req, res, next) => {
  try {
    res.status(201).json(createVenue(req.body));
  } catch (err) {
    next(err);
  }
});

venuesRouter.patch('/venues/:id', (req, res, next) => {
  try {
    const venue = updateVenue(Number(req.params.id), req.body);
    if (!venue) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(venue);
  } catch (err) {
    next(err);
  }
});

venuesRouter.delete('/venues/:id', (req, res) => {
  if (!deleteVenue(Number(req.params.id))) {
    return res.status(404).json({ error: 'Nicht gefunden' });
  }
  res.status(204).end();
});

// --- Interaktionen (Grundgeruest, ausgebaut in Phase 7) --------------------

venuesRouter.get('/venues/:id/interactions', (req, res) => {
  res.json(
    db
      .prepare('SELECT * FROM interactions WHERE venue_id = ? ORDER BY happened_at DESC')
      .all(Number(req.params.id))
  );
});

venuesRouter.post('/venues/:id/interactions', (req, res, next) => {
  try {
    const venueId = Number(req.params.id);
    if (!getVenue(venueId)) throw new HttpError(404, 'Nicht gefunden');
    const { channel, note, outcome, happened_at } = req.body || {};
    const info = db
      .prepare(
        `INSERT INTO interactions (venue_id, channel, note, outcome, happened_at)
         VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))`
      )
      .run(venueId, channel || null, note || null, outcome || null, happened_at || null);
    updateVenue(venueId, { last_contact_at: happened_at || nowSql() });
    res.status(201).json(
      db.prepare('SELECT * FROM interactions WHERE id = ?').get(info.lastInsertRowid)
    );
  } catch (err) {
    next(err);
  }
});

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
