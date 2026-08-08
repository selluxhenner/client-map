import { el, clear, get, post, toast, fail, isLight, debounce } from './api.js';
import {
  state, loadConfig, loadVenues, on, filterValue, select, scoreBandFor,
} from './state.js';
import { renderFilters } from './filters.js';
import { initDetail, showVenue } from './detail.js';
import { initJobs } from './jobs.js';

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
  }).addTo(map);

  initDetail(document.getElementById('detail'), { onVenueChange: onVenueChanged });
  renderFilters(document.getElementById('filters'), { showBboxToggle: true });
  wireTopbar();
  initJobs().catch(fail);

  on('filter', () => refresh());
  on('venues', () => { drawMarkers(); drawStats(); });
  on('selection', (id) => highlight(id));

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

async function refresh() {
  try {
    await loadVenues({ bbox: filterValue('nurAusschnitt') === '1' ? bboxParam() : '' });
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
      showVenue(v);
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
    try {
      const res = await post('/discover', {
        south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast(),
      });
      toast(`${res.found} gefunden · ${res.inserted} neu · ${res.updated} ergänzt`);
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Diesen Bereich durchsuchen';
    }
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
  showVenue(venue);
  const url = new URL(location.href);
  url.searchParams.delete('fokus');
  history.replaceState(null, '', url);
});
