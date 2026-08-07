// Discovery ueber Overpass (OpenStreetMap). Gratis, kein Key, kein Limit
// ausser Hoeflichkeit gegenueber dem oeffentlichen Server.
//
// Wichtig fuer die Interpretation: fehlt hier ein website-Tag, heisst das
// NICHT, dass der Laden keine Website hat - nur, dass OSM es nicht weiss.
// Deshalb landen solche Betriebe auf 'unbekannt' und nicht auf 'keine'.

const AMENITIES = ['restaurant', 'bar', 'cafe', 'pub', 'fast_food', 'biergarten', 'ice_cream'];

const TYPE_LABEL = {
  restaurant: 'Restaurant',
  bar: 'Bar',
  cafe: 'Café',
  pub: 'Pub',
  fast_food: 'Schnellimbiss',
  biergarten: 'Biergarten',
  ice_cream: 'Eisdiele',
};

const MIRRORS = [
  process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function buildQuery({ south, west, north, east }) {
  const bbox = `${south},${west},${north},${east}`;
  const filter = `^(${AMENITIES.join('|')})$`;
  return `[out:json][timeout:40];
(
  node["amenity"~"${filter}"](${bbox});
  way["amenity"~"${filter}"](${bbox});
  relation["amenity"~"${filter}"](${bbox});
);
out center tags;`;
}

/** Holt alle Gastro-Betriebe im Kartenausschnitt. */
export async function fetchVenues(bbox) {
  const body = new URLSearchParams({ data: buildQuery(bbox) });
  let lastError;

  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': userAgent(),
        },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status} ${res.statusText}`);
      const json = await res.json();
      return (json.elements || []).map(toVenue).filter(Boolean);
    } catch (err) {
      lastError = err;
      console.warn(`[overpass] ${url} fehlgeschlagen: ${err.message}`);
    }
  }
  throw new Error(`Overpass nicht erreichbar: ${lastError?.message ?? 'unbekannt'}`);
}

export function userAgent() {
  const contact = process.env.OSM_CONTACT || 'unknown';
  return `ServiWeb-ClientMap/0.1 (${contact})`;
}

function toVenue(el) {
  const t = el.tags || {};
  const name = t.name || t['name:de'] || t.brand || t.operator;
  if (!name) return null; // Namenlose Punkte sind als Lead wertlos.

  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) return null;

  const website = firstOf(t, ['website', 'contact:website', 'url', 'website:official']);
  const instagram = handleFrom(firstOf(t, ['contact:instagram', 'instagram']), 'instagram.com');

  return {
    source: 'osm',
    source_id: `${el.type}/${el.id}`,
    name,
    lat,
    lng,
    venue_type: TYPE_LABEL[t.amenity] || t.amenity || null,
    cuisine: t.cuisine ? t.cuisine.replace(/;/g, ', ') : null,
    street: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ') || null,
    zip: t['addr:postcode'] || null,
    city: normaliseCity(t['addr:city']),
    country: t['addr:country'] || 'CH',
    phone: normalisePhone(firstOf(t, ['phone', 'contact:phone', 'contact:mobile'])),
    email: firstOf(t, ['email', 'contact:email']),
    website: website || null,
    instagram,
    facebook: handleFrom(firstOf(t, ['contact:facebook', 'facebook']), 'facebook.com'),
    opening_hours: t.opening_hours || null,
    website_status: website ? 'ok' : 'unbekannt',
    instagram_status: instagram ? 'unbekannt' : 'unbekannt',
    is_chain: t.brand || t['brand:wikidata'] ? 1 : 0,
    permanently_closed: t['disused:amenity'] || t.disused === 'yes' ? 1 : 0,
  };
}

function firstOf(tags, keys) {
  for (const key of keys) if (tags[key]) return tags[key];
  return null;
}

/**
 * OSM schreibt denselben Ort mal "Wil (SG)", mal "Wil SG". Ohne
 * Vereinheitlichung stehen im Ortsfilter zwei Eintraege fuer dieselbe Stadt.
 * Bewusst konservativ: nur die Klammern um ein Kantonskuerzel fallen weg.
 */
function normaliseCity(value) {
  if (!value) return null;
  return value
    .trim()
    .replace(/\s*\(([A-Z]{2})\)\s*$/, ' $1')
    .replace(/\s+/g, ' ');
}

function normalisePhone(value) {
  if (!value) return null;
  return value.split(';')[0].trim();
}

/** Macht aus einer Profil-URL ein Handle, laesst blosse Handles in Ruhe. */
function handleFrom(value, host) {
  if (!value) return null;
  const raw = value.split(';')[0].trim();
  if (!raw) return null;
  if (!raw.includes('/')) return raw.replace(/^@/, '');
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (!url.hostname.includes(host.split('.')[0])) return raw;
    const handle = url.pathname.split('/').filter(Boolean)[0];
    return handle || null;
  } catch {
    return raw;
  }
}
