// Vokabular der Kontaktarbeit: Kanäle und Ergebnisse.
//
// Eigene Datei und nicht in scoring.js, weil hier keine Punkte vergeben
// werden. Wie bei den Status gilt: Schlüssel deutsch und ASCII, Beschriftung
// darf Umlaute haben. Ausgeliefert wird das über /api/config, damit die
// Oberfläche nichts doppelt kennt.

/** Wie kontaktiert wurde. Instagram steht zuerst, das ist der Hauptkanal. */
export const CHANNELS = {
  instagram: { label: 'Instagram-DM', icon: '📷' },
  mail:      { label: 'E-Mail',       icon: '✉️' },
  telefon:   { label: 'Telefon',      icon: '📞' },
  besuch:    { label: 'Vorbeigegangen', icon: '🚶' },
  sonstiges: { label: 'Sonstiges',    icon: '•' },
};

export const CHANNEL_KEYS = Object.keys(CHANNELS);

/**
 * Was dabei herauskam. `offen` ist der Normalfall direkt nach dem Absenden -
 * und genau der Zustand, den die Wiedervorlage später einsammelt.
 */
export const OUTCOMES = {
  offen:          { label: 'Noch keine Antwort', color: '#94a3b8' },
  antwort:        { label: 'Hat geantwortet',    color: '#3b82f6' },
  termin:         { label: 'Termin vereinbart',  color: '#eab308' },
  abschluss:      { label: 'Auftrag',            color: '#22c55e' },
  kein_interesse: { label: 'Kein Interesse',     color: '#ef4444' },
};

export const OUTCOME_KEYS = Object.keys(OUTCOMES);

/**
 * Wie weit ein Ergebnis den Pipeline-Status mindestens bringt.
 *
 * Nur vorwärts: wer schon Kunde ist, wird durch eine neue Notiz nicht wieder
 * "kontaktiert". Und `kein_interesse` stellt bewusst NICHT automatisch auf
 * `abgelehnt` - eine einzelne unbeantwortete DM ist noch kein Nein, das
 * entscheidet Kevin selbst.
 */
export const OUTCOME_STATUS = {
  offen: 'kontaktiert',
  antwort: 'kontaktiert',
  termin: 'in_gespraech',
  abschluss: 'kunde',
  kein_interesse: 'kontaktiert',
};

/** Reihenfolge der Pipeline für den Funnel - nur die Stufen, die vorwärts führen. */
export const FUNNEL = [
  'neu', 'recherchiert', 'interessiert', 'demo_gebaut', 'kontaktiert', 'in_gespraech', 'kunde',
];

/**
 * Status, die keine eigene Trichterstufe sind, aber eine erreicht haben.
 *
 * `pausiert` heisst "war Kunde, liegt gerade still" — das ist kein Abgang,
 * sondern ein durchlaufener Trichter. Ohne diese Zuordnung stünde ein
 * pausierter Kunde unter "ausgeschieden", und die Zahl der je gewonnenen
 * Kunden wäre zu klein.
 */
export const FUNNEL_ALIAS = {
  pausiert: 'kunde',
};
