// Was für Aufträge die Engine kennt.
//
// Jede Art bringt ihr eigenes Modell, ihr eigenes Tageslimit und ihren
// eigenen Prompt mit. Der Modell-Split ist der wichtigste Hebel gegen den
// Verbrauch: Recherche laeuft auf Sonnet, nur der Demo-Bau auf Opus.

import { join } from 'node:path';

/**
 * Tageslimit je Auftragsart. Ueber die .env uebersteuerbar
 * (JOB_LIMIT_TEST, JOB_LIMIT_ANALYSE, JOB_LIMIT_DEMO), damit du die Bremse
 * anziehen oder loesen kannst, ohne Code anzufassen.
 */
function limit(name, fallback) {
  const raw = process.env[`JOB_LIMIT_${name.toUpperCase()}`];
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const KINDS = {
  test: {
    label: 'Verbindung testen',
    model: 'sonnet',
    dailyLimit: limit('test', 20),
    timeoutMs: 3 * 60_000,
    needsVenue: false,
    available: true,
    build: () => ({
      prompt:
        'Antworte mit genau einem kurzen deutschen Satz, der bestätigt, dass du erreichbar bist. Nutze keine Werkzeuge.',
      args: ['--tools', ''],
    }),
  },

  analyse: {
    label: 'Analyse',
    model: 'sonnet',
    dailyLimit: limit('analyse', 40),
    timeoutMs: 12 * 60_000,
    needsVenue: true,
    available: false,
    plannedIn: 5,
  },

  demo: {
    label: 'Demo bauen',
    model: 'opus',
    dailyLimit: limit('demo', 5),
    timeoutMs: 60 * 60_000,
    needsVenue: true,
    available: false,
    plannedIn: 6,
    // Ab Phase 6: schreibt in den Demo-Ordner und darf dort auch Dateien anlegen.
    workdir: () => process.env.DEMO_DIR || join(process.cwd(), 'demos'),
  },
};

export function kindOf(name) {
  return KINDS[name] || null;
}

/** Was die Oberflaeche als Auswahl anzeigen darf. */
export function publicKinds() {
  return Object.fromEntries(
    Object.entries(KINDS).map(([key, k]) => [
      key,
      {
        label: k.label,
        model: k.model,
        dailyLimit: k.dailyLimit,
        needsVenue: k.needsVenue,
        available: k.available,
        plannedIn: k.plannedIn ?? null,
      },
    ])
  );
}
