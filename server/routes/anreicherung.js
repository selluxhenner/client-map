// Sammel-Anreicherung: derselbe Filter wie Karte, Liste und Export, aber
// statt einem Agenten je Betrieb laeuft hier ein HTTP-Abruf je Betrieb.
//
// Der Lauf antwortet sofort und meldet den Fortschritt ueber den
// Ereignisstrom - 400 Betriebe dauern rund zwei Minuten, so lange soll keine
// Anfrage offen stehen.

import { Router } from 'express';
import { listVenues } from '../lib/venue-store.js';
import {
  kandidaten, startAnreicherung, stopAnreicherung, anreicherungState, pruefeBetrieb,
  MAX_PRO_LAUF, GOOGLE_MAX, WIEDERHOLUNG_TAGE,
} from '../lib/enrich.js';
import { isEnabled as googleEnabled } from '../providers/google.js';

export const anreicherungRouter = Router();

anreicherungRouter.get('/anreicherung', (_req, res) => {
  res.json({
    ...anreicherungState(),
    google: googleEnabled(),
    maxProLauf: MAX_PRO_LAUF,
    googleMax: GOOGLE_MAX,
    wiederholungTage: WIEDERHOLUNG_TAGE,
  });
});

/**
 * Startet einen Lauf ueber den aktuellen Filter.
 *
 * `dryRun: true` liefert dieselben Zahlen, ohne etwas anzufassen - damit die
 * Rueckfrage in der Oberflaeche echte Zahlen nennen kann statt "einige".
 */
anreicherungRouter.post('/anreicherung', (req, res, next) => {
  try {
    const { filter = {}, max, google: mitGoogle, force = false, dryRun = false } = req.body || {};
    const nutzeGoogle = mitGoogle !== false && googleEnabled();

    const { venues } = listVenues({
      ...filter,
      felder: 'alle',
      sort: 'score_desc',
      limit: 5000,
    });

    const auswahl = kandidaten(venues, {
      google: nutzeGoogle,
      force: Boolean(force),
      max: Math.min(Number(max) || MAX_PRO_LAUF, MAX_PRO_LAUF),
    });

    const vorschau = {
      gefiltert: venues.length,
      kandidaten: auswahl.machen.length,
      kuerzlich: auswahl.kuerzlich,
      nichtsZuHolen: auswahl.nichtsZuHolen,
      uebrig: auswahl.uebrig,
      googleNoetig: auswahl.googleNoetig,
      google: nutzeGoogle,
      wiederholungTage: WIEDERHOLUNG_TAGE,
    };

    if (dryRun || !auswahl.machen.length) return res.json({ ...vorschau, laeuft: false });
    res.json({ ...vorschau, ...startAnreicherung(auswahl.machen, { google: nutzeGoogle }) });
  } catch (err) {
    next(err);
  }
});

anreicherungRouter.post('/anreicherung/stop', (_req, res) => {
  res.json({ gestoppt: stopAnreicherung(), ...anreicherungState() });
});

/** Ein einzelner Betrieb, gleich mit Antwort - das dauert nur zwei Sekunden. */
anreicherungRouter.post('/anreicherung/betrieb/:id', async (req, res, next) => {
  try {
    const ergebnis = await pruefeBetrieb(Number(req.params.id), { google: googleEnabled() });
    if (!ergebnis) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(ergebnis);
  } catch (err) {
    next(err);
  }
});
