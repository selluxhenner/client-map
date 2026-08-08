// Detail-Panel eines Betriebs. Alles hier speichert sofort - kein
// Speichern-Knopf, den man vergessen kann.

import { el, clear, get, post, patch, del, toast, fail, debounce, formatDate } from './api.js';
import { state, upsertLocal, scoreBandFor, select } from './state.js';
import { startJob, onKinds, onVenueUpdate } from './jobs.js';

let host;
let onChange = () => {};
let current = null;
let kinds = {};
let analyseOffen = false;
const analyseText = new Map();

/** Kontakt-Historie des gerade offenen Betriebs. */
let historie = [];
/** Halb ausgefülltes Kontakt-Formular über ein Neuzeichnen hinweg behalten. */
let formular = null;

// Sobald die Job-Engine meldet, welche Auftragsarten scharf sind, werden die
// Knoepfe hier von selbst aktiv. Phase 5 und 6 muessen dafuer nur ein Flag
// in server/jobs/kinds.js umlegen.
onKinds((next) => {
  kinds = next;
  if (current) render();
});

// Wenn eine Analyse durchlaeuft, waehrend das Panel offen ist, soll man das
// sehen, ohne den Betrieb neu anzuklicken.
onVenueUpdate((venue) => {
  analyseText.delete(venue.id);
  if (!current || current.id !== venue.id) return;
  current = venue;
  upsertLocal(venue);
  onChange(venue);
  render();
  toast(`Analyse übernommen: ${venue.name}`);
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
  analyseOffen = false;
  historie = [];
  formular = null;
  host.classList.add('open');
  render();
  ladeHistorie(venue.id);
}

async function ladeHistorie(venueId) {
  try {
    const eintraege = await get(`/venues/${venueId}/interactions`);
    if (current?.id !== venueId) return;
    historie = eintraege;
    render();
  } catch {
    /* Ohne Historie ist das Panel weiterhin benutzbar. */
  }
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
        'Ungeprüft. Die Angaben stammen roh aus OpenStreetMap — ein fehlender Website-Eintrag ist dort kein Beweis, dass es keine Website gibt. Die Analyse unten klärt das.')
    );
  }

  if (v.analysis_summary || v.analysis_path) inner.append(analysisBlock(v));

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
      statusHinweis(v),
      el('div', { class: 'field' }, [
        el('label', {}, 'Letzter Kontakt'),
        el('input', {
          type: 'date',
          value: (v.last_contact_at || '').slice(0, 10),
          onchange: (e) => save({ last_contact_at: e.target.value || null }),
        }),
      ]),
      wiedervorlageFeld(v),
      el('div', { class: 'field' }, [
        el('label', {}, 'Notizen'),
        el('textarea', {
          placeholder: 'Dauerhafte Notizen zum Betrieb — Einzelkontakte kommen unten in die Historie',
          oninput: (e) => saveSoon({ notes: e.target.value }),
        }, v.notes || ''),
      ]),
    ])
  );

  inner.append(historieBlock(v));
  if (v.outreach_draft) inner.append(entwurfBlock(v));

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
        el('dt', {}, 'Demo'),
        el('dd', {}, v.demo_path
          ? [
              el('span', {}, v.demo_path),
              ' ',
              el('button', {
                class: 'btn sm ghost',
                title: 'Ordner im Explorer zeigen',
                onclick: async () => {
                  const res = await post('/demos/open', { ordner: v.demo_path }).catch(fail);
                  if (res?.geoeffnet) toast('Im Explorer geöffnet');
                },
              }, '📂'),
            ]
          : '–'),
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
    { kind: 'schnell', icon: '⚡', fallback: 'Schnell-Check' },
    { kind: 'analyse', icon: '🔍', fallback: 'Analyse durch Claude' },
    { kind: 'demo', icon: '🔨', fallback: 'Demo bauen' },
    { kind: 'kontakt', icon: '✍️', fallback: 'Kontakt-Entwurf' },
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
          onclick: ready ? () => aktionStarten(kind, v) : null,
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

// --- Wiedervorlage ---------------------------------------------------------

