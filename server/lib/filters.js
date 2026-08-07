// Baut aus den Query-Parametern der Oberflaeche eine SQL-WHERE-Klausel.
// Karte, Liste und CSV-Export nutzen alle dieselbe Funktion, damit die
// exportierte Datei garantiert genau das enthaelt, was du auf dem
// Bildschirm siehst.

const SORTS = {
  score_desc: 'score DESC, review_count DESC NULLS LAST',
  score_asc: 'score ASC',
  name: 'name COLLATE NOCASE ASC',
  city: 'city COLLATE NOCASE ASC, name COLLATE NOCASE ASC',
  updated: 'updated_at DESC',
  created: 'created_at DESC',
  contact: 'last_contact_at DESC NULLS LAST',
};

const csv = (value) =>
  String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function buildVenueQuery(q = {}) {
  const where = [];
  const params = {};

  if (q.bbox) {
    const [south, west, north, east] = String(q.bbox).split(',').map(Number);
    if ([south, west, north, east].every(Number.isFinite)) {
      where.push('lat BETWEEN @south AND @north AND lng BETWEEN @west AND @east');
      Object.assign(params, { south, west, north, east });
    }
  }

  const listFilter = (key, column) => {
    const values = csv(q[key]);
    if (!values.length) return;
    const names = values.map((v, i) => {
      params[`${column}_${i}`] = v;
      return `@${column}_${i}`;
    });
    where.push(`${column} IN (${names.join(', ')})`);
  };

  listFilter('status', 'status');
  listFilter('websiteStatus', 'website_status');
  listFilter('instagramStatus', 'instagram_status');
  listFilter('venueType', 'venue_type');
  listFilter('city', 'city');

  if (q.minScore != null && q.minScore !== '') {
    where.push('score >= @minScore');
    params.minScore = Number(q.minScore);
  }
  if (q.maxScore != null && q.maxScore !== '') {
    where.push('score <= @maxScore');
    params.maxScore = Number(q.maxScore);
  }

  if (q.verified === '1') where.push('verified = 1');
  if (q.verified === '0') where.push('verified = 0');

  if (q.hasDemo === '1') where.push("demo_path IS NOT NULL AND demo_path <> ''");
  if (q.hasDemo === '0') where.push("(demo_path IS NULL OR demo_path = '')");

  if (q.hasWebsite === '1') where.push("website IS NOT NULL AND website <> ''");
  if (q.hasWebsite === '0') where.push("(website IS NULL OR website = '')");

  if (q.hasInstagram === '1') where.push("instagram IS NOT NULL AND instagram <> ''");

  if (q.includeClosed !== '1') where.push('permanently_closed = 0');

  // "Nachfassen faellig": kontaktiert, aber seit N Tagen nichts gehoert.
  if (q.kontaktVorTagen) {
    where.push(
      "(last_contact_at IS NOT NULL AND last_contact_at <= datetime('now', @kontaktOffset))"
    );
    params.kontaktOffset = `-${Number(q.kontaktVorTagen) || 14} days`;
  }

  if (q.q) {
    where.push(
      '(name LIKE @suche OR city LIKE @suche OR street LIKE @suche OR notes LIKE @suche OR cuisine LIKE @suche)'
    );
    params.suche = `%${q.q}%`;
  }

  return {
    sql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
    orderBy: SORTS[q.sort] || SORTS.score_desc,
    limit: Math.min(Number(q.limit) || 2000, 20_000),
    offset: Number(q.offset) || 0,
  };
}
