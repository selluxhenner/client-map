# Screenshots

Bildschirmfotos der laufenden Client-Map, aufgenommen mit Chrome headless
gegen `localhost:8788`. Die API-Antworten wurden dabei abgefangen und Name,
Telefon, Adresse, Website und Handles jedes Betriebs durch erfundene Werte
ersetzt — Karte, Zahlen und Bewertungen sind echt, die Betriebe nicht
identifizierbar.

| Datei                  | Inhalt                                                  |
|------------------------|---------------------------------------------------------|
| `hero.webp`            | Ausschnitt von karte-region ohne App-Rahmen, Hero-Hintergrund|
| `karte-region.webp`    | Region Wil, Zoom 13, Pin-Gruppen                         |
| `karte-detail.webp`    | Altstadt Wil, Zoom 17, Einzelpins, Detail offen         |
| `liste.webp`           | Liste gefiltert auf Wil SG mit Trichter                 |
| `liste-detail.webp`    | Liste plus Detail eines Betriebs mit 45 Punkten         |
| `detail-kopf.webp`     | Detail-Panel oben (Score, Hinweis, Pipeline, Historie)  |
| `detail-aktionen.webp` | Detail-Panel unten (Fakten, Nachschauen, Aktionen)      |

Neu aufnehmen: das Skript liegt nicht im Repo (Puppeteer-Abhaengigkeit).
Wichtig ist nur die Regel: **nie echte Betriebsnamen auf die oeffentliche
Seite.** Wer neue Bilder macht, ersetzt Namen und Nummern vorher.
