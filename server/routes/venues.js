import { Router } from 'express';
import {
  listVenues, getVenue, createVenue, updateVenue, deleteVenue, stats, HttpError,
} from '../lib/venue-store.js';
import { db } from '../db.js';
import { readAnalysis } from '../lib/analysis.js';
import { CHANNEL_KEYS, OUTCOME_KEYS, OUTCOME_STATUS } from '../crm.js';
import { STATUS_KEYS } from '../scoring.js';

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
    ['last_contact_at', 'Letzter Kontakt'], ['follow_up_at', 'Wiedervorlage'],
    ['follow_up_note', 'Wiedervorlage-Notiz'], ['analysis_summary', 'Analyse'],
    ['notes', 'Notizen'],
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

// Die ausfuehrliche Analyse liegt als Markdown auf der Platte, nicht in der
// DB - so kann man sie auch ausserhalb der App lesen, weiterschicken oder
// spaeter als research.md in einen Demo-Ordner kopieren (Phase 6).
venuesRouter.get('/venues/:id/analyse', (req, res) => {
  const venue = getVenue(Number(req.params.id));
  if (!venue) return res.status(404).json({ error: 'Nicht gefunden' });

  const analysis = readAnalysis(venue);
  if (!analysis) return res.status(404).json({ error: 'Für diesen Betrieb gibt es noch keine Analyse' });

  res.json({ ...analysis, last_analysis_at: venue.last_analysis_at });
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

// --- Kontakt-Historie ------------------------------------------------------

venuesRouter.get('/venues/:id/interactions', (req, res) => {
  res.json(listInteractions(Number(req.params.id)));
});

/**
 * Kontakt eintragen.
 *
 * Zieht den Pipeline-Status mit, aber nur vorwaerts: eine neue Notiz macht aus
 * einem Kunden nicht wieder einen Kontaktierten. Wie weit ein Ergebnis traegt,
 * steht in OUTCOME_STATUS - und `kein_interesse` stellt absichtlich nicht auf
 * `abgelehnt`: eine unbeantwortete DM ist noch kein Nein.
 */
venuesRouter.post('/venues/:id/interactions', (req, res, next) => {
  try {
    const venueId = Number(req.params.id);
    const venue = getVenue(venueId);
    if (!venue) throw new HttpError(404, 'Nicht gefunden');

    const { channel, note, outcome, happened_at, follow_up_at, follow_up_note } = req.body || {};
    const kanal = CHANNEL_KEYS.includes(channel) ? channel : 'sonstiges';
    const ergebnis = OUTCOME_KEYS.includes(outcome) ? outcome : 'offen';
    const wann = happened_at || nowSql();

    const info = db
      .prepare(
        `INSERT INTO interactions (venue_id, channel, note, outcome, happened_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(venueId, kanal, note?.trim() || null, ergebnis, wann);

    const patch = { last_contact_at: wann };

    const ziel = OUTCOME_STATUS[ergebnis];
    if (ziel && darfWeiter(venue.status, ziel)) patch.status = ziel;

    // Wiedervorlage gleich mitsetzen, wenn sie im Formular stand - sonst
    // vergisst man genau den Teil, der das Nachfassen ueberhaupt ermoeglicht.
    if (follow_up_at !== undefined) patch.follow_up_at = follow_up_at || null;
    if (follow_up_note !== undefined) patch.follow_up_note = follow_up_note || null;

    res.status(201).json({
      interaction: db.prepare('SELECT * FROM interactions WHERE id = ?').get(info.lastInsertRowid),
      venue: updateVenue(venueId, patch),
      interactions: listInteractions(venueId),
    });
  } catch (err) {
    next(err);
  }
});

venuesRouter.patch('/interactions/:id', (req, res, next) => {
  try {
    const eintrag = db.prepare('SELECT * FROM interactions WHERE id = ?').get(Number(req.params.id));
    if (!eintrag) throw new HttpError(404, 'Nicht gefunden');

    const { channel, note, outcome, happened_at } = req.body || {};
    db.prepare(
      `UPDATE interactions SET
         channel = COALESCE(@channel, channel),
         note = @note,
         outcome = COALESCE(@outcome, outcome),
         happened_at = COALESCE(@happened_at, happened_at)
       WHERE id = @id`
    ).run({
      id: eintrag.id,
      channel: CHANNEL_KEYS.includes(channel) ? channel : null,
      note: note === undefined ? eintrag.note : (note?.trim() || null),
      outcome: OUTCOME_KEYS.includes(outcome) ? outcome : null,
      happened_at: happened_at || null,
    });

    res.json({
      interaction: db.prepare('SELECT * FROM interactions WHERE id = ?').get(eintrag.id),
      interactions: listInteractions(eintrag.venue_id),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Eintrag loeschen. Der Pipeline-Status bleibt, wo er ist: dass ein Kontakt
 * stattgefunden hat, wird durch das Loeschen der Notiz nicht ungeschehen -
 * und ein zurueckgesetzter Status waere eine stille Nebenwirkung.
 */
venuesRouter.delete('/interactions/:id', (req, res, next) => {
  try {
    const eintrag = db.prepare('SELECT * FROM interactions WHERE id = ?').get(Number(req.params.id));
    if (!eintrag) throw new HttpError(404, 'Nicht gefunden');
    db.prepare('DELETE FROM interactions WHERE id = ?').run(eintrag.id);

    // Letzter Kontakt neu bestimmen, sonst zeigt die Karte ein Datum, zu dem
    // es keinen Eintrag mehr gibt.
    const letzter = db
      .prepare('SELECT MAX(happened_at) AS wann FROM interactions WHERE venue_id = ?')
      .get(eintrag.venue_id).wann;
    updateVenue(eintrag.venue_id, { last_contact_at: letzter || null });

    res.json({ interactions: listInteractions(eintrag.venue_id) });
  } catch (err) {
    next(err);
  }
});

function listInteractions(venueId) {
  return db
    .prepare('SELECT * FROM interactions WHERE venue_id = ? ORDER BY happened_at DESC, id DESC')
    .all(venueId);
}

/** Nur vorwaerts in der Pipeline, und nie ueber einen Endzustand hinweg. */
function darfWeiter(jetzt, ziel) {
  const von = STATUS_KEYS.indexOf(jetzt);
  const nach = STATUS_KEYS.indexOf(ziel);
  if (von < 0 || nach < 0) return false;
  // Abgelehnt, kein Fit, geschlossen und "Website schon gut" sind bewusste
  // Entscheidungen - die hebt ein Kontakteintrag nicht auf.
  if (['abgelehnt', 'kein_fit', 'geschlossen', 'website_gut'].includes(jetzt)) return false;
  return nach > von;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
