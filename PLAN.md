# ServiWeb Client-Map — Bauplan

Lokales Akquise-Werkzeug: Gastro-Betriebe auf einer Karte finden, bewerten,
verfolgen — und per Knopfdruck von Claude analysieren und als Demo-Website
bauen lassen.

**Status:** Alle Phasen 0–8 gebaut.
**Stand:** 2026-08-08

### Gemessen bei 10 000 Betrieben

| | |
|---|---|
| Kartenausschnitt Stadt (5 × 4 km) | 2,8 ms · 131 Zeilen |
| Kartenausschnitt Region (30 × 25 km) | 50 ms · 2358 Zeilen |
| Statuszählung der Filterleiste | 2,4 ms |
| Datenbankdatei | 4,2 MB |

Die Abfragen sind also nicht das Problem — `idx_venues_pos` wird genutzt. Das
Problem war die **Nutzlast**: 10 000 volle Zeilen sind 9,4 MB JSON. Die Karte
braucht davon sieben Spalten, das sind 1,2 MB — 87 Prozent weniger. Den Rest
holt das Detail-Panel beim Anklicken einzeln nach.

Dabei kam ein stiller Fehler heraus: die Karte lud ohne eigenes Limit nur die
ersten 2000 Treffer, zeigte in der Kopfzeile aber die Gesamtzahl. Jetzt liegt
die Grenze bei 8000, und wird sie erreicht, sagt die Karte es.

---

## 1. Entscheidungen (bereits getroffen)

| Thema | Entscheidung |
|---|---|
| Karte | Leaflet + OpenStreetMap-Tiles — gratis, kein Key, kein Build-Step |
| Betriebs-Daten | Overpass (OSM) für Discovery + Claude-Recherche für Tiefe. Google-Places-Adapter wird gebaut, bleibt aber **aus** |
| Architektur | Lokaler Node-Server + SQLite (`npm start` → `http://localhost:8788`) |
| Agent-Start | Server startet `claude -p` headless mit `/restaurant-website-build` |
| Farbcode | **Zwei Dimensionen**: Farbe = Pipeline-Status, Ring = Hotness-Score |
| Zielgruppe | Gastro: Restaurant, Bar, Café, Pizzeria, Pub, Take-Away |
| Demo-Output | `D:\03 Business\Aufträge\03_Demos\<slug>\` |
| Sprache | Deutsch — Oberfläche und Status-Keys (`kontaktiert`, `in_gespraech`). Nur DB-Spaltennamen bleiben Englisch, die siehst du nie |
| Abrechnung | Claude Max — keine API-Kosten pro Job. Gedeckelt wird über Laufzeit und Tageskontingent, nicht über USD (§5) |

---

## 2. Warum zwei Dimensionen statt einer Farbskala

Deine ursprüngliche Idee mischte zwei Fragen in eine Farbe:

- **Wie gut ist der Lead?** (keine Website, kleine Bude, geiles Lokal)
- **Wie weit bin ich mit ihm?** (kontaktiert, Demo gebaut, Kunde)

Wenn beides eine Farbe teilt, sehen ein heisser unberührter Lead und ein
heisser bereits abgesagter Lead gleich aus — und genau diese Unterscheidung
ist der ganze Zweck der Karte. Darum:

### Farbe des Pins = Pipeline-Status

| Status | Farbe | Bedeutung |
|---|---|---|
| `neu` | Grau `#94a3b8` | Gefunden, noch nichts gemacht |
| `recherchiert` | Blau `#3b82f6` | Claude-Analyse liegt vor |
| `interessiert` | Indigo `#6366f1` | **Von mir vorgemerkt:** Demo bauen und ansprechen |
| `demo_gebaut` | Violett `#8b5cf6` | Demo-Website existiert |
| `kontaktiert` | Orange `#f97316` | Angeschrieben (Insta/Mail/Telefon) |
| `in_gespraech` | Gelb `#eab308` | Im Gespräch / Termin |
| `kunde` | Grün `#22c55e` | Aktiver Kunde |
| `pausiert` | Türkis `#14b8a6` | War Kunde, aktuell gestoppt — Wiedervorlage |
| `abgelehnt` | Rot `#ef4444` | Flop, kein Interesse |
| `website_gut` | Steingrau `#78716c` | Kein Bedarf — hat eine gute Website |
| `kein_fit` | Dunkelgrau `#475569` | Kette, zu klein, passt nicht |
| `geschlossen` | Schwarzgrau `#1f2937` | Betrieb existiert nicht mehr (Konkurs, Aufgabe) |

