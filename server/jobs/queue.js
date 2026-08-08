// Auftragsschlange.
//
// Absicht: Es soll unmöglich sein, dass ein unbedachter Klick oder ein
// Stapellauf ueber Nacht das gesamte Nutzungskontingent auffrisst. Deshalb
// drei Bremsen: begrenzte Gleichzeitigkeit, ein Tageslimit je Auftragsart,
// und eine automatische Pause, sobald die CLI ein Rate-Limit meldet.

import { db } from '../db.js';
import { kindOf } from './kinds.js';
import { runJob } from './runner.js';
import { getVenue } from '../lib/venue-store.js';
import { bus } from '../lib/bus.js';

export { bus };

// Vier gleichzeitig: ein Schnell-Check ist rund eine halbe Minute lang, und
// die Wartezeit ist fast nur Warten auf fremde Server. Mehr Prozesse bringen
// wenig, kosten aber je ein paar hundert Megabyte.
const CONCURRENCY = Math.max(1, Number(process.env.JOB_CONCURRENCY) || 4);

/** Obergrenze fuer einen einzelnen Stapellauf, unabhaengig vom Tageslimit. */
const BATCH_MAX = Math.max(1, Number(process.env.JOB_BATCH_MAX) || 25);

/** Laufende Prozesse, damit Abbrechen wirklich abbricht. */
const running = new Map(); // jobId -> child

let pausedUntil = 0;
let pauseReason = null;

// --- Öffentliche Schnittstelle ---------------------------------------------

export function enqueue({ kind: kindName, venueId = null }) {
  const kind = kindOf(kindName);
  if (!kind) throw httpError(400, `Unbekannte Auftragsart: ${kindName}`);
  if (!kind.available) {
    throw httpError(400, `"${kind.label}" kommt in Phase ${kind.plannedIn}.`);
  }
  if (kind.needsVenue && !venueId) throw httpError(400, 'Betrieb fehlt');
  if (venueId && !getVenue(venueId)) throw httpError(404, 'Betrieb nicht gefunden');

  // Zweimal dasselbe fuer denselben Laden ist immer ein Versehen und kostet
  // doppelt Kontingent.
  const offen = venueId ? openJobFor(venueId, kindName) : null;
  if (offen) {
    throw httpError(409, `"${kind.label}" läuft für diesen Betrieb bereits (Auftrag #${offen.id}).`);
  }

  const used = todayCount(kindName);
  if (used >= kind.dailyLimit) {
    throw httpError(
      429,
      `Tageslimit erreicht: ${used}/${kind.dailyLimit} für "${kind.label}". ` +
        `Morgen wieder — oder JOB_LIMIT_${kindName.toUpperCase()} in der .env anheben.`
    );
  }

  const info = db
    .prepare("INSERT INTO jobs (venue_id, kind, model, status) VALUES (?, ?, ?, 'wartend')")
    .run(venueId, kindName, kind.model);

  const job = getJob(info.lastInsertRowid);
  bus.emit('event', { type: 'job', job });
  setImmediate(pump);
  return job;
}

/**
 * Stapellauf: viele Betriebe auf einmal einreihen.
 *
 * Anders als enqueue() wirft das hier nicht beim ersten Hindernis, sondern
 * nimmt mit, was noch reingeht, und berichtet den Rest. Ein Tiefen-Scan ueber
 * 60 Laeden soll nicht daran scheitern, dass Nummer 3 schon laeuft.
 *
 * @param {{kind: string, venueIds: number[], max?: number, dryRun?: boolean}} opts
 */
