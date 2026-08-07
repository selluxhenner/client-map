// Alle Schreib- und Lesezugriffe auf venues an einer Stelle. Der Score wird
// hier bei jeder Aenderung neu berechnet, damit er nie veralten kann.

import { db, rowToVenue } from '../db.js';
import { computeScore } from '../scoring.js';
import { buildVenueQuery } from './filters.js';

const EDITABLE = [
  'name', 'lat', 'lng', 'venue_type', 'cuisine',
  'street', 'zip', 'city', 'canton', 'country',
  'phone', 'email', 'website', 'instagram', 'facebook', 'opening_hours',
  'website_status', 'instagram_status', 'rating', 'review_count',
  'is_chain', 'permanently_closed', 'verified',
  'status', 'priority', 'notes', 'tags',
  'demo_path', 'analysis_path', 'last_contact_at', 'last_analysis_at',
];

const BOOLEANS = new Set(['is_chain', 'permanently_closed', 'verified']);

export function listVenues(query) {
  const { sql, params, orderBy, limit, offset } = buildVenueQuery(query);
  const rows = db
    .prepare(`SELECT * FROM venues ${sql} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });
  const total = db.prepare(`SELECT COUNT(*) AS n FROM venues ${sql}`).get(params).n;
  return { venues: rows.map(rowToVenue), total, returned: rows.length };
}

export function getVenue(id) {
  return rowToVenue(db.prepare('SELECT * FROM venues WHERE id = ?').get(id));
}

export function deleteVenue(id) {
  return db.prepare('DELETE FROM venues WHERE id = ?').run(id).changes > 0;
}

export function createVenue(data) {
  const clean = sanitise(data);
  if (!clean.name) throw new HttpError(400, 'Name fehlt');
  if (!Number.isFinite(clean.lat) || !Number.isFinite(clean.lng)) {
    throw new HttpError(400, 'Koordinaten fehlen');
  }

  const { score, breakdown } = computeScore(clean);
  const row = {
    source: data.source || 'manuell',
    source_id: data.source_id || null,
    score,
    score_breakdown: JSON.stringify(breakdown),
    ...withDefaults(clean),
  };

  const columns = Object.keys(row);
  const info = db
    .prepare(
      `INSERT INTO venues (${columns.join(', ')})
       VALUES (${columns.map((c) => `@${c}`).join(', ')})`
    )
    .run(row);
  return getVenue(info.lastInsertRowid);
}

export function updateVenue(id, patch) {
  const existing = getVenue(id);
  if (!existing) return null;

  const clean = sanitise(patch);

  // Wer auf "kontaktiert" stellt, hat gerade kontaktiert - Datum mitfuehren,
  // damit "Nachfassen faellig" ohne Extra-Klick funktioniert.
  if (clean.status === 'kontaktiert' && !clean.last_contact_at && !existing.last_contact_at) {
    clean.last_contact_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  const merged = { ...existing, ...clean };
  const { score, breakdown } = computeScore(merged);
  clean.score = score;
  clean.score_breakdown = JSON.stringify(breakdown);

  const keys = Object.keys(clean);
  if (!keys.length) return existing;

  db.prepare(
    `UPDATE venues SET ${keys.map((k) => `${k} = @${k}`).join(', ')},
     updated_at = datetime('now') WHERE id = @id`
  ).run({ ...clean, id });

  return getVenue(id);
}

/**
 * Uebernimmt Discovery-Ergebnisse. Bereits bekannte Betriebe werden
 * aktualisiert, aber NIEMALS in ihrem Pipeline-Status, ihren Notizen oder
 * manuell gesetzten Feldern ueberschrieben - sonst wuerde ein Rescan deine
 * Arbeit loeschen.
 */
export function upsertDiscovered(found) {
  const selectBySource = db.prepare(
    'SELECT * FROM venues WHERE source = ? AND source_id = ?'
  );
  const selectNearby = db.prepare(
    `SELECT * FROM venues
     WHERE lower(name) = lower(?) AND abs(lat - ?) < 0.0015 AND abs(lng - ?) < 0.0015
     LIMIT 1`
  );

  let inserted = 0;
  let updated = 0;

  const run = db.transaction((items) => {
    for (const item of items) {
      const existing =
        (item.source_id ? selectBySource.get(item.source, item.source_id) : null) ||
        selectNearby.get(item.name, item.lat, item.lng);

      if (!existing) {
        createVenue(item);
        inserted += 1;
        continue;
      }

      // Nur Faktenfelder auffrischen, und auch die nur, wenn sie leer sind
      // oder der Betrieb noch nicht verifiziert wurde.
      const patch = {};
      for (const field of ['phone', 'email', 'website', 'instagram', 'facebook',
                           'opening_hours', 'cuisine', 'street', 'zip', 'city',
                           'venue_type']) {
        if (!existing[field] && item[field]) patch[field] = item[field];
      }
      if (!existing.verified && item.website && existing.website_status === 'unbekannt') {
        patch.website_status = 'ok';
      }
      if (existing.source === 'manuell' && item.source_id && !existing.source_id) {
        patch.source_id = item.source_id;
      }

      if (Object.keys(patch).length) {
        updateVenue(existing.id, patch);
        updated += 1;
      }
    }
  });

  run(found);
  return { inserted, updated, skipped: found.length - inserted - updated };
}

export function stats(query = {}) {
  const { sql, params } = buildVenueQuery(query);
  const byStatus = db
    .prepare(`SELECT status, COUNT(*) AS n FROM venues ${sql} GROUP BY status`)
    .all(params);
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN score >= 70 THEN 1 ELSE 0 END) AS heiss,
              SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) AS verifiziert,
              SUM(CASE WHEN demo_path IS NOT NULL AND demo_path <> '' THEN 1 ELSE 0 END) AS demos
       FROM venues ${sql}`
    )
    .get(params);
  return {
    ...totals,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
  };
}

// --- intern ----------------------------------------------------------------

function sanitise(data = {}) {
  const out = {};
  for (const key of EDITABLE) {
    if (!(key in data)) continue;
    let value = data[key];
    if (key === 'tags') value = JSON.stringify(Array.isArray(value) ? value : []);
    else if (BOOLEANS.has(key)) value = value ? 1 : 0;
    else if (key === 'lat' || key === 'lng' || key === 'rating') value = value == null ? null : Number(value);
    else if (key === 'review_count' || key === 'priority') value = value == null ? null : Math.trunc(Number(value));
    else if (typeof value === 'string') value = value.trim() || null;
    out[key] = value;
  }
  return out;
}

function withDefaults(clean) {
  return {
    website_status: 'unbekannt',
    instagram_status: 'unbekannt',
    status: 'neu',
    ...clean,
  };
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
