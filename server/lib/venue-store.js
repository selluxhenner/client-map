// Alle Schreib- und Lesezugriffe auf venues an einer Stelle. Der Score wird
// hier bei jeder Aenderung neu berechnet, damit er nie veralten kann.

import { db, rowToVenue } from '../db.js';
import { computeScore } from '../scoring.js';
import { FUNNEL, FUNNEL_ALIAS } from '../crm.js';
import { buildVenueQuery } from './filters.js';

const EDITABLE = [
  'name', 'lat', 'lng', 'venue_type', 'cuisine',
  'street', 'zip', 'city', 'canton', 'country',
  'phone', 'email', 'website', 'instagram', 'facebook', 'opening_hours',
  'website_status', 'instagram_status', 'rating', 'review_count',
  'is_chain', 'permanently_closed', 'verified',
  'status', 'priority', 'notes', 'tags',
  'demo_path', 'analysis_path', 'analysis_summary', 'analysis_kind',
  'last_contact_at', 'last_analysis_at', 'follow_up_at', 'follow_up_note',
  // Vom Agenten geschrieben, wie analysis_summary - laeuft aber durch denselben
  // Weg, damit es keinen zweiten Schreibpfad auf venues gibt.
  'outreach_draft', 'outreach_draft_at',
];

const BOOLEANS = new Set(['is_chain', 'permanently_closed', 'verified']);

/**
 * Was die Karte von einem Betrieb tatsaechlich braucht.
 *
 * Gemessen bei 10 000 Betrieben: die vollen Zeilen sind 9,4 MB JSON, diese
 * sieben Spalten 1,2 MB - 87 Prozent weniger. Den Rest holt das Detail-Panel
 * beim Anklicken einzeln nach, und das ist ohnehin der Moment, in dem er
 * gebraucht wird.
 */
const KARTEN_FELDER = 'id, name, lat, lng, score, status, verified, city, venue_type';

export function listVenues(query) {
  const { sql, params, orderBy, limit, offset } = buildVenueQuery(query);
  const schlank = query?.felder === 'karte';

  const rows = db
    .prepare(
      `SELECT ${schlank ? KARTEN_FELDER : '*'} FROM venues ${sql}
       ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset });

  const total = db.prepare(`SELECT COUNT(*) AS n FROM venues ${sql}`).get(params).n;

  return {
    venues: schlank ? rows.map((r) => ({ ...r, verified: Boolean(r.verified) })) : rows.map(rowToVenue),
    total,
    returned: rows.length,
    // Ehrlich melden, wenn nicht alles mitgekommen ist. Ohne das zeigt die
    // Karte 2000 Pins und die Kopfzeile daneben 10000.
    gekappt: rows.length < total,
    felder: schlank ? 'karte' : 'alle',
  };
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

  // Die Zahl neben einem Status soll genau das sein, was ein Klick darauf
  // zeigt. Fuer jeden Status heisst das "ohne dauerhaft geschlossene", fuer
  // 'geschlossen' selbst genau umgekehrt. Deshalb wird das hier pro Zeile
  // entschieden und nicht fuer die ganze Abfrage - sonst steht das Kaestchen
  // "Geschlossen" ewig auf 0, oder die Summe links passt nicht zur Karte.
  const jeStatus = buildVenueQuery({ ...query, status: '', includeClosed: '1' });
  const byStatus = db
    .prepare(
      `SELECT status, COUNT(*) AS n FROM venues
       ${jeStatus.sql || 'WHERE 1=1'}
         AND (permanently_closed = 0 OR status = 'geschlossen')
       GROUP BY status`
    )
    .all(jeStatus.params);
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN score >= 70 THEN 1 ELSE 0 END) AS heiss,
              SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) AS verifiziert,
              SUM(CASE WHEN demo_path IS NOT NULL AND demo_path <> '' THEN 1 ELSE 0 END) AS demos,
              SUM(CASE WHEN follow_up_at IS NOT NULL
                        AND date(follow_up_at) <= date('now', 'localtime')
                       THEN 1 ELSE 0 END) AS wiedervorlage_faellig,
              SUM(CASE WHEN outreach_draft IS NOT NULL AND outreach_draft <> ''
                       THEN 1 ELSE 0 END) AS entwuerfe
       FROM venues ${sql}`
    )
    .get(params);

  return {
    ...totals,
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    ...funnelOf(query),
  };
}

/**
 * Der Funnel zaehlt kumulativ: "wie viele haben diese Stufe mindestens
 * erreicht". Ein Kunde ist auch kontaktiert worden - haette man ihn nur in
 * seiner aktuellen Stufe, sähe der Trichter breiter aus, als er ist, und die
 * Abbruchquoten wären falsch.
 *
 * Endzustaende stehen nicht im Trichter - wer abgelehnt hat, ist kein halber
 * Kunde. Sie werden als `abgang` daneben gemeldet, damit die Rechnung
 * aufgeht: Trichterspitze + Abgang = alle Betriebe im Filter.
 */
function funnelOf(query = {}) {
  const { sql, params } = buildVenueQuery({ ...query, status: '' });
  const zeilen = db
    .prepare(`SELECT status, COUNT(*) AS n FROM venues ${sql} GROUP BY status`)
    .all(params);
  const je = Object.fromEntries(zeilen.map((r) => [r.status, r.n]));

  // Status, die eine Stufe erreicht haben, ohne selbst eine zu sein
  // (pausiert = war Kunde), dort dazuzaehlen.
  const erreichtIn = { ...je };
  for (const [status, stufe] of Object.entries(FUNNEL_ALIAS)) {
    if (!je[status]) continue;
    erreichtIn[stufe] = (erreichtIn[stufe] || 0) + je[status];
    delete erreichtIn[status];
  }

  const funnel = FUNNEL.map((stufe, i) => ({
    status: stufe,
    // Alles ab dieser Stufe - wer weiter ist, war auch hier.
    erreicht: FUNNEL.slice(i).reduce((summe, s) => summe + (erreichtIn[s] || 0), 0),
    aktuell: je[stufe] || 0,
  }));

  const abgang = Object.entries(je)
    .filter(([status]) => !FUNNEL.includes(status) && !FUNNEL_ALIAS[status])
    .map(([status, n]) => ({ status, n }))
    .sort((a, b) => b.n - a.n);

  return {
    funnel,
    abgang,
    abgangGesamt: abgang.reduce((summe, a) => summe + a.n, 0),
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
