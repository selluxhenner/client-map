// Die Demo-Ordner auf der Platte: finden, Betrieben zuordnen, neue anlegen.
//
// Zwei Wurzeln, weil die Arbeit historisch an zwei Orten liegt: die neueren
// Demos in 03_Demos, die aelteren Projekte direkt im Auftragsordner. Neue
// Demos entstehen immer in der ersten Wurzel.
//
// Wichtigste Entscheidung hier: die Zuordnung Ordner -> Betrieb wird nur
// VORGESCHLAGEN, nie automatisch angewendet. "Street Art" und "art-wil"
// koennten derselbe Laden sein oder zwei verschiedene - das kann nur Kevin
// entscheiden, und ein falscher Treffer wuerde einen Pipeline-Status
// verfaelschen.

import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { slugify, kennWorte, fastGleich } from './text.js';
import { getVenue, updateVenue } from './venue-store.js';

/**
 * Pipeline-Status, die ein Demo-Bau weiterstellen darf.
 *
 * 'interessiert' gehoert ausdruecklich dazu: das ist der Status, den Kevin
 * setzt, weil er genau diese Demo bauen will. Wird sie fertig, ist der
 * naechste Schritt 'demo_gebaut'. Weiter hinten in der Pipeline (kontaktiert,
 * im Gespraech, Kunde) bleibt der Status stehen - eine zweite Demo fuer einen
 * bestehenden Kunden wirft ihn nicht zurueck.
 */
const UEBERSCHREIBBAR = new Set(['neu', 'recherchiert', 'interessiert']);

/** Wohin neue Demos gebaut werden. Aus PLAN §1; per .env uebersteuerbar. */
export function demoRoot() {
  return process.env.DEMO_DIR || 'D:\\03 Business\\Aufträge\\03_Demos';
}

/**
 * Wo nach bestehender Arbeit gesucht wird. Standard: der Demo-Ordner und der
 * Ordner darueber, in dem die aelteren Projekte liegen.
 */
export function scanRoots() {
  const root = demoRoot();
  const aus = process.env.DEMO_SCAN_DIRS;
  const liste = aus
    ? aus.split(';').map((p) => p.trim()).filter(Boolean)
    : [root, dirname(root)];
  // Das Bauziel gehoert immer dazu, auch wenn jemand DEMO_SCAN_DIRS setzt -
  // sonst findet die App die Demos nicht, die sie selbst gebaut hat.
  return [...new Set([root, ...liste])];
}

/**
 * Sucht zu einem nicht existierenden Pfad die Variante, die es wirklich gibt -
 * "Auftraege" gegen "Aufträge" und umgekehrt.
 *
 * Der Grund für diese Funktion ist ein echter Vorfall: in der .env stand die
 * ausgeschriebene Form, im Code die mit Umlaut. Beide Pfade sehen im Terminal
 * fast gleich aus, und die Fehlermeldung "Ordner existiert nicht" hilft dann
 * genau nicht weiter.
 */
export function umlautVariante(pfad) {
  const paare = [['ae', 'ä'], ['oe', 'ö'], ['ue', 'ü'], ['ss', 'ß']];
  const kandidaten = new Set();

  for (const [lang, kurz] of paare) {
    kandidaten.add(pfad.split(lang).join(kurz));
    kandidaten.add(pfad.split(kurz).join(lang));
  }
  // Auch alle zusammen, falls mehrere Umlaute im Pfad stecken.
  let alle = pfad;
  let umgekehrt = pfad;
  for (const [lang, kurz] of paare) {
    alle = alle.split(lang).join(kurz);
    umgekehrt = umgekehrt.split(kurz).join(lang);
  }
  kandidaten.add(alle);
  kandidaten.add(umgekehrt);

  for (const kandidat of kandidaten) {
    if (kandidat !== pfad && existsSync(kandidat)) return kandidat;
  }
  return null;
}

/** Ordner, die nie ein Kundenprojekt sind. */
const UEBERGEHEN = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'temp', 'tmp',
  '01_angebote', '02_rechnungen', '03_demos', 'dokumente', 'archiv', 'vorlagen',
]);

/**
 * Wohin die Analyse aus der Client-Map kommt.
 *
 * Bewusst nicht `research.md`: das ist der Arbeitsname des Skills, und der
 * ueberschreibt ihn in Phase 1.
 */
export const RECHERCHE_DATEI = 'recherche-clientmap.md';

/** Dateien und Ordner, die einen Ordner als gebaute Website ausweisen. */
const SEITEN_SPUREN = ['package.json', 'index.html', 'app', 'src', 'components'];

// --- Lesen ------------------------------------------------------------------

