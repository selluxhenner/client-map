// Textwerkzeug, das an mehreren Stellen gebraucht wird: Dateinamen aus
// Betriebsnamen und der Vergleich "ist das derselbe Laden".

const KOMBI_VON = 0x0300;
const KOMBI_BIS = 0x036f;

/**
 * "Café Rössli" -> "Cafe Roessli". Umlaute werden ausgeschrieben (nicht zu
 * "Rossli" verkuerzt), alle uebrigen Akzente ueber die Zerlegung entfernt.
 * Ohne Escape-Sequenzen im Quelltext, damit die Datei in jedem Editor gleich
 * aussieht.
 */
export function ohneAkzente(value) {
  return [...String(value ?? '')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')]
    .filter((zeichen) => {
      const code = zeichen.codePointAt(0);
      return code < KOMBI_VON || code > KOMBI_BIS;
    })
    .join('');
}

/** Kleinbuchstaben, Bindestriche, sonst nichts. */
export function slugify(value, maxLen = 60) {
  return ohneAkzente(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
}

/**
 * Woerter, die in Ordner- und Betriebsnamen vorkommen, ohne etwas zu
 * unterscheiden. "tiger-wil-website" und "resti-tiger" sollen beide auf
 * "tiger" hinauslaufen.
 */
const FUELLWOERTER = new Set([
  'website', 'webseite', 'web', 'site', 'seite', 'redesign', 'relaunch', 'demo',
  'neu', 'new', 'alt', 'old', 'copy', 'kopie', 'test', 'final', 'v1', 'v2',
  'restaurant', 'resti', 'gasthaus', 'gasthof', 'hotel', 'bar', 'cafe', 'pub',
  'pizzeria', 'takeaway', 'imbiss', 'der', 'die', 'das', 'zum', 'zur', 'the',
]);

/** Bedeutungstragende Wortteile eines Namens. */
export function kennWorte(value) {
  return slugify(value, 120)
    .split('-')
    .filter((wort) => wort.length >= 3 && !FUELLWOERTER.has(wort));
}

/** Unterscheiden sich zwei Woerter um hoechstens einen Tippfehler? */
export function fastGleich(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5) return false;
  if (Math.abs(a.length - b.length) > 1) return false;

  // Einmal Ersetzen, Einfuegen oder Loeschen - mehr nicht. Das faengt
  // "kebab"/"kebap" und "roessli"/"rossli", ohne "sonne"/"sonnen" mit
  // beliebigen anderen Woertern zu verwechseln.
  let i = 0;
  let j = 0;
  let fehler = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    fehler += 1;
    if (fehler > 1) return false;
    if (a.length === b.length) { i += 1; j += 1; }
    else if (a.length > b.length) i += 1;
    else j += 1;
  }
  return fehler + (a.length - i) + (b.length - j) <= 1;
}
