# Client-Map — Konventionen

Lokales Akquise-Werkzeug für ServiWeb: Gastro-Betriebe auf der Karte finden,
bewerten, verfolgen. Der vollständige Bauplan steht in `PLAN.md`.

## Starten

```bash
npm start          # http://localhost:8788
npm run dev        # mit --watch
```

`.env` aus `.env.example` erzeugen. Ohne `.env` laufen die Standardwerte.

## Sprache

- Oberfläche, Labels, Fehlermeldungen: **Deutsch**
- Gespeicherte **Werte**: deutsch und ASCII (`kontaktiert`, `in_gespraech`,
  `kein_fit`) — keine Umlaute in Schlüsseln
- **Spaltennamen und Code**: englisch (`last_contact_at`, `website_status`)
- Kommentare: deutsch, ohne Umlaute in `.js`-Dateien schreiben ist nicht nötig,
  aber Konsistenz mit dem Bestand halten

## Architektur

- **Kein Build-Step.** Frontend ist Vanilla JS + ES-Module, direkt aus
  `public/` ausgeliefert. Leaflet kommt aus `node_modules`, nicht vom CDN.
  Bitte kein React, kein Bundler, kein Tailwind nachrüsten.
- **SQLite ist die einzige Wahrheit.** `data/clientmap.db`. Schemaänderungen
  ausschliesslich als neue Migration in `server/db.js` anhängen — nie eine
  bestehende Migration ändern.
- **Alle Schreibzugriffe** auf Betriebe laufen über `server/lib/venue-store.js`.
  Dort wird der Score bei jeder Änderung neu berechnet, damit er nie veraltet.
- **Filterlogik** liegt einmal in `server/lib/filters.js` und wird von Karte,
  Liste und CSV-Export geteilt. Der Export enthält damit garantiert genau das,
  was auf dem Bildschirm steht.
- **Farben und Punkte** stehen ausschliesslich in `server/scoring.js` und
  werden über `/api/config` ans Frontend geliefert. Keine Farbwerte im
  Frontend hartkodieren.

## Zwei Dimensionen — nicht zusammenlegen

- **Pin-Farbe** = Pipeline-Status (wie weit bin ich mit dem Laden)
- **Pin-Ring** = Hotness-Score (wie gut ist der Lead)

Das war eine bewusste Entscheidung. Ein heisser unberührter Lead und ein
heisser abgelehnter Lead müssen unterschiedlich aussehen.

Ebenso getrennt bleiben **Pipeline-Status** und **Faktenfelder**: `geschlossen`
ist Buchführung, `permanently_closed` steuert Score und Sichtbarkeit;
`website_gut` ist Buchführung, `website_status` steuert die Punkte. Das
Detail-Panel bietet an, das Gegenstück mitzusetzen — es tut es nie von selbst.

