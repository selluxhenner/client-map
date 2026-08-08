// Detail-Panel eines Betriebs. Alles hier speichert sofort - kein
// Speichern-Knopf, den man vergessen kann.

import { el, clear, patch, del, toast, fail, debounce, formatDate } from './api.js';
import { state, upsertLocal, scoreBandFor, select } from './state.js';
import { startJob, onKinds } from './jobs.js';

let host;
let onChange = () => {};
let current = null;
let kinds = {};

// Sobald die Job-Engine meldet, welche Auftragsarten scharf sind, werden die
// Knoepfe hier von selbst aktiv. Phase 5 und 6 muessen dafuer nur ein Flag
// in server/jobs/kinds.js umlegen.
onKinds((next) => {
  kinds = next;
  if (current) render();
});

export function initDetail(node, { onVenueChange } = {}) {
  host = node;
  onChange = onVenueChange || (() => {});
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && host.classList.contains('open')) close();
  });
}

export function close() {
  host.classList.remove('open');
  current = null;
  select(null);
}

export function showVenue(venue) {
  current = venue;
  host.classList.add('open');
  render();
}

async function save(fields) {
  try {
    const updated = await patch(`/venues/${current.id}`, fields);
    current = updated;
    upsertLocal(updated);
    onChange(updated);
    render();
  } catch (err) {
    fail(err);
  }
}

const saveSoon = debounce(save, 600);

