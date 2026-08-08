// Was für Aufträge die Engine kennt.
//
// Jede Art bringt ihr eigenes Modell, ihr eigenes Tageslimit und ihren
// eigenen Prompt mit. Der Modell-Split ist der wichtigste Hebel gegen den
// Verbrauch: Recherche laeuft auf Sonnet, nur der Demo-Bau auf Opus.

import { analysePrompt } from './prompts/analyse.js';
import { schnellcheckPrompt } from './prompts/schnellcheck.js';
import { demoPrompt } from './prompts/demo.js';
import { kontaktPrompt } from './prompts/kontakt.js';
import { applyOutreach, outreachInput } from '../lib/outreach.js';
import { ANALYSEN_DIR, applyAnalysis, readAnalysis } from '../lib/analysis.js';
import { finishDemo, prepareDemoFolder, RECHERCHE_DATEI } from '../lib/demos.js';

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

  // Der Arbeitspferd-Auftrag fuer ganze Ausschnitte: beantwortet nur die
  // Fragen, die den Score bewegen, und ist darum in rund einer halben Minute
  // durch. Kein Dateischreiben, keine Story - dafuer gibt es die Analyse.
  schnell: {
    label: 'Schnell-Check',
    model: 'sonnet',
    dailyLimit: limit('schnell', 150),
    timeoutMs: 90_000,
    typischS: 35,
    needsVenue: true,
    available: true,

    build: ({ venue }) => ({
      prompt: schnellcheckPrompt(venue),
      cwd: ANALYSEN_DIR,
      args: [
        '--tools', 'WebSearch,WebFetch',
        '--allowed-tools', 'WebSearch,WebFetch',
      ],
    }),

    onSuccess: ({ job, result }) => applyAnalysis(job.venue_id, result, 'schnell'),
  },

  analyse: {
    label: 'Analyse',
    model: 'sonnet',
    dailyLimit: limit('analyse', 40),
    timeoutMs: 12 * 60_000,
    typischS: 150,
    needsVenue: true,
    available: true,

    // Der Agent arbeitet in data/analysen und legt dort seine zwei Dateien ab.
    // Zusammen mit der eingeschraenkten Werkzeugliste kann er ausserhalb
    // dieses Ordners nichts anfassen.
    //
    // --tools begrenzt, WAS es an Werkzeugen gibt; --allowed-tools sagt, dass
    // sie ohne Rueckfrage benutzt werden duerfen. Ohne das zweite Flag wuerde
    // ein WebFetch auf eine neue Domain im Kopfmodus einfach abgelehnt.
    build: ({ venue }) => ({
      prompt: analysePrompt(venue),
      cwd: ANALYSEN_DIR,
      args: [
        '--tools', 'WebSearch,WebFetch,Write',
        '--allowed-tools', 'WebSearch,WebFetch,Write',
      ],
    }),

    onSuccess: ({ job, result }) => applyAnalysis(job.venue_id, result, 'analyse'),
  },

  // Aktion C: erzeugt nur Entwuerfe. Braucht keine Werkzeuge, weil alles
  // Wissen im Prompt steht - deshalb in rund 20 Sekunden durch, und der Agent
  // kann nichts anfassen. Versendet wird nie etwas.
  kontakt: {
    label: 'Kontakt-Entwurf',
    model: 'sonnet',
    dailyLimit: limit('kontakt', 60),
    timeoutMs: 3 * 60_000,
    typischS: 25,
    needsVenue: true,
    available: true,

    build: ({ venue }) => ({
      prompt: kontaktPrompt({ venue, ...outreachInput(venue) }),
      args: ['--tools', ''],
    }),

    onSuccess: ({ job, result }) => applyOutreach(job.venue_id, result),
  },

  demo: {
    label: 'Demo bauen',
    model: 'opus',
    dailyLimit: limit('demo', 5),
    timeoutMs: 60 * 60_000,
    typischS: 40 * 60,
    needsVenue: true,
    available: true,

    /**
     * Der Ordner wird VOR dem Start angelegt und mit der Recherche sowie einem
     * Vorbildprojekt gefuellt. Das Arbeitsverzeichnis ist genau dieser Ordner:
     * mit acceptEdits kann der Agent damit nirgends sonst schreiben, und im
     * Auftragsordner liegen Kundenprojekte ohne Git-Sicherung.
     *
     * Bash braucht der Bau (npm install, npm run build), deshalb steht es in
     * --allowed-tools - aber nur fuer die Befehle, die ein Seitenbau wirklich
     * braucht. Reicht die Liste einmal nicht, scheitert der Auftrag sichtbar,
     * statt still mehr zu duerfen als gedacht.
     */
    build: ({ venue }) => {
      const analyse = readAnalysis(venue);
      const { pfad, ordner, referenz } = prepareDemoFolder(venue, analyse?.text || null);

      return {
        prompt: demoPrompt({
          venue, ordner, referenz,
          hatRecherche: Boolean(analyse),
          rechercheDatei: RECHERCHE_DATEI,
        }),
        cwd: pfad,
        args: [
          '--allowed-tools',
          [
            'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'Task',
            'Bash(npm *)', 'Bash(npx *)', 'Bash(node *)', 'Bash(mkdir *)', 'Bash(ls *)', 'Bash(cat *)',
          ].join(','),
        ],
      };
    },

    onSuccess: ({ job }) => finishDemo(job.venue_id),
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
        // Erfahrungswert, damit die Oberflaeche vor einem Stapellauf sagen
        // kann, wie lange das ungefaehr dauert.
        typischS: k.typischS ?? null,
      },
    ])
  );
}
