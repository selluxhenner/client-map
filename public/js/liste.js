import { el, clear, get, fail, debounce, formatDate } from './api.js';
import {
  state, loadConfig, loadVenues, on, setFilter, filterValue, select, scoreBandFor,
} from './state.js';
import { renderFilters } from './filters.js';
import { initDetail, showVenue } from './detail.js';
import { initJobs, onVenueUpdate } from './jobs.js';

const COLUMNS = [
  { key: 'score',            label: 'Score',     sort: 'score_desc', cell: scoreCell, cls: 'num' },
  { key: 'name',             label: 'Betrieb',   sort: 'name',       cell: nameCell,  cls: 'name' },
  { key: 'status',           label: 'Status',    sort: null,         cell: statusCell },
  { key: 'city',             label: 'Ort',       sort: 'city',       cell: (v) => v.city || '–' },
  { key: 'venue_type',       label: 'Typ',       sort: null,         cell: (v) => v.venue_type || '–' },
  { key: 'website_status',   label: 'Website',   sort: null,         cell: websiteCell },
  { key: 'instagram',        label: 'Instagram', sort: null,         cell: instaCell },
  { key: 'phone',            label: 'Telefon',   sort: null,         cell: (v) => v.phone || '–' },
  { key: 'rating',           label: 'Bew.',      sort: null,         cell: ratingCell, cls: 'num' },
  { key: 'demo_path',        label: 'Demo',      sort: null,         cell: (v) => (v.demo_path ? '✓' : '–') },
  { key: 'last_contact_at',  label: 'Kontakt',   sort: 'contact',    cell: (v) => formatDate(v.last_contact_at) },
  { key: 'follow_up_at',     label: 'Wiedervorlage', sort: 'wiedervorlage', cell: followUpCell },
];

start().catch(fail);

async function start() {
  await loadConfig();

  initDetail(document.getElementById('detail'), { onVenueChange: onVenueChanged });
  renderFilters(document.getElementById('filters'));
  initJobs().catch(fail);

  const quick = document.getElementById('quick');
  quick.value = filterValue('q');
  quick.addEventListener('input', debounce((e) => setFilter('q', e.target.value), 300));

  document.getElementById('export').addEventListener('click', () => {
    const query = new URLSearchParams(state.filter);
    query.delete('bbox');
    location.href = `/api/venues/export.csv?${query}`;
  });

  document.getElementById('menu')?.addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('open');
  });

  on('filter', () => refresh());
  on('venues', () => { drawTable(); drawStats(); drawFunnel(); });
  on('selection', highlight);

  // Waehrend eines Tiefen-Scans aendern sich laufend Zeilen. Gesammelt neu
  // laden statt bei jedem einzelnen Betrieb - sonst springt die Tabelle
  // unter der Maus weg.
  onVenueUpdate(debounce(() => refresh(), 1500));

  await refresh();
}

async function refresh() {
  try {
    await loadVenues({ bbox: '' });
  } catch (err) {
    fail(err);
  }
}

function drawTable() {
  const host = document.getElementById('table-wrap');
  clear(host);

  if (!state.venues.length) {
    host.append(
      el('div', { class: 'empty' },
        'Keine Treffer. Filter lockern — oder auf der Karte einen Bereich durchsuchen.')
    );
    return;
  }

  const currentSort = filterValue('sort') || 'score_desc';

  const head = el('tr', {}, COLUMNS.map((col) =>
    el('th', {
      title: col.sort ? 'Nach dieser Spalte sortieren' : '',
      onclick: col.sort ? () => setFilter('sort', nextSort(col.sort, currentSort)) : null,
    }, col.label + sortMark(col.sort, currentSort))
  ));

  const body = el('tbody', {}, state.venues.map((v) =>
    el('tr', {
      dataset: { id: v.id },
      class: state.selectedId === v.id ? 'selected' : '',
      onclick: () => { select(v.id); showVenue(v); },
    }, COLUMNS.map((col) => el('td', { class: col.cls || '' }, [col.cell(v)])))
  ));

  host.append(el('table', { class: 'data' }, [el('thead', {}, [head]), body]));
}

function nextSort(base, current) {
  if (base === 'score_desc') return current === 'score_desc' ? 'score_asc' : 'score_desc';
  return base;
}

function sortMark(base, current) {
  if (!base) return '';
  if (current === base) return ' ↓';
  if (base === 'score_desc' && current === 'score_asc') return ' ↑';
  return '';
}

// --- Zellen ---------------------------------------------------------------

function scoreCell(v) {
  const band = scoreBandFor(v.score);
  return el('span', {
    class: 'score-pill',
    style: { background: band.color, opacity: v.verified ? 1 : 0.55 },
    title: v.verified ? band.label : `${band.label} · ungeprüft`,
  }, String(v.score));
}

function nameCell(v) {
  return el('span', {}, [
    v.name,
    v.score >= 70 ? ' 🔥' : '',
    el('a', {
      class: 'btn sm ghost',
      href: `/?fokus=${v.id}`,
      title: 'Auf der Karte zeigen',
      onclick: (e) => e.stopPropagation(),
    }, '↗'),
  ]);
}