export function enqueueBatch({ kind: kindName, venueIds = [], max, dryRun = false }) {
  const kind = kindOf(kindName);
  if (!kind) throw httpError(400, `Unbekannte Auftragsart: ${kindName}`);
  if (!kind.available) throw httpError(400, `"${kind.label}" kommt in Phase ${kind.plannedIn}.`);

  const used = todayCount(kindName);
  const platz = Math.max(0, kind.dailyLimit - used);
  const deckel = Math.min(platz, Math.max(0, Number(max) || BATCH_MAX), BATCH_MAX);

  const frei = [];
  const laeuftSchon = [];
  for (const id of venueIds) {
    if (openJobFor(id, kindName)) laeuftSchon.push(id);
    else frei.push(id);
  }

  const nehmen = frei.slice(0, deckel);
  const bericht = {
    kandidaten: venueIds.length,
    eingereiht: nehmen.length,
    laeuftSchon: laeuftSchon.length,
    uebrig: frei.length - nehmen.length,
    heute: used,
    dailyLimit: kind.dailyLimit,
    limitErreicht: frei.length > nehmen.length && platz <= nehmen.length,
    label: kind.label,
  };

  if (dryRun || !nehmen.length) return bericht;

  const insert = db.prepare(
    "INSERT INTO jobs (venue_id, kind, model, status) VALUES (?, ?, ?, 'wartend')"
  );
  const ids = db.transaction((list) => list.map((id) => insert.run(id, kindName, kind.model).lastInsertRowid))(nehmen);

  for (const id of ids) bus.emit('event', { type: 'job', job: getJob(id) });
  broadcastQueue();
  setImmediate(pump);

  // Die Nummern zurueckgeben, damit die Oberflaeche genau diesen Stapel
  // mitverfolgen kann und nicht raten muss, welche Aufträge dazugehoeren.
  return { ...bericht, ids };
}

export function cancel(id) {
  const job = getJob(id);
  if (!job) return null;

  const child = running.get(id);
  if (child) {
    child.kill();
    return getJob(id);
  }
  if (job.status === 'wartend') {
    finish(id, { status: 'abgebrochen', error: 'Vor dem Start abgebrochen' });
    return getJob(id);
  }
  return job;
}

/**
 * Alles wegräumen, was noch nicht angefangen hat. Laufende Aufträge bleiben
 * unangetastet - die haben ihr Kontingent schon ausgegeben, ein Abbruch
 * mittendrin wuerde es nur wegwerfen.
 */
export function cancelWaiting() {
  const wartende = db.prepare("SELECT id FROM jobs WHERE status = 'wartend'").all();
  for (const { id } of wartende) {
    finish(id, { status: 'abgebrochen', error: 'Warteschlange geleert' });
  }
  broadcastQueue();
  return wartende.length;
}

export function getJob(id) {
  const row = db
    .prepare(
      `SELECT j.*, v.name AS venue_name
       FROM jobs j LEFT JOIN venues v ON v.id = j.venue_id
       WHERE j.id = ?`
    )
    .get(id);
  return row ? { ...row, meta: parse(row.meta) } : null;
}

export function listJobs({ limit = 50 } = {}) {
  return db
    .prepare(
      `SELECT j.*, v.name AS venue_name
       FROM jobs j LEFT JOIN venues v ON v.id = j.venue_id
       ORDER BY j.id DESC LIMIT ?`
    )
    .all(Math.min(Number(limit) || 50, 500))
    .map((row) => ({ ...row, meta: parse(row.meta) }));
}

export function queueState() {
  const counts = db
    .prepare(
      // Gleiche Zählweise wie das Tageslimit, sonst zeigt die Schublade eine
      // andere Zahl an, als die Bremse benutzt.
      `SELECT kind, COUNT(*) AS n FROM jobs
       WHERE date(created_at, 'localtime') = date('now', 'localtime')
         AND status <> 'abgebrochen'
       GROUP BY kind`
    )
    .all();
  return {
    running: [...running.keys()],
    concurrency: CONCURRENCY,
    paused: pausedUntil > Date.now(),
    pausedUntil: pausedUntil || null,
    pauseReason,
    heute: Object.fromEntries(counts.map((c) => [c.kind, c.n])),
  };
}

