// Nimmt das Ergebnis eines Kontakt-Entwurf-Auftrags entgegen.
//
// Gleiche Haltung wie bei der Analyse: dem Agenten wird nicht geglaubt,
// sondern geprüft. Ein Entwurf ohne DM-Text ist wertlos, und eine DM, die
// Instagram abschneidet, ist schlimmer als keine.

import { getVenue, updateVenue } from './venue-store.js';
import { extractJson, readAnalysis } from './analysis.js';

/** Ab hier schneidet Instagram ab. Muss zu DM_MAX im Prompt passen. */
const DM_MAX = 450;

export function applyOutreach(venueId, resultText) {
  const venue = getVenue(venueId);
  if (!venue) throw new Error('Betrieb existiert nicht mehr');

  const data = extractJson(resultText);
  if (!data) {
    throw new Error('Der Lauf hat keinen lesbaren Entwurf geliefert (kein JSON in der Antwort).');
  }

  const warnungen = [];
  const dm = text(data.dm, 1200);
  const mailText = text(data.mail_text, 4000);

  if (!dm && !mailText) {
    throw new Error('Der Entwurf enthält weder eine DM noch eine Mail.');
  }
  if (!dm) warnungen.push('Keine Instagram-DM im Entwurf.');
  if (!mailText) warnungen.push('Kein Mail-Text im Entwurf.');

  // Nicht abschneiden, nur melden: ein halber Satz waere schlimmer als ein zu
  // langer Text, den Kevin selbst kuerzt.
  if (dm && dm.length > DM_MAX) {
    warnungen.push(`DM ist ${dm.length} Zeichen lang (Instagram schneidet ab ${DM_MAX} ab) — bitte kürzen.`);
  }
  if (dm && !venue.instagram) {
    warnungen.push('Für diesen Betrieb ist kein Instagram-Handle bekannt — die DM kannst du noch nicht verschicken.');
  }
  if (/\[DEMO-LINK\]/.test(`${dm} ${mailText}`)) {
    warnungen.push('Enthält den Platzhalter [DEMO-LINK] — vor dem Absenden ersetzen.');
  }

  const entwurf = {
    dm,
    mail_betreff: text(data.mail_betreff, 200),
    mail_text: mailText,
    aufhaenger: text(data.aufhaenger, 400),
    hinweise: [
      ...(Array.isArray(data.hinweise) ? data.hinweise.map((h) => text(h, 300)).filter(Boolean) : []),
      ...warnungen,
    ],
  };

  const updated = updateVenue(venueId, {
    outreach_draft: JSON.stringify(entwurf),
    outreach_draft_at: nowSql(),
  });

  return { venue: updated, warnungen };
}

/** Was der Auftrag als Ausgangsmaterial bekommt. */
export function outreachInput(venue) {
  const analyse = readAnalysis(venue);
  return {
    analyse: analyse?.text || null,
    hatDemo: Boolean(venue.demo_path),
  };
}

function text(value, max) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\r\n/g, '\n').trim();
  return clean ? clean.slice(0, max) : null;
}

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}