**`interessiert` ist die eigene Entscheidung, nicht die des Betriebs.** Genau
deshalb darf kein Agentenlauf ihn zurückstellen — ein Schnell-Check über einen
vorgemerkten Laden lässt den Status stehen. Nur eine belegte Schliessung
überschreibt ihn, denn ein Vorhaben für einen Betrieb, den es nicht mehr gibt,
ist gegenstandslos. Ab `kontaktiert` bleibt alles stehen: wer mit dem Wirt
geredet hat, weiss es besser als eine Websuche.

**Drei verschiedene Arten „Nein".** `abgelehnt` heisst, *er* wollte nicht.
`website_gut` heisst, es gibt nichts zu verkaufen — der einzige Nein-Status,
der in zwei Jahren wieder ein Ja werden kann. `kein_fit` heisst, der Laden
passt grundsätzlich nicht. Zusammengelegt wären das drei ungleiche Stapel in
einer Schublade.

### Ring um den Pin = Hotness-Score (0–100)

- **0–39** dünner grauer Ring — kalt
- **40–69** mittlerer bernsteinfarbener Ring — interessant
- **70–100** dicker roter Ring + 🔥-Icon — heiss

Deine ursprünglichen Farben sind damit nicht verloren, sie sind nur in den
Score gewandert: „dunkelgrün = keine oder alte Website" ist jetzt der
grösste einzelne Score-Faktor (+40), „rot = geschlossen/kaputt" ist
`no_fit`, „gelb = sehr klein" ist ein Score-Abzug.

**Der Blick, den du eigentlich willst:** Filter auf `status = neu` +
`score ≥ 70` → alle heissen, noch unberührten Läden im Bild.

### Hollow Ring = noch nicht verifiziert

Wichtig und leicht zu übersehen: OSM-Daten sind lückenhaft. Wenn Overpass
kein `website`-Tag liefert, heisst das **nicht**, dass der Laden keine
Website hat — nur, dass OSM es nicht weiss. Solche Pins bekommen einen
gestrichelten Ring und ein `?`. Erst nach der Claude-Analyse wird der Ring
massiv und der Score belastbar. Ohne diese Unterscheidung würdest du
Läden anschreiben, die längst eine gute Website haben.

---

## 3. Scoring-Modell

Transparent in einer einzigen Datei (`server/scoring.js`), jederzeit von dir
anpassbar. Jeder Pin speichert seine Punkte-Aufschlüsselung, das Detail-Panel
zeigt „warum 87 Punkte".

| Signal | Punkte |
|---|---|
| Keine Website (verifiziert) | **+40** |
| Website kaputt / kein SSL / nicht mobil / sichtbar 2010er | **+30** |
| Website vorhanden, veraltet aber funktioniert | **+20** |
| Website modern und gut | **−10** |
| Instagram vorhanden | **+15** |
| Instagram aktiv (Post < 30 Tage) | **+10** |
| ≥ 50 Bewertungen **und** Rating ≥ 4.0 | **+15** |
| < 10 Bewertungen | **−10** |
| Telefon oder Mail auffindbar | **+5** |
| Kette / Franchise erkannt | **−20** |
| Dauerhaft geschlossen | **→ `no_fit`** |

Instagram zählt bewusst stark: Du hast gesagt, die IG-DM ist dein
einfachster und bester Kontaktweg. Ein Laden ohne Website **mit** aktivem
Instagram ist damit der Idealfall — hohe Punkte und ein direkter Kanal.