/**
 * Ein Datum plus ein Wort, warum. Ohne das "warum" steht man in vier Wochen
 * vor einem Termin, ohne zu wissen, was man vorhatte.
 */
function wiedervorlageFeld(v) {
  const heute = new Date().toISOString().slice(0, 10);
  const datum = (v.follow_up_at || '').slice(0, 10);
  const faellig = datum && datum <= heute;

  return el('div', { class: 'field' }, [
    el('label', {}, [
      'Wiedervorlage',
      faellig ? el('span', { class: 'faellig-marke' }, ' fällig') : null,
    ]),
    el('div', { class: 'links' }, [
      el('input', {
        type: 'date',
        value: datum,
        onchange: (e) => save({ follow_up_at: e.target.value || null }),
      }),
      ...(datum
        ? [el('button', {
            class: 'btn sm ghost',
            title: 'Wiedervorlage entfernen',
            onclick: () => save({ follow_up_at: null, follow_up_note: null }),
          }, '✕')]
        : [7, 14, 30].map((tage) =>
            el('button', {
              class: 'btn sm',
              title: `Wiedervorlage in ${tage} Tagen`,
              onclick: () => save({ follow_up_at: inTagen(tage) }),
            }, `+${tage} T`)
          )),
    ]),
    datum
      ? el('input', {
          type: 'text',
          placeholder: 'Warum? z. B. „nach den Ferien nochmal fragen"',
          value: v.follow_up_note || '',
          onchange: (e) => save({ follow_up_note: e.target.value || null }),
        })
      : null,
  ]);
}

function inTagen(tage) {
  const d = new Date();
  d.setDate(d.getDate() + tage);
  return d.toISOString().slice(0, 10);
}

// --- Kontakt-Historie ------------------------------------------------------

/**
 * Was wann über welchen Kanal passiert ist, und was dabei herauskam.
 *
 * Der Eintrag zieht den Pipeline-Status mit (das macht der Server) - deshalb
 * ist das hier der eigentliche Arbeitsplatz und nicht die Status-Auswahl oben.
 */
function historieBlock(v) {
  const { config } = state;
  formular ||= { channel: v.instagram ? 'instagram' : 'mail', outcome: 'offen', note: '', datum: new Date().toISOString().slice(0, 10) };

  const feld = (key, node) => {
    node.addEventListener('change', (e) => { formular[key] = e.target.value; });
    node.addEventListener('input', (e) => { formular[key] = e.target.value; });
    return node;
  };

  const eintragen = async () => {
    try {
      const antwort = await post(`/venues/${v.id}/interactions`, {
        channel: formular.channel,
        outcome: formular.outcome,
        note: formular.note,
        happened_at: `${formular.datum} 12:00:00`,
      });
      historie = antwort.interactions;
      formular = null;
      current = antwort.venue;
      upsertLocal(antwort.venue);
      onChange(antwort.venue);
      toast('Kontakt eingetragen');
      render();
    } catch (err) {
      fail(err);
    }
  };

  return el('div', { class: 'block' }, [
    el('h3', {}, `Kontakt-Historie${historie.length ? ` (${historie.length})` : ''}`),

    historie.length
      ? el('ul', { class: 'historie' }, historie.map((e) => {
          const kanal = config.channels?.[e.channel] || { label: e.channel || '–', icon: '•' };
          const ergebnis = config.outcomes?.[e.outcome];
          return el('li', {}, [
            el('div', { class: 'historie-kopf' }, [
              el('span', { title: kanal.label }, `${kanal.icon} ${kanal.label}`),
              el('span', { class: 'hint' }, formatDate(e.happened_at)),
              ergebnis
                ? el('span', {
                    class: 'badge',
                    style: { background: `${ergebnis.color}22`, color: ergebnis.color },
                  }, ergebnis.label)
                : null,
              el('span', { class: 'spacer' }),
              el('button', {
                class: 'btn sm ghost',
                title: 'Eintrag löschen',
                onclick: async () => {
                  if (!confirm('Diesen Eintrag löschen?')) return;
                  try {
                    historie = (await del(`/interactions/${e.id}`)).interactions;
                    current = await get(`/venues/${v.id}`);
                    upsertLocal(current);
                    onChange(current);
                    render();
                  } catch (err) {
                    fail(err);
                  }
                },
              }, '✕'),
            ]),
            e.note ? el('div', { class: 'historie-notiz' }, e.note) : null,
          ]);
        }))
      : el('div', { class: 'hint' }, 'Noch kein Kontakt eingetragen.'),

    el('div', { class: 'kontakt-form' }, [
      el('div', { class: 'links' }, [
        feld('datum', el('input', { type: 'date', value: formular.datum })),
        feld('channel', el('select', {},
          Object.entries(config.channels || {}).map(([key, meta]) =>
            el('option', { value: key, selected: formular.channel === key }, `${meta.icon} ${meta.label}`)
          )
        )),
        feld('outcome', el('select', {},
          Object.entries(config.outcomes || {}).map(([key, meta]) =>
            el('option', { value: key, selected: formular.outcome === key }, meta.label)
          )
        )),
      ]),
      feld('note', el('input', {
        type: 'text',
        placeholder: 'Was gesagt / geschrieben? (optional)',
        value: formular.note,
      })),
      el('button', { class: 'btn primary sm', onclick: eintragen }, '+ Kontakt eintragen'),
      el('div', { class: 'hint' },
        'Der Status zieht automatisch mit — aber nur vorwärts. „Termin vereinbart" setzt auf Im Gespräch, „Auftrag" auf Kunde.'),
    ]),
  ]);
}

