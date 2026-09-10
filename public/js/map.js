import { el, clear, get, post, toast, fail, isLight, debounce } from './api.js';
import {
  state, loadConfig, loadVenues, on, filterValue, select, scoreBandFor, upsertLocal,
} from './state.js';
import { renderFilters, refreshCounts } from './filters.js';
import { initDetail, showVenue } from './detail.js';
import { initJobs, startBatch, onVenueUpdate } from './jobs.js';
import { initScanStatus, scanBegin, scanEnd, trackBatch } from './scan-status.js';
import { startAnreicherung } from './anreicherung.js';

let map;
let cluster;
const markers = new Map();
let addMode = false;

start().catch(fail);

async function start() {
  await loadConfig();

  map = L.map('map', { zoomControl: true, preferCanvas: false })
    .setView([state.config.map.lat, state.config.map.lng], state.config.map.zoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  cluster = L.markerClusterGroup({
    maxClusterRadius: 45,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    disableClusteringAtZoom: 17,
    // Bei tausenden Pins wuerde das Einhaengen in einem Zug die Oberflaeche
    // sekundenlang einfrieren. Stueckweise bleibt sie bedienbar.
    chunkedLoading: true,
    chunkInterval: 100,
  }).addTo(map);

  initDetail(document.getElementById('detail'), { onVenueChange: onVenueChanged });
  initScanStatus(document.querySelector('.workspace'));
  renderFilters(document.getElementById('filters'), { showBboxToggle: true });
  wireTopbar();
  initJobs().catch(fail);

  on('filter', () => refresh());
  on('venues', () => { drawMarkers(); drawStats(); });
  on('selection', (id) => highlight(id));

  // Ein fertig analysierter Betrieb springt sofort um: neuer Score, neuer
  // Ring, gegebenenfalls neue Farbe. Die Zahlen in der Filterleiste ziehen
  // gesammelt nach - waehrend eines Stapellaufs aendern sich Dutzende, und
  // jede einzelne Zaehlung waere eine eigene Serveranfrage.
  const zahlenNachziehen = debounce(() => refreshCounts(), 1200);
  onVenueUpdate((venue) => {
    upsertLocal(venue);
    markers.get(venue.id)?.setIcon(iconFor(venue));
    drawStats();
    zahlenNachziehen();
  });

  map.on('moveend', debounce(() => {
    if (filterValue('nurAusschnitt') === '1') refresh();
  }, 400));

  map.on('click', (e) => {
    if (addMode) createManual(e.latlng);
  });

  // Debug-Zugriff aus der Browser-Konsole: clientMap.map.setView(...)
  window.clientMap = { map, cluster, state, refresh };

  await refresh();
}

function bboxParam() {
  const b = map.getBounds();
  return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].join(',');
}

/**
 * Obergrenze fuer die Karte. Darueber hinaus wird gekappt und das auch gesagt -
 * gemessen sind 10 000 Pins bei schlanker Nutzlast rund 1,2 MB und mit
 * stueckweisem Einhaengen bedienbar, aber irgendwo muss die Grenze sein.
 */
const MAX_PINS = 8000;

async function refresh() {
  try {
    const data = await loadVenues({
      bbox: filterValue('nurAusschnitt') === '1' ? bboxParam() : '',
      // Die Karte braucht sieben Spalten, nicht dreissig. Den Rest holt das
      // Detail-Panel beim Anklicken.
      felder: 'karte',
      limit: MAX_PINS,
    });
    if (data.gekappt) {
      toast(`${data.returned} von ${data.total} Pins gezeigt — näher zoomen oder filtern`, 'err');
    }
  } catch (err) {
    fail(err);
  }
}

/**
 * Voller Datensatz fuer das Panel. Die Karte kennt nur die schlanke Fassung,
 * und Notizen oder Analyse stehen nicht darin.
 */
async function oeffnen(id) {
  try {
    showVenue(await get(`/venues/${id}`));
  } catch (err) {
    fail(err);
  }
}

// --- Marker ---------------------------------------------------------------

