// Bewertungslogik der Client-Map.
//
// Diese Datei ist absichtlich die einzige Stelle, an der Punkte vergeben
// werden. Wenn sich dein Gefuehl dafuer aendert, was ein heisser Lead ist,
// aenderst du hier die Zahlen - sonst nichts.

/** Pipeline-Status: bestimmt die FARBE des Pins. */
export const STATUS = {
  neu:          { label: 'Neu',          color: '#94a3b8', hint: 'Gefunden, noch nichts gemacht' },
  recherchiert: { label: 'Recherchiert', color: '#3b82f6', hint: 'Analyse liegt vor' },
  demo_gebaut:  { label: 'Demo gebaut',  color: '#8b5cf6', hint: 'Demo-Website existiert' },
  kontaktiert:  { label: 'Kontaktiert',  color: '#f97316', hint: 'Angeschrieben' },
  in_gespraech: { label: 'Im Gespräch',  color: '#eab308', hint: 'Im Gespräch / Termin' },
  kunde:        { label: 'Kunde',        color: '#22c55e', hint: 'Aktiver Kunde' },
  pausiert:     { label: 'Pausiert',     color: '#14b8a6', hint: 'War Kunde, aktuell gestoppt' },
  abgelehnt:    { label: 'Abgelehnt',    color: '#ef4444', hint: 'Flop, kein Interesse' },
  kein_fit:     { label: 'Kein Fit',     color: '#475569', hint: 'Geschlossen, Kette, zu klein' },
};

export const STATUS_KEYS = Object.keys(STATUS);

/** Zustand der Website - der wichtigste Einzelfaktor fuer ServiWeb. */
export const WEBSITE_STATUS = {
  unbekannt: { label: 'Unbekannt',                   points: 20, provisional: true },
  keine:     { label: 'Keine Website',               points: 40 },
  kaputt:    { label: 'Kaputt / kein SSL / nicht mobil', points: 30 },
  veraltet:  { label: 'Veraltet, funktioniert aber', points: 20 },
  ok:        { label: 'Brauchbar',                   points: 0 },
  gut:       { label: 'Modern und gut',              points: -10 },
};

export const WEBSITE_STATUS_KEYS = Object.keys(WEBSITE_STATUS);

/** Instagram - dein bester Kontaktkanal, deshalb hoch gewichtet. */
export const INSTAGRAM_STATUS = {
  unbekannt: { label: 'Unbekannt', points: 0 },
  keiner:    { label: 'Kein Account', points: 0 },
  inaktiv:   { label: 'Account, aber inaktiv', points: 15 },
  aktiv:     { label: 'Aktiver Account', points: 25 },
};

export const INSTAGRAM_STATUS_KEYS = Object.keys(INSTAGRAM_STATUS);

/** Ab diesen Schwellen wird der Ring dicker und roter. */
export const SCORE_BANDS = [
  { min: 70, key: 'heiss',      label: 'Heiss',       color: '#dc2626', width: 4 },
  { min: 40, key: 'interessant',label: 'Interessant', color: '#f59e0b', width: 3 },
  { min: 0,  key: 'kalt',       label: 'Kalt',        color: '#cbd5e1', width: 2 },
];

export function scoreBand(score) {
  return SCORE_BANDS.find((b) => score >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

/**
 * Berechnet Score und Begruendung fuer einen Betrieb.
 *
 * Gibt immer eine nachvollziehbare Aufschluesselung zurueck, damit das
 * Detail-Panel "warum 87 Punkte" beantworten kann. Faktoren, die auf
 * ungeprueften OSM-Daten beruhen, sind als `provisional` markiert.
 */
export function computeScore(v) {
  const breakdown = [];
  const add = (label, points, provisional = false) => {
    if (points === 0 && !provisional) return;
    breakdown.push({ label, points, provisional });
  };

  // Dauerhaft geschlossen schlaegt alles andere.
  if (v.permanently_closed) {
    return {
      score: 0,
      breakdown: [{ label: 'Dauerhaft geschlossen', points: 0, provisional: false }],
    };
  }

  const web = WEBSITE_STATUS[v.website_status] ?? WEBSITE_STATUS.unbekannt;
  add(`Website: ${web.label}`, web.points, Boolean(web.provisional));

  const insta = INSTAGRAM_STATUS[v.instagram_status] ?? INSTAGRAM_STATUS.unbekannt;
  add(`Instagram: ${insta.label}`, insta.points);

  const reviews = Number(v.review_count) || 0;
  const rating = Number(v.rating) || 0;
  if (reviews >= 50 && rating >= 4.0) {
    add(`Etabliert (${reviews} Bewertungen, ${rating.toFixed(1)}★)`, 15);
  } else if (v.review_count != null && reviews < 10) {
    add(`Kaum Bewertungen (${reviews})`, -10);
  }

  if (v.phone || v.email) add('Telefon oder Mail vorhanden', 5);
  if (v.is_chain) add('Kette / Franchise', -20);

  const raw = breakdown.reduce((sum, b) => sum + b.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  return { score, breakdown };
}

/**
 * Ob der Score belastbar ist. Solange nichts verifiziert wurde, beruht er
 * auf OSM-Tags - und ein fehlender website-Tag in OSM heisst NICHT, dass
 * der Laden keine Website hat. Die Karte zeigt das als gestrichelten Ring.
 */
export function isVerified(v) {
  return Boolean(v.verified);
}
