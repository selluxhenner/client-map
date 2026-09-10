import 'dotenv/config';
import express from 'express';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { ROOT } from './db.js';
import { venuesRouter } from './routes/venues.js';
import { discoverRouter } from './routes/discover.js';
import { anreicherungRouter } from './routes/anreicherung.js';
import { metaRouter } from './routes/meta.js';
import { jobsRouter } from './routes/jobs.js';
import { demosRouter } from './routes/demos.js';
import { wartungRouter } from './routes/wartung.js';
import { recoverOrphans, stopAll } from './jobs/queue.js';
import { herunterfahren } from './lib/shutdown.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use('/api', metaRouter);
app.use('/api', discoverRouter);
app.use('/api', anreicherungRouter);
app.use('/api', jobsRouter);
app.use('/api', demosRouter);
app.use('/api', wartungRouter);
app.use('/api', venuesRouter);

// Leaflet kommt aus node_modules statt von einem CDN: die App startet damit
// auch ohne Internet und bleibt in fuenf Jahren noch reproduzierbar.
app.use('/vendor/leaflet', express.static(join(ROOT, 'node_modules/leaflet/dist')));
app.use(
  '/vendor/markercluster',
  express.static(join(ROOT, 'node_modules/leaflet.markercluster/dist'))
);
app.use(express.static(join(ROOT, 'public')));

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[fehler]', err);
  res.status(status).json({ error: err.message || 'Unbekannter Fehler' });
});

const port = Number(process.env.PORT) || 8788;
const host = process.env.HOST || '127.0.0.1';

app.listen(port, host, () => {
  console.log(`\n  ServiWeb Client-Map läuft auf http://${host}:${port}`);
  console.log('  Beenden: Strg-C, oder "q" und Enter, oder der Knopf auf /wartung.html\n');
  recoverOrphans();
});

// --- Beenden ---------------------------------------------------------------

// SIGTERM und SIGHUP kennt Windows nicht, sie stehen für den Fall eines
// späteren Umzugs auf einen Server. SIGBREAK ist das Windows-Gegenstück und
// kommt bei Strg-Untbr an.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => herunterfahren(signal));
}

/**
 * Tastatursteuerung im Terminal.
 *
 * Zwei Gründe für readline statt nur process.on('SIGINT'): erstens liefert
 * Windows Strg-C an einen über npm gestarteten Node-Prozess nicht zuverlässig,
 * readline fängt es dagegen zuverlässig ab (so steht es auch in der
 * Node-Dokumentation). Zweitens gibt es damit einen Weg, der ganz ohne
 * Signale funktioniert: "q" tippen und Enter.
 */
if (process.stdin.isTTY) {
  const tasten = createInterface({ input: process.stdin });
  tasten.on('SIGINT', () => herunterfahren('Strg-C'));
  tasten.on('line', (zeile) => {
    if (['q', 'quit', 'exit', 'stop', 'ende'].includes(zeile.trim().toLowerCase())) {
      herunterfahren('Tastendruck');
    }
  });
}

// Letzte Rettung: wird der Prozess anders beendet (Fensterkreuz, Task-Manager
// mit Signal), sollen die Agenten trotzdem nicht weiterlaufen. Bei einem
// harten Kill greift auch das nicht - dafür gibt es recoverOrphans().
process.on('exit', stopAll);
