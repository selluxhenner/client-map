// SQLite-Anbindung und Schema.
//
// Konvention: Spaltennamen englisch (siehst du nie), gespeicherte WERTE
// deutsch ('kontaktiert', 'keine', ...). So bleibt die Oberflaeche deutsch,
// ohne dass Umlaute in Spaltennamen spaeter Aerger machen.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..');
export const DATA_DIR = join(ROOT, 'data');

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(join(DATA_DIR, 'analysen'), { recursive: true });
mkdirSync(join(DATA_DIR, 'jobs'), { recursive: true });

export const db = new Database(join(DATA_DIR, 'clientmap.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// --- Migrationen -----------------------------------------------------------
// Jede Migration laeuft genau einmal, gesteuert ueber PRAGMA user_version.

const migrations = [
  // 1 - Grundschema
  () => {
    db.exec(`
      CREATE TABLE venues (
        id                 INTEGER PRIMARY KEY,
        user_id            TEXT    NOT NULL DEFAULT 'kevin',

        source             TEXT    NOT NULL DEFAULT 'osm',   -- osm | google | manuell
        source_id          TEXT,
        name               TEXT    NOT NULL,
        lat                REAL    NOT NULL,
        lng                REAL    NOT NULL,

        venue_type         TEXT,                              -- restaurant | bar | cafe | ...
        cuisine            TEXT,
        street             TEXT,
        zip                TEXT,
        city               TEXT,
        canton             TEXT,
        country            TEXT    DEFAULT 'CH',

        phone              TEXT,
        email              TEXT,
        website            TEXT,
        instagram          TEXT,
        facebook           TEXT,
        opening_hours      TEXT,

        website_status     TEXT    NOT NULL DEFAULT 'unbekannt',
        instagram_status   TEXT    NOT NULL DEFAULT 'unbekannt',
        rating             REAL,
        review_count       INTEGER,
        is_chain           INTEGER NOT NULL DEFAULT 0,
        permanently_closed INTEGER NOT NULL DEFAULT 0,

        score              INTEGER NOT NULL DEFAULT 0,
        score_breakdown    TEXT,
        verified           INTEGER NOT NULL DEFAULT 0,

        status             TEXT    NOT NULL DEFAULT 'neu',
        priority           INTEGER NOT NULL DEFAULT 0,
        notes              TEXT,
        tags               TEXT,

        demo_path          TEXT,
        analysis_path      TEXT,

        last_contact_at    TEXT,
        last_analysis_at   TEXT,
        created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE UNIQUE INDEX idx_venues_source ON venues(source, source_id)
        WHERE source_id IS NOT NULL;
      CREATE INDEX idx_venues_pos    ON venues(lat, lng);
      CREATE INDEX idx_venues_status ON venues(status);
      CREATE INDEX idx_venues_score  ON venues(score);
      CREATE INDEX idx_venues_city   ON venues(city);

      -- Kontakt-Historie (wird in Phase 7 mit Leben gefuellt)
      CREATE TABLE interactions (
        id         INTEGER PRIMARY KEY,
        venue_id   INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
        happened_at TEXT   NOT NULL DEFAULT (datetime('now')),
        channel    TEXT,                                     -- instagram | mail | telefon | besuch
        note       TEXT,
        outcome    TEXT,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_interactions_venue ON interactions(venue_id);

      -- Agent-Jobs (Phase 4)
      CREATE TABLE jobs (
        id          INTEGER PRIMARY KEY,
        venue_id    INTEGER REFERENCES venues(id) ON DELETE SET NULL,
        kind        TEXT    NOT NULL,                        -- analyse | demo | kontakt
        status      TEXT    NOT NULL DEFAULT 'wartend',      -- wartend | laeuft | fertig | fehler | abgebrochen
        model       TEXT,
        log_path    TEXT,
        exit_code   INTEGER,
        error       TEXT,
        started_at  TEXT,
        finished_at TEXT,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_jobs_status ON jobs(status);

      -- Welche Kartenausschnitte wurden schon gescannt
      CREATE TABLE scanned_areas (
        id         INTEGER PRIMARY KEY,
        south REAL, west REAL, north REAL, east REAL,
        found      INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Gespeicherte Filter
      CREATE TABLE saved_filters (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        query      TEXT NOT NULL,
        builtin    INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0
      );
    `);

    const ins = db.prepare(
      'INSERT INTO saved_filters (name, query, builtin, sort_order) VALUES (?, ?, 1, ?)'
    );
    [
      ['🔥 Heiss & unberührt', 'status=neu&minScore=70', 1],
      ['Demo gebaut, nicht kontaktiert', 'status=demo_gebaut', 2],
      ['Ohne Website', 'websiteStatus=keine', 3],
      ['Nur Instagram, keine Website', 'websiteStatus=keine&instagramStatus=aktiv', 4],
      ['Nachfassen fällig', 'status=kontaktiert&kontaktVorTagen=14', 5],
      ['Meine Kunden', 'status=kunde,pausiert', 6],
    ].forEach(([name, query, order]) => ins.run(name, query, order));
  },

  // 2 - Ortsnamen vereinheitlichen: "Wil (SG)" und "Wil SG" sind derselbe Ort
  //     und duerfen im Filter nicht zweimal auftauchen.
  () => {
    const rows = db.prepare("SELECT id, city FROM venues WHERE city LIKE '%(%)%'").all();
    const update = db.prepare('UPDATE venues SET city = ? WHERE id = ?');
    for (const row of rows) {
      update.run(row.city.replace(/\s*\(([A-Z]{2})\)\s*$/, ' $1').replace(/\s+/g, ' ').trim(), row.id);
    }
  },
];

const current = db.pragma('user_version', { simple: true });
migrations.slice(current).forEach((migrate, i) => {
  const version = current + i + 1;
  db.transaction(() => {
    migrate();
    db.pragma(`user_version = ${version}`);
  })();
  console.log(`[db] Migration ${version} angewendet`);
});

// --- Hilfsfunktionen -------------------------------------------------------

/** Wandelt eine DB-Zeile in das Format um, das das Frontend erwartet. */
export function rowToVenue(row) {
  if (!row) return null;
  return {
    ...row,
    is_chain: Boolean(row.is_chain),
    permanently_closed: Boolean(row.permanently_closed),
    verified: Boolean(row.verified),
    tags: safeJson(row.tags, []),
    score_breakdown: safeJson(row.score_breakdown, []),
  };
}

function safeJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function touch(id) {
  db.prepare("UPDATE venues SET updated_at = datetime('now') WHERE id = ?").run(id);
}
