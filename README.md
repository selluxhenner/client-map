# ServiWeb Client-Map

Gastro-Akquise auf der Karte. Betriebe finden, nach Potenzial bewerten und
den eigenen Vertriebsstand verfolgen — lokal, ohne Cloud, ohne API-Key.

## Starten

```bash
npm install
cp .env.example .env
npm start
```

Dann `http://localhost:8788` öffnen.

## Erste Schritte

1. Oben links den Ort suchen, z. B. **Wil SG**, und Enter drücken.
2. Auf **Diesen Bereich durchsuchen** klicken. Alle Restaurants, Bars und
   Cafés im sichtbaren Ausschnitt kommen aus OpenStreetMap in die Datenbank.
3. Auf einen Pin klicken. Rechts öffnet sich das Detail-Panel: Status setzen,
   Notizen schreiben, Website- und Instagram-Zustand beurteilen. Alles
   speichert sofort.
4. Unter **Liste** dieselben Daten als Tabelle, sortierbar und als CSV
   exportierbar.
5. Im Detail-Panel auf **🔍 Analyse** klicken. Claude recherchiert den Laden
   im Netz und schreibt das Ergebnis zurück (siehe unten).

## Drei Geschwindigkeiten

| | **⚡ Daten sammeln** | **⚡ Schnell-Check** | **🔍 Analyse** |
|---|---|---|---|
| Wer arbeitet | der Server selbst, per HTTP | Claude (Sonnet) | Claude (Sonnet) |
| Frage | Läuft die Website? Telefon, Mail, Instagram, Facebook | Website und Instagram — alles, was den Score bewegt | Wer ist der Laden, und womit spricht man ihn an |
| Dauer | ~2 s je Betrieb, 8 gleichzeitig | ~30 s | 2–3 min |
| Kosten | keine | Kontingent | Kontingent |
| Wofür | den ganzen Bestand auf einmal | was sich nicht messen lässt | die Läden, die dabei oben landen |

Der Web-Check misst, die beiden anderen urteilen. Deshalb setzt er nie
`Modern und gut` und überschreibt auch kein Urteil aus einer Analyse — er
korrigiert nur Messwerte und füllt leere Felder. Und ein Schnell-Check über
einen Betrieb, für den schon eine volle Analyse vorliegt, frischt nur die
Fakten auf und lässt den Text in Ruhe.

## Daten sammeln (ohne Agent, ohne Kontingent)

Der Knopf **⚡ Daten sammeln** steht auf Karte und Liste und arbeitet den
aktuellen Filter ab — auf der Karte zusätzlich begrenzt auf den sichtbaren
Ausschnitt. Für jeden Betrieb mit hinterlegter Website:

1. Website abrufen (zweiter Versuch bei Fehlschlag, HTTP-Rückfall ohne SSL),
2. Startseite und, falls nötig, die verlinkte Kontakt- oder Impressumsseite
   nach `tel:`, `mailto:`, Instagram- und Facebook-Links durchsuchen,
3. Website-Zustand daraus bestimmen: tote Domain, Platzhalterseite, kein
   HTTPS oder kein Viewport → `Kaputt`; alte Bautechnik → `Veraltet`; sonst
   höchstens `Brauchbar`.

Gefüllt werden nur **leere** Felder — von Hand Eingetragenes bleibt stehen.
Bleibt der Befund offen (Zeitlimit, Namensauflösung gescheitert), wird
**nichts** geschrieben und der Betrieb bleibt ungeprüft; ein DNS-Aussetzer
darf keine lebende Website als „kaputt" in die Datenbank schreiben.

Betriebe **ohne** hinterlegte Website kann der Web-Check nicht beantworten —
dafür ist der Schnell-Check da. Nur mit `GOOGLE_PLACES_KEY` schlägt er sie
zusätzlich bei Google nach; erst dann ist „hat keine Website" belegt.

Einzelne Betriebe prüft der Knopf **⚡ Web-Check (gratis)** im Detail-Panel,
sofort und mit Antwort.

## Analyse durch Claude

Der Knopf **Analyse** startet im Hintergrund einen Claude-Lauf (Modell
Sonnet), der den Betrieb online recherchiert: eigene Website und in welchem
Zustand, Instagram inklusive Aktivität, Facebook, Telefon, Mail,
Öffnungszeiten, Bewertungen, Kette ja/nein, geschlossen ja/nein — und was den
Laden ausmacht.

Das Ergebnis landet an zwei Orten:

- **`data/analysen/<slug>.md`** — die lesbare Fassung mit Kurzfazit,
  Aufhängern für die Ansprache und Quellen. Im Detail-Panel unter „Analyse"
  über **Volltext anzeigen**.