---

## 4. Architektur

```
client-map/
├─ package.json              express, better-sqlite3, node-fetch
├─ .env.example              GOOGLE_PLACES_KEY (leer = aus)
├─ CLAUDE.md                 Konventionen für Agenten in diesem Repo
├─ data/
│  ├─ clientmap.db           SQLite — die einzige Wahrheit
│  ├─ analysen/<slug>.md     Claude-Analysen
│  └─ jobs/<id>.log          Roh-Logs der Agent-Läufe
├─ server/
│  ├─ index.js               Express + statisches public/
│  ├─ db.js                  Schema + Migrationen
│  ├─ scoring.js             Score-Regeln (§3)
│  ├─ providers/
│  │  ├─ overpass.js         OSM-Discovery im Kartenausschnitt
│  │  ├─ nominatim.js        Ortssuche „Wil SG"
│  │  └─ google.js           Adapter, inaktiv ohne Key
│  ├─ routes/                venues, discover, jobs, export
│  └─ jobs/
│     ├─ queue.js            SQLite-Queue, Concurrency 2
│     ├─ runner.js           spawnt claude -p, parst stream-json
│     └─ prompts/            analyze.js, build.js, outreach.js
└─ public/                   Vanilla JS + Leaflet, kein Bundler
   ├─ index.html             Karte
   ├─ liste.html             Übersicht / Tabelle
   └─ js/, css/
```

**Kein React, kein Build-Step.** Du willst „eine HTML-Website, die ich lokal
laufen lassen kann" — Leaflet + Vanilla JS liefert genau das, startet
sofort und hat in fünf Jahren keine kaputten Dependencies. Für die
Skalierung sorgt `leaflet.markercluster` (zehntausende Pins problemlos)
plus bbox-Abfragen mit Index auf lat/lng.

### Datenmodell (Kern)

- **`venues`** — Identität (`source`, `source_id`, `name`, `lat`, `lng`),
  Kontakt (`address`, `phone`, `email`, `website`, `instagram`, `facebook`),
  Bewertung (`website_status`, `score`, `score_breakdown`, `rating`,
  `review_count`), Pipeline (`pipeline_status`, `notes`, `tags`,
  `demo_path`, `analysis_path`, `last_contact_at`, `last_enriched_at`)
- **`interactions`** — Kontakt-Historie: Datum, Kanal, Notiz, Ergebnis
- **`jobs`** — Agent-Läufe: Art, Status, Kosten, Log-Pfad, Exit-Code

---

## 5. Die zwei Aktions-Buttons

### Aktion A — „Analyse" (Online-Recherche) — gebaut

Server startet:

```
claude -p "<Recherche-Prompt>" --model sonnet
  --output-format stream-json --verbose
  --permission-mode acceptEdits
  --tools WebSearch,WebFetch,Write
  --allowed-tools WebSearch,WebFetch,Write
```

Arbeitsverzeichnis ist `data/analysen/` — mehr kann der Agent nicht anfassen.
`--allowed-tools` ist nötig, weil ein WebFetch auf eine unbekannte Domain im
Kopfmodus sonst ohne Rückfragemöglichkeit abgelehnt würde.

Claude recherchiert den Laden online: Website ja/nein und in welchem
Zustand, Instagram inkl. Aktivität, Facebook, Telefon, Mail,
Öffnungszeiten, Bewertungen, Küche, Story/Besonderheiten, Inhaber.

**Zwei Ausgaben aus einem Lauf:**
1. `data/analysen/<slug>.md` — die lesbare MD-Datei, die du wolltest
2. `data/analysen/<slug>.json` → wird nach dem Lauf eingelesen, geprüft und
   in die DB geschrieben, Score wird neu berechnet, Status `neu` →
   `recherchiert`. Fehlt die JSON-Datei, wird als Rückfallebene die
   Schlussnachricht nach einem JSON-Block durchsucht; kommt auch dort nichts,
   gilt der Auftrag als fehlgeschlagen statt als still erfolglos.