function statusCell(v) {
  const meta = state.config.status[v.status] || state.config.status.neu;
  return el('span', { class: 'badge', style: { background: `${meta.color}22`, color: meta.color } }, [
    el('span', { class: 'dot', style: { background: meta.color } }),
    meta.label,
  ]);
}

function websiteCell(v) {
  const meta = state.config.websiteStatus[v.website_status];
  const label = meta ? meta.label : v.website_status;
  if (!v.website) return el('span', { style: { color: '#94a3b8' } }, label);
  return el('a', {
    href: v.website, target: '_blank', rel: 'noopener noreferrer',
    onclick: (e) => e.stopPropagation(), title: v.website,
  }, label);
}

function instaCell(v) {
  if (!v.instagram) return '–';
  return el('a', {
    href: `https://instagram.com/${v.instagram}`, target: '_blank', rel: 'noopener noreferrer',
    onclick: (e) => e.stopPropagation(),
  }, `@${v.instagram}`);
}

function ratingCell(v) {
  return v.rating ? `${v.rating} (${v.review_count ?? '?'})` : '–';
}

function followUpCell(v) {
  if (!v.follow_up_at) return '–';
  const datum = v.follow_up_at.slice(0, 10);
  const faellig = datum <= new Date().toISOString().slice(0, 10);
  return el('span', {
    class: faellig ? 'faellig-marke' : '',
    title: v.follow_up_note || '',
  }, formatDate(v.follow_up_at) + (v.follow_up_note ? ' •' : ''));
}

/**
 * Der Trichter zählt kumulativ: "so viele haben diese Stufe mindestens
 * erreicht". Daneben steht, wie viel von der Stufe davor übrig blieb - das
 * ist die Zahl, die zeigt, wo es klemmt.
 */
async function drawFunnel() {
  const host = document.getElementById('funnel');
  if (!host) return;
  try {
    const query = new URLSearchParams(state.lastQuery || state.filter);
    query.delete('status');
    const data = await get(`/venues/stats?${query}`);
    const stufen = data.funnel || [];
    const start = stufen[0]?.erreicht || 0;

    clear(host).append(
      ...stufen.map((s, i) => {
        const meta = state.config.status[s.status];
        const vorher = i ? stufen[i - 1].erreicht : null;
        const quote = vorher ? Math.round((s.erreicht / vorher) * 100) : null;
        return el('button', {
          class: 'funnel-stufe',
          title: `${meta.label}: ${s.erreicht} erreicht, ${s.aktuell} stehen aktuell hier` +
            (quote != null ? ` · ${quote} % von „${state.config.status[stufen[i - 1].status].label}"` : ''),
          onclick: () => setFilter('status', s.status),
        }, [
          el('b', {}, String(s.erreicht)),
          el('span', {}, meta.label),
          el('span', {
            class: 'funnel-balken',
            style: {
              width: `${start ? Math.max(4, Math.round((s.erreicht / start) * 100)) : 4}%`,
              background: meta.color,
            },
          }),
          quote != null ? el('span', { class: 'funnel-quote' }, `${quote} %`) : null,
        ]);
      }),
      data.wiedervorlage_faellig
        ? el('button', {
            class: 'funnel-stufe faellig',
            title: 'Betriebe mit einer Wiedervorlage, die heute oder früher fällig war',
            onclick: () => setFilter('wiedervorlage', 'faellig'),
          }, [
            el('b', {}, String(data.wiedervorlage_faellig)),
            el('span', {}, '⏰ fällig'),
          ])
        : null,

      // Wer den Trichter verlassen hat. Ohne diese Zahl geht die Rechnung
      // nicht auf und man sucht die fehlenden Betriebe.
      data.abgangGesamt
        ? el('button', {
            class: 'funnel-stufe abgang',
            title: 'Aus dem Trichter ausgeschieden: ' +
              data.abgang.map((a) => `${state.config.status[a.status]?.label || a.status} ${a.n}`).join(', '),
            onclick: () => setFilter('status', data.abgang.map((a) => a.status).join(',')),
          }, [
            el('b', {}, String(data.abgangGesamt)),
            el('span', {}, 'ausgeschieden'),
          ])
        : null
    );
  } catch {
    /* Der Trichter ist Übersicht, kein Grund für eine Fehlermeldung. */
  }
}

function highlight(id) {
  for (const row of document.querySelectorAll('tr[data-id]')) {
    row.classList.toggle('selected', Number(row.dataset.id) === id);
  }
}

function onVenueChanged() {
  refresh();
}

function drawStats() {
  const host = document.getElementById('stats');
  const hot = state.venues.filter((v) => v.score >= 70).length;
  clear(host).append(
    el('div', { class: 'stat' }, [el('b', {}, String(state.total)), el('span', {}, 'Betriebe')]),
    el('div', { class: 'stat hot' }, [el('b', {}, String(hot)), el('span', {}, 'heiss')]),
  );
}
