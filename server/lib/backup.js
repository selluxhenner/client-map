// Sicherungen der Datenbank.
//
// Warum das eine eigene Sache ist und nicht "kopier halt die Datei": im
// laufenden Betrieb steht ein Teil der Daten im WAL-Journal und nicht in der
// .db-Datei. Ein blosses Kopieren im Explorer erwischt einen Zwischenstand -
// im Zweifel genau den vor der Arbeit, die man sichern wollte. VACUUM INTO
// schreibt dagegen eine in sich geschlossene, aufgeraeumte Kopie.

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, db } from '../db.js';

export const BACKUP_DIR = join(DATA_DIR, 'sicherungen');

/** Wie viele Sicherungen behalten werden. Aeltere fliegen automatisch raus. */
const BEHALTEN = Math.max(3, Number(process.env.BACKUP_KEEP) || 20);

/**
 * Legt eine Sicherung an und gibt sie zurueck.
 *
 * @param {string} grund Kurzes Wort, das im Dateinamen landet - damit man
 *   spaeter sieht, WARUM gesichert wurde ("vor-merge" ist die wichtigste).
 */
export function createBackup(grund = 'manuell') {
  mkdirSync(BACKUP_DIR, { recursive: true });

  // Erst das Journal in die Datenbank schreiben, dann kopieren. Sonst ist die
  // Sicherung aelter als der letzte Klick in der Oberflaeche.
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    console.warn(`[backup] Journal nicht zusammengefuehrt: ${err.message}`);
  }

  const name = `clientmap-${zeitstempel()}-${sauber(grund)}.db`;
  const ziel = join(BACKUP_DIR, name);

  // VACUUM INTO scheitert absichtlich, wenn die Datei existiert - der
  // Zeitstempel enthaelt Sekunden, ein Zusammenstoss ist also ein echter
  // Fehler und kein Grund, still zu ueberschreiben.
  db.prepare('VACUUM INTO ?').run(ziel);

  const gross = statSync(ziel).size;
  aufraeumen();
  return { name, pfad: ziel, groesse: gross, grund, erstellt: new Date().toISOString() };
}

export function listBackups() {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const info = statSync(join(BACKUP_DIR, f));
      return {
        name: f,
        groesse: info.size,
        erstellt: info.mtime.toISOString(),
        // Format: clientmap-JJJJ-MM-TT-HHMMSS-grund.db. Ohne die Zeitstempel
        // im Muster wuerde der Grund das halbe Datum mit einsammeln.
        grund: (f.match(/^clientmap-\d{4}-\d{2}-\d{2}-\d{6}-(.+)\.db$/) || [])[1] || null,
      };
    })
    .sort((a, b) => b.erstellt.localeCompare(a.erstellt));
}

/** Zustand der Datenbank - was man wissen will, bevor man sichert. */
export function dbInfo() {
  const datei = join(DATA_DIR, 'clientmap.db');
  const wal = `${datei}-wal`;
  const zaehlen = (tabelle) => db.prepare(`SELECT COUNT(*) AS n FROM ${tabelle}`).get().n;

  return {
    pfad: datei,
    groesse: existsSync(datei) ? statSync(datei).size : 0,
    // Ein grosses Journal ist kein Fehler, aber ein Hinweis darauf, dass lange
    // nicht zusammengefuehrt wurde.
    journal: existsSync(wal) ? statSync(wal).size : 0,
    version: db.pragma('user_version', { simple: true }),
    integritaet: db.pragma('quick_check', { simple: true }),
    zeilen: {
      betriebe: zaehlen('venues'),
      kontakte: zaehlen('interactions'),
      Aufträge: zaehlen('jobs'),
      gescannt: zaehlen('scanned_areas'),
    },
    sicherungen: listBackups().length,
    behalten: BEHALTEN,
  };
}

/**
 * Journal zusammenfuehren und Platz freigeben. Nach dem Loeschen vieler
 * Betriebe schrumpft die Datei sonst nicht.
 */
export function compact() {
  const vorher = dbInfo();
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');
  const nachher = dbInfo();
  return { vorher: vorher.groesse + vorher.journal, nachher: nachher.groesse + nachher.journal };
}

function aufraeumen() {
  const alle = listBackups();
  for (const alt of alle.slice(BEHALTEN)) {
    try {
      rmSync(join(BACKUP_DIR, alt.name));
    } catch (err) {
      console.warn(`[backup] ${alt.name} nicht geloescht: ${err.message}`);
    }
  }
}

function zeitstempel() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function sauber(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'manuell';
}