// --- Kontakt-Entwurf -------------------------------------------------------

/**
 * Die Entwürfe aus Aktion C. Wichtigste Funktion ist der Kopierknopf: von
 * hier geht der Text nach Instagram, und zwar von Kevins Hand. Die App
 * verschickt nichts.
 */
function entwurfBlock(v) {
  const d = v.outreach_draft;
  const zuLang = d.dm && d.dm.length > 450;

  const kopieren = (was, text) => el('button', {
    class: 'btn sm',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast(`${was} kopiert`);
      } catch {
        toast('Kopieren hat nicht geklappt — Text von Hand markieren', 'err');
      }
    },
  }, `📋 ${was} kopieren`);

  return el('div', { class: 'block' }, [
    el('h3', {}, `Kontakt-Entwurf · ${formatDate(v.outreach_draft_at)}`),
    el('div', { class: 'notice info' },
      'Nur ein Entwurf. Lies ihn durch, ändere was nicht passt, und verschick ihn selbst — die App schickt nie etwas raus.'),

    d.aufhaenger ? el('p', { class: 'analysis-summary' }, d.aufhaenger) : null,

    d.dm
      ? el('div', { class: 'entwurf' }, [
          el('div', { class: 'entwurf-kopf' }, [
            el('strong', {}, 'Instagram-DM'),
            el('span', { class: zuLang ? 'faellig-marke' : 'hint' }, `${d.dm.length} Zeichen`),
            el('span', { class: 'spacer' }),
            kopieren('DM', d.dm),
          ]),
          el('pre', { class: 'md-view' }, d.dm),
        ])
      : null,

    d.mail_text
      ? el('div', { class: 'entwurf' }, [
          el('div', { class: 'entwurf-kopf' }, [
            el('strong', {}, 'E-Mail'),
            el('span', { class: 'spacer' }),
            d.mail_betreff ? kopieren('Betreff', d.mail_betreff) : null,
            kopieren('Mail', d.mail_text),
          ]),
          d.mail_betreff ? el('div', { class: 'hint' }, `Betreff: ${d.mail_betreff}`) : null,
          el('pre', { class: 'md-view' }, d.mail_text),
        ])
      : null,

    d.hinweise?.length
      ? el('ul', { class: 'hinweise' }, d.hinweise.map((h) => el('li', {}, h)))
      : null,
  ]);
}

/**
 * Status und Faktenfeld sind absichtlich zwei verschiedene Dinge: der Status
 * ist deine Buchführung, das Faktenfeld steuert Score und Sichtbarkeit. Bei
 * zwei Status gehören sie aber praktisch immer zusammen — und statt es
 * stillschweigend mitzuändern, wird es hier angeboten.
 */
