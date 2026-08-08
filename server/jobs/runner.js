// Startet einen headless Claude-Lauf und uebersetzt dessen stream-json in
// ein paar wenige, stabile Ereignisse.
//
// Warum stream-json und nicht einfach text: nur so sieht man live, was der
// Agent tut, und nur so bekommt man die Abbruchgruende, den Verbrauch und
// vor allem die Rate-Limit-Meldung sauber heraus.

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DATA_DIR } from '../db.js';

/**
 * Umgebungsvariablen, die einen Agentenlauf von der Abo-Anmeldung auf eine
 * andere Abrechnung umleiten wuerden.
 *
 * Warum das hier ueberhaupt ein Thema ist: index.js laedt die .env in
 * process.env, und ein Kindprozess erbt alles davon. Ein Schluessel, der aus
 * einem ganz anderen Grund in der .env liegt, wuerde die Aufträge still auf
 * API-Abrechnung umstellen - und das merkt man erst auf der Rechnung. Deshalb
 * werden sie herausgenommen, ausser man will es ausdruecklich.
 */
const ABRECHNUNGS_VARIABLEN = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
];

function childEnv() {
  const env = { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'client-map' };
  if (process.env.JOB_ALLOW_API_BILLING === '1') return env;

  const entfernt = ABRECHNUNGS_VARIABLEN.filter((name) => env[name] != null);
  for (const name of entfernt) delete env[name];
  if (entfernt.length) {
    console.warn(
      `[runner] ${entfernt.join(', ')} nicht weitergegeben — Aufträge laufen über die ` +
      'Abo-Anmeldung. Mit JOB_ALLOW_API_BILLING=1 in der .env erlauben.'
    );
  }
  return env;
}

/** Findet die Claude-CLI. Auf Windows braucht spawn den vollen Pfad. */
export function claudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const candidates = [
    join(home, '.local', 'bin', 'claude.exe'),
    join(home, '.local', 'bin', 'claude'),
  ];
  return candidates.find((p) => existsSync(p)) || 'claude';
}

let abrechnungPromise;

/**
 * Womit sich die CLI anmeldet - Abo oder API. Einmal pro Serverlauf gefragt
 * und gemerkt, weil es ein eigener Prozessstart ist.
 *
 * Die Frage "kostet mich das jetzt Geld pro Auftrag" soll man in der
 * Oberflaeche beantworten koennen und nicht im Terminal nachschlagen muessen.
 */
export function abrechnung() {
  abrechnungPromise ||= new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(claudeBin(), ['auth', 'status'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: childEnv(),
      });
    } catch {
      return resolve(null);
    }

    const stop = setTimeout(() => { child.kill(); resolve(null); }, 10_000);
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('error', () => { clearTimeout(stop); resolve(null); });
    child.on('close', () => {
      clearTimeout(stop);
      try {
        const status = JSON.parse(out);
        resolve({
          angemeldet: Boolean(status.loggedIn),
          weg: status.authMethod ?? null,
          abo: status.subscriptionType ?? null,
          // firstParty = direkt bei Anthropic. Alles andere heisst: es laeuft
          // ueber einen anderen Anbieter und damit ueber eine Rechnung.
          ueberAbo: status.apiProvider === 'firstParty' && Boolean(status.subscriptionType),
        });
      } catch {
        resolve(null);
      }
    });
  });
  return abrechnungPromise;
}

/**
 * Fuehrt einen Job aus.
 *
 * @returns {{child: import('node:child_process').ChildProcess, done: Promise<object>}}
 */
export function runJob({ job, kind, venue, onEvent }) {
  const spec = kind.build ? kind.build({ venue, job }) : { prompt: '', args: [] };

  const args = [
    '-p', spec.prompt,
    '--model', kind.model,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', spec.permissionMode || 'acceptEdits',
    ...(spec.args || []),
  ];

  const cwd = spec.cwd && existsSync(spec.cwd) ? spec.cwd : process.cwd();
  const logPath = join(DATA_DIR, 'jobs', `${job.id}.jsonl`);
  const log = createWriteStream(logPath, { flags: 'a' });

  const child = spawn(claudeBin(), args, {
    cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv(),
  });

  const summary = {
    logPath,
    sessionId: null,
    result: null,
    cost: null,
    turns: null,
    isError: false,
    rateLimit: null,
    meta: {},
    stderr: '',
  };

  const emit = (event) => {
    try {
      onEvent?.(event);
    } catch (err) {
      console.error('[runner] onEvent', err);
    }
  };

  createInterface({ input: child.stdout }).on('line', (line) => {
    if (!line.trim()) return;
    log.write(line + '\n');

    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      emit({ t: 'text', text: line });
      return;
    }
    handle(msg, summary, emit);
  });

  createInterface({ input: child.stderr }).on('line', (line) => {
    summary.stderr += line + '\n';
    log.write(JSON.stringify({ type: 'stderr', line }) + '\n');
    emit({ t: 'stderr', text: line });
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, kind.timeoutMs || 15 * 60_000);

  const done = new Promise((resolve) => {
    child.on('error', (err) => {
      summary.isError = true;
      summary.stderr += `${err.message}\n`;
      emit({ t: 'stderr', text: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      log.end();
      resolve({
        ...summary,
        exitCode: code,
        timedOut,
        ok: code === 0 && !summary.isError && !timedOut,
      });
    });
  });

  return { child, done };
}

function handle(msg, summary, emit) {
  switch (msg.type) {
    case 'system':
      if (msg.subtype === 'init') {
        const skills = (msg.skills || []).map((s) => (typeof s === 'string' ? s : s?.name));
        summary.sessionId = msg.session_id;
        summary.meta = {
          model: msg.model,
          permissionMode: msg.permissionMode,
          cwd: msg.cwd,
          skillCount: skills.length,
          hasRestaurantSkill: skills.includes('restaurant-website-build'),
          version: msg.claude_code_version,
        };
        emit({ t: 'init', ...summary.meta, sessionId: msg.session_id });
      }
      break;

    case 'assistant':
      for (const part of msg.message?.content || []) {
        if (part.type === 'text' && part.text.trim()) {
          emit({ t: 'text', text: part.text });
        } else if (part.type === 'tool_use') {
          emit({ t: 'tool', name: part.name, input: shortInput(part.input) });
        }
      }
      break;

    case 'rate_limit_event':
      // Die einzige verlaessliche Quelle dafuer, dass das Kontingent knapp
      // wird. Die Queue haengt sich daran und pausiert von selbst.
      summary.rateLimit = msg.rate_limit_info;
      emit({ t: 'rate', info: msg.rate_limit_info });
      break;

    case 'result':
      summary.result = msg.result ?? null;
      summary.cost = msg.total_cost_usd ?? null;
      summary.turns = msg.num_turns ?? null;
      summary.isError = Boolean(msg.is_error);
      emit({
        t: 'result',
        ok: !msg.is_error,
        subtype: msg.subtype,
        result: msg.result,
        cost: msg.total_cost_usd,
        turns: msg.num_turns,
        durationMs: msg.duration_ms,
      });
      break;

    default:
      break;
  }
}

function shortInput(input) {
  if (!input) return '';
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}
