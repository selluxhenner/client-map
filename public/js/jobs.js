// Auftrags-Schublade: was läuft gerade, was ist gelaufen, und was sagt der
// Agent dabei. Der Live-Log kommt über einen Server-Sent-Events-Strom, damit
// man beim Demo-Bau zusehen kann, statt zu warten und zu hoffen.

import { el, clear, get, post, toast, fail } from './api.js';

const KIND_ICON = { test: '🔌', schnell: '⚡', analyse: '🔍', kontakt: '✍️', demo: '🔨' };

const STATUS_STYLE = {
  wartend:     { label: 'Wartet',       color: '#94a3b8' },
  laeuft:      { label: 'Läuft',        color: '#3b82f6' },
  fertig:      { label: 'Fertig',       color: '#22c55e' },
  fehler:      { label: 'Fehler',       color: '#ef4444' },
  abgebrochen: { label: 'Abgebrochen',  color: '#475569' },
};

const store = {
  jobs: [],
  kinds: {},
  queue: { running: [], concurrency: 2, heute: {} },
  selected: null,
  logs: new Map(),
};

let nodes = {};
let source;
const kindListeners = [];
const venueListeners = [];
const rawListeners = [];

export function onKinds(fn) {
  kindListeners.push(fn);
  if (Object.keys(store.kinds).length) fn(store.kinds);
}

/**
 * Meldet Betriebe, die ein Auftrag gerade veraendert hat. Karte und
 * Detail-Panel haengen sich daran, damit der Pin nach einer Analyse von
 * selbst umspringt - ohne dass man neu laden muss.
 */
export function onVenueUpdate(fn) {
  venueListeners.push(fn);
}

/**
 * Alles, was der Server ueber den Ereignisstrom schickt - roh. Die
 * Fortschrittsanzeige haengt sich daran, weil sie sowohl Aufträge als auch
 * Bereichssuchen mitverfolgt.
 */
export function onServerEvent(fn) {
  rawListeners.push(fn);
}

export async function initJobs() {
  build();
  await reload();
  connect();
}

export function toggleDrawer(force) {
  const open = force ?? !nodes.drawer.classList.contains('open');
  nodes.drawer.classList.toggle('open', open);
  if (open && !store.selected && store.jobs.length) selectJob(store.jobs[0].id);
}

export async function startJob(kind, venueId = null) {
  try {
    const job = await post('/jobs', { kind, venue_id: venueId });
    toast(`${store.kinds[kind]?.label || kind} eingereiht`);
    await reload();
    toggleDrawer(true);
    selectJob(job.id);
    return job;
  } catch (err) {
    fail(err);
    return null;
  }
}

/**
 * Stapellauf ueber einen Filter. Fragt erst trocken nach, wie viel das
 * betrifft, und laesst dich dann entscheiden - ein Tiefen-Scan ist der
 * einzige Knopf in der App, der auf einen Schlag Stunden Kontingent kosten
 * kann.
 */
export async function startBatch(kind, filter) {
  try {
    const vorschau = await post('/jobs/batch', { kind, filter, dryRun: true });

    if (!vorschau.kandidaten) {
      toast('Hier ist nichts zu analysieren — alles schon geprüft.');
      return null;
    }
    if (!vorschau.eingereiht) {
      toast(
        vorschau.laeuftSchon === vorschau.kandidaten
          ? 'Für diese Betriebe läuft die Analyse bereits.'
          : `Tageslimit erreicht (${vorschau.heute}/${vorschau.dailyLimit}).`,
        'err'
      );
      return null;
    }

    const zeilen = [
      `${vorschau.kandidaten} Betriebe im aktuellen Ausschnitt (ungeprüfte, wenn du nichts anderes gefiltert hast).`,
      `${vorschau.eingereiht} davon werden jetzt geprüft — ${vorschau.label}, Modell ${store.kinds[kind]?.model || '?'}.`,
      dauerSchaetzung(kind, vorschau.eingereiht),
      vorschau.uebrig ? `${vorschau.uebrig} bleiben für später übrig.` : null,
      vorschau.laeuftSchon ? `${vorschau.laeuftSchon} laufen bereits.` : null,
      `Heute bisher: ${vorschau.heute}/${vorschau.dailyLimit}.`,
      '',
      'Starten?',
    ].filter(Boolean);

    if (!confirm(zeilen.join('\n'))) return null;

    const bericht = await post('/jobs/batch', { kind, filter });
    toast(`${bericht.eingereiht} Analysen eingereiht`);
    await reload();
    toggleDrawer(true);
    return bericht;
  } catch (err) {
    fail(err);
    return null;
  }
}

