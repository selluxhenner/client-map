// Google-Places-Adapter. Aktuell AUS.
//
// Sobald GOOGLE_PLACES_KEY in der .env steht, liefert dieser Adapter
// zusaetzlich Bewertungen, Bewertungsanzahl und verifizierte Website-URLs -
// also genau die Signale, die den Score belastbar machen, ohne dass Claude
// jeden Laden einzeln recherchieren muss.
//
// Die Schnittstelle ist absichtlich identisch zu overpass.js, damit das
// Einschalten eine Konfigurationsaenderung bleibt und kein Umbau.

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';

/** Was Google pro Anfrage höchstens zurückgibt. Harte Grenze der API. */
const MAX_PRO_ANFRAGE = 20;

/**
 * Aktiv nur mit Schluessel - und abschaltbar, ohne ihn wieder herauszunehmen.
 * GOOGLE_ENABLED=0 ist die Bremse fuer den Fall, dass die Rechnung laeuft
 * und man erst schauen will.
 */
export function isEnabled() {
  if (process.env.GOOGLE_ENABLED === '0') return false;
  return Boolean(process.env.GOOGLE_PLACES_KEY);
}

/** Was die Oberfläche über den Adapter sagen soll, ohne den Schlüssel zu zeigen. */
export function adapterInfo() {
  const key = process.env.GOOGLE_PLACES_KEY || '';
  return {
    schluesselHinterlegt: Boolean(key),
    abgeschaltet: process.env.GOOGLE_ENABLED === '0',
    maxProAnfrage: MAX_PRO_ANFRAGE,
    hinweis: key
      ? 'Google liefert höchstens 20 Treffer je Ausschnitt. Bei mehr wird gemeldet, dass gekappt wurde — dann kleinere Ausschnitte suchen.'
      : 'Ohne GOOGLE_PLACES_KEY vollständig inaktiv. Die Karte läuft dann nur auf OpenStreetMap.',
  };
}

const FIELDS = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.formattedAddress',
  'places.primaryType',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.regularOpeningHours.weekdayDescriptions',
].join(',');

const TYPES = ['restaurant', 'bar', 'cafe', 'pub', 'fast_food_restaurant'];

const TYPE_LABEL = {
  restaurant: 'Restaurant',
  bar: 'Bar',
  cafe: 'Café',
  pub: 'Pub',
  fast_food_restaurant: 'Schnellimbiss',
};

/** Sucht Betriebe im Umkreis. bbox wird in Mittelpunkt + Radius uebersetzt. */
export async function fetchVenues({ south, west, north, east }) {
  if (!isEnabled()) return [];

  const lat = (south + north) / 2;
  const lng = (west + east) / 2;
  const radius = Math.min(50_000, haversine(south, west, north, east) / 2);

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_KEY,
      'X-Goog-FieldMask': FIELDS,
    },
    body: JSON.stringify({
      includedTypes: TYPES,
      maxResultCount: MAX_PRO_ANFRAGE,
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
      languageCode: 'de',
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`Google Places ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const gefunden = json.places || [];

  const betriebe = gefunden.map((p) => ({
    source: 'google',
    source_id: p.id,
    name: p.displayName?.text ?? 'Unbenannt',
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    venue_type: TYPE_LABEL[p.primaryType] || p.primaryType || null,
    street: p.formattedAddress || null,
    phone: p.nationalPhoneNumber || null,
    website: p.websiteUri || null,
    // Google kennt die Website zuverlaessig - fehlt sie hier, ist "keine"
    // eine echte Aussage und keine Datenluecke.
    website_status: p.websiteUri ? 'ok' : 'keine',
    instagram_status: 'unbekannt',
    rating: p.rating ?? null,
    review_count: p.userRatingCount ?? null,
    opening_hours: p.regularOpeningHours?.weekdayDescriptions?.join('\n') || null,
    permanently_closed: p.businessStatus === 'CLOSED_PERMANENTLY' ? 1 : 0,
    is_chain: 0,
    verified: 1,
  }));

  // Genau 20 Treffer heisst fast immer: es gab mehr, Google hat abgeschnitten.
  // Das muss auffallen, sonst haelt man einen halben Ausschnitt fuer
  // vollstaendig und wundert sich spaeter ueber fehlende Laeden. Als Eigenschaft
  // am Array, damit die Schnittstelle identisch zu overpass.js bleibt.
  betriebe.gekappt = gefunden.length >= MAX_PRO_ANFRAGE;
  if (betriebe.gekappt) {
    console.warn(
      `[google] ${gefunden.length} Treffer — Obergrenze pro Anfrage erreicht. ` +
      'Der Ausschnitt enthält vermutlich mehr Betriebe; kleiner suchen.'
    );
  }

  return betriebe;
}

function haversine(south, west, north, east) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(north - south);
  const dLng = toRad(east - west);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(south)) * Math.cos(toRad(north)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