- **In der Datenbank** — die Faktenfelder werden korrigiert, der Score neu
  berechnet, der Status springt von `neu` auf `recherchiert`.

Notizen, Tags und ein bereits von Hand gesetzter Status werden dabei nie
überschrieben.

**🔍 Pins bewerten** auf der Karte schickt alle ungeprüften Betriebe im
aktuellen Ausschnitt durch den Schnell-Check. Vor dem Start kommt eine
Rückfrage mit echten Zahlen und einer Zeitschätzung; pro Lauf gehen höchstens
25 Betriebe in die Schlange. Ein Streifen über der Karte zählt mit, was dabei
herauskommt — wie viele ohne Website, wie viele mit aktivem Instagram, wie
viele heiss.

Im Zahnrad oben rechts läuft der Live-Log mit: was der Agent gerade tut, was
er verbraucht hat, ein Abbruch-Knopf und **Warteschlange leeren** für alles,
was noch nicht angefangen hat.

### Bremsen

| `.env` | Standard | Wirkung |
|---|---|---|
| `JOB_CONCURRENCY` | 4 | Wie viele Agenten gleichzeitig laufen |
| `JOB_LIMIT_SCHNELL` | 150 | Schnell-Checks pro Tag |
| `JOB_LIMIT_ANALYSE` | 40 | volle Analysen pro Tag |
| `JOB_LIMIT_KONTAKT` | 60 | Kontakt-Entwürfe pro Tag |
| `JOB_LIMIT_DEMO` | 5 | Demo-Builds pro Tag |
| `JOB_BATCH_MAX` | 25 | Betriebe pro Stapellauf |
| `CLAUDE_BIN` | automatisch | Pfad zur Claude-CLI, falls sie woanders liegt |
| `BACKUP_KEEP` | 20 | wie viele Sicherungen behalten werden |
| `REGION_PAUSE_MS` | 1500 | Pause zwischen zwei Overpass-Kacheln |
| `GOOGLE_ENABLED` | – | `0` schaltet Google ab, ohne den Schlüssel zu entfernen |

Meldet die CLI ein Rate-Limit, pausiert die Schlange von selbst und sagt es
in der Oberfläche — statt reihenweise Aufträge in Fehler laufen zu lassen.

### Abrechnung

Die Aufträge starten dieselbe Claude-CLI, mit der du im Terminal arbeitest,
und benutzen deren Anmeldung. Ist das ein Abo, laufen sie gegen dein
Nutzungskontingent und **erzeugen keine Rechnung pro Auftrag**. Die
Dollarbeträge in der Schublade sind dann ein Verbrauchsmass, keine Kosten.

Im Kopf der Auftrags-Schublade steht, was gerade gilt: **Max-Abo** (grün) oder
**API-Abrechnung** (orange). Prüfen kannst du es auch selbst:

```bash
claude auth status
```