export function listDemoFolders() {
  const gefunden = [];

  for (const wurzel of scanRoots()) {
    if (!existsSync(wurzel)) continue;

    for (const eintrag of readdirSync(wurzel, { withFileTypes: true })) {
      if (!eintrag.isDirectory()) continue;
      const name = eintrag.name;
      if (name.startsWith('.') || name.startsWith('_')) continue;
      if (UEBERGEHEN.has(name.toLowerCase())) continue;

      const pfad = join(wurzel, name);
      // Derselbe Ordnername kann in beiden Wurzeln liegen (tiger-redesign).
      // Der aus der ersten Wurzel gewinnt, die zweite wird als Zweitfundort
      // vermerkt statt zu verschwinden.
      const schonDa = gefunden.find((f) => f.name === name);
      if (schonDa) {
        schonDa.auchIn = wurzel;
        continue;
      }

      gefunden.push({
        name,
        wurzel,
        pfad,
        geaendert: safeMtime(pfad),
        hatSeite: SEITEN_SPUREN.some((spur) => existsSync(join(pfad, spur))),
        hatRecherche: existsSync(join(pfad, 'research.md')),
      });
    }
  }

  return gefunden.sort((a, b) => (b.geaendert || '').localeCompare(a.geaendert || ''));
}

function safeMtime(pfad) {
  try {
    return statSync(pfad).mtime.toISOString().slice(0, 19).replace('T', ' ');
  } catch {
    return null;
  }
}

// --- Zuordnen ---------------------------------------------------------------

/**
 * Wie gut passt ein Ordnername zu einem Betrieb? 0 bis etwa 1.
 *
 * Grundlage sind die bedeutungstragenden Wortteile: "tiger-wil-website" wird
 * zu ["tiger"], weil "wil" der Ort und "website" ein Fuellwort ist. Der Ort
 * zaehlt separat als Bonus - er bestaetigt einen Treffer, begruendet aber
 * keinen.
 */
/**
 * Alle Ortsnamen, die in den Daten vorkommen. Aus der Datenbank abgeleitet
 * statt festgeschrieben - damit funktioniert es auch, wenn Kevin morgen im
 * Thurgau sucht.
 */
export function knownPlaces(venues) {
  const orte = new Set();
  for (const v of venues) for (const wort of kennWorte(v.city || '')) orte.add(wort);
  return orte;
}

export function matchScore(ordnerName, venue, orte = null) {
  // Ortsnamen werden aus dem Wortvergleich herausgenommen. Sonst gilt jeder
  // Laden in Wil als Treffer fuer "vision_wil", nur weil beide "wil"
  // enthalten - und "Pizza Time Wil" auch dann, wenn bei ihm kein Ort
  // eingetragen ist.
  const ortWorte = new Set(kennWorte(venue.city || ''));
  const ohneOrt = (worte) => worte.filter((w) => !ortWorte.has(w) && !orte?.has(w));

  const links = ohneOrt(kennWorte(ordnerName));
  const rechts = ohneOrt(kennWorte(venue.name));
  if (!links.length || !rechts.length) return 0;

  // Ein genauer Treffer zaehlt mehr als ein fast-Treffer. Ohne diese
  // Unterscheidung stehen "Tiger" und "Café Giger" gleichauf - ein Buchstabe
  // Unterschied, und der falsche steht oben in der Auswahl.
  let gewicht = 0;
  let treffer = 0;
  for (const wort of rechts) {
    if (links.includes(wort)) { gewicht += 1; treffer += 1; }
    else if (links.some((l) => fastGleich(l, wort))) { gewicht += 0.75; treffer += 1; }
  }
  if (!treffer) return 0;

  let score = gewicht / Math.min(links.length, rechts.length);

  // Wortstellung traegt Bedeutung: "barcelona-central" faengt mit Barcelona an.
  if (links[0] === rechts[0]) score += 0.05;

  const ordnerAlle = slugify(ordnerName, 120).split('-');
  if (ortWorte.size && [...ortWorte].some((o) => ordnerAlle.includes(o))) score += 0.15;

  return Math.min(1, Math.round(score * 100) / 100);
}

