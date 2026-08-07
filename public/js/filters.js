// Filterleiste. Wird von Karte und Liste geteilt, damit beide Ansichten
// garantiert denselben Ausschnitt deiner Daten zeigen.

import { el, clear, get, post, del, toast, fail, debounce } from './api.js';
import {
  state, filterValue, filterList, setFilter, toggleInFilter,
  replaceFilter, clearFilter, savableQuery, on,
} from './state.js';

export function renderFilters(host, { showBboxToggle = false } = {}) {
  const draw = () => build(host, { showBboxToggle });
  draw();
  on('filter', draw);
  on('venues', () => refreshCounts(host));
  refreshCounts(host);
}

function build(host, opts) {
  const { config } = state;
  clear(host);

  // --- Gespeicherte Filter ---
  const savedBlock = el('div', { class: 'block' }, [el('h3', {}, 'Gespeicherte Filter')]);
  const chips = el('div', { class: 'chips' });
  savedBlock.append(chips);
  savedBlock.append(
    el('div', { class: 'chips', style: { marginTop: '8px' } }, [
      el('button', { class: 'btn sm', onclick: () => saveCurrent(host, opts) }, '+ Aktuellen speichern'),
      el('button', { class: 'btn sm ghost', onclick: () => clearFilter() }, 'Zurücksetzen'),
    ])
  );
  host.append(savedBlock);
  loadSaved(chips, host, opts);

  // --- Freitext ---
  host.append(
    block('Suche', [
      el('input', {
        type: 'search',
        placeholder: 'Name, Ort, Notiz …',
        value: filterValue('q'),
        oninput: debounce((e) => setFilter('q', e.target.value), 300),
      }),
    ])
  );

  // --- Status ---
  const statusCounts = el('div', { class: 'checks', dataset: { role: 'status-checks' } });
  const active = filterList('status');
  for (const [key, meta] of Object.entries(config.status)) {
    statusCounts.append(
      el('label', { class: 'check', title: meta.hint }, [
        el('input', {
          type: 'checkbox',
          checked: active.includes(key),
          onchange: () => toggleInFilter('status', key),
        }),
        el('span', { class: 'dot', style: { background: meta.color } }),
        el('span', {}, meta.label),
        el('span', { class: 'count', dataset: { status: key } }, '–'),
      ])
    );
  }
  host.append(block('Pipeline-Status', [statusCounts]));

  // --- Score ---
  const min = filterValue('minScore') || '0';
  const scoreOut = el('b', {}, `${min}+`);
  host.append(
    block('Hotness', [
      el('div', { class: 'field' }, [
        el('label', {}, ['Mindest-Score: ', scoreOut]),
        el('input', {
          type: 'range', min: '0', max: '100', step: '5', value: min,
          oninput: (e) => { scoreOut.textContent = `${e.target.value}+`; },
          onchange: (e) => setFilter('minScore', e.target.value === '0' ? '' : e.target.value),
        }),
      ]),
      el('div', { class: 'checks' }, [
        radio('Alle', 'verified', '', filterValue('verified')),
        radio('Nur verifizierte', 'verified', '1', filterValue('verified')),
        radio('Nur ungeprüfte', 'verified', '0', filterValue('verified')),
      ]),
    ])
  );

  // --- Website / Instagram ---
  host.append(
    block('Website', [
      multi('websiteStatus', config.websiteStatus),
    ])
  );
  host.append(
    block('Instagram', [
      multi('instagramStatus', config.instagramStatus),
      el('label', { class: 'check' }, [
        el('input', {
          type: 'checkbox',
          checked: filterValue('hasInstagram') === '1',
          onchange: (e) => setFilter('hasInstagram', e.target.checked ? '1' : ''),
        }),
        el('span', {}, 'Nur mit Handle'),
      ]),
    ])
  );

  // --- Sonstiges ---
  const cityOptions = [el('option', { value: '' }, 'Alle Orte')];
  for (const row of config.staedte) {
    cityOptions.push(
      el('option', { value: row.city, selected: filterValue('city') === row.city },
        `${row.city} (${row.n})`)
    );
  }

  host.append(
    block('Weiteres', [
      el('div', { class: 'field' }, [
        el('label', {}, 'Ort'),
        el('select', { onchange: (e) => setFilter('city', e.target.value) }, cityOptions),
      ]),
      el('div', { class: 'checks' }, [
        toggle('Nur mit Demo', 'hasDemo', '1'),
        toggle('Nur ohne Website-Link', 'hasWebsite', '0'),
        toggle('Geschlossene mitzeigen', 'includeClosed', '1'),
        opts.showBboxToggle && toggle('Nur im Kartenausschnitt', 'nurAusschnitt', '1'),
      ])
    ])
  );

  // --- Legende ---
  host.append(
    block('Legende', [
      el('div', { class: 'hint' }, 'Farbe = Status, Ring = Hotness.'),
      ...config.scoreBands.map((band) =>
        el('div', { class: 'legend-row' }, [
          el('span', {
            class: 'legend-ring',
            style: { border: `${band.width}px solid ${band.color}` },
          }),
          `${band.label} (${band.min}+)`,
        ])
      ),
      el('div', { class: 'legend-row' }, [
        el('span', {
          class: 'legend-ring',
          style: { border: '3px dashed #94a3b8' },
        }),
        'Gestrichelt = ungeprüft',
      ]),
      el('div', { class: 'hint', style: { marginTop: '6px' } },
        'Ungeprüft heisst: die Daten kommen roh aus OpenStreetMap. Ein fehlender Website-Eintrag beweist dort nicht, dass es keine Website gibt.'),
    ])
  );
}