**Verifiziert wird nur, was belegt ist.** Bleibt der Website-Zustand
`unbekannt`, bleibt der Betrieb ungeprüft und der Ring gestrichelt — sonst
würde die Analyse eine Sicherheit vortäuschen, die sie nicht geliefert hat.

### Aktion B — „Demo bauen"

```
claude -p "/restaurant-website-build <Name>, <Ort>" 
  --add-dir "D:\03 Business\Aufträge\03_Demos"
  --permission-mode acceptEdits --model opus
  --output-format stream-json
```

**Cleverer Teil:** Bevor der Job startet, kopiert der Server die Analyse aus
Aktion A als `research.md` in den neuen Demo-Ordner. Dein Skill liest in
Phase 1 genau diese Datei — die Recherche ist also schon erledigt, der
Build-Agent springt direkt zu Design und Code. Spart Zeit und Tokens pro
Demo.

Der Live-Log streamt per SSE in eine Schublade in der UI, du siehst
mitlaufen was passiert. Nach Erfolg: `pipeline_status = demo_built`,
`demo_path` gesetzt, Pin wird violett.

**Sicherheit:** `acceptEdits` statt `bypassPermissions`, `--add-dir` auf
genau einen Ordner beschränkt, Queue mit Concurrency 2, jeder Job jederzeit
abbrechbar, Zeitlimit pro Job.

### Wichtig: Claude Max statt API — was das für die Deckelung heisst

`--max-budget-usd` greift nur bei API-Abrechnung. Auf Max laufen die Jobs
gegen dein Nutzungskontingent, nicht gegen eine Rechnung. Der eigentliche
Schaden ist also nicht Geld, sondern: **ein Batch-Lauf über 200 Läden frisst
dein 5-Stunden-Fenster auf und blockiert dich beim normalen Arbeiten.**

Deshalb im Bau eingeplant:

- **Modell-Split** — Analysen laufen auf Sonnet (Recherche, völlig
  ausreichend, deutlich sparsamer), nur Demo-Builds auf Opus. Das ist der
  grösste Hebel überhaupt.
- **Tageskontingent** — konfigurierbares Limit „max. N Jobs pro Tag",
  Standard 40 Analysen / 5 Builds. Queue stoppt sauber statt weiterzurennen.
- **Nachtmodus** — Batch-Läufe planbar für Zeiten, in denen du nicht
  arbeitest.
- **Kontingent-Warnung** — läuft ein Job in ein Rate-Limit, pausiert die
  Queue und meldet es in der UI, statt reihenweise Jobs fehlschlagen zu
  lassen.

### Aktion C — „Kontakt-Entwurf" — gebaut

Erzeugt aus der Analyse einen IG-DM-Entwurf und eine Mail-Variante,
personalisiert auf die Story des Ladens. **Erzeugt nur Entwürfe — versendet
nie selbst.** Im Panel stehen sie mit Kopierknopf; abgeschickt wird von Hand.

Der Auftrag bekommt **kein einziges Werkzeug** (`--tools ''`) — alles Wissen
steht im Prompt. Damit ist er in etwa 25 Sekunden durch und kann nichts
anfassen.

Geprüft wird das Ergebnis wie bei der Analyse: eine DM über 450 Zeichen
schneidet Instagram ab, das wird gemeldet statt stillschweigend gekürzt. Fehlt
ein Instagram-Handle, steht das als Hinweis dabei. Ein Entwurf ohne DM **und**
ohne Mail gilt als Fehlschlag.

**Zum Demo-Link:** die Demos liegen lokal, es gibt keine öffentliche URL.
Existiert eine Demo, setzt der Entwurf den Platzhalter `[DEMO-LINK]` und weist
darauf hin — versprochen wird nichts, was noch nicht erreichbar ist.

---

## 6. Autonome Suche