function statusHinweis(v) {
  if (v.status === 'geschlossen' && !v.permanently_closed) {
    return el('div', { class: 'notice info' }, [
      'Noch nicht als dauerhaft geschlossen markiert — der Betrieb bleibt damit auf der Karte und zählt im Score mit. ',
      el('button', {
        class: 'btn sm',
        onclick: () => save({ permanently_closed: true }),
      }, 'Auch dauerhaft geschlossen setzen'),
    ]);
  }

  if (v.status === 'website_gut' && v.website_status !== 'gut') {
    return el('div', { class: 'notice info' }, [
      `Website-Zustand steht auf „${state.config.websiteStatus[v.website_status]?.label || v.website_status}". `,
      'Solange das so ist, bleibt der Score hoch und der Laden taucht bei den heissen Leads auf. ',
      el('button', {
        class: 'btn sm',
        onclick: () => save({ website_status: 'gut', verified: true }),
      }, 'Website als „modern und gut" eintragen'),
    ]);
  }

  return null;
}

/**
 * Der Demo-Bau ist die eine Aktion, die eine Rückfrage verdient: eine knappe
 * Stunde auf Opus, und das Tageslimit liegt bei fünf. Ein Fehlklick tut hier
 * wirklich weh, ein Schnell-Check nicht.
 */
function aktionStarten(kind, v) {
  if (kind !== 'demo') return startJob(kind, v.id);

  const meta = kinds.demo;
  const zeilen = [
    `Demo-Website für "${v.name}" bauen lassen.`,
    `Modell ${meta.model}, rund ${Math.round((meta.typischS || 2400) / 60)} Minuten, Tageslimit ${meta.dailyLimit}.`,
    '',
    v.last_analysis_at
      ? 'Die vorhandene Analyse wird als research.md mitgegeben — der Agent muss Phase 1 nicht neu machen.'
      : 'Für diesen Betrieb liegt noch keine Analyse vor. Der Agent recherchiert dann alles selbst, das dauert deutlich länger. Erst "Analyse" laufen lassen?',
    v.demo_path ? `Achtung: Ordner "${v.demo_path}" ist schon verknüpft und wird weiterverwendet.` : null,
    '',
    'Starten?',
  ].filter((z) => z !== null);

  if (!confirm(zeilen.join('\n'))) return null;
  return startJob(kind, v.id);
}

/**
 * Ergebnis der Claude-Analyse. Kurzfassung sofort sichtbar, der volle Text
 * erst auf Klick - sonst schiebt er alles Bedienbare aus dem Blick.
 */
function analysisBlock(v) {
  const box = el('pre', { class: 'md-view', hidden: !analyseOffen },
    analyseText.get(v.id) || 'Wird geladen …');

  const knopf = el('button', { class: 'btn sm' },
    analyseOffen ? 'Volltext ausblenden' : 'Volltext anzeigen');

  knopf.addEventListener('click', () => {
    analyseOffen = !analyseOffen;
    box.hidden = !analyseOffen;
    knopf.textContent = analyseOffen ? 'Volltext ausblenden' : 'Volltext anzeigen';
    if (analyseOffen && !analyseText.has(v.id)) loadAnalysis(v, box);
  });

  if (analyseOffen && !analyseText.has(v.id)) loadAnalysis(v, box);

  const schnell = v.analysis_kind === 'schnell';

  return el('div', { class: 'block' }, [
    el('h3', {}, `${schnell ? 'Schnell-Check' : 'Analyse'} · ${formatDate(v.last_analysis_at)}`),
    v.analysis_summary
      ? el('p', { class: 'analysis-summary' }, v.analysis_summary)
      : el('div', { class: 'hint' }, 'Ohne Kurzfassung — Volltext ansehen.'),
    schnell
      ? el('div', { class: 'hint' },
          'Geprüft wurden nur Website und Instagram. Für Inhaber, Geschichte und Aufhänger die volle Analyse starten.')
      : null,
    el('div', { class: 'links' }, [knopf]),
    box,
  ]);
}

async function loadAnalysis(v, box) {
  try {
    const data = await get(`/venues/${v.id}/analyse`);
    analyseText.set(v.id, data.text);
    box.textContent = data.text;
  } catch (err) {
    box.textContent = err.message;
  }
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
