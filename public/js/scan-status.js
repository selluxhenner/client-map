// Fortschrittsstreifen ueber der Karte.
//
// Zwei Aktionen laufen laenger als ein Klick: die Bereichssuche (Sekunden bis
// eine Minute) und die Bewertung eines ganzen Ausschnitts (Minuten bis
// Stunden). Ohne sichtbaren Stand sieht beides aus wie "nichts passiert" -
// und dann klickt man nochmal, was im zweiten Fall Kontingent kostet.
//
// Der Streifen sagt deshalb immer drei Dinge: was laeuft, wie weit es ist,
// und was am Ende dabei herauskam.

import { el, clear } from './api.js';
import { onServerEvent } from './jobs.js';

let host;
let ticker;
let lauf = null;    // aktueller Vorgang
let stapel = null;  // mitverfolgter Bewertungs-Stapel

const AUTO_WEG_MS = 12_000;

export function initScanStatus(parent) {
  host = el('div', { class: 'scan-status', hidden: true });
  parent.append(host);
  onServerEvent(handleEvent);
}

// --- Von aussen steuerbar ---------------------------------------------------

export function scanBegin(titel, zeile = '') {
  stapel = null; // ein neuer Vorgang loest den vorherigen ab
  lauf = { titel, zeile, start: Date.now(), von: 0, bis: 0, fertig: false, fehler: false };
  clearInterval(ticker);
  ticker = setInterval(render, 1000);
  render();
}

export function scanNote(zeile) {
  if (!lauf || lauf.fertig) return;
  lauf.zeile = zeile;
  render();
}

export function scanEnd(zeile, { fehler = false } = {}) {
  if (!lauf) scanBegin('Fertig');
  lauf.zeile = zeile;
  lauf.fertig = true;
  lauf.fehler = fehler;
  clearInterval(ticker);
  render();
  // Erfolg verschwindet von selbst, ein Fehler bleibt stehen, bis man ihn
  // weggeklickt hat - sonst uebersieht man ihn.
  if (!fehler) setTimeout(() => { if (lauf?.fertig && !lauf.fehler) verstecken(); }, AUTO_WEG_MS);
}

/**
 * Einen Stapel Analyse-Aufträge mitverfolgen. Zaehlt nicht nur ab, sondern
 * sammelt auch, was dabei herauskommt - das ist die eigentliche Frage:
 * wie viele Betriebe im Ausschnitt sind wirklich ohne Website?
 */
export function trackBatch(ids, titel = 'Betriebe werden bewertet') {
  if (!ids?.length) return;
  scanBegin(titel);
  stapel = {
    offen: new Set(ids),
    fertig: 0,
    fehler: 0,
    gesamt: ids.length,
    ohneWebsite: 0,
    instaAktiv: 0,
    heiss: 0,
  };
  renderStapel();
}

// --- Ereignisse -------------------------------------------------------------

function handleEvent(payload) {
  if (payload.type === 'discover') return handleDiscover(payload);
  if (payload.type === 'job') return handleJob(payload.job);
  if (payload.type === 'venue') return handleVenue(payload.venue);
}

function handleDiscover(e) {
  switch (e.phase) {
    case 'overpass':
      return scanNote('OpenStreetMap wird abgefragt …');
    case 'google':
      return scanNote(`${e.gefunden} aus OpenStreetMap · Google wird ergänzt …`);
    case 'speichern':
      return scanNote(`${e.gefunden} Treffer · werden gespeichert …`);
    default:
      // 'fertig' und 'fehler' meldet der Aufrufer selbst, mit den genauen
      // Zahlen aus der Antwort.
      return undefined;
  }
}

function handleJob(job) {
  if (!stapel || !stapel.offen.has(job.id)) return;
  if (!['fertig', 'fehler', 'abgebrochen'].includes(job.status)) return;

  stapel.offen.delete(job.id);
  if (job.status === 'fertig') stapel.fertig += 1;
  else stapel.fehler += 1;

  if (stapel.offen.size) renderStapel();
  else abschluss();
}

function handleVenue(venue) {
  if (!stapel) return;
  if (venue.website_status === 'keine') stapel.ohneWebsite += 1;
  if (venue.instagram_status === 'aktiv') stapel.instaAktiv += 1;
  if (venue.score >= 70) stapel.heiss += 1;
  renderStapel();
}

function renderStapel() {
  if (!lauf || !stapel) return;
  lauf.von = stapel.gesamt - stapel.offen.size;
  lauf.bis = stapel.gesamt;
  lauf.zeile = [
    `${lauf.von} von ${stapel.gesamt} bewertet`,
    stapel.ohneWebsite ? `${stapel.ohneWebsite} ohne Website` : null,
    stapel.instaAktiv ? `${stapel.instaAktiv} mit aktivem Instagram` : null,
    stapel.heiss ? `${stapel.heiss} heiss` : null,
    stapel.fehler ? `${stapel.fehler} fehlgeschlagen` : null,
  ].filter(Boolean).join(' · ');
  render();
}

function abschluss() {
  const s = stapel;
  stapel = null;
  scanEnd(
    [
      `${s.fertig} Betriebe bewertet`,
      `${s.ohneWebsite} ohne Website`,
      `${s.instaAktiv} mit aktivem Instagram`,
      `${s.heiss} heiss (Score ab 70)`,
      s.fehler ? `${s.fehler} fehlgeschlagen` : null,
    ].filter(Boolean).join(' · '),
    { fehler: s.fertig === 0 }
  );
}

// --- Darstellung ------------------------------------------------------------

function render() {
  if (!host || !lauf) return;
  host.hidden = false;
  host.classList.toggle('ok', lauf.fertig && !lauf.fehler);
  host.classList.toggle('err', lauf.fehler);

  const anteil = lauf.bis ? Math.round((lauf.von / lauf.bis) * 100) : null;
  const unbestimmt = !lauf.fertig && anteil == null;

  clear(host).append(
    el('div', { class: `scan-bar ${unbestimmt ? 'unbestimmt' : ''}` }, [
      el('div', {
        class: 'scan-bar-fill',
        style: { width: lauf.fertig ? '100%' : `${anteil ?? 100}%` },
      }),
    ]),
    el('div', { class: 'scan-text' }, [
      el('strong', {}, (lauf.fertig ? (lauf.fehler ? '✕ ' : '✓ ') : '') + lauf.titel),
      lauf.zeile ? el('span', {}, lauf.zeile) : null,
      el('span', { class: 'scan-time' }, dauer()),
    ]),
    el('button', { class: 'scan-close', title: 'Ausblenden', onclick: verstecken }, '×')
  );
}

function dauer() {
  const s = Math.round((Date.now() - lauf.start) / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function verstecken() {
  clearInterval(ticker);
  lauf = null;
  if (host) host.hidden = true;
}