Zwei Geschwindigkeiten, bewusst getrennt:

**Breitensuche (sofort, gratis, ohne Claude)** — Kartenausschnitt oder Radius
wählen → „Diesen Bereich durchsuchen" → Overpass liefert alle Gastro-POIs →
werden gespeichert und aus OSM-Tags vorbewertet. Hunderte Pins in Sekunden.

**Tiefen-Scan (Claude, im Hintergrund)** — „Alle unverifizierten Pins in
diesem Bereich analysieren" → reiht N Analyse-Jobs in die Queue, läuft
nebenher durch, mit Budget-Deckel für den ganzen Batch. Danach sind die
Scores belastbar.

---

## 7. Übersicht / Listenansicht

Tabelle, sortier- und filterbar nach Ort, Status, Score, Website-Zustand,
Instagram, Demo vorhanden, letzter Kontakt.

Gespeicherte Filter, ein Klick:
- **🔥 Heiss & unberührt** — `score ≥ 70` + `status = neu`
- **Demo gebaut, nicht kontaktiert** — der wichtigste Nachfass-Stapel
- **Nachfassen fällig** — kontaktiert vor > 14 Tagen, keine Antwort
- **Ohne Website** — der ServiWeb-Kernmarkt
- **Nur Instagram, keine Website** — beste Kontaktierbarkeit

Plus CSV-Export, Kopfzeile mit Zahlen (X neu / Y kontaktiert / Z Kunden),
und Karte ↔ Liste synchronisiert.

---

## 7b. Bestandsdaten (Seed)

Diese Läden sind bekannt und werden in Phase 6 fix eingetragen, damit die
Karte vom ersten Tag an deinen echten Stand zeigt:

| Betrieb | Ordner | Status |
|---|---|---|
| Tiger, Wil | `tiger-wil-website`, `tiger-redesign`, `resti-tiger` | `kunde` |
| Vision, Wil | `vision_wil` | `kunde` |
| Trinkstube zum Hartz | `Trinkstube zum Hartz` | `pausiert` |
| Säntis Kebab | `saentis-kebab` | `in_gespraech` |
| Barcelona Central | `barcelona-central` | `in_gespraech` |
| Goldenes Rössli, Wil | `goldenes-roessli-wil` | `abgelehnt` |
| Art(s), Wil | `art-wil`, `Street Art` | `abgelehnt` |

Nicht gastro und damit **nicht** auf der Karte: `dj-ostschweiz`,
`djhappytunes`, `Sellux`, `Lernapp`, `Twitter_copy`.

Noch ungeklärt (siehe §9 F1): `loewen-pub`, `rebstock`, `vibes-wil`,
`Ilge-pianobar`.

---

## 8. Bau-Phasen

Jede Phase ist einzeln startbar und endet mit etwas Benutzbarem. Phasen mit
🔎 haben einen vorgeschalteten Recherche-Schritt (Online-Recherche zu APIs,
Limits, Query-Design), bevor Code entsteht.