/** Grobe Laufzeit eines Stapels: Erfahrungswert je Auftrag durch Parallelität. */
function dauerSchaetzung(kind, anzahl) {
  const proStueck = store.kinds[kind]?.typischS;
  if (!proStueck || !anzahl) return null;
  const gleichzeitig = Math.max(1, store.queue?.concurrency || 1);
  const minuten = Math.ceil((anzahl * proStueck) / gleichzeitig / 60);
  return `Dauert ungefähr ${minuten} Minute${minuten === 1 ? '' : 'n'} ` +
    `(~${proStueck} s pro Betrieb, ${gleichzeitig} gleichzeitig).`;
}

// --- Aufbau ---------------------------------------------------------------

function build() {
  nodes.drawer = el('aside', { class: 'jobs-drawer', id: 'jobs-drawer' });
  nodes.head = el('div', { class: 'jobs-head' });
  nodes.list = el('div', { class: 'jobs-list' });
  nodes.log = el('div', { class: 'jobs-log' });

  nodes.drawer.append(
    nodes.head,
    el('div', { class: 'jobs-body' }, [nodes.list, nodes.log])
  );
  document.body.append(nodes.drawer);

  nodes.toggle = document.getElementById('jobs-toggle');
  nodes.toggle?.addEventListener('click', () => toggleDrawer());
}

async function reload() {
  const data = await get('/jobs');
  store.jobs = data.jobs;
  store.kinds = data.kinds;
  store.queue = data.queue;
  store.claudeBin = data.claudeBin;
  store.abrechnung = data.abrechnung;
  kindListeners.forEach((fn) => fn(store.kinds));
  render();
}

function connect() {
  source?.close();
  source = new EventSource('/api/jobs/stream');

  source.onmessage = (e) => {
    const payload = JSON.parse(e.data);
    rawListeners.forEach((fn) => fn(payload));

    if (payload.type === 'queue') {
      store.queue = payload.state;
      renderHead();
      return;
    }
    if (payload.type === 'job') {
      const index = store.jobs.findIndex((j) => j.id === payload.job.id);
      if (index >= 0) store.jobs[index] = payload.job;
      else store.jobs.unshift(payload.job);
      renderHead();
      renderList();
      if (store.selected === payload.job.id) renderLog();
      return;
    }
    if (payload.type === 'venue') {
      venueListeners.forEach((fn) => fn(payload.venue));
      return;
    }
    if (payload.type === 'log') {
      const bucket = store.logs.get(payload.jobId) || [];
      bucket.push(payload.event);
      store.logs.set(payload.jobId, bucket);
      if (store.selected === payload.jobId) appendLogLine(payload.event);
      if (payload.event.t === 'rate') renderHead();
    }
  };

  source.onerror = () => {
    // EventSource verbindet selbst neu; nur melden, wenn es dauerhaft klemmt.
    setTimeout(() => {
      if (source.readyState === EventSource.CLOSED) connect();
    }, 4000);
  };
}

function render() {
  renderHead();
  renderList();
  renderLog();
}

