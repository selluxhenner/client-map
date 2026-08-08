// Der Recherche-Auftrag fuer einen einzelnen Betrieb.
//
// Der Prompt ist bewusst laenger als noetig: jede Regel darin ist eine, die
// sonst falsche Daten in die Karte schreibt. Die teuerste Verwechslung waere
// "kein Website-Eintrag gefunden" mit "hat keine Website" - das steht deshalb
// gleich dreimal drin.

import { analysisSlug } from '../../lib/analysis.js';

/** Was der Agent ueber den Betrieb schon weiss, bevor er sucht. */
function known(venue) {
  const lines = [
    `Name: ${venue.name}`,
    `Ort: ${[venue.street, venue.zip, venue.city].filter(Boolean).join(', ') || 'unbekannt'}`,
    `Koordinaten: ${venue.lat}, ${venue.lng}`,
    `Art laut OpenStreetMap: ${venue.venue_type || 'unbekannt'}${venue.cuisine ? ` (${venue.cuisine})` : ''}`,
  ];
  if (venue.website) lines.push(`Website laut OpenStreetMap (ungeprüft): ${venue.website}`);
  if (venue.phone) lines.push(`Telefon laut OpenStreetMap (ungeprüft): ${venue.phone}`);
  if (venue.instagram) lines.push(`Instagram laut OpenStreetMap (ungeprüft): ${venue.instagram}`);
  return lines.join('\n');
}

export function analysePrompt(venue) {
  const slug = analysisSlug(venue);

  return `Du recherchierst einen Gastronomie-Betrieb in der Schweiz für die Neukunden-Akquise einer Webagentur. Antworte und schreibe durchgehend auf Deutsch.

## Der Betrieb

${known(venue)}

## Auftrag

1. Suche den Betrieb im Netz. Kläre zuerst die wichtigste Frage: **Hat er eine eigene Website — und in welchem Zustand ist sie?** Wenn du eine findest, ruf sie wirklich auf (WebFetch) und beurteile sie: erreichbar, HTTPS, mobiltauglich, aktuelle Inhalte, letztes sichtbares Update.
2. Suche Instagram und Facebook. Bei Instagram zählt nur: Account vorhanden, und ist der letzte Beitrag jünger als 30 Tage.
3. Sammle Telefon, E-Mail, Öffnungszeiten, Küche, Google-Bewertung und Anzahl Bewertungen.
4. Prüfe, ob es eine Kette oder ein Franchise ist und ob der Betrieb dauerhaft geschlossen wurde.
5. Halte fest, was den Laden ausmacht: Inhaber, Geschichte, Besonderheiten. Das ist später der Aufhänger für die Ansprache.

## Regeln

- **Höchstens 12 Suchanfragen oder Seitenabrufe.** Lieber wenige sichere Fakten als viele geratene.
- **Rate nie.** Was du nicht belegen kannst, ist \`unbekannt\`. Ein leeres Feld ist wertvoller als ein falsches.
- **"keine Website" nur, wenn du wirklich gesucht hast und nichts gefunden hast.** Ein Instagram- oder Facebook-Auftritt ist keine Website. Ein Eintrag auf einem Portal (local.ch, tripadvisor, lunchgate, eat.ch, Speisekarte-Portale, Lieferdienste) ist ebenfalls keine eigene Website.
- Findest du eine Website, die zu einem anderen Betrieb gleichen Namens gehört: nicht übernehmen, sondern unter \`unsicher\` vermerken.
- Nutze nur WebSearch, WebFetch und Write. Keine anderen Werkzeuge.

## Ausgabe: zwei Dateien im aktuellen Ordner

### 1. \`${slug}.md\` — die lesbare Fassung

\`\`\`markdown
# ${venue.name}

**Kurzfazit:** <2–3 Sätze: lohnt sich der Lead, und warum>

| | |
|---|---|
| Website | <URL oder "keine gefunden"> |
| Zustand | <Einschätzung in einem Satz> |
| Instagram | <@handle, aktiv/inaktiv> |
| Facebook | <URL oder "–"> |
| Telefon | <…> |
| E-Mail | <…> |
| Bewertung | <4.3 ★ (127)> |

## Website
<Was du gesehen hast. Wenn keine: wo du gesucht hast.>

## Social Media
<Instagram, Facebook, Aktivität>

## Der Betrieb
<Küche, Grösse, Inhaber, Geschichte, Besonderheiten>

## Aufhänger für die Ansprache
<1–3 konkrete Punkte, die man in einer DM erwähnen würde>

## Quellen
<Liste der URLs, die du tatsächlich aufgerufen hast>

## Unsicher
<Was du nicht klären konntest>
\`\`\`

### 2. \`${slug}.json\` — die maschinenlesbare Fassung

Exakt diese Schlüssel, keine weiteren. Unbekanntes als \`null\` (nicht als leerer String, nicht als "unbekannt"):

\`\`\`json
{
  "website": "https://… oder null",
  "website_status": "keine | kaputt | veraltet | ok | gut | unbekannt",
  "instagram": "handle ohne @ oder null",
  "instagram_status": "keiner | inaktiv | aktiv | unbekannt",
  "facebook": "URL oder null",
  "phone": "+41 … oder null",
  "email": "… oder null",
  "opening_hours": "… oder null",
  "cuisine": "… oder null",
  "venue_type": "Restaurant | Bar | Café | Pizzeria | Pub | Take-Away | … oder null",
  "rating": 4.3,
  "review_count": 127,
  "is_chain": false,
  "permanently_closed": false,
  "zusammenfassung": "2–3 Sätze, dasselbe wie das Kurzfazit oben",
  "aufhaenger": "ein Satz, der beste Einstieg für die Ansprache",
  "unsicher": ["Punkte, die offen geblieben sind"]
}
\`\`\`

Bedeutung von \`website_status\`:
- \`keine\` — gesucht, keine eigene Website vorhanden
- \`kaputt\` — nicht erreichbar, kein HTTPS, kaputt oder auf dem Handy unbrauchbar
- \`veraltet\` — funktioniert, sieht aber sichtbar alt aus oder hat veraltete Inhalte
- \`ok\` — brauchbar, aber nichts Besonderes
- \`gut\` — modern, schnell, mobiltauglich, gepflegt
- \`unbekannt\` — nicht abschliessend klärbar

Schreib beide Dateien mit Write. Antworte danach mit **einem** Satz, was dabei herausgekommen ist.`;
}
