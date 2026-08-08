// Wartungsseite: Regions-Suche, Dubletten, Sicherungen, Datenbank.
//
// Alles, was man selten macht und dann genau wissen will. Bewusst nicht in der
// Karte versteckt: hier stehen die zwei einzigen Knöpfe der App, die Daten
// wirklich verändern können (Zusammenführen) oder lange laufen (Regions-Suche).

import { el, clear, get, post, toast, fail, formatDate } from './api.js';
import { state, loadConfig } from './state.js';
import { initDetail, showVenue } from './detail.js';
import { initJobs, onServerEvent } from './jobs.js';

let daten = null;
let doppelte = null;
let regionLauf = null;

start().catch(fail);

async function start() {
  await loadConfig();
  initDetail(document.getElementById('detail'));
  initJobs().catch(fail);
  onServerEvent(regionEreignis);
  await laden();
}

async function laden() {
  daten = await get('/wartung');
  regionLauf = daten.region?.laeuft ? daten.region : regionLauf;
  zeichnen();
}

function zeichnen() {
  const host = clear(document.getElementById('seite'));
  host.append(el('h1', {}, 'Wartung'));
  host.append(regionenBlock());
  host.append(doppelteBlock());
  host.append(sicherungBlock());
  host.append(datenbankBlock());
}

// --- Regions-Suche ----------------------------------------------------------

function regionenBlock() {
  const feld = el('textarea', {
    rows: '5',
    placeholder: 'Ein Ort pro Zeile:\nWil SG\nUzwil\nFlawil\nSirnach',
    style: { width: '100%' },
  }, gespeicherteOrte());

  const status = el('div', { class: 'hint' },
    regionLauf?.laeuft
      ? `Läuft: ${regionLauf.erledigt}/${regionLauf.gesamt} Orte · ${regionLauf.neu || 0} neu`
      : 'Sucht jeden Ort nacheinander ab. Grosse Gebiete werden automatisch in Kacheln zerlegt.');

  return el('div', { class: 'block' }, [
    el('h3', {}, 'Regions-Suche'),
    el('p', { class: 'hint' },
      'Overpass und Nominatim sind öffentliche Gratisdienste — deshalb läuft das nacheinander mit Pausen und nicht parallel. Rechne mit einer halben bis zwei Minuten pro Ort.'),
    feld,
    el('div', { class: 'links', style: { marginTop: '8px' } }, [
      el('button', {
        class: 'btn primary',
        disabled: Boolean(regionLauf?.laeuft),
        onclick: async () => {
          const orte = feld.value.split('\n').map((z) => z.trim()).filter(Boolean);
          if (!orte.length) return toast('Keine Orte angegeben', 'err');
          if (!confirm(`${orte.length} Ort${orte.length === 1 ? '' : 'e'} absuchen?\n\nDauert etwa ${orte.length} bis ${orte.length * 2} Minuten. Läuft im Hintergrund weiter, auch wenn du auf die Karte wechselst.`)) return;
          try {
            localStorage.setItem('clientmap-orte', feld.value);
            regionLauf = await post('/wartung/regionen', { orte });
            toast('Regions-Suche gestartet');
            zeichnen();
          } catch (err) {
            fail(err);
          }
        },
      }, regionLauf?.laeuft ? 'Läuft …' : '🌍 Region absuchen'),
      regionLauf?.laeuft
        ? el('button', {
            class: 'btn danger',
            onclick: async () => {
              await post('/wartung/regionen/stop').catch(fail);
              toast('Wird nach dem aktuellen Ort beendet');
            },
          }, 'Abbrechen')
        : null,
    ]),
    status,
    regionLauf?.ergebnisse?.length
      ? el('ul', { class: 'ergebnisse' }, regionLauf.ergebnisse.map((r) =>
          el('li', {}, r.fehler
            ? `${r.ort}: ✕ ${r.fehler}`
            : `${r.ort}: ${r.gefunden} gefunden, ${r.inserted} neu, ${r.updated} ergänzt (${r.kacheln} Kachel${r.kacheln === 1 ? '' : 'n'})`))
        )
      : null,
  ]);
}

function gespeicherteOrte() {
  return localStorage.getItem('clientmap-orte') || '';
}

function regionEreignis(payload) {
  if (payload.type !== 'region') return;

  if (payload.phase === 'fertig') {
    regionLauf = { ...payload, laeuft: false };
    toast(`Regions-Suche fertig: ${payload.neu} neu, ${payload.ergaenzt} ergänzt`);
    laden().catch(fail);
    return;
  }
  if (payload.phase === 'fehler') {
    regionLauf = { ...regionLauf, laeuft: false };
    toast(payload.meldung, 'err');
    zeichnen();
    return;
  }

  regionLauf = {
    ...(regionLauf || {}),
    laeuft: true,
    gesamt: payload.gesamt ?? regionLauf?.gesamt ?? 0,
    erledigt: payload.erledigt ?? regionLauf?.erledigt ?? 0,
    aktuell: payload.ort ?? regionLauf?.aktuell,
  };

  if (payload.phase === 'ort-fertig' || payload.phase === 'ort-fehler') {
    regionLauf.ergebnisse = [...(regionLauf.ergebnisse || []), { ort: payload.ort, ...payload }];
    regionLauf.erledigt = (regionLauf.erledigt || 0) + 1;
    regionLauf.neu = (regionLauf.neu || 0) + (payload.inserted || 0);
  }
  zeichnen();
}