function renderHead() {
  const q = store.queue;
  const running = q.running?.length || 0;

  clear(nodes.head).append(
    el('strong', {}, 'Aufträge'),
    el('span', { class: 'jobs-meta' },
      `${running}/${q.concurrency} laufen · heute ${Object.entries(q.heute || {})
        .map(([k, n]) => `${store.kinds[k]?.label || k}: ${n}`)
        .join(' · ') || 'nichts'}`),
    abrechnungsHinweis(),
    el('span', { class: 'spacer' }),
    ...availableKindButtons(),
    wartende()
      ? el('button', {
          class: 'btn sm danger',
          title: 'Bricht alles ab, was noch nicht angefangen hat. Laufende bleiben.',
          onclick: async () => {
            const res = await post('/jobs/cancel-waiting').catch(fail);
            if (res) { toast(`${res.abgebrochen} aus der Warteschlange entfernt`); reload(); }
          },
        }, `Warteschlange leeren (${wartende()})`)
      : null,
    el('button', { class: 'btn sm ghost', onclick: () => toggleDrawer(false) }, '✕')
  );

  if (q.paused) {
    nodes.head.after(
      el('div', { class: 'notice warn jobs-paused' }, [
        `Warteschlange pausiert — ${q.pauseReason || 'Kontingent'}. `,
        q.pausedUntil ? `Weiter ab ${new Date(q.pausedUntil).toLocaleTimeString('de-CH')}. ` : '',
        el('button', {
          class: 'btn sm',
          onclick: async () => { await post('/jobs/resume'); toast('Fortgesetzt'); },
        }, 'Trotzdem fortsetzen'),
      ])
    );
  } else {
    nodes.drawer.querySelector('.jobs-paused')?.remove();
  }

  if (nodes.toggle) {
    nodes.toggle.textContent = running ? `⚙ ${running}` : '⚙';
    nodes.toggle.classList.toggle('primary', running > 0);
  }
}

/**
 * Läuft das über das Abo oder über eine Rechnung? Steht im Kopf, weil die
 * Antwort darüber entscheidet, ob ein Stapellauf harmlos ist.
 */
function abrechnungsHinweis() {
  const a = store.abrechnung;
  if (!a) return null;

  if (a.ueberAbo) {
    return el('span', {
      class: 'badge',
      style: { background: 'var(--accent-soft)', color: 'var(--accent)' },
      title: `Angemeldet über ${a.weg}. Aufträge laufen gegen dein Kontingent, nicht gegen eine Rechnung. Die Dollarwerte sind ein Verbrauchsmass.`,
    }, `${a.abo === 'max' ? 'Max' : a.abo || 'Abo'}-Abo`);
  }

  return el('span', {
    class: 'badge',
    style: { background: 'var(--warn-soft)', color: 'var(--warn)' },
    title: a.angemeldet
      ? 'Nicht über ein Abo angemeldet — jeder Auftrag erzeugt echte API-Kosten.'
      : 'Die Claude-CLI ist nicht angemeldet. Aufträge werden fehlschlagen: einmal "claude auth login" ausführen.',
  }, a.angemeldet ? 'API-Abrechnung' : 'nicht angemeldet');
}

function wartende() {
  return store.jobs.filter((j) => j.status === 'wartend').length;
}

function availableKindButtons() {
  return Object.entries(store.kinds)
    .filter(([, k]) => k.available && !k.needsVenue)
    .map(([key, k]) =>
      el('button', {
        class: 'btn sm',
        title: `Modell: ${k.model} · Tageslimit ${k.dailyLimit}`,
        onclick: () => startJob(key),
      }, `${KIND_ICON[key] || '▶'} ${k.label}`)
    );
}

function renderList() {
  clear(nodes.list);
  if (!store.jobs.length) {
    nodes.list.append(el('div', { class: 'hint', style: { padding: '10px' } }, 'Noch nichts gelaufen.'));
    return;
  }

  for (const job of store.jobs) {
    const style = STATUS_STYLE[job.status] || STATUS_STYLE.wartend;
    nodes.list.append(
      el('button', {
        class: `job-row ${store.selected === job.id ? 'on' : ''}`,
        onclick: () => selectJob(job.id),
      }, [
        el('span', { class: 'job-icon' }, KIND_ICON[job.kind] || '▶'),
        el('span', { class: 'job-main' }, [
          el('span', { class: 'job-title' },
            job.venue_name || store.kinds[job.kind]?.label || job.kind),
          el('span', { class: 'job-sub' },
            [`#${job.id}`, job.model, formatDuration(job)].filter(Boolean).join(' · ')),
        ]),
        el('span', {
          class: 'badge',
          style: { background: `${style.color}22`, color: style.color },
        }, style.label),
      ])
    );
  }
}