Damit nichts unbemerkt umschaltet, gibt der Server die Variablen
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`,
`CLAUDE_CODE_USE_BEDROCK` und `CLAUDE_CODE_USE_VERTEX` **nicht** an die
Agenten weiter — sonst würde ein Schlüssel, der aus einem anderen Grund in
der `.env` liegt, die Aufträge auf API-Abrechnung umstellen. Wer das
ausdrücklich will: `JOB_ALLOW_API_BILLING=1`.

## Demo bauen

**🔨 Demo bauen** im Detail-Panel startet die Skill `restaurant-website-build`
auf Opus. Vorher legt der Server den Ordner an und füllt ihn:

- **`research.md`** — die vorhandene Analyse. Der Agent muss Phase 1 nicht neu
  machen, das spart einen guten Teil des Laufs. Fehlt die Analyse, recherchiert
  er selbst — dann dauert es deutlich länger, und die Rückfrage sagt das auch.
- **`_referenz/<projekt>/`** — der Quelltext einer fertigen Seite als Vorbild,
  damit die neue Demo denselben Aufbau bekommt. Wird nach dem Bau entfernt.

Das Arbeitsverzeichnis ist genau dieser eine Ordner. Im Auftragsordner liegen
echte Kundenprojekte ohne Git-Sicherung, dort schreibt der Agent nicht hinein.
Bleibt der Ordner am Ende leer, gilt der Auftrag als **fehlgeschlagen** — der
Pin wird nur violett, wenn wirklich eine Seite entstanden ist.

| `.env` | Standard | Wirkung |
|---|---|---|
| `DEMO_DIR` | `D:\03 Business\Aufträge\03_Demos` | wohin neue Demos gebaut werden |
| `DEMO_SCAN_DIRS` | `DEMO_DIR` + Ordner darüber | wo nach bestehender Arbeit gesucht wird, mit `;` getrennt |
| `DEMO_REFERENCE` | jüngstes fertiges Projekt | welches Projekt als Vorbild dient |

## Demo-Ordner abgleichen

Die Seite **Demos** listet alle Projektordner auf der Platte und schlägt vor,
zu welchem Betrieb jeder gehört — aus dem Ordnernamen und aus PLAN §7b.
Übernommen wird nichts von selbst: du prüfst die Zuordnung, wählst den Status
und bestätigst. Ein falscher Treffer würde sonst einen Pipeline-Status
verfälschen.

Ordner ohne plausiblen Treffer bleiben leer statt geraten. `📂` zeigt den
Ordner im Explorer.

## Kontakte verfolgen

Im Detail-Panel unter **Kontakt-Historie** trägst du jeden Kontakt ein: Datum,
Kanal (Instagram-DM, Mail, Telefon, vorbeigegangen), Ergebnis und eine Notiz.

Der Pipeline-Status zieht automatisch mit, **aber nur vorwärts**:

| Ergebnis | Status danach |
|---|---|
| Noch keine Antwort · Hat geantwortet | Kontaktiert |
| Termin vereinbart | Im Gespräch |
| Auftrag | Kunde |
| Kein Interesse | Kontaktiert |

„Kein Interesse" setzt bewusst **nicht** auf Abgelehnt — eine unbeantwortete
DM ist noch kein Nein. Und aus einem Kunden wird durch eine neue Notiz nie
wieder ein Kontaktierter.

**Wiedervorlage:** ein Datum plus ein Satz, warum. Die Knöpfe `+7 T`, `+14 T`,
`+30 T` setzen es in einem Klick. Fällige stehen rot in der Liste, im Funnel
und hinter dem Schnellfilter **⏰ Wiedervorlage fällig**.

## Kontakt-Entwurf

**✍️ Kontakt-Entwurf** schreibt aus der Analyse eine Instagram-DM und eine
E-Mail — Du-Form fürs DM, Sie-Form für die Mail, beide mit einem konkreten
Aufhänger aus der Recherche statt „ich habe Ihre Website gesehen".

Im Panel stehen sie mit **Kopierknopf**. **Die App verschickt nie etwas** —
du liest, änderst was nicht passt, und schickst selbst.

Dazu Hinweise, was vor dem Absenden noch fehlt: eine DM über 450 Zeichen wird
von Instagram abgeschnitten (wird gemeldet, nicht gekürzt), ein fehlendes
Instagram-Handle, oder der Platzhalter `[DEMO-LINK]` — die Demos liegen lokal,
eine öffentliche Adresse müsstest du selbst einsetzen.

Dauert rund 25 Sekunden und läuft ohne jedes Werkzeug.

## Funnel

Über der Liste steht der Trichter: wie viele Betriebe jede Stufe **mindestens
erreicht** haben, mit der Quote zur Stufe davor — dort sieht man, wo es
klemmt. Ein Klick filtert auf die Stufe.

Daneben **ausgeschieden** (abgelehnt, kein Fit, Website schon gut,
geschlossen) und **⏰ fällig**. Trichterspitze plus Ausgeschiedene ergibt immer
die Gesamtzahl — pausierte Kunden zählen als gewonnene Kunden, denn sie haben
den Trichter durchlaufen.

## Der Farbcode

**Farbe des Pins = wie weit bist du mit dem Laden**

| | |
|---|---|
| Grau | Neu — gefunden, noch nichts gemacht |
| Blau | Recherchiert |
| Indigo | **Interessiert** — von dir vorgemerkt: Demo bauen und ansprechen |
| Violett | Demo gebaut |
| Orange | Kontaktiert |
| Gelb | Im Gespräch |
| Grün | Kunde |
| Türkis | Pausiert |
| Rot | Abgelehnt — er wollte nicht |
| Steingrau | **Website schon gut** — kein Bedarf, in zwei Jahren neu ansehen |
| Dunkelgrau | Kein Fit — Kette, zu klein, passt nicht |
| Schwarzgrau | **Geschlossen** — Betrieb existiert nicht mehr |

`Interessiert` ist dein Stapel für die nächsten Demos — dafür gibt es den
Schnellfilter **Vorgemerkt für Demo**. Kein Agentenlauf stellt diesen Status
zurück; nur eine belegte Schliessung überschreibt ihn.

Bei `Geschlossen` und `Website schon gut` fragt das Detail-Panel, ob es das
passende Faktenfeld mitsetzen soll (`Dauerhaft geschlossen` bzw. Website-Zustand
`modern und gut`). Es tut das nicht von selbst: der Status ist deine
Buchführung, das Faktenfeld steuert Score und Sichtbarkeit auf der Karte.

**Ring um den Pin = wie gut ist der Lead**

Dünn grau = kalt · mittel orange = interessant · dick rot + 🔥 = heiss (70+)

**Gestrichelter Ring = ungeprüft.** Die Daten kommen roh aus OpenStreetMap.
Ein fehlender Website-Eintrag ist dort **kein Beweis**, dass der Betrieb keine
Website hat. Solange der Ring gestrichelt ist, ist der Score eine Vermutung.
Die Analyse klärt das — aber nur, wenn sie die Website-Frage wirklich
beantworten konnte. Bleibt sie offen, bleibt der Ring gestrichelt. Das Häkchen
„Von mir geprüft" kannst du jederzeit selbst setzen.

## Punkte

| Signal | Punkte |
|---|---|
| Keine Website (belegt) | +40 |
| Website kaputt / kein SSL / nicht mobil | +30 |
| Website veraltet | +20 |
| Website unbekannt | +20 vorläufig |
| Website modern und gut | −10 |
| Instagram aktiv | +25 |
| Instagram vorhanden, aber inaktiv | +15 |
| ≥ 50 Bewertungen und ≥ 4.0 ★ | +15 |
| Unter 10 Bewertungen | −10 |
| Telefon oder Mail vorhanden | +5 |
| Kette / Franchise | −20 |

Zum Ändern: `server/scoring.js`. Das Detail-Panel zeigt zu jedem Betrieb,
wie sich seine Punkte zusammensetzen.

## Wartung

Die Seite **Wartung** bündelt alles, was man selten braucht und dann genau
wissen will.

**🌍 Regions-Suche** — eine Liste von Ortsnamen, ein Ort pro Zeile, und die
App sucht sie nacheinander ab. Grosse Gebiete werden automatisch in Kacheln
zerlegt, weil Overpass bei einem ganzen Kanton ins Zeitlimit läuft und dann
gar nichts liefert. Rechne mit einer halben bis zwei Minuten pro Ort; der Lauf
läuft im Hintergrund weiter, auch wenn du zur Karte wechselst.

**Doppelte Betriebe** — gesucht wird über Telefonnummer, E-Mail, Website,
Instagram und Namensgleichheit in Gehweite, **nicht** über den Abstand allein:
in der Wiler Altstadt liegen über hundert verschiedene Lokale weniger als 80 m
auseinander. Zusammengeführt wird nur auf Klick, mit einer Vorschau, wer
bleibt. Dabei gehen keine Daten verloren — leere Felder werden gefüllt,
Notizen aneinandergehängt, die Kontakt-Historie zieht mit um, und der weiter
fortgeschrittene Status gewinnt.

**💾 Sicherungen** — eine in sich geschlossene Kopie der Datenbank. Kopiere die
Datei **nicht** im Explorer: im Betrieb steht ein Teil der Daten im Journal und
würde fehlen. Vor jedem Zusammenführen wird automatisch gesichert. Die 20
neuesten werden behalten (`BACKUP_KEEP`), die Wiederherstellung ist auf der
Seite Schritt für Schritt beschrieben.

**Datenbank** — Grösse, Schema-Version, Integritätsprüfung, Zeilenzahlen und
der Zustand des Google-Adapters. `Aufräumen (VACUUM)` führt das Journal zusammen
und gibt Platz frei.

## Grösse

Gemessen mit 10 000 Betrieben: Kartenausschnitt einer Stadt 2,8 ms, einer
Region 50 ms, Statuszählung 2,4 ms, Datenbank 4,2 MB. Die Karte lädt bewusst
nur sieben Spalten pro Betrieb (1,2 MB statt 9,4 MB) und holt den vollen
Datensatz erst beim Anklicken. Über 8000 Pins im Bild wird gekappt — und
gesagt.

Google Places bleibt ohne `GOOGLE_PLACES_KEY` vollständig inaktiv. Mit
Schlüssel liefert es Bewertungen und geprüfte Website-Adressen, aber
höchstens 20 Treffer pro Anfrage — wird gekappt, steht das in der Meldung.
`GOOGLE_ENABLED=0` schaltet es ab, ohne den Schlüssel zu entfernen.

## Was noch fehlt

Alle Phasen aus [PLAN.md](PLAN.md) sind gebaut. Die offenen Ideen stehen dort
in §9 F2: Foto im Detail-Panel, Routenplanung für einen Akquise-Tag,
Deal-Werte für eine echte Pipeline-Summe.