function block(title, children) {
  return el('div', { class: 'block' }, [el('h3', {}, title), ...children]);
}

function multi(key, options) {
  const active = filterList(key);
  return el('div', { class: 'checks' },
    Object.entries(options).map(([value, meta]) =>
      el('label', { class: 'check' }, [
        el('input', {
          type: 'checkbox',
          checked: active.includes(value),
          onchange: () => toggleInFilter(key, value),
        }),
        el('span', {}, meta.label),
        meta.points ? el('span', { class: 'count' }, `${meta.points > 0 ? '+' : ''}${meta.points}`) : null,
      ])
    )
  );
}

function toggle(label, key, onValue) {
  return el('label', { class: 'check' }, [
    el('input', {
      type: 'checkbox',
      checked: filterValue(key) === onValue,
      onchange: (e) => setFilter(key, e.target.checked ? onValue : ''),
    }),
    el('span', {}, label),
  ]);
}

function radio(label, key, value, current) {
  return el('label', { class: 'check' }, [
    el('input', {
      type: 'radio', name: `f-${key}`, checked: current === value,
      onchange: () => setFilter(key, value),
    }),
    el('span', {}, label),
  ]);
}

async function loadSaved(host, sidebar, opts) {
  try {
    const filters = await get('/filters');
    clear(host);
    const currentQuery = savableQuery();
    for (const f of filters) {
      const isActive = normalise(f.query) === normalise(currentQuery);
      host.append(
        el('span', { class: `chip ${isActive ? 'on' : ''}` }, [
          el('span', { onclick: () => replaceFilter(f.query), style: { cursor: 'pointer' } }, f.name),
          !f.builtin
            ? el('span', {
                class: 'x',
                title: 'Filter löschen',
                onclick: async (e) => {
                  e.stopPropagation();
                  await del(`/filters/${f.id}`).catch(fail);
                  loadSaved(host, sidebar, opts);
                },
              }, '×')
            : null,
        ])
      );
    }
  } catch (err) {
    fail(err);
  }
}

const normalise = (query) => [...new URLSearchParams(query).entries()].sort().join('&');

async function saveCurrent(sidebar, opts) {
  const query = savableQuery();
  if (!query) return toast('Erst einen Filter setzen', 'err');
  const name = prompt('Name für diesen Filter:');
  if (!name) return;
  try {
    await post('/filters', { name, query });
    toast('Filter gespeichert');
    build(sidebar, opts);
  } catch (err) {
    fail(err);
  }
}

/** Zahlen neben den Status-Kaestchen - zeigt, wie viel jeder Status hergibt. */
async function refreshCounts(host) {
  const target = host.querySelector('[data-role="status-checks"]');
  if (!target) return;
  try {
    const query = new URLSearchParams(state.filter);
    query.delete('status');
    const data = await get(`/venues/stats?${query}`);
    for (const node of target.querySelectorAll('.count')) {
      node.textContent = data.byStatus[node.dataset.status] ?? 0;
    }
  } catch {
    /* Zahlen sind Komfort, kein Grund fuer eine Fehlermeldung. */
  }
}
