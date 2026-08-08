// Was nach einem Analyse-Lauf passiert: das Ergebnis des Agenten einlesen,
// misstrauisch pruefen und in den Betrieb zurueckschreiben.
//
// Grundhaltung: der Agent darf sich irren. Alles, was nicht eindeutig ist,
// landet als 'unbekannt' in der DB und nicht als Behauptung. Und wenn die
// Website-Frage offen bleibt, bleibt der Betrieb ungeprueft - dann ist der
// Score naemlich weiterhin geraten und der Ring muss gestrichelt bleiben.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../db.js';
import { getVenue, updateVenue } from './venue-store.js';
import { slugify } from './text.js';
import { WEBSITE_STATUS_KEYS, INSTAGRAM_STATUS_KEYS } from '../scoring.js';

export const ANALYSEN_DIR = join(DATA_DIR, 'analysen');

/** Pipeline-Status, die eine Analyse noch weiterstellen darf. */
const UEBERSCHREIBBAR = new Set(['neu', 'recherchiert']);

/**
 * Wen ein "der Laden ist zu" ueberschreiben darf.
 *
 * Weiter als UEBERSCHREIBBAR, weil eine Schliessung keine Meinung ist,
 * sondern eine Tatsache: 'interessiert' heisst "den nehme ich mir vor" - und
 * das ist gegenstandslos, wenn es den Betrieb nicht mehr gibt. Ab
 * 'kontaktiert' wird nichts mehr angetastet: wer schon mit dem Wirt geredet
 * hat, weiss es besser als eine Websuche.
 */
const SCHLIESSUNG_UEBERSCHREIBT = new Set(['neu', 'recherchiert', 'interessiert']);

// --- Dateien ---------------------------------------------------------------

/** Dateiname ohne Endung. Die id haengt hinten dran, weil es zwei "Rössli" gibt. */
export function analysisSlug(venue) {
  const base = slugify([venue.name, venue.city].filter(Boolean).join('-'));
  return `${base || 'betrieb'}-${venue.id}`;
}

/** Pfad relativ zu data/ - so bleibt die DB umzugsfaehig. */
export function analysisRelPath(venue) {
  return `analysen/${analysisSlug(venue)}.md`;
}

/** Liest die Markdown-Analyse eines Betriebs, falls es eine gibt. */
export function readAnalysis(venue) {
  const rel = venue.analysis_path || analysisRelPath(venue);
  // Kein Ausbrechen aus data/, auch wenn irgendwann etwas Fremdes in der
  // Spalte landet.
  if (rel.includes('..')) return null;
  const abs = join(DATA_DIR, rel);
  if (!existsSync(abs)) return null;
  return { path: rel, text: readFileSync(abs, 'utf8') };
}

// --- Ergebnis einlesen -----------------------------------------------------

/**
 * Holt das JSON des Agenten. Erste Wahl ist die Datei, die er schreiben
 * sollte; zweite Wahl seine Schlussnachricht. Zwei Wege deshalb, weil ein
 * vergessener Write sonst einen kompletten Lauf wertlos machen wuerde.
 */
export function readAgentJson(venue, resultText) {
  const sidecar = join(ANALYSEN_DIR, `${analysisSlug(venue)}.json`);
  if (existsSync(sidecar)) {
    const parsed = parseJson(readFileSync(sidecar, 'utf8'));
    if (parsed) return { data: parsed, quelle: 'datei' };
  }
  const fromText = extractJson(resultText);
  if (fromText) return { data: fromText, quelle: 'antwort' };
  return null;
}