`interessiert` ist Kevins eigene Entscheidung („den nehme ich mir vor") und
darf von keinem Agentenlauf zurückgestellt werden. Einzige Ausnahme: eine
belegte Schliessung.

## Ungeprüft ≠ keine Website

OSM-Daten sind lückenhaft. Fehlt dort ein `website`-Tag, heisst das **nicht**,
dass der Betrieb keine Website hat. Deshalb:

- `website_status = 'unbekannt'` (nicht `'keine'`) für unbelegte Fälle
- `verified = 0` → gestrichelter Ring in der Karte
- `'keine'` wird erst gesetzt, wenn eine Analyse oder Google es belegt

Diese Unterscheidung nicht wegoptimieren — ohne sie schreibt Kevin Läden an,
die längst eine gute Website haben.

## Discovery darf keine Arbeit zerstören

`upsertDiscovered()` ergänzt bei bekannten Betrieben nur leere Faktenfelder.
Status, Notizen, Tags und manuelle Korrekturen werden nie überschrieben. Ein
Rescan derselben Region muss folgenlos bleiben.

## Agenten-Aufträge

- Jede Auftragsart steht in `server/jobs/kinds.js` mit ihrem Modell, ihrem
  Tageslimit und ihrem Zeitlimit. **Recherche auf Sonnet, nur Demo-Builds auf
  Opus** — das ist der grösste Hebel gegen den Kontingent-Verbrauch.
- Eine neue Auftragsart bringt `build()` (Prompt, cwd, CLI-Argumente) und
  optional `onSuccess()` mit. `onSuccess` darf werfen: dann gilt der Auftrag
  als fehlgeschlagen. Genau so soll es sein — ein Lauf, dessen Ergebnis nicht
  ankommt, ist kein Erfolg, auch wenn der Prozess sauber beendet hat.
- Agenten bekommen nur die Werkzeuge, die sie brauchen (`--tools`), und die
  müssen zusätzlich freigegeben sein (`--allowed-tools`) — im Kopfmodus kann
  niemand eine Rückfrage beantworten.
- Nie `bypassPermissions`. `acceptEdits` plus ein enges Arbeitsverzeichnis.
- Der Runner gibt **nicht** die ganze Umgebung weiter: Schlüssel und
  Anbieter-Variablen (`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, Bedrock,
  Vertex …) werden entfernt, damit ein Eintrag in der `.env` die Aufträge
  nicht still von der Abo-Anmeldung auf API-Abrechnung umlenkt. Diese Liste
  nicht kürzen.

## Zwei Prüftiefen — nicht zusammenlegen

- **`schnell`** beantwortet nur die Fragen, die den Score bewegen (Website,
  Instagram), in höchstens 4 Werkzeugaufrufen und ohne Dateien zu schreiben.
  Er ist für ganze Ausschnitte gedacht und muss ~30 Sekunden bleiben. Wer ihm
  Aufgaben dazugibt, macht den Stapellauf unbenutzbar.
- **`analyse`** darf ausführlich sein und schreibt die Markdown-Datei.
- Ein Schnell-Check über einen Betrieb mit vorhandener Tiefen-Analyse frischt
  nur Faktenfelder auf: `analysis_path`, `analysis_summary` und
  `analysis_kind` bleiben stehen. Sonst würde Breite Tiefe überschreiben.

## Analyse-Ergebnisse

- `server/lib/analysis.js` ist die einzige Stelle, die Agenten-JSON in
  Betriebsfelder übersetzt. Sie misstraut allem: unbekannte Enum-Werte werden
  zu `unbekannt`, unplausible Zahlen fliegen raus, leere Angaben löschen
  nichts Bestehendes.
- **Ungeklärt bleibt ungeprüft.** Liefert die Analyse `website_status =
  'unbekannt'`, bleibt `verified = 0`. Der Ring bleibt gestrichelt.
- Die Analyse darf Faktenfelder korrigieren, aber **nie** Notizen, Tags oder
  einen Pipeline-Status anfassen, in dem schon Handarbeit steckt. Weitergestellt
  wird nur `neu` → `recherchiert` (bzw. → `kein_fit` bei geschlossenen Betrieben).

## Kontaktarbeit

- **Kanäle und Ergebnisse** stehen in `server/crm.js`, nicht in `scoring.js` —
  dort werden Punkte vergeben, hier nicht. Ausgeliefert wird beides über
  `/api/config`.
- **Ein Kontakteintrag zieht den Status mit, aber nur vorwärts.** Eine neue
  Notiz macht aus einem Kunden nie wieder einen Kontaktierten, und die
  bewussten Endzustände (`abgelehnt`, `kein_fit`, `geschlossen`,
  `website_gut`) hebt sie nicht auf. `kein_interesse` stellt absichtlich
  **nicht** auf `abgelehnt` — eine unbeantwortete DM ist noch kein Nein.
- **Löschen eines Eintrags setzt den Status nicht zurück.** Dass ein Kontakt
  stattgefunden hat, wird durch das Löschen der Notiz nicht ungeschehen. Nur
  `last_contact_at` wird aus der restlichen Historie neu bestimmt.
- **Die Wiedervorlage steht am Betrieb**, nicht an der Interaktion: es gibt
  immer nur eine offene Frage „wann kümmere ich mich wieder um diesen Laden".
- **Der Funnel zählt kumulativ** („so viele haben diese Stufe mindestens
  erreicht"). Endzustände stehen als `abgang` daneben, `pausiert` zählt über
  `FUNNEL_ALIAS` als erreichter Kunde. Trichterspitze + Abgang muss gleich der
  Gesamtzahl sein — wenn diese Rechnung nicht aufgeht, ist der Funnel falsch.

## Kontakt-Entwürfe

- **Die App versendet nie etwas.** Aktion C erzeugt Text, Kevin liest, ändert
  und schickt selbst. Kein Sende-Knopf, keine Mail-Anbindung, auch nicht
  „nur als Draft im Postfach".
- Der Auftrag läuft ohne Werkzeuge. Wer ihm welche gibt, macht ihn langsam
  und angreifbar, ohne dass der Entwurf besser wird.
- `server/lib/outreach.js` prüft das Ergebnis und **kürzt nicht**: eine zu
  lange DM wird gemeldet, nicht abgeschnitten. Ein halber Satz wäre schlimmer.

## Demo-Ordner

- **Zwei Wurzeln:** `DEMO_DIR` (dort entstehen neue Demos) und der Ordner
  darüber, in dem die älteren Projekte liegen. `scanRoots()` nimmt das
  Bauziel immer mit auf, sonst findet die App ihre eigenen Demos nicht.
- **Der Bau-Agent arbeitet nur in seinem eigenen Ordner.** Im Auftragsordner
  liegen Kundenprojekte **ohne Git-Sicherung** — deshalb bekommt er dort
  keinen Schreibzugriff. Was er an Konventionen braucht, wird ihm vorher als
  `_referenz/` hineinkopiert und danach wieder entfernt.
- **Unsere Analyse heisst `recherche-clientmap.md`, nie `research.md`.**
  `research.md` ist der Arbeitsname des Skills; er überschreibt die Datei in
  Phase 1, bevor er hineinsieht. In den ersten beiden echten Läufen ist genau
  das passiert — die Recherche wurde weggeworfen und auf Opus wiederholt.
- **Die tatsächlichen Rechte sind weiter als `--allowed-tools`.** Für einen
  Lauf gilt die Vereinigung mit `.claude/settings.json` im Zielordner. Dort
  steht ein `deny` auf `Bash(curl *)` — der Bau-Agent kann also keine Bilder
  herunterladen und weicht auf Umwege aus. Wer die Rechte des Bau-Auftrags
  beurteilt, muss beide Stellen ansehen.
- **`DEMO_DIR` niemals blind anlegen.** `prepareDemoFolder()` prüft, ob die
  Wurzel existiert, und bricht sonst ab. Ohne diese Prüfung erzeugte ein
  Tippfehler in der `.env` (`Auftraege` statt `Aufträge`) still einen zweiten
  Ordnerbaum, in dem eine Demo landete.
- **Kein `fs.cpSync` mit `recursive`.** Stürzt auf dieser Node-Version unter
  Windows hart ab (0xC0000409) und nimmt den Server mit, weil `build()`
  synchron in der Auftragsschlange läuft. `copyTree()` in `demos.js` benutzen.
- **Ordner werden Betrieben nur vorgeschlagen, nie automatisch zugeordnet.**
  Ein falscher Treffer verfälscht einen Pipeline-Status. Die Ortsnamen fliegen
  aus dem Namensvergleich, und ein genauer Wortreffer zählt mehr als ein
  fast-Treffer — sonst steht „Café Giger" vor „Tiger".

## Externe Dienste

- Overpass und Nominatim sind öffentliche Gratis-Dienste. User-Agent mitschicken,
  Nominatim auf 1 Anfrage/Sekunde drosseln, Suchbereich begrenzen.
- Google Places ist ein Adapter in `server/providers/google.js` und bleibt
  ohne `GOOGLE_PLACES_KEY` vollständig inaktiv.

## Wartung und Skalierung

- **Zusammenführen ist der einzige Vorgang, der Daten vernichtet.** Deshalb
  sichert er vorher automatisch (`vor-merge`), und deshalb wird nie
  automatisch zusammengeführt. Beim Zusammenführen gilt: leere Felder füllen,
  Notizen aneinanderhängen (nie überschreiben), den weiter fortgeschrittenen
  Status nehmen, Historie und Aufträge umziehen.
- **Nähe beweist keine Dublette.** In der Wiler Altstadt liegen 128 Paare
  verschiedener Lokale unter 80 m auseinander. Es braucht ein Namens- oder
  Kontaktindiz; Nähe bestätigt nur. Eine gemeinsame Website zählt nicht bei
  Ketten und nicht über 2 km — sonst sind alle Migros-Filialen Dubletten.
- **Sicherungen über `VACUUM INTO`**, nie durch Kopieren der Datei: im Betrieb
  steht ein Teil der Daten im WAL-Journal.
- **Die Karte lädt schlank** (`felder=karte`, sieben Spalten). Volle Zeilen
  sind bei 10 000 Betrieben 9,4 MB JSON statt 1,2 MB. Das Detail-Panel holt
  den vollen Datensatz beim Anklicken nach — wer der Karte neue Felder
  hinzufügt, muss `KARTEN_FELDER` in `venue-store.js` erweitern.
- **Kein stilles Kappen.** Liefert eine Abfrage mehr als das Limit, sagt die
  Antwort `gekappt: true` und die Oberfläche zeigt es. Dasselbe gilt für
  Google Places, das pro Anfrage bei 20 Treffern abschneidet.
- **Regions-Läufe laufen nacheinander mit Pausen.** Overpass und Nominatim
  sind öffentliche Gratisdienste; Parallelität wäre eine kleine Attacke.
  Grosse Gebiete werden in Kacheln unter 0,28° zerlegt, weil Overpass sonst
  ins Zeitlimit läuft und dann gar nichts liefert.

## Noch nicht gebaut

Alle Phasen aus `PLAN.md` sind gebaut. Offene Ideen stehen in §9 F2.