function render() {
  const v = current;
  const { config } = state;
  const band = scoreBandFor(v.score);
  const statusMeta = config.status[v.status] || config.status.neu;

  const inner = el('div', { class: 'detail-inner' });

  // --- Kopf ---
  inner.append(
    el('div', { class: 'detail-head' }, [
      el('div', { style: { flex: '1' } }, [
        el('h2', {}, v.name),
        el('div', { class: 'sub' }, [
          [v.venue_type, v.cuisine].filter(Boolean).join(' · ') || 'Gastro',
          v.city ? ` · ${v.city}` : '',
        ].join('')),
      ]),
      el('button', { class: 'btn ghost', title: 'Schliessen (Esc)', onclick: close }, '×'),
    ])
  );

  // --- Score ---
  inner.append(
    el('div', { class: 'score-box' }, [
      el('div', {}, [
        el('div', { class: 'score-num', style: { color: band.color } }, String(v.score)),
        el('div', { class: 'score-band', style: { color: band.color } }, band.label),
      ]),
      el('ul', { class: 'breakdown', style: { flex: '1' } },
        (v.score_breakdown || []).map((b) =>
          el('li', {}, [
            el('span', {}, [b.label, b.provisional ? el('span', { class: 'prov' }, ' · vorläufig') : null]),
            el('span', {
              class: `pts ${b.points > 0 ? 'plus' : b.points < 0 ? 'minus' : ''}`,
            }, b.points > 0 ? `+${b.points}` : String(b.points)),
          ])
        )
      ),
    ])
  );

  if (!v.verified) {
    inner.append(
      el('div', { class: 'notice warn' },
        'Ungeprüft. Die Angaben stammen roh aus OpenStreetMap — ein fehlender Website-Eintrag ist dort kein Beweis, dass es keine Website gibt. Ab Phase 5 klärt das die Claude-Analyse automatisch.')
    );
  }

  // --- Status ---
  const statusSelect = el('select', {
    class: 'status-select',
    style: { '--c': statusMeta.color },
    onchange: (e) => save({ status: e.target.value }),
  },
    Object.entries(config.status).map(([key, meta]) =>
      el('option', { value: key, selected: v.status === key }, meta.label)
    )
  );

  inner.append(
    el('div', { class: 'block' }, [
      el('h3', {}, 'Pipeline'),
      el('div', { class: 'field' }, [el('label', {}, 'Status'), statusSelect]),
      el('div', { class: 'field' }, [
        el('label', {}, 'Letzter Kontakt'),
        el('input', {
          type: 'date',
          value: (v.last_contact_at || '').slice(0, 10),
          onchange: (e) => save({ last_contact_at: e.target.value || null }),
        }),
      ]),
      el('div', { class: 'field' }, [
        el('label', {}, 'Notizen'),
        el('textarea', {
          placeholder: 'Was ist passiert? Wen erreicht? Was vereinbart?',
          oninput: (e) => saveSoon({ notes: e.target.value }),
        }, v.notes || ''),
      ]),
    ])
  );

  // --- Bewertung durch dich ---
  inner.append(
    el('div', { class: 'block' }, [
      el('h3', {}, 'Einschätzung'),
      selectField('Website-Zustand', 'website_status', config.websiteStatus, v),
      selectField('Instagram', 'instagram_status', config.instagramStatus, v),
      el('label', { class: 'check' }, [
        el('input', {
          type: 'checkbox', checked: v.verified,
          onchange: (e) => save({ verified: e.target.checked }),
        }),
        el('span', {}, 'Von mir geprüft'),
      ]),
      el('label', { class: 'check' }, [
        el('input', {
          type: 'checkbox', checked: v.is_chain,
          onchange: (e) => save({ is_chain: e.target.checked }),
        }),
        el('span', {}, 'Kette / Franchise'),
      ]),
      el('label', { class: 'check' }, [
        el('input', {
          type: 'checkbox', checked: v.permanently_closed,
          onchange: (e) => save({ permanently_closed: e.target.checked }),
        }),
        el('span', {}, 'Dauerhaft geschlossen'),
      ]),
    ])
  );

  // --- Kontaktdaten ---
  inner.append(
    el('div', { class: 'block' }, [
      el('h3', {}, 'Kontakt'),
      textField('Telefon', 'phone', v),
      textField('E-Mail', 'email', v),
      textField('Website', 'website', v, 'https://…'),
      textField('Instagram-Handle', 'instagram', v, 'ohne @'),
      textField('Adresse', 'street', v),
      textField('Ort', 'city', v),
    ])
  );

  // --- Fakten ---
  inner.append(
    el('div', { class: 'block' }, [
      el('h3', {}, 'Fakten'),
      el('dl', { class: 'kv' }, [
        el('dt', {}, 'Öffnung'), el('dd', {}, v.opening_hours || '–'),
        el('dt', {}, 'Bewertung'),
        el('dd', {}, v.rating ? `${v.rating} ★ (${v.review_count ?? '?'})` : '–'),
        el('dt', {}, 'Quelle'), el('dd', {}, v.source === 'osm' ? 'OpenStreetMap' : v.source),
        el('dt', {}, 'Analyse'), el('dd', {}, formatDate(v.last_analysis_at)),
        el('dt', {}, 'Demo'), el('dd', {}, v.demo_path || '–'),
      ]),
    ])
  );

  // --- Schnellzugriffe ---
  const q = encodeURIComponent(`${v.name} ${v.city || ''}`.trim());
  inner.append(
    el('div', { class: 'block' }, [
      el('h3', {}, 'Nachschauen'),
      el('div', { class: 'links' }, [
        link('Google', `https://www.google.com/search?q=${q}`),
        link('Maps', `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}`),
        v.instagram
          ? link('Instagram', `https://instagram.com/${v.instagram}`)
          : link('IG suchen', `https://www.google.com/search?q=${q}+instagram`),
        v.website ? link('Website', v.website) : null,
      ]),
    ])
  );

  // --- Aktionen: starten echte Agenten-Läufe ---
  const actions = [
    { kind: 'analyse', icon: '🔍', fallback: 'Analyse durch Claude' },
    { kind: 'demo', icon: '🔨', fallback: 'Demo bauen' },
  ];
  const pending = actions.filter(({ kind }) => kinds[kind] && !kinds[kind].available);

  inner.append(
    el('div', { class: 'block' }, [
      el('h3', {}, 'Aktionen'),
      el('div', { class: 'links' }, actions.map(({ kind, icon, fallback }) => {
        const meta = kinds[kind];
        const ready = Boolean(meta?.available);
        return el('button', {
          class: `btn ${ready ? 'primary' : ''}`,
          disabled: !ready,
          title: ready
            ? `Modell: ${meta.model} · Tageslimit ${meta.dailyLimit}`
            : `Kommt in Phase ${meta?.plannedIn ?? '?'}`,
          onclick: ready ? () => startJob(kind, v.id) : null,
        }, `${icon} ${meta?.label || fallback}`);
      })),
      pending.length
        ? el('div', { class: 'hint', style: { marginTop: '6px' } },
            `Noch nicht scharf: ${pending.map((a) => `${kinds[a.kind].label} (Phase ${kinds[a.kind].plannedIn})`).join(', ')}. Bis dahin setzt du den Status von Hand.`)
        : null,
    ])
  );

  inner.append(
    el('div', { class: 'block' }, [
      el('button', {
        class: 'btn danger',
        onclick: async () => {
          if (!confirm(`"${v.name}" wirklich löschen?`)) return;
          await del(`/venues/${v.id}`).catch(fail);
          toast('Gelöscht');
          onChange(null);
          close();
        },
      }, 'Betrieb löschen'),
    ])
  );

  clear(host).append(inner);
}

function textField(label, key, v, placeholder = '') {
  return el('div', { class: 'field' }, [
    el('label', {}, label),
    el('input', {
      type: 'text', value: v[key] || '', placeholder,
      onchange: (e) => save({ [key]: e.target.value }),
    }),
  ]);
}

function selectField(label, key, options, v) {
  return el('div', { class: 'field' }, [
    el('label', {}, label),
    el('select', { onchange: (e) => save({ [key]: e.target.value }) },
      Object.entries(options).map(([value, meta]) =>
        el('option', { value, selected: v[key] === value },
          meta.points ? `${meta.label} (${meta.points > 0 ? '+' : ''}${meta.points})` : meta.label)
      )
    ),
  ]);
}

function link(label, href) {
  return el('a', { class: 'btn sm', href, target: '_blank', rel: 'noopener noreferrer' }, label);
}