export function resume() {
  pausedUntil = 0;
  pauseReason = null;
  broadcastQueue();
  pump();
}

/**
 * Beim Herunterfahren alle laufenden Agenten mitnehmen.
 *
 * Ohne das läuft ein Demo-Bau nach Strg-C einfach weiter, schreibt weiter
 * Dateien und verbraucht weiter Kontingent - während die Oberfläche den Job
 * längst als tot anzeigt. Ein hartes Kill des Servers (Task-Manager) lässt
 * sich damit allerdings nicht abfangen; dafür gibt es recoverOrphans().
 */
export function stopAll() {
  if (!running.size) return 0;
  const count = running.size;
  for (const [id, child] of running) {
    child.kill();
    try {
      db.prepare(
        `UPDATE jobs SET status = 'abgebrochen', error = 'Server heruntergefahren',
         finished_at = datetime('now') WHERE id = ?`
      ).run(id);
    } catch {
      /* Beim Herunterfahren nicht auch noch am Schreiben scheitern. */
    }
  }
  running.clear();
  console.log(`[queue] ${count} laufende Jobs beendet`);
  return count;
}

/** Beim Serverstart: Jobs, die einen Absturz "überlebt" haben, aufräumen. */
export function recoverOrphans() {
  const orphans = db.prepare("SELECT id FROM jobs WHERE status = 'laeuft'").all();
  for (const { id } of orphans) {
    finish(id, { status: 'fehler', error: 'Server wurde neu gestartet, während der Job lief' });
  }
  if (orphans.length) console.log(`[queue] ${orphans.length} unterbrochene Jobs bereinigt`);
  setImmediate(pump);
}

// --- Innenleben ------------------------------------------------------------

// Der Tag endet um Mitternacht deiner Uhr, nicht um Mitternacht UTC. Ohne
// 'localtime' wuerde das Kontingent hier um 02:00 morgens umspringen.
/** Wartet oder laeuft fuer diesen Betrieb bereits ein Auftrag dieser Art? */
function openJobFor(venueId, kind) {
  return db
    .prepare(
      `SELECT id FROM jobs
       WHERE venue_id = ? AND kind = ? AND status IN ('wartend', 'laeuft')
       ORDER BY id LIMIT 1`
    )
    .get(venueId, kind);
}

