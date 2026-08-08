// Der Auftrag "Demo bauen".
//
// Der Skill `restaurant-website-build` stellt vor Phase 1 vier Fragen (Name
// und Ort, Sprachen, Reservation, Impressum-Recht). Im Kopfmodus kann sie
// niemand beantworten - deshalb stehen die Antworten hier drin. Wer sie
// aendern will, aendert sie an dieser Stelle und nirgends sonst.

const VORGABEN = {
  sprache: 'Deutsch, einsprachig',
  reservation: 'Formular an E-Mail; ist keine Mailadresse bekannt, nur Telefon',
  recht: 'Schweiz (CH)',
};

export function demoPrompt({ venue, ordner, referenz, hatRecherche, rechercheDatei }) {
  const ort = venue.city || 'Schweiz';

  const bekannt = [
    venue.website ? `- Bestehende Website: ${venue.website} (Zustand laut Analyse: ${venue.website_status})` : null,
    venue.instagram ? `- Instagram: @${venue.instagram}` : null,
    venue.phone ? `- Telefon: ${venue.phone}` : null,
    venue.email ? `- E-Mail: ${venue.email}` : null,
    venue.street ? `- Adresse: ${[venue.street, venue.zip, venue.city].filter(Boolean).join(', ')}` : null,
    venue.cuisine ? `- Küche: ${venue.cuisine}` : null,
  ].filter(Boolean).join('\n');

  return `/restaurant-website-build ${venue.name}, ${ort}

Du arbeitest im aktuellen Ordner (\`${ordner}\`). **Schreib ausschliesslich hierhin.** Alles darüber liegt im Auftragsordner mit echten Kundenprojekten und ist nicht gesichert.

## Die vier Vorgaben — nicht nachfragen, es kann niemand antworten

- **Betrieb:** ${venue.name}, ${ort}
- **Sprache:** ${VORGABEN.sprache}
- **Reservation:** ${VORGABEN.reservation}
- **Impressum-Recht:** ${VORGABEN.recht}

${bekannt ? `## Was die Client-Map schon weiss\n\n${bekannt}\n` : ''}
${hatRecherche
    ? `## Phase 1 ist halb erledigt — lies das zuerst

**Öffne als erstes \`${rechercheDatei}\`.** Darin steht die fertige Recherche aus der Client-Map: Website-Lage, Social Media, Kontaktdaten, Bewertungen, Inhaber, Geschichte, Aufhänger und die geprüften Quellen. Diese Fakten sind belegt — such sie nicht neu.

Das ist eine andere Datei als \`research.md\`. Deine eigene \`research.md\` schreibst du wie gewohnt, aber **übernimm die Fakten aus \`${rechercheDatei}\`** und recherchier nur, was für den Bau zusätzlich fehlt: Bilder, Signature-Dishes mit Preisen, Öffnungszeiten pro Tag. Was in \`${rechercheDatei}\` als unsicher markiert ist, darfst du prüfen; alles andere ist geklärt.`
    : `## Phase 1 komplett

Für diesen Betrieb liegt noch keine Recherche vor — mach Phase 1 vollständig und schreib \`research.md\`.`}

${referenz
    ? `## Konventionen

In \`_referenz/${referenz}/\` liegt der Quelltext eines fertigen Projekts als Vorbild: Ordneraufbau, Design-Tokens, Komponentenstruktur, Footer und Impressum. **Übernimm diese Konventionen**, statt eine eigene Architektur zu erfinden. Der Ordner ist nur zum Lesen da und wird nach dem Bau automatisch entfernt — bau nichts hinein und verlinke nichts daraus.`
    : ''}

## Abschluss

Der Ordner muss am Ende eine lauffähige Seite enthalten (\`package.json\` plus Quelltext). Schreib zum Schluss \`handover.md\` mit dem Stand, den offenen Punkten und der Rechtelage der Bilder.`;
}
