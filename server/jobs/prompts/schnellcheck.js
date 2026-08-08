// Der schnelle Bewertungslauf.
//
// Unterschied zur Analyse: hier geht es nicht darum, den Laden zu verstehen,
// sondern nur darum, den Score belastbar zu machen. Das sind genau zwei
// Fragen - eigene Website ja/nein/wie, und gibt es Instagram. Alles andere
// kostet Zeit, ohne einen einzigen Punkt zu bewegen.
//
// Deshalb: harte Obergrenze an Werkzeugaufrufen, keine Dateien, Antwort ist
// nur der JSON-Block. Zielzeit rund 30 Sekunden pro Betrieb.

export function schnellcheckPrompt(venue) {
  const ort = [venue.street, venue.zip, venue.city].filter(Boolean).join(', ') || 'Schweiz';
  const bekannt = venue.website
    ? `\nOpenStreetMap nennt diese Website (ungeprüft): ${venue.website} — prüf zuerst, ob sie überhaupt lebt.`
    : '';

  return `Kurzprüfung eines Gastro-Betriebs für eine Akquise-Karte. Arbeite schnell und knapp.

BETRIEB: ${venue.name}, ${ort}${bekannt}

ZWEI FRAGEN, mehr nicht:
1. Hat der Betrieb eine **eigene Website** — und in welchem Zustand ist sie?
2. Gibt es ein **Instagram-Profil**?

VORGEHEN
- Eine Suche nach "${venue.name} ${venue.city || ''}" beantwortet meistens beides auf einmal.
- Findest du eine Website: ruf sie **einmal** auf und beurteile Zustand und Mobiltauglichkeit.
- **Höchstens 4 Werkzeugaufrufe insgesamt.** Lieber "unbekannt" antworten als einen fünften machen.
- Schreib **keine Datei**.

REGELN
- Portale sind keine eigene Website: local.ch, search.ch, tripadvisor, lunchgate, eat.ch, Lieferdienste, Speisekarten-Portale.
- Ein Instagram- oder Facebook-Auftritt ist keine Website.
- "keine" nur, wenn du gesucht und nichts gefunden hast. Hast du gar nicht erst nachgesehen: "unbekannt".
- Instagram "aktiv" nur, wenn ein Beitrag aus den letzten 30 Tagen belegt ist. Handle gefunden, Aktivität unklar → "unbekannt".
- Nichts raten.

ANTWORT: ausschliesslich dieser JSON-Block, kein Text davor oder danach.

\`\`\`json
{
  "website": "https://… oder null",
  "website_status": "keine | kaputt | veraltet | ok | gut | unbekannt",
  "instagram": "handle ohne @ oder null",
  "instagram_status": "keiner | inaktiv | aktiv | unbekannt",
  "phone": "… oder null",
  "rating": null,
  "review_count": null,
  "is_chain": false,
  "permanently_closed": false,
  "zusammenfassung": "ein Satz: Website-Lage und was daraus für die Akquise folgt"
}
\`\`\`

Bedeutung von \`website_status\`: \`keine\` = keine eigene Seite · \`kaputt\` = nicht erreichbar, kein HTTPS oder auf dem Handy unbrauchbar · \`veraltet\` = läuft, sieht aber alt aus · \`ok\` = brauchbar · \`gut\` = modern und gepflegt.`;
}
