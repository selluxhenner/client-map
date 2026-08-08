// Aktion C: Kontakt-Entwürfe.
//
// Der Auftrag braucht kein einziges Werkzeug - alles, was er wissen muss,
// steht im Prompt. Das macht ihn schnell (rund 20 Sekunden) und billig, und
// er kann nichts anfassen.
//
// Wichtigste Regel: **es wird nie etwas versendet.** Der Lauf erzeugt Text,
// den Kevin liest, ändert und selbst abschickt.

/** Wie lang eine DM sein darf, bevor Instagram sie abschneidet. */
const DM_MAX = 450;

export function kontaktPrompt({ venue, analyse, hatDemo }) {
  const ort = venue.city || '';
  const web = {
    keine: 'hat gar keine eigene Website',
    kaputt: 'hat eine Website, die kaputt oder auf dem Handy unbrauchbar ist',
    veraltet: 'hat eine veraltete Website',
    ok: 'hat eine brauchbare, aber unauffällige Website',
    gut: 'hat eine gute, moderne Website',
    unbekannt: 'Website-Lage ist unklar',
  }[venue.website_status] || 'Website-Lage ist unklar';

  const fakten = [
    `- Betrieb: ${venue.name}${ort ? `, ${ort}` : ''}`,
    `- Art: ${[venue.venue_type, venue.cuisine].filter(Boolean).join(', ') || 'Gastronomie'}`,
    `- Website: ${web}${venue.website ? ` (${venue.website})` : ''}`,
    `- Instagram: ${venue.instagram ? `@${venue.instagram}` : 'keins bekannt'}`,
    venue.rating ? `- Bewertung: ${venue.rating} Sterne bei ${venue.review_count ?? '?'} Bewertungen` : null,
    `- Bisheriger Kontakt: ${venue.last_contact_at ? `zuletzt am ${venue.last_contact_at.slice(0, 10)}` : 'noch keiner'}`,
    hatDemo ? '- Für diesen Betrieb existiert bereits eine fertige Demo-Website.' : null,
  ].filter(Boolean).join('\n');

  return `Du schreibst zwei Erstkontakt-Entwürfe für ServiWeb, eine kleine Schweizer Webagentur, die Websites für Gastro-Betriebe baut. Kevin führt das Gespräch selbst — du lieferst nur die Entwürfe.

## Der Betrieb

${fakten}

${analyse ? `## Recherche zu diesem Betrieb\n\n${analyse}\n` : '## Recherche\n\nEs liegt keine Recherche vor. Bleib entsprechend allgemein und behaupte nichts Konkretes.\n'}

## Was du schreibst

**1. Instagram-DM** — der Hauptkanal. Du-Form, locker aber nicht kumpelhaft, wie eine Nachricht von einem Menschen aus der Region. Höchstens ${DM_MAX} Zeichen, denn längere DMs werden abgeschnitten und nicht gelesen. Keine Anrede-Floskel wie "Sehr geehrte Damen und Herren", kein Betreff, keine Emoji-Girlande (höchstens eines, wenn es passt).

**2. E-Mail** — Sie-Form, sachlich, mit Betreff. Höchstens 130 Wörter im Text.

## Regeln, an denen sich das entscheidet

- **Fang mit dem Laden an, nicht mit dir.** Der erste Satz muss etwas Konkretes über den Betrieb sagen, das nur aus der Recherche stammen kann — eine Spezialität, die Geschichte, der Inhaber, ein Detail aus den Bewertungen. Ohne das ist es Spam.
- **Behaupte nichts, was nicht in der Recherche steht.** Keine erfundenen Gerichte, keine erfundenen Jahreszahlen, kein "ich war letzte Woche bei euch".
- **Kein Herunterreden.** "Ihre Website ist veraltet" verliert das Gespräch. Es geht um das, was der Laden gewinnt, nicht um seinen Mangel.
- **Ein einziger, kleiner nächster Schritt.** ${hatDemo
    ? 'Es existiert eine fertige Demo — biete an, sie zu zeigen. Setz dafür den Platzhalter [DEMO-LINK] ein, den Kevin ersetzt.'
    : 'Zum Beispiel ein kurzes Telefonat oder die Frage, ob Interesse besteht. Verspreche keine Demo, es gibt noch keine.'}
- **Keine Preise, keine Rabatte, keine Fristen.** Kein "nur diese Woche".
- Schweizer Deutsch in der Schriftform: "ss" statt "ß", "Grüezi" nur, wenn es zum Ton passt.

## Antwort

Ausschliesslich dieser JSON-Block, kein Text davor oder danach:

\`\`\`json
{
  "dm": "der Instagram-Text, höchstens ${DM_MAX} Zeichen, mit echten Zeilenumbrüchen als \\n",
  "mail_betreff": "kurz und konkret, kein Werbe-Ton",
  "mail_text": "der Mail-Text, mit Anrede und Grussformel",
  "aufhaenger": "in einem Satz: welches konkrete Detail du als Einstieg benutzt hast und woher es kommt",
  "hinweise": ["was Kevin vor dem Absenden prüfen oder ergänzen sollte"]
}
\`\`\``;
}