export function extractJson(text) {
  if (!text) return null;
  if (typeof text === 'object') return text;

  const raw = String(text);
  const candidates = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);

  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));

  for (const candidate of candidates.reverse()) {
    const parsed = parseJson(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function parseJson(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// --- Umwandeln in einen Betriebs-Patch --------------------------------------

/**
 * Baut aus dem Agenten-JSON die Felder, die in die DB duerfen.
 *
 * Rein und ohne Seiteneffekte, damit sich die Regeln testen lassen, ohne
 * einen Agenten laufen zu lassen.
 */
export function buildPatch(data, venue, modus = 'analyse') {
  const warnungen = [];
  const patch = {};
  const put = (key, value) => { if (value != null) patch[key] = value; };

  // Ein Schnell-Check darf eine vorhandene Tiefen-Analyse nicht entwerten:
  // die Faktenfelder frischt er auf, aber Tiefe und Textdatei bleiben.
  const ueberschreibtTiefe = modus === 'schnell' && venue.analysis_kind === 'analyse';

  const websiteStatus = pickEnum(data.website_status, WEBSITE_STATUS_KEYS, 'website_status', warnungen);
  const instagramStatus = pickEnum(data.instagram_status, INSTAGRAM_STATUS_KEYS, 'instagram_status', warnungen);

  put('website_status', websiteStatus);
  put('instagram_status', instagramStatus);

  const website = url(data.website);
  if (websiteStatus === 'keine') patch.website = null;
  else put('website', website);

  const handle = instagramHandle(data.instagram);
  if (instagramStatus === 'keiner') patch.instagram = null;
  else put('instagram', handle);

  put('facebook', url(data.facebook) || text(data.facebook, 200));
  put('phone', text(data.phone, 60));
  put('email', email(data.email));
  put('opening_hours', text(data.opening_hours, 300));
  put('cuisine', text(data.cuisine, 120));
  put('venue_type', text(data.venue_type, 60));

  const rating = number(data.rating, 0, 5);
  if (rating != null) patch.rating = Math.round(rating * 10) / 10;
  const reviews = number(data.review_count, 0, 1_000_000);
  if (reviews != null) patch.review_count = Math.round(reviews);

  const chain = bool(data.is_chain);
  if (chain != null) patch.is_chain = chain ? 1 : 0;
  const closed = bool(data.permanently_closed);
  if (closed != null) patch.permanently_closed = closed ? 1 : 0;

  const kurz = summary(data, warnungen);
  if (kurz && !ueberschreibtTiefe) patch.analysis_summary = kurz;
  if (!ueberschreibtTiefe) {
    patch.analysis_path = analysisRelPath(venue);
    patch.analysis_kind = modus;
  }
  patch.last_analysis_at = nowSql();

  // Verifiziert heisst: der Score ist belastbar. Bleibt die Website-Frage
  // offen, ist er das nicht - dann bleibt der Ring gestrichelt, statt eine
  // Sicherheit vorzutaeuschen, die die Analyse nicht liefern konnte.
  patch.verified = websiteStatus && websiteStatus !== 'unbekannt' ? 1 : venue.verified ? 1 : 0;
  if (!patch.verified) {
    warnungen.push('Website-Zustand blieb offen — Betrieb bleibt ungeprüft.');
  }

  // Pipeline nur dort weiterstellen, wo noch keine Handarbeit drinsteckt.
  if (patch.permanently_closed === 1 && SCHLIESSUNG_UEBERSCHREIBT.has(venue.status)) {
    patch.status = 'geschlossen';
  } else if (venue.status === 'neu') {
    patch.status = 'recherchiert';
  }

  if (Array.isArray(data.unsicher)) {
    warnungen.push(...data.unsicher.map((u) => text(u, 200)).filter(Boolean));
  }

  return { patch, warnungen };
}

/**
 * Schreibt das Ergebnis eines Laufs in den Betrieb.
 * Wirft, wenn der Lauf nichts Verwertbares hinterlassen hat.
 */
export function applyAnalysis(venueId, resultText, modus = 'analyse') {
  const venue = getVenue(venueId);
  if (!venue) throw new Error('Betrieb existiert nicht mehr');

  const found = readAgentJson(venue, resultText);
  if (!found) {
    throw new Error(
      'Der Lauf ist durchgelaufen, hat aber keine verwertbaren Daten hinterlassen ' +
      `(weder ${analysisSlug(venue)}.json noch JSON in der Antwort). Log ansehen.`
    );
  }

  const { patch, warnungen } = buildPatch(found.data, venue, modus);
  if (patch.analysis_path) ensureMarkdown(venue, found.data, modus);

  const updated = updateVenue(venueId, patch);
  return { venue: updated, warnungen, quelle: found.quelle };
}

/**
 * Sorgt dafuer, dass zu jedem Ergebnis eine lesbare Datei existiert.
 *
 * Beim Schnell-Check ist das der Normalfall: er schreibt bewusst nichts,
 * damit er schnell bleibt - die Kurzfassung bauen wir hier selbst. Bei der
 * Tiefen-Analyse ist es die Notfassung fuer den Fall, dass der Agent das
 * Schreiben vergessen hat.
 */
function ensureMarkdown(venue, data, modus) {
  const abs = join(DATA_DIR, analysisRelPath(venue));
  if (existsSync(abs) && modus !== 'schnell') return;

  const zeile = (label, wert) => `| ${label} | ${wert == null || wert === '' ? '–' : wert} |`;

  const zeilen = modus === 'schnell'
    ? [
        `# ${venue.name}`,
        '',
        `**Schnell-Check vom ${heute()}** — geprüft wurden nur die Fragen, die den`,
        'Score bewegen. Für Story, Inhaber und Aufhänger die volle **Analyse** starten.',
        '',
        '| | |',
        '|---|---|',
        zeile('Website', data.website),
        zeile('Zustand', data.website_status),
        zeile('Instagram', data.instagram ? `@${data.instagram} (${data.instagram_status || '?'})` : null),
        zeile('Telefon', data.phone),
        zeile('Kette', data.is_chain ? 'ja' : 'nein'),
        zeile('Geschlossen', data.permanently_closed ? 'ja' : 'nein'),
        '',
        data.zusammenfassung || '',
        '',
      ]
    : [
        `# ${venue.name}`,
        '',
        '> Notfassung: der Agent hat keine Markdown-Datei geschrieben, dies ist die',
        '> Rohfassung aus seinen strukturierten Daten.',
        '',
        ...Object.entries(data).map(([key, value]) =>
          `- **${key}:** ${value == null ? '–' : typeof value === 'object' ? JSON.stringify(value) : value}`
        ),
        '',
      ];

  writeFileSync(abs, zeilen.join('\n'), 'utf8');
}

function heute() {
  return new Date().toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// --- kleine Helfer ----------------------------------------------------------

const LEER = /^(unbekannt|unknown|keine angabe|n\/?a|null|none|-|–)$/i;

function text(value, max) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  if (!clean || LEER.test(clean)) return null;
  return clean.slice(0, max);
}

function url(value) {
  const clean = text(value, 500);
  if (!clean) return null;
  const withProto = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
  try {
    const parsed = new URL(withProto);
    return parsed.hostname.includes('.') ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function email(value) {
  const clean = text(value, 200);
  return clean && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) ? clean.toLowerCase() : null;
}

function instagramHandle(value) {
  const clean = text(value, 200);
  if (!clean) return null;
  const handle = clean
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/^@/, '')
    .trim();
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

function number(value, min, max) {
  const n = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function bool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^(true|ja|yes|1)$/i.test(value.trim())) return true;
    if (/^(false|nein|no|0)$/i.test(value.trim())) return false;
  }
  return null;
}

function pickEnum(value, allowed, feld, warnungen) {
  const clean = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!clean) return null;
  if (allowed.includes(clean)) return clean;
  warnungen.push(`Unbekannter Wert für ${feld}: "${value}" — als "unbekannt" gewertet.`);
  return 'unbekannt';
}

function summary(data, warnungen) {
  const teile = [text(data.zusammenfassung, 600), text(data.aufhaenger, 300)].filter(Boolean);
  if (!teile.length) {
    warnungen.push('Keine Zusammenfassung geliefert.');
    return null;
  }
  return teile.join('\n\n');
}

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