| # | Phase | Start-Befehl | Ergebnis |
|---|---|---|---|
| 0 | ✅ **Fundament** | erledigt | Express + SQLite, `npm start` → :8788 |
| 1 | ✅ **Karte & Discovery** | erledigt | Ortssuche, „Bereich durchsuchen", 75 echte Betriebe aus OSM in Wil |
| 2 | ✅ **Pins, Farbcode, Detail** | erledigt | Zwei-Dimensions-Marker, Clustering, Legende, Detail-Panel mit Sofort-Speicherung, manuelle Pins |
| 3 | ✅ **Filter & Übersicht** | erledigt | Filterleiste, 6 gespeicherte Filter, Listenansicht, CSV-Export, Statistik |
| 4 | ✅ **Job-Engine** | erledigt | Queue mit Concurrency 2, `claude -p`-Runner, Live-Log per SSE, Abbruch, Tageslimit je Auftragsart, Auto-Pause bei Rate-Limit |
| 5 | ✅ **Aktion Analyse** | erledigt | Zwei Prüftiefen auf Sonnet: Schnell-Check (~30 s, nur Score-Fragen, für ganze Ausschnitte) und volle Analyse mit `data/analysen/<slug>.md`. Beide schreiben geprüft in die DB zurück und rechnen den Score neu; Fortschrittsstreifen über der Karte |
| 6 | ✅ **Aktion Demo bauen** | erledigt | `restaurant-website-build` verdrahtet: Ordner wird vorbereitet (Analyse als `research.md`, Vorbildprojekt als `_referenz/`), Bau auf Opus im eigenen Ordner, Ergebnis wird geprüft. Neue Seite **Demos** gleicht die 19 bestehenden Ordner mit der Karte ab |
| 7 | ✅ **CRM-Tiefe** | erledigt | Kontakt-Historie je Betrieb (Kanal, Ergebnis, Notiz) mit automatischem Statusfortschritt, Wiedervorlage mit Datum und Grund, Kontakt-Entwürfe (Aktion C), Funnel in der Liste |
| 8 | ✅ **Härtung & Skalierung** | erledigt | Seite **Wartung**: Regions-Suche über Ortslisten (mit Kachelzerlegung), Dublettensuche und Zusammenführen, Sicherungen, Datenbank-Zustand. 10 000-Pins-Test gemessen, schlanke Kartennutzlast, Google-Adapter abschaltbar |

**Vorschlag für den Einstieg:** Phase 0–3 am Stück. Danach hast du eine
voll benutzbare Karte mit echten Daten, Farbcode und Filtern — komplett
ohne Agenten-Komplexität. Ob dir die Bedienung passt, merkst du dort, und
Korrekturen sind vor Phase 4 billig.

---

## 9. Geklärt und offen

### Geklärt

- **Instagram** — es wird nur erfasst, ob ein aktiver Account existiert
  (`ja` / `nein` / `inaktiv`) plus das Handle. Keine Followerzahlen. Das ist
  auch das ehrlichere Versprechen, weil Instagram Massenauslesen sperrt.
- **Abrechnung** — Claude Max, deshalb Deckelung über Modell-Split und
  Tageskontingent statt USD (§5).
- **Hosting** — lokal zuerst, aber ohne Sackgassen: Konfiguration über
  `.env` statt fest verdrahtetem `localhost`, API sauber vom Frontend
  getrennt, `user_id`-Spalte von Anfang an im Schema. Ein späterer Umzug auf
  einen Server mit Login ist damit ein Zusatz, kein Umbau.
- **Sprache** — durchgehend Deutsch, inklusive Status-Keys.
- **Startregion** — Wil / Ostschweiz.

### Offen

**F1 — Vier unklare Ordner.** Der Abgleich in Phase 6 hat drei davon in den
Daten wiedergefunden; offen ist jetzt nur noch der Status:

| Ordner | Treffer in der Karte | offen |
|---|---|---|
| `rebstock` | Rebstock (100 %) | Status? |
| `vibes-wil` | Vibes Lounge Bar Hookah (100 %) | Status? |
| `Ilge-pianobar` | Ilge, Wil SG (100 %) | Status? |
| `loewen-pub` | Taverna zum Löwen, **Sirnach** (100 %) | derselbe Laden? |

Entschieden wird das auf der Seite **Demos** — bis dahin ist nichts
verknüpft. `vision_wil` hat bewusst keinen Vorschlag: „Vision" steht nicht in
der Karte, der Pin fehlt also noch.

**F2 — Was fehlt noch?** Solange das Schema formbar ist, billig
nachzurüsten; später teuer:

- Foto des Lokals direkt im Detail-Panel
- Routenplanung für einen Akquise-Tag („zeig mir die 8 heissesten Läden in
  Wil als Laufroute")
- Wiedervorlage-Erinnerungen mit Datum
- Umsatz/Deal-Wert pro Kunde, für eine echte Pipeline-Summe
