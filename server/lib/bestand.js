// Was vor der Karte schon passiert ist (PLAN §7b).
//
// Diese Liste ist Handwissen: welcher Ordner zu welchem Betrieb gehoert und
// wie weit die Beziehung ist. Sie wird nicht automatisch angewendet - die
// Abgleich-Seite schlaegt sie vor, uebernommen wird auf Klick. Sonst wuerde
// eine Namensverwechslung einen echten Kunden auf 'abgelehnt' setzen.

export const BESTAND = [
  { name: 'Tiger',                city: 'Wil', status: 'kunde',        ordner: ['tiger-wil-website', 'tiger-redesign', 'resti-tiger'] },
  { name: 'Vision',               city: 'Wil', status: 'kunde',        ordner: ['vision_wil'] },
  { name: 'Trinkstube zum Hartz', city: null,  status: 'pausiert',     ordner: ['Trinkstube zum Hartz'] },
  { name: 'Säntis Kebab',         city: 'Wil', status: 'in_gespraech', ordner: ['saentis-kebab'] },
  { name: 'Barcelona Central',    city: null,  status: 'in_gespraech', ordner: ['barcelona-central'] },
  { name: 'Goldenes Rössli',      city: 'Wil', status: 'abgelehnt',    ordner: ['goldenes-roessli-wil'] },
  { name: 'Art(s)',               city: 'Wil', status: 'abgelehnt',    ordner: ['art-wil', 'Street Art'] },
];

/** Kein Gastro-Betrieb — gehoert nicht auf die Karte. */
export const NICHT_GASTRO = [
  'dj-ostschweiz', 'djhappytunes', 'Sellux', 'Lernapp', 'Twitter_copy',
];

/** PLAN §9 F1: Zugehoerigkeit und Status noch offen. */
export const UNGEKLAERT = [
  'loewen-pub', 'rebstock', 'vibes-wil', 'Ilge-pianobar',
];

const kleiner = (s) => String(s).toLowerCase();

/** Was die Liste ueber einen Ordner weiss. */
export function bestandFor(ordnerName) {
  const name = kleiner(ordnerName);

  const eintrag = BESTAND.find((b) => b.ordner.some((o) => kleiner(o) === name));
  if (eintrag) {
    return {
      art: 'bekannt',
      name: eintrag.name,
      city: eintrag.city,
      status: eintrag.status,
      notiz: `Laut PLAN §7b: ${eintrag.name}${eintrag.city ? `, ${eintrag.city}` : ''} — Status ${eintrag.status}.`,
    };
  }
  if (NICHT_GASTRO.some((o) => kleiner(o) === name)) {
    return { art: 'nicht_gastro', notiz: 'Kein Gastro-Betrieb — gehört nicht auf die Karte.' };
  }
  if (UNGEKLAERT.some((o) => kleiner(o) === name)) {
    return { art: 'ungeklaert', notiz: 'PLAN §9 F1: noch ungeklärt, ob und zu welchem Betrieb das gehört.' };
  }
  return { art: 'unbekannt', notiz: null };
}