/** Die plausibelsten Betriebe zu einem Ordner, bester zuerst. */
export function candidatesFor(ordnerName, venues, max = 4) {
  const orte = knownPlaces(venues);
  return venues
    .map((v) => ({
      venue_id: v.id, name: v.name, city: v.city, status: v.status,
      score: matchScore(ordnerName, v, orte),
    }))
    .filter((k) => k.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

// --- Schreiben --------------------------------------------------------------

/** Ordnername fuer eine neue Demo. Stabil, damit ein zweiter Lauf denselben trifft. */
export function demoSlug(venue) {
  return slugify([venue.name, venue.city].filter(Boolean).join('-')) || `betrieb-${venue.id}`;
}

export function demoPathFor(venue) {
  return join(demoRoot(), demoSlug(venue));
}

/**
 * Bereitet den Ordner fuer einen Bau-Auftrag vor.
 *
 * Zwei Dinge landen darin, bevor der Agent startet:
 *
 * 1. `research.md` aus unserer Analyse - der Skill liest in Phase 1 genau
 *    diese Datei, die Recherche ist damit schon erledigt.
 * 2. `_referenz/` mit dem Quelltext eines fertigen Projekts. Der Skill soll
 *    die Konventionen bestehender Seiten uebernehmen; ohne diese Kopie
 *    braeuchte er Schreibrechte im ganzen Auftragsordner - und dort liegen
 *    Kundenprojekte ohne Git-Sicherung. Die Kopie kostet 50 KB und macht das
 *    unnoetig.
 */
export function prepareDemoFolder(venue, rechercheText) {
  // Erst pruefen, ob das Bauziel ueberhaupt existiert.
  //
  // Ohne diese Zeile legt mkdirSync mit `recursive` den ganzen Pfad an - und
  // ein Tippfehler in DEMO_DIR erzeugt still einen zweiten Auftragsordner
  // neben dem echten. Genau das ist passiert: "Auftraege" statt "Aufträge",
  // und eine Demo landete eine Stunde lang im falschen Baum, ohne dass es
  // irgendwo aufgefallen waere. Ein klar gescheiterter Auftrag ist besser als
  // ein erfolgreicher am falschen Ort.
  const wurzel = demoRoot();
  if (!existsSync(wurzel)) {
    const gemeint = umlautVariante(wurzel);
    throw new Error(
      `Der Demo-Ordner "${wurzel}" existiert nicht. ` +
      (gemeint ? `Gemeint war wohl "${gemeint}". ` : '') +
      'Bitte DEMO_DIR in der .env prüfen (Umlaute exakt schreiben) oder den Ordner anlegen. ' +
      'Es wird bewusst kein neuer Ordnerbaum erzeugt.'
    );
  }

  const ziel = demoPathFor(venue);
  mkdirSync(ziel, { recursive: true });

  // NICHT als research.md ablegen: diesen Namen besitzt der Skill selbst
  // ("Write findings to research.md in the project folder") und ueberschreibt
  // ihn in Phase 1, bevor er hineinsieht. In den ersten beiden echten Laeufen
  // hat der Agent unsere Datei genau so weggeworfen und die Recherche mit 26
  // WebFetch-Aufrufen auf Opus wiederholt. Ein eigener Name kostet nichts und
  // kann nicht kollidieren.
  if (rechercheText) {
    writeFileSync(join(ziel, RECHERCHE_DATEI), rechercheText, 'utf8');
  }

  const referenz = copyReference(ziel, venue);
  return { pfad: ziel, ordner: demoSlug(venue), referenz };
}

/**
 * Rekursiv kopieren, von Hand.
 *
 * Nicht mit fs.cpSync: das stuerzt auf dieser Node-Version unter Windows bei
 * rekursiven Ordnern hart ab (0xC0000409), und weil build() synchron in der
 * Auftragsschlange laeuft, wuerde das den ganzen Server mitnehmen. Von Hand
 * ist ausserdem klar, was mitkommt: keine Verknuepfungen, keine Riesendateien.
 */
function copyTree(von, nach, budget = { dateien: 400 }) {
  const info = lstatSync(von);
  if (info.isSymbolicLink()) return;

  if (info.isFile()) {
    if (budget.dateien <= 0 || info.size > 512 * 1024) return;
    mkdirSync(dirname(nach), { recursive: true });
    copyFileSync(von, nach);
    budget.dateien -= 1;
    return;
  }

  if (!info.isDirectory()) return;
  mkdirSync(nach, { recursive: true });
  for (const eintrag of readdirSync(von)) {
    if (eintrag === 'node_modules' || eintrag.startsWith('.')) continue;
    if (budget.dateien <= 0) return;
    copyTree(join(von, eintrag), join(nach, eintrag), budget);
  }
}

/** Kopiert ein bestehendes Projekt als Vorbild - nur Quelltext, kein Ballast. */
function copyReference(ziel, venue) {
  const quelle = referenceProject(venue);
  if (!quelle) return null;

  const nur = ['app', 'components', 'lib', 'styles', 'package.json', 'tailwind.config.ts',
               'tailwind.config.js', 'postcss.config.mjs', 'tsconfig.json', 'components.json'];
  const nach = join(ziel, '_referenz', quelle.name);
  const budget = { dateien: 400 };

  let etwas = false;
  for (const teil of nur) {
    const von = join(quelle.pfad, teil);
    if (!existsSync(von)) continue;
    try {
      copyTree(von, join(nach, teil), budget);
      etwas = true;
    } catch (err) {
      console.warn(`[demos] Referenz ${teil} nicht kopiert: ${err.message}`);
    }
  }
  return etwas ? quelle.name : null;
}

/** Das jüngste fertige Projekt, das nicht der Betrieb selbst ist. */
function referenceProject(venue) {
  const gewuenscht = process.env.DEMO_REFERENCE;
  const alle = listDemoFolders().filter((f) => f.hatSeite && f.name !== demoSlug(venue));
  if (gewuenscht) return alle.find((f) => f.name === gewuenscht) || alle[0] || null;
  return alle[0] || null;
}

/** Nach dem Bau: Vorbild wieder weg, es gehoert nicht zur Demo. */
export function cleanupReference(pfad) {
  const referenz = join(pfad, '_referenz');
  if (!existsSync(referenz)) return false;
  rmSync(referenz, { recursive: true, force: true });
  return true;
}

/**
 * Hilfsskripte auf der obersten Ebene des Demo-Ordners.
 *
 * Im ersten echten Lauf lag ein `_extract.py` in der fertigen Demo - der Agent
 * hatte es geschrieben, um Bilder aus HTML zu ziehen. Harmlos, aber es gehoert
 * nicht in etwas, das ein Kunde sieht.
 */
function uebrigeHelfer(pfad) {
  const verdaechtig = /\.(py|ps1|sh|bat|cmd)$/i;
  try {
    return readdirSync(pfad, { withFileTypes: true })
      .filter((e) => e.isFile() && verdaechtig.test(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Ist in diesem Ordner tatsaechlich eine Seite entstanden? */
export function looksBuilt(pfad) {
  if (!existsSync(pfad)) return false;
  return SEITEN_SPUREN.some((spur) => existsSync(join(pfad, spur)));
}

/**
 * Nach einem Bau-Auftrag: aufraeumen, pruefen, eintragen.
 *
 * Wirft, wenn im Ordner keine Seite steht. Ein Agent, der eine Stunde auf
 * Opus gelaufen ist und nichts hinterlassen hat, darf den Pin nicht violett
 * faerben - sonst zaehlt die Karte Demos, die es nicht gibt.
 */
export function finishDemo(venueId) {
  const venue = getVenue(venueId);
  if (!venue) throw new Error('Betrieb existiert nicht mehr');

  const pfad = demoPathFor(venue);
  const warnungen = [];

  if (cleanupReference(pfad)) warnungen.push('Vorbild-Ordner _referenz entfernt.');

  if (!looksBuilt(pfad)) {
    throw new Error(
      `Im Ordner "${demoSlug(venue)}" ist keine Seite entstanden ` +
      '(keine package.json, kein index.html, kein Quelltext). Log ansehen.'
    );
  }

  if (!existsSync(join(pfad, 'handover.md'))) {
    warnungen.push('Kein handover.md geschrieben — Rechtelage der Bilder ungeklärt.');
  }

  // Hilfsskripte, die der Agent unterwegs geschrieben hat, gehoeren nicht in
  // eine Kundendemo. Sie werden gemeldet und nicht geloescht: was er gebaut
  // hat, entscheidet er - was mitgeliefert wird, entscheidest du.
  const reste = uebrigeHelfer(pfad);
  if (reste.length) {
    warnungen.push(`Hilfsdateien im Ordner, die nicht zur Demo gehören: ${reste.join(', ')}`);
  }

  const patch = { demo_path: demoSlug(venue) };
  if (UEBERSCHREIBBAR.has(venue.status)) patch.status = 'demo_gebaut';

  return { venue: updateVenue(venue.id, patch), warnungen };
}

/**
 * Loest einen gespeicherten Ordnernamen zu einem Pfad auf - und nur, wenn er
 * wirklich unter einer der Wurzeln liegt. Sonst koennte ein Eintrag in der
 * Spalte demo_path den Server dazu bringen, irgendeinen Ordner zu oeffnen.
 */
export function resolveDemoPath(gespeichert) {
  if (!gespeichert) return null;

  // "C:\a" darf nicht auch "C:\abc" freigeben - deshalb bis zum Trennzeichen
  // vergleichen und nicht blosses startsWith.
  const drin = (pfad, wurzel) => {
    const w = resolve(wurzel);
    return pfad === w || pfad.startsWith(w + sep);
  };

  for (const wurzel of scanRoots()) {
    const kandidat = resolve(wurzel, gespeichert);
    if (drin(kandidat, wurzel) && existsSync(kandidat)) return kandidat;
  }

  // Aeltere Eintraege koennen ein absoluter Pfad sein.
  const direkt = resolve(gespeichert);
  const erlaubt = scanRoots().some((w) => drin(direkt, w));
  return erlaubt && existsSync(direkt) ? direkt : null;
}
