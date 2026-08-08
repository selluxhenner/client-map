// Abgleich zwischen den Ordnern auf der Platte und den Betrieben in der Karte.
//
// Bewusst eine Bestaetigungsseite und kein Automatismus: "Street Art" und
// "art-wil" koennen derselbe Laden sein oder zwei verschiedene, und ein
// falscher Treffer wuerde einen Pipeline-Status verfaelschen. Der Server
// schlaegt vor, entschieden wird hier.

import { el, clear, get, post, toast, fail, formatDate } from './api.js';
import { state, loadConfig } from './state.js';
import { initDetail, showVenue } from './detail.js';
import { initJobs } from './jobs.js';

let daten = null;
const wahl = new Map(); // ordner -> { venue_id, status, aktiv }

start().catch(fail);

async function start() {
  await loadConfig();
  initDetail(document.getElementById('detail'));
  initJobs().catch(fail);
  await laden();
}

async function laden() {
  daten = await get('/demos');
  wahl.clear();
  for (const o of daten.ordner) {
    wahl.set(o.name, {
      venue_id: o.verknuepftMit?.id ?? o.vorschlaege[0]?.venue_id ?? '',
      status: o.wissen.status || '',
      // Vorausgewaehlt wird nur, was noch nicht verknuepft ist, plausibel
      // aussieht und kein bekannter Nicht-Gastro-Ordner ist.
      aktiv: !o.verknuepftMit && o.wissen.art !== 'nicht_gastro' && Boolean(o.vorschlaege.length),
    });
  }
  zeichnen();
}

function zeichnen() {
  const host = clear(document.getElementById('seite'));

  host.append(
    el('div', { class: 'seiten-kopf' }, [
      el('div', {}, [
        el('h1', {}, 'Demo-Ordner abgleichen'),
        el('p', { class: 'hint' },
          'Welcher Ordner auf der Platte gehört zu welchem Betrieb. Die Vorschläge stammen aus dem Ordnernamen und aus PLAN §7b — geprüft wird von dir.'),
      ]),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onclick: () => laden().catch(fail) }, 'Neu einlesen'),
      el('button', { class: 'btn primary', onclick: uebernehmen }, 'Auswahl übernehmen'),
    ])
  );

  host.append(
    el('div', { class: 'block' }, [
      el('h3', {}, 'Durchsuchte Ordner'),
      ...daten.wurzeln.map((w) =>
        el('div', { class: `hint ${w.vorhanden ? '' : 'warn-text'}` },
          `${w.vorhanden ? '✓' : '✕'} ${w.pfad}${w.vorhanden ? '' : ' — nicht gefunden'}`)
      ),
      daten.bauZielVorhanden
        ? el('div', { class: 'hint', style: { marginTop: '6px' } },
            `Neue Demos werden gebaut in: ${daten.bauZiel}`)
        : el('div', { class: 'notice warn', style: { marginTop: '6px' } }, [
            el('strong', {}, 'Bauziel existiert nicht: '),
            daten.bauZiel,
            ' — ein Demo-Bau würde abbrechen. Prüf DEMO_DIR in der .env; Umlaute müssen exakt stimmen.',
          ]),
    ])
  );

  const kopf = el('tr', {}, ['Ordner', 'Zustand', 'Betrieb', 'Status danach', 'Hinweis', ''].map(
    (t) => el('th', {}, t)
  ));

  const zeilen = daten.ordner.map(zeile);
  host.append(
    el('div', { class: 'table-wrap' }, [
      el('table', { class: 'data' }, [el('thead', {}, [kopf]), el('tbody', {}, zeilen)]),
    ])
  );
}