function selectJob(id) {
  store.selected = id;
  renderList();
  renderLog();
}

async function renderLog() {
  clear(nodes.log);
  const job = store.jobs.find((j) => j.id === store.selected);
  if (!job) {
    nodes.log.append(el('div', { class: 'hint', style: { padding: '14px' } },
      'Einen Auftrag links auswählen.'));
    return;
  }

  nodes.log.append(
    el('div', { class: 'log-head' }, [
      el('div', {}, [
        el('strong', {}, `#${job.id} · ${store.kinds[job.kind]?.label || job.kind}`),
        job.venue_name ? el('span', { class: 'jobs-meta' }, ` · ${job.venue_name}`) : null,
      ]),
      el('span', { class: 'spacer' }),
      job.cost_usd != null
        ? el('span', { class: 'jobs-meta', title: 'Verbrauch als Geldwert. Im Max-Abo keine Rechnung.' },
            `${job.cost_usd.toFixed(3)} $ · ${job.num_turns ?? '?'} Schritte`)
        : null,
      ['wartend', 'laeuft'].includes(job.status)
        ? el('button', {
            class: 'btn sm danger',
            onclick: async () => { await post(`/jobs/${job.id}/cancel`); toast('Abgebrochen'); },
          }, 'Abbrechen')
        : null,
    ])
  );

  nodes.stream = el('div', { class: 'log-stream' });
  nodes.log.append(nodes.stream);

  if (job.error) {
    nodes.stream.append(el('div', { class: 'log-line err' }, job.error));
  }

  // Live gesammelte Zeilen, sonst aus der Logdatei nachladen.
  let events = store.logs.get(job.id);
  if (!events) {
    try {
      events = (await get(`/jobs/${job.id}/log`)).events;
      store.logs.set(job.id, events);
    } catch {
      events = [];
    }
  }
  events.forEach(appendLogLine);
}

function appendLogLine(event) {
  if (!nodes.stream) return;
  const line = renderEvent(event);
  if (!line) return;
  nodes.stream.append(line);
  nodes.stream.scrollTop = nodes.stream.scrollHeight;
}

function renderEvent(e) {
  switch (e.t) {
    case 'init':
      return el('div', { class: 'log-line meta' },
        `Gestartet · ${e.model || '?'}${e.skillCount ? ` · ${e.skillCount} Skills` : ''}` +
        (e.hasRestaurantSkill === false ? ' · ⚠ restaurant-website-build NICHT gefunden' : ''));
    case 'text':
      return el('div', { class: 'log-line' }, e.text);
    case 'tool':
      return el('div', { class: 'log-line tool' }, `⚒ ${e.name}${e.input ? ` ${e.input}` : ''}`);
    case 'rate':
      return el('div', { class: 'log-line warn' },
        `Kontingent: ${e.info?.status} (${e.info?.rateLimitType || '–'})`);
    case 'warn':
      return el('div', { class: 'log-line warn' }, `⚠ ${e.text}`);
    case 'stderr':
      return el('div', { class: 'log-line err' }, e.text);
    case 'result':
      return el('div', { class: `log-line ${e.ok ? 'ok' : 'err'}` },
        `${e.ok ? '✓ Fertig' : '✗ Fehlgeschlagen'}${e.result ? ` — ${e.result}` : ''}`);
    default:
      return null;
  }
}

function formatDuration(job) {
  if (!job.started_at) return null;
  const start = new Date(job.started_at.replace(' ', 'T') + 'Z');
  const end = job.finished_at ? new Date(job.finished_at.replace(' ', 'T') + 'Z') : new Date();
  const secs = Math.max(0, Math.round((end - start) / 1000));
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}
