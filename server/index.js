import 'dotenv/config';
import express from 'express';
import { join } from 'node:path';
import { ROOT } from './db.js';
import { venuesRouter } from './routes/venues.js';
import { discoverRouter } from './routes/discover.js';
import { metaRouter } from './routes/meta.js';
import { jobsRouter } from './routes/jobs.js';
import { recoverOrphans, stopAll } from './jobs/queue.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use('/api', metaRouter);
app.use('/api', discoverRouter);
app.use('/api', jobsRouter);
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

const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || '127.0.0.1';

app.listen(port, host, () => {
  console.log(`\n  ServiWeb Client-Map läuft auf http://${host}:${port}\n`);
  recoverOrphans();
});

// Strg-C soll auch die Agenten mitnehmen, nicht nur den Server.
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    stopAll();
    process.exit(0);
  });
}
process.on('exit', stopAll);
