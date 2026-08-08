// `npm run stop` — beendet einen laufenden Server von aussen.
//
// Gedacht für den Fall, dass das Terminal mit dem Server nicht mehr reagiert
// oder längst geschlossen ist, der Node-Prozess aber noch läuft und weiter
// Agenten beschäftigt. Bittet den Server über seine eigene Schnittstelle, sich
// zu beenden — dadurch nimmt er seine Agenten korrekt mit, anders als ein
// Abschuss über den Task-Manager.

import 'dotenv/config';

const port = Number(process.env.PORT) || 8788;
const host = process.env.HOST || '127.0.0.1';
const url = `http://${host}:${port}/api/wartung/beenden`;

try {
  const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(5000) });
  const text = await res.text();

  if (res.status === 404) {
    // Der laeuft noch mit Code von vor diesem Befehl. Genau die Lage, in der
    // man ihn loswerden will - deshalb hier gleich der Ausweg.
    console.log(
      `Der Server auf Port ${port} kennt "beenden" noch nicht — er läuft mit älterem Code.\n` +
      'Einmalig von Hand beenden, danach geht es mit diesem Befehl:\n' +
      '  Get-Process node | Where-Object { $_.CommandLine -match "server.index.js" } | Stop-Process\n' +
      'Laufende Agenten werden dabei zu Waisen; der nächste Serverstart räumt die Aufträge auf.'
    );
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`Der Server hat abgelehnt (${res.status}): ${text.slice(0, 200)}`);
    process.exit(1);
  }

  let daten;
  try {
    daten = JSON.parse(text);
  } catch {
    console.log('Der Server hat geantwortet, aber nicht wie erwartet:', text.slice(0, 200));
    process.exit(0);
  }

  console.log(daten.meldung || 'Server wird beendet.');
} catch (err) {
  // ECONNREFUSED heisst: da läuft nichts. Das ist keine Fehlermeldung wert,
  // sondern die Antwort auf die Frage.
  const nichtDa = /ECONNREFUSED|fetch failed|timeout/i.test(err.message);
  console.log(nichtDa
    ? `Auf http://${host}:${port} läuft kein Server (mehr).`
    : `Beenden fehlgeschlagen: ${err.message}`);
  process.exit(nichtDa ? 0 : 1);
}
