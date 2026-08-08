import { Router } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../db.js';
import { bus } from '../lib/bus.js';
import {
  enqueue, enqueueBatch, cancel, cancelWaiting, getJob, listJobs, queueState, resume,
} from '../jobs/queue.js';
import { publicKinds } from '../jobs/kinds.js';
import { claudeBin, abrechnung } from '../jobs/runner.js';
import { listVenues } from '../lib/venue-store.js';

export const jobsRouter = Router();

jobsRouter.get('/jobs', async (req, res) => {
  res.json({
    jobs: listJobs({ limit: req.query.limit }),
    queue: queueState(),
    kinds: publicKinds(),
    claudeBin: claudeBin(),
    abrechnung: await abrechnung(),
  });
});

// Live-Ticker. Ein einziger Strom fuer alle Jobs - die Oberflaeche filtert
// selbst, welchen sie gerade anzeigt.
jobsRouter.get('/jobs/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify({ type: 'queue', state: queueState() })}\n\n`);

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  bus.on('event', send);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off('event', send);
  });
});

jobsRouter.post('/jobs', (req, res, next) => {
  try {
    const { kind, venue_id: venueId } = req.body || {};
    res.status(201).json(enqueue({ kind, venueId: venueId ?? null }));
  } catch (err) {
    next(err);
  }
});

/**
 * Tiefen-Scan: alle Betriebe eines Filters auf einmal analysieren lassen.
 *
 * Der Filter ist derselbe wie fuer Karte, Liste und Export - was du auf dem
 * Bildschirm siehst, ist genau das, was in die Schlange geht. Voreingestellt
 * sind die ungeprueften Betriebe, weil ein zweiter Lauf ueber bereits
 * recherchierte Laeden nur Kontingent kostet.
 *
 * `dryRun: true` liefert dieselben Zahlen, ohne etwas einzureihen - damit die
 * Rueckfrage in der Oberflaeche echte Zahlen nennen kann.
 */
jobsRouter.post('/jobs/batch', (req, res, next) => {
  try {
    const { kind = 'analyse', filter = {}, max, dryRun = false } = req.body || {};

    const { venues } = listVenues({
      verified: '0',
      ...filter,
      sort: 'score_desc',
      limit: 1000,
    });

    res.json({
      ...enqueueBatch({
        kind,
        venueIds: venues.map((v) => v.id),
        max,
        dryRun: Boolean(dryRun),
      }),
      gefiltert: venues.length,
    });
  } catch (err) {
    next(err);
  }
});

jobsRouter.post('/jobs/resume', (_req, res) => {
  resume();
  res.json(queueState());
});

jobsRouter.post('/jobs/cancel-waiting', (_req, res) => {
  res.json({ abgebrochen: cancelWaiting(), queue: queueState() });
});

jobsRouter.get('/jobs/:id', (req, res) => {
  const job = getJob(Number(req.params.id));
  if (!job) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(job);
});

// Verlauf eines Laufs, damit die Oberflaeche einen Job auch nachtraeglich
// nachlesen kann und nicht nur live.
jobsRouter.get('/jobs/:id/log', (req, res) => {
  const path = join(DATA_DIR, 'jobs', `${Number(req.params.id)}.jsonl`);
  if (!existsSync(path)) return res.json({ events: [] });

  const events = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.type === 'stderr') {
      events.push({ t: 'stderr', text: msg.line });
    } else if (msg.type === 'assistant') {
      for (const part of msg.message?.content || []) {
        if (part.type === 'text' && part.text.trim()) events.push({ t: 'text', text: part.text });
        else if (part.type === 'tool_use') events.push({ t: 'tool', name: part.name });
      }
    } else if (msg.type === 'system' && msg.subtype === 'init') {
      events.push({ t: 'init', model: msg.model, skillCount: (msg.skills || []).length });
    } else if (msg.type === 'result') {
      events.push({ t: 'result', ok: !msg.is_error, result: msg.result, cost: msg.total_cost_usd });
    }
  }
  res.json({ events });
});

jobsRouter.post('/jobs/:id/cancel', (req, res) => {
  const job = cancel(Number(req.params.id));
  if (!job) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(job);
});