function todayCount(kind) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM jobs
       WHERE kind = ?
         AND date(created_at, 'localtime') = date('now', 'localtime')
         AND status <> 'abgebrochen'`
    )
    .get(kind).n;
}

function pump() {
  if (pausedUntil > Date.now()) return;
  if (pausedUntil) resumeIfDue();

  while (running.size < CONCURRENCY) {
    const next = db
      .prepare("SELECT * FROM jobs WHERE status = 'wartend' ORDER BY id LIMIT 1")
      .get();
    if (!next) return;
    start(next);
  }
}

function resumeIfDue() {
  if (pausedUntil && pausedUntil <= Date.now()) {
    pausedUntil = 0;
    pauseReason = null;
    broadcastQueue();
  }
}

function start(row) {
  const kind = kindOf(row.kind);
  if (!kind) return finish(row.id, { status: 'fehler', error: 'Unbekannte Auftragsart' });

  const venue = row.venue_id ? getVenue(row.venue_id) : null;

  db.prepare("UPDATE jobs SET status = 'laeuft', started_at = datetime('now') WHERE id = ?")
    .run(row.id);
  bus.emit('event', { type: 'job', job: getJob(row.id) });

  const { child, done } = runJob({
    job: row,
    kind,
    venue,
    onEvent: (event) => {
      bus.emit('event', { type: 'log', jobId: row.id, event });
      if (event.t === 'rate') noteRateLimit(event.info);
    },
  });

  running.set(row.id, child);
  broadcastQueue();

  done.then((res) => {
    running.delete(row.id);

    let status = res.timedOut
      ? 'fehler'
      : res.exitCode === null || child.killed
        ? 'abgebrochen'
        : res.ok
          ? 'fertig'
          : 'fehler';

    // Ein Lauf, dessen Ergebnis nicht ankommt, ist kein Erfolg - auch wenn
    // der Prozess sauber beendet hat. Sonst faerbt sich der Pin blau, ohne
    // dass ein einziges Feld dazugelernt haette.
    let nachlaufFehler = null;
    if (status === 'fertig' && kind.onSuccess) {
      try {
        const ergebnis = kind.onSuccess({ job: row, venue, result: res.result });
        if (ergebnis?.venue) {
          bus.emit('event', { type: 'venue', venue: ergebnis.venue });
        }
        for (const warnung of ergebnis?.warnungen || []) {
          bus.emit('event', { type: 'log', jobId: row.id, event: { t: 'warn', text: warnung } });
        }
      } catch (err) {
        status = 'fehler';
        nachlaufFehler = err.message;
        console.error(`[queue] Auftrag #${row.id} auswerten:`, err);
        bus.emit('event', { type: 'log', jobId: row.id, event: { t: 'stderr', text: err.message } });
      }
    }

    finish(row.id, {
      status,
      // Ein bewusster Abbruch ist kein Fehler und braucht keine Meldung.
      error: nachlaufFehler
        ? nachlaufFehler
        : res.timedOut
          ? 'Zeitlimit überschritten'
          : status === 'abgebrochen' || res.ok
            ? null
            : (res.stderr || '').trim().slice(-500) || `Exit-Code ${res.exitCode}`,
      // Mit --json-schema kaeme hier ein Objekt an, die Spalte ist aber TEXT.
      result: typeof res.result === 'string' || res.result == null
        ? res.result
        : JSON.stringify(res.result),
      cost_usd: res.cost,
      num_turns: res.turns,
      session_id: res.sessionId,
      log_path: res.logPath,
      exit_code: res.exitCode,
      meta: JSON.stringify(res.meta || {}),
    });

    broadcastQueue();
    setImmediate(pump);
  });
}

function finish(id, fields) {
  const columns = Object.keys(fields);
  db.prepare(
    `UPDATE jobs SET ${columns.map((c) => `${c} = @${c}`).join(', ')},
     finished_at = datetime('now') WHERE id = @id`
  ).run({ ...fields, id });
  bus.emit('event', { type: 'job', job: getJob(id) });
}

/**
 * Entscheidet, ob eine Kontingent-Meldung der CLI die Schlange anhalten muss.
 *
 * 'allowed' ist der Normalfall, 'warning' heisst nur "wird knapp" - beides
 * laeuft weiter. Alles andere heisst: jetzt nicht weitermachen, sonst laufen
 * die naechsten Jobs nur noch in Fehler und verbrennen dabei Kontingent.
 *
 * Bewusst rein und exportiert, damit sich das ohne echtes Rate-Limit prüfen
 * laesst - man will nicht erst an die Wand fahren, um zu wissen, ob die
 * Bremse hält.
 */
export function rateLimitDecision(info, now = Date.now()) {
  if (!info || info.status === 'allowed' || info.status === 'warning') {
    return { pause: false };
  }
  const resetsAt = Number(info.resetsAt) * 1000;
  return {
    pause: true,
    until: Number.isFinite(resetsAt) && resetsAt > now ? resetsAt : now + 15 * 60_000,
    reason: `Kontingent (${info.rateLimitType || 'unbekannt'}) meldet "${info.status}"`,
  };
}

function noteRateLimit(info) {
  const decision = rateLimitDecision(info);
  if (!decision.pause) return;

  pausedUntil = decision.until;
  pauseReason = decision.reason;

  console.warn(`[queue] pausiert bis ${new Date(pausedUntil).toLocaleString('de-CH')}: ${pauseReason}`);
  broadcastQueue();
}

function broadcastQueue() {
  bus.emit('event', { type: 'queue', state: queueState() });
}

function parse(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