// --- Doppelte ---------------------------------------------------------------

function doppelteBlock() {
  const inhalt = el('div', {});

  if (!doppelte) {
    inhalt.append(
      el('button', {
        class: 'btn',
        onclick: async () => {
          try {
            doppelte = await get('/wartung/doppelte');
            toast(`${doppelte.anzahl} verdächtige Paare`);
            zeichnen();
          } catch (err) {
            fail(err);
          }
        },
      }, 'Nach Doppelten suchen')
    );
  } else if (!doppelte.paare.length) {
    inhalt.append(el('div', { class: 'notice info' }, 'Keine Doppelten gefunden.'));
  } else {
    inhalt.append(
      el('div', { class: 'table-wrap' }, [
        el('table', { class: 'data' }, [
          el('thead', {}, [el('tr', {}, ['Sicherheit', 'Grund', 'Abstand', 'Behalten', 'Aufgeben', ''].map((t) => el('th', {}, t)))]),
          el('tbody', {}, doppelte.paare.map(paarZeile)),
        ]),
      ])
    );
  }

  return el('div', { class: 'block' }, [
    el('h3', {}, 'Doppelte Betriebe'),
    el('p', { class: 'hint' },
      'Gesucht wird über Telefonnummer, E-Mail, Website, Instagram und Namensgleichheit in Gehweite — nicht über den Abstand allein. In der Wiler Altstadt liegen über hundert verschiedene Lokale weniger als 80 Meter auseinander; wer nach Nähe zusammenführt, verliert echte Betriebe.'),
    inhalt,
  ]);
}

function paarZeile(paar) {
  const behalten = paar.vorschlagBehalten;
  const aufgeben = behalten === paar.a.id ? paar.b : paar.a;
  const bleibt = behalten === paar.a.id ? paar.a : paar.b;

  const beschreiben = (v) => [
    el('strong', {}, v.name),
    el('div', { class: 'hint' }, [
      `#${v.id} · ${v.city || 'ohne Ort'} · ${state.config.status[v.status]?.label || v.status}`,
      v.hatNotizen ? ' · Notizen' : '',
      v.hatDemo ? ' · Demo' : '',
      v.hatAnalyse ? ' · Analyse' : '',
      v.kontaktiert ? ' · kontaktiert' : '',
    ].join('')),
  ];

  return el('tr', {}, [
    el('td', {}, `${Math.round(paar.sicherheit * 100)} %`),
    el('td', { class: 'hint' }, paar.gruende.join(', ')),
    el('td', {}, `${paar.abstand} m`),
    el('td', {}, beschreiben(bleibt)),
    el('td', { class: 'gedimmt' }, beschreiben(aufgeben)),
    el('td', {}, [
      el('button', {
        class: 'btn sm danger',
        onclick: async () => {
          if (!confirm(
            `"${aufgeben.name}" (#${aufgeben.id}) in "${bleibt.name}" (#${bleibt.id}) zusammenführen?\n\n` +
            'Leere Felder werden gefüllt, Notizen aneinandergehängt, die Kontakt-Historie zieht mit um. ' +
            `Der Eintrag #${aufgeben.id} wird danach gelöscht.\n\n` +
            'Vorher wird automatisch gesichert.'
          )) return;
          try {
            const res = await post('/wartung/merge', { behalten: bleibt.id, aufgeben: aufgeben.id });
            toast(`Zusammengeführt · Sicherung ${res.sicherung}`);
            doppelte = await get('/wartung/doppelte');
            await laden();
          } catch (err) {
            fail(err);
          }
        },
      }, 'Zusammenführen'),
      el('button', {
        class: 'btn sm ghost',
        title: 'Beide ansehen',
        onclick: async () => {
          try {
            showVenue(await get(`/venues/${bleibt.id}`));
          } catch (err) {
            fail(err);
          }
        },
      }, '👁'),
    ]),
  ]);
}

// --- Sicherungen ------------------------------------------------------------

