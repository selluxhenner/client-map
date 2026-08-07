// Ortssuche ueber Nominatim (OpenStreetMap). Gratis, aber hoeflich sein:
// max. 1 Anfrage pro Sekunde und ein aussagekraeftiger User-Agent.

import { userAgent } from './overpass.js';

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const MIN_INTERVAL_MS = 1100;
let lastCall = 0;

async function throttle() {
  const wait = lastCall + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

/** Sucht einen Ort und liefert Mittelpunkt plus Bounding-Box zurueck. */
export async function geocode(query, { countries = 'ch,de,at,li,fr,it' } = {}) {
  await throttle();

  const url = new URL(ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('addressdetails', '1');
  if (countries) url.searchParams.set('countrycodes', countries);

  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent(), 'Accept-Language': 'de' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status} ${res.statusText}`);

  const json = await res.json();
  return json.map((hit) => {
    // Nominatim liefert [south, north, west, east] als Strings.
    const [south, north, west, east] = (hit.boundingbox || []).map(Number);
    return {
      label: hit.display_name,
      name: hit.name || hit.display_name.split(',')[0],
      lat: Number(hit.lat),
      lng: Number(hit.lon),
      type: hit.type,
      bbox: Number.isFinite(south) ? { south, west, north, east } : null,
    };
  });
}
