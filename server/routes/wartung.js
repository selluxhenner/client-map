import { Router } from 'express';
import { createBackup, listBackups, dbInfo, compact, BACKUP_DIR } from '../lib/backup.js';
import { findDuplicates, mergeVenues, besserBehalten } from '../lib/dedupe.js';
import { getVenue } from '../lib/venue-store.js';
import { startRegionScan, stopRegionScan, regionState } from '../lib/regions.js';
import { queueState } from '../jobs/queue.js';
import { herunterfahren } from '../lib/shutdown.js';
import { isEnabled as googleEnabled, adapterInfo } from '../providers/google.js';

export const wartungRouter = Router();

// --- Zustand ----------------------------------------------------------------

wartungRouter.get('/wartung', (_req, res) => {
  res.json({
    datenbank: dbInfo(),
    sicherungen: listBackups(),
    sicherungsordner: BACKUP_DIR,
    google: { aktiv: googleEnabled(), ...adapterInfo() },
    region: regionState(),
  });
});

// --- Sicherungen ------------------------------------------------------------

wartungRouter.post('/wartung/sicherung', (req, res, next) => {
  try {
    res.status(201).json(createBackup(req.body?.grund || 'manuell'));
  } catch (err) {
    next(err);
  }
});

wartungRouter.post('/wartung/kompakt', (_req, res, next) => {
  try {
    res.json(compact());
  } catch (err) {
    next(err);
  }
});

// --- Doppelte ---------------------------------------------------------------

wartungRouter.get('/wartung/doppelte', (_req, res) => {
  const paare = findDuplicates();
  res.json({
    paare: paare.map((p) => ({ ...p, vorschlagBehalten: besserBehalten(p.a, p.b) })),
    anzahl: paare.length,
  });
});

/**
 * Zusammenfuehren. Vorher wird automatisch gesichert - das ist der einzige
 * Vorgang in der App, der Daten wirklich vernichtet, und eine Sicherung
 * kostet bei dieser Datenbankgroesse Millisekunden.
 */
wartungRouter.post('/wartung/merge', (req, res, next) => {
  try {
    const behalten = Number(req.body?.behalten);
    const aufgeben = Number(req.body?.aufgeben);
    if (!getVenue(behalten) || !getVenue(aufgeben)) {
      return res.status(404).json({ error: 'Betrieb nicht gefunden' });
    }

    const sicherung = createBackup('vor-merge');
    res.json({ ...mergeVenues(behalten, aufgeben), sicherung: sicherung.name });
  } catch (err) {
    next(err);
  }
});

// --- Regions-Stapel ---------------------------------------------------------

wartungRouter.post('/wartung/regionen', (req, res, next) => {
  try {
    res.status(202).json(startRegionScan(req.body?.orte));
  } catch (err) {
    next(err);
  }
});

wartungRouter.post('/wartung/regionen/stop', (_req, res) => {
  res.json({ gestoppt: stopRegionScan() });
});

// --- Beenden ----------------------------------------------------------------

/**
 * Server sauber beenden.
 *
 * Klingt nach einem gefaehrlichen Knopf, ist aber das Gegenteil: unter Windows
 * kommt Strg-C bei einem ueber npm gestarteten Node-Prozess nicht zuverlaessig
 * an, und wer das Fenster zuklickt, hinterlaesst laufende Agenten als Waisen.
 * Dieser Weg nimmt sie garantiert mit.
 *
 * Nur von diesem Rechner aus - der Server hoert ohnehin auf 127.0.0.1, aber
 * falls jemand HOST aufmacht, soll das hier nicht mitkommen.
 */
wartungRouter.post('/wartung/beenden', (req, res) => {
  const woher = req.socket.remoteAddress || '';
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(woher)) {
    return res.status(403).json({ error: 'Beenden geht nur von diesem Rechner aus' });
  }

  const laufende = queueState().running.length;
  res.json({
    beendet: true,
    laufendeAuftraege: laufende,
    meldung: laufende
      ? `Server wird beendet — ${laufende} laufende Aufträge werden abgebrochen.`
      : 'Server wird beendet.',
  });
  herunterfahren('Knopf in der Oberfläche');
});