function iconFor(v) {
  const meta = state.config.status[v.status] || state.config.status.neu;
  const band = scoreBandFor(v.score);
  const classes = ['pin', isLight(meta.color) ? 'light' : '', v.verified ? '' : 'unverified']
    .filter(Boolean).join(' ');

  return L.divIcon({
    className: 'pin-wrap',
    html: `<div class="${classes}" style="--c:${meta.color};--ring:${band.color};--rw:${band.width}px">
             ${v.score}${v.score >= 70 ? '<span class="flame">🔥</span>' : ''}
           </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function drawMarkers() {
  cluster.clearLayers();
  markers.clear();

  const layers = state.venues.map((v) => {
    const marker = L.marker([v.lat, v.lng], {
      icon: iconFor(v),
      title: `${v.name} · ${v.score}`,
    });
    marker.on('click', () => {
      select(v.id);
      oeffnen(v.id);
    });
    markers.set(v.id, marker);
    return marker;
  });

  cluster.addLayers(layers);
}

function highlight(id) {
  for (const [venueId, marker] of markers) {
    const node = marker.getElement()?.firstElementChild;
    node?.classList.toggle('selected', venueId === id);
  }
}

function onVenueChanged(venue) {
  if (!venue) return refresh();
  const marker = markers.get(venue.id);
  if (marker) marker.setIcon(iconFor(venue));
  drawStats();
}

// --- Kopfzeile ------------------------------------------------------------

function drawStats() {
  const host = document.getElementById('stats');
  const hot = state.venues.filter((v) => v.score >= 70).length;
  const unverified = state.venues.filter((v) => !v.verified).length;

  clear(host).append(
    stat(state.total, 'Betriebe'),
    stat(hot, 'heiss', 'hot'),
    stat(unverified, 'ungeprüft'),
  );
}

function stat(value, label, cls = '') {
  return el('div', { class: `stat ${cls}` }, [el('b', {}, String(value)), el('span', {}, label)]);
}

function wireTopbar() {
  const searchInput = document.getElementById('geo-input');
  const results = document.getElementById('geo-results');

  const runSearch = async () => {
    const q = searchInput.value.trim();
    if (!q) return;
    try {
      const hits = await get(`/geocode?q=${encodeURIComponent(q)}`);
      clear(results);
      if (!hits.length) return toast('Nichts gefunden', 'err');
      results.hidden = false;
      for (const hit of hits) {
        results.append(
          el('button', {
            onclick: () => {
              results.hidden = true;
              if (hit.bbox) {
                map.fitBounds([[hit.bbox.south, hit.bbox.west], [hit.bbox.north, hit.bbox.east]]);
              } else {
                map.setView([hit.lat, hit.lng], 15);
              }
            },
          }, [el('strong', {}, hit.name), el('span', {}, hit.label)])
        );
      }
    } catch (err) {
      fail(err);
    }
  };

  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
  document.getElementById('geo-go').addEventListener('click', runSearch);
  document.addEventListener('click', (e) => {
    if (!results.contains(e.target) && e.target !== searchInput) results.hidden = true;
  });

  const scanBtn = document.getElementById('scan');
  scanBtn.addEventListener('click', async () => {
    const b = map.getBounds();
    scanBtn.disabled = true;
    scanBtn.textContent = 'Suche läuft …';
    scanBegin('Bereich wird durchsucht', 'Anfrage wird gestellt …');
    try {
      const res = await post('/discover', {
        south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast(),
      });
      await refresh();
      scanEnd(
        `${res.found} gefunden · ${res.inserted} neu · ${res.updated} ergänzt · ` +
        `${res.skipped} unverändert`
      );
    } catch (err) {
      scanEnd(err.message, { fehler: true });
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Diesen Bereich durchsuchen';
    }
  });

  // Tiefen-Scan: derselbe Filter wie die Karte, plus der Ausschnitt, den man
  // gerade sieht. Was nicht im Bild ist, wird auch nicht analysiert - sonst
  // reiht ein Klick versehentlich den halben Kanton ein.
  document.getElementById('deep-scan').addEventListener('click', async () => {
    const filter = Object.fromEntries(new URLSearchParams(state.filter));
    delete filter.nurAusschnitt;
    filter.bbox = bboxParam();

    // Fuer den ganzen Ausschnitt der Schnell-Check: er beantwortet genau die
    // Fragen, die den Score bewegen. Die volle Analyse startest du gezielt
    // bei den Laeden, die dabei oben landen.
    const bericht = await startBatch('schnell', filter);
    if (bericht?.ids?.length) {
      trackBatch(bericht.ids, `${bericht.ids.length} Betriebe werden bewertet`);
    }
  });

  // Web-Check ueber denselben Ausschnitt. Anders als der Tiefen-Scan laeuft
  // er ohne Agenten: nichts wird geraten, nur abgerufen - dafuer beantwortet
  // er auch nur die messbaren Fragen.
  document.getElementById('daten-sammeln').addEventListener('click', async () => {
    const filter = Object.fromEntries(new URLSearchParams(state.filter));
    delete filter.nurAusschnitt;
    filter.bbox = bboxParam();
    await startAnreicherung(filter);
  });

  const addBtn = document.getElementById('add-pin');
  addBtn.addEventListener('click', () => {
    addMode = !addMode;
    addBtn.classList.toggle('primary', addMode);
    document.getElementById('map').style.cursor = addMode ? 'crosshair' : '';
    if (addMode) toast('Klicke auf die Karte, um einen Betrieb zu setzen');
  });

  document.getElementById('menu')?.addEventListener('click', () => {
    document.querySelector('.sidebar').classList.toggle('open');
  });
}

async function createManual(latlng) {
  const name = prompt('Name des Betriebs:');
  if (!name) return;
  try {
    const venue = await post('/venues', {
      name, lat: latlng.lat, lng: latlng.lng, source: 'manuell', venue_type: 'Restaurant',
    });
    toast('Angelegt');
    await refresh();
    select(venue.id);
    showVenue(venue);
  } catch (err) {
    fail(err);
  } finally {
    addMode = false;
    document.getElementById('add-pin').classList.remove('primary');
    document.getElementById('map').style.cursor = '';
  }
}

// Von der Liste aus verlinkt: ?fokus=<id> zentriert und oeffnet den Betrieb.
on('venues', () => {
  const focus = Number(new URLSearchParams(location.search).get('fokus'));
  if (!focus) return;
  const venue = state.venues.find((v) => v.id === focus);
  if (!venue) return;
  map.setView([venue.lat, venue.lng], Math.max(map.getZoom(), 17));
  select(venue.id);
  oeffnen(venue.id);
  const url = new URL(location.href);
  url.searchParams.delete('fokus');
  history.replaceState(null, '', url);
});