function zeile(o) {
  const w = wahl.get(o.name);

  const haken = el('input', {
    type: 'checkbox',
    checked: w.aktiv,
    onchange: (e) => { w.aktiv = e.target.checked; },
  });

  const auswahl = el('select', {
    onchange: (e) => { w.venue_id = e.target.value; },
  }, [
    el('option', { value: '' }, '— kein Betrieb —'),
    ...o.vorschlaege.map((k) =>
      el('option', { value: k.venue_id, selected: String(w.venue_id) === String(k.venue_id) },
        `${k.name}${k.city ? `, ${k.city}` : ''}  (Treffer ${Math.round(k.score * 100)} %)`)
    ),
    el('option', { disabled: true }, '──────────'),
    ...daten.betriebe
      .filter((b) => !o.vorschlaege.some((k) => k.venue_id === b.id))
      .map((b) =>
        el('option', { value: b.id, selected: String(w.venue_id) === String(b.id) },
          `${b.name}${b.city ? `, ${b.city}` : ''}`)
      ),
  ]);

  const statusWahl = el('select', {
    onchange: (e) => { w.status = e.target.value; },
  }, [
    el('option', { value: '', selected: !w.status }, 'unverändert lassen'),
    ...Object.entries(state.config.status).map(([key, meta]) =>
      el('option', { value: key, selected: w.status === key }, meta.label)
    ),
  ]);

  const hinweis = [
    o.wissen.notiz,
    o.auchIn ? `Liegt auch in ${o.auchIn}` : null,
    o.hatRecherche ? 'hat research.md' : null,
  ].filter(Boolean);

  return el('tr', { class: o.wissen.art === 'nicht_gastro' ? 'gedimmt' : '' }, [
    el('td', {}, [
      el('label', { class: 'check' }, [haken, el('span', {}, o.name)]),
      el('div', { class: 'hint' }, formatDate(o.geaendert)),
    ]),
    el('td', {}, o.hatSeite ? 'gebaute Seite' : el('span', { class: 'hint' }, 'leer / nur Notizen')),
    el('td', {}, [auswahl]),
    el('td', {}, [statusWahl]),
    el('td', { class: 'hint' }, hinweis.join(' · ') || '–'),
    el('td', {}, [
      o.verknuepftMit
        ? el('span', { class: 'badge', style: { background: 'var(--accent-soft)', color: 'var(--accent)' } },
            `↳ ${o.verknuepftMit.name}`)
        : null,
      el('button', {
        class: 'btn sm ghost',
        title: 'Ordner im Explorer zeigen',
        onclick: async () => {
          const res = await post('/demos/open', { ordner: o.name }).catch(fail);
          if (res?.geoeffnet) toast('Im Explorer geöffnet');
        },
      }, '📂'),
    ]),
  ]);
}

async function uebernehmen() {
  const paare = [...wahl.entries()]
    .filter(([, w]) => w.aktiv && w.venue_id)
    .map(([ordner, w]) => ({ ordner, venue_id: Number(w.venue_id), status: w.status || null }));

  if (!paare.length) return toast('Nichts ausgewählt', 'err');

  // Zwei Ordner auf denselben Betrieb: erlaubt, aber nur einer kann in
  // demo_path stehen. Besser vorher sagen als hinterher wundern.
  const mehrfach = paare
    .map((p) => p.venue_id)
    .filter((id, i, alle) => alle.indexOf(id) !== i);
  if (mehrfach.length) {
    const namen = [...new Set(mehrfach)].map(
      (id) => daten.betriebe.find((b) => b.id === id)?.name || id
    );
    if (!confirm(
      `Mehrere Ordner zeigen auf denselben Betrieb (${namen.join(', ')}).\n` +
      'Gespeichert wird jeweils nur der letzte. Trotzdem übernehmen?'
    )) return;
  }

  if (!confirm(`${paare.length} Verknüpfung${paare.length === 1 ? '' : 'en'} übernehmen?`)) return;

  try {
    const res = await post('/demos/link', { paare });
    toast(`${res.verknuepft} übernommen`);
    await laden();
  } catch (err) {
    fail(err);
  }
}

// Ein Klick auf einen verknüpften Betrieb öffnet ihn rechts — von hier aus
// will man oft direkt den Status oder die Notiz nachziehen.
document.addEventListener('click', async (e) => {
  const badge = e.target.closest('.badge');
  if (!badge || !badge.textContent.startsWith('↳')) return;
  const name = badge.textContent.slice(1).trim();
  const treffer = daten?.ordner.find((o) => o.verknuepftMit?.name === name);
  if (!treffer) return;
  try {
    showVenue(await get(`/venues/${treffer.verknuepftMit.id}`));
  } catch (err) {
    fail(err);
  }
});
