// Sauberes Herunterfahren - an einer Stelle, weil es drei Auslöser gibt:
// Strg-C im Terminal, ein Tastendruck, und der Knopf in der Oberfläche.
//
// Warum das überhaupt Aufwand ist: unter Windows kommt Strg-C bei einem über
// `npm start` gestarteten Node-Prozess nicht zuverlässig an. Dazwischen liegt
// eine Batch-Datei, cmd fragt "Terminate batch job (Y/N)?", und je nachdem,
// wer zuerst stirbt, läuft der Server als Waise weiter - mitsamt seinen
// Agenten, die weiter Kontingent verbrauchen und Dateien schreiben.

import { stopAll } from '../jobs/queue.js';

let laeuftSchonAus = false;

/**
 * Beendet den Server und nimmt alle laufenden Agenten mit.
 *
 * @param {string} grund Wird ins Log geschrieben, damit man später sieht,
 *   ob jemand den Knopf gedrückt hat oder das Fenster zugegangen ist.
 */
export function herunterfahren(grund = 'unbekannt') {
  if (laeuftSchonAus) return 0;
  laeuftSchonAus = true;

  const beendet = stopAll();
  console.log(`\n  Beendet (${grund})${beendet ? ` — ${beendet} laufende Aufträge mitgenommen` : ''}\n`);

  // Kurz warten, damit eine offene HTTP-Antwort noch hinausgeht.
  setTimeout(() => process.exit(0), 150);
  return beendet;
}

export function faehrtHerunter() {
  return laeuftSchonAus;
}