function sicherungBlock() {
  return el('div', { class: 'block' }, [
    el('h3', {}, 'Sicherungen'),
    el('p', { class: 'hint' }, [
      'Eine Sicherung ist eine in sich geschlossene Kopie der Datenbank. ',
      el('strong', {}, 'Nicht'),
      ' einfach die Datei im Explorer kopieren — im Betrieb steht ein Teil der Daten im Journal und würde fehlen.',
    ]),
    el('div', { class: 'links' }, [
      el('button', {
        class: 'btn primary',
        onclick: async () => {
          try {
            const s = await post('/wartung/sicherung', { grund: 'manuell' });
            toast(`Gesichert: ${s.name} (${kb(s.groesse)})`);
            await laden();
          } catch (err) {
            fail(err);
          }
        },
      }, '💾 Jetzt sichern'),
    ]),
    el('div', { class: 'hint', style: { marginTop: '8px' } },
      `Ordner: ${daten.sicherungsordner} · es werden die ${daten.datenbank.behalten} neuesten behalten`),

    daten.sicherungen.length
      ? el('ul', { class: 'ergebnisse' }, daten.sicherungen.slice(0, 10).map((s) =>
          el('li', {}, `${formatDate(s.erstellt)} · ${s.name} · ${kb(s.groesse)}${s.grund === 'vor-merge' ? ' (automatisch vor einem Zusammenführen)' : ''}`))
        )
      : el('div', { class: 'notice warn' }, 'Noch keine Sicherung vorhanden.'),

    el('details', { style: { marginTop: '10px' } }, [
      el('summary', { class: 'hint' }, 'Wie stelle ich eine Sicherung wieder her?'),
      el('ol', { class: 'hint', style: { lineHeight: '1.7' } }, [
        el('li', {}, 'Server beenden (Strg-C im Terminal).'),
        el('li', {}, 'Im Ordner data/ die Dateien clientmap.db, clientmap.db-wal und clientmap.db-shm umbenennen — nicht löschen.'),
        el('li', {}, 'Die gewünschte Sicherung aus data/sicherungen/ nach data/clientmap.db kopieren.'),
        el('li', {}, 'Server neu starten. Läuft alles, kannst du die umbenannten Dateien wegwerfen.'),
      ]),
    ]),
  ]);
}

// --- Datenbank --------------------------------------------------------------

function datenbankBlock() {
  const d = daten.datenbank;
  const g = daten.google;

  return el('div', { class: 'block' }, [
    el('h3', {}, 'Datenbank'),
    el('dl', { class: 'kv' }, [
      el('dt', {}, 'Datei'), el('dd', {}, `${kb(d.groesse)}${d.journal ? ` + ${kb(d.journal)} Journal` : ''}`),
      el('dt', {}, 'Schema'), el('dd', {}, `Version ${d.version}`),
      el('dt', {}, 'Prüfung'), el('dd', {},
        d.integritaet === 'ok'
          ? el('span', { style: { color: 'var(--accent)' } }, 'in Ordnung')
          : el('span', { class: 'faellig-marke' }, String(d.integritaet))),
      el('dt', {}, 'Betriebe'), el('dd', {}, String(d.zeilen.betriebe)),
      el('dt', {}, 'Kontakte'), el('dd', {}, String(d.zeilen.kontakte)),
      el('dt', {}, 'Aufträge'), el('dd', {}, String(d.zeilen.auftraege)),
      el('dt', {}, 'Gescannt'), el('dd', {}, `${d.zeilen.gescannt} Ausschnitte`),
      el('dt', {}, 'Google'), el('dd', {},
        g.aktiv ? 'aktiv' : g.abgeschaltet ? 'Schlüssel hinterlegt, abgeschaltet' : 'inaktiv (kein Schlüssel)'),
    ]),
    el('div', { class: 'hint', style: { marginTop: '6px' } }, g.hinweis),
    el('div', { class: 'links', style: { marginTop: '10px' } }, [
      el('button', {
        class: 'btn sm danger',
        title: 'Beendet den Server und nimmt alle laufenden Agenten mit',
        onclick: async () => {
          if (!confirm(
            'Server beenden?\n\n' +
            'Laufende Agenten werden abgebrochen. Danach musst du ihn im Terminal ' +
            'wieder mit "npm start" starten.'
          )) return;
          try {
            const r = await post('/wartung/beenden');
            toast(r.meldung);
            setTimeout(() => {
              clear(document.getElementById('seite')).append(
                el('div', { class: 'notice info' },
                  'Server beendet. Zum Weiterarbeiten im Terminal "npm start" ausführen und diese Seite neu laden.')
              );
            }, 400);
          } catch (err) {
            fail(err);
          }
        },
      }, '⏹ Server beenden'),
      el('button', {
        class: 'btn sm',
        title: 'Journal zusammenführen und Datei aufräumen',
        onclick: async () => {
          try {
            const r = await post('/wartung/kompakt');
            toast(`${kb(r.vorher)} → ${kb(r.nachher)}`);
            await laden();
          } catch (err) {
            fail(err);
          }
        },
      }, 'Aufräumen (VACUUM)'),
    ]),
  ]);
}

function kb(bytes) {
  if (!bytes) return '0 KB';
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
