# Client-Map — Konventionen

Lokales Akquise-Werkzeug für ServiWeb: Gastro-Betriebe auf der Karte finden,
bewerten, verfolgen. Der vollständige Bauplan steht in `PLAN.md`.

## Starten

```bash
npm start          # http://localhost:8787
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

## Externe Dienste

- Overpass und Nominatim sind öffentliche Gratis-Dienste. User-Agent mitschicken,
  Nominatim auf 1 Anfrage/Sekunde drosseln, Suchbereich begrenzen.
- Google Places ist ein Adapter in `server/providers/google.js` und bleibt
  ohne `GOOGLE_PLACES_KEY` vollständig inaktiv.

## Noch nicht gebaut

Phasen 4–8 aus `PLAN.md`: Job-Engine, Claude-Analyse, Demo-Build,
CRM-Tiefe, Skalierung. Die Tabellen `jobs` und `interactions` liegen bereits
im Schema bereit.
