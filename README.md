# ServiWeb Client-Map

Gastro-Akquise auf der Karte. Betriebe finden, nach Potenzial bewerten und
den eigenen Vertriebsstand verfolgen — lokal, ohne Cloud, ohne API-Key.

## Starten

```bash
npm install
cp .env.example .env
npm start
```

Dann `http://localhost:8787` öffnen.

## Erste Schritte

1. Oben links den Ort suchen, z. B. **Wil SG**, und Enter drücken.
2. Auf **Diesen Bereich durchsuchen** klicken. Alle Restaurants, Bars und
   Cafés im sichtbaren Ausschnitt kommen aus OpenStreetMap in die Datenbank.
3. Auf einen Pin klicken. Rechts öffnet sich das Detail-Panel: Status setzen,
   Notizen schreiben, Website- und Instagram-Zustand beurteilen. Alles
   speichert sofort.
4. Unter **Liste** dieselben Daten als Tabelle, sortierbar und als CSV
   exportierbar.

## Der Farbcode

**Farbe des Pins = wie weit bist du mit dem Laden**

| | |
|---|---|
| Grau | Neu — gefunden, noch nichts gemacht |
| Blau | Recherchiert |
| Violett | Demo gebaut |
| Orange | Kontaktiert |
| Gelb | Im Gespräch |
| Grün | Kunde |
| Türkis | Pausiert |
| Rot | Abgelehnt |
| Dunkelgrau | Kein Fit |

**Ring um den Pin = wie gut ist der Lead**

Dünn grau = kalt · mittel orange = interessant · dick rot + 🔥 = heiss (70+)

**Gestrichelter Ring = ungeprüft.** Die Daten kommen roh aus OpenStreetMap.
Ein fehlender Website-Eintrag ist dort **kein Beweis**, dass der Betrieb keine
Website hat. Solange der Ring gestrichelt ist, ist der Score eine Vermutung.
Ab Phase 5 klärt das die Claude-Analyse; bis dahin setzt du das Häkchen
„Von mir geprüft" von Hand.

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

## Was noch fehlt

Phase 4–8 aus [PLAN.md](PLAN.md): Job-Engine, Analyse durch Claude,
automatischer Demo-Build über die `restaurant-website-build`-Skill,
Kontakt-Historie und Skalierung. Die Aktionsknöpfe im Detail-Panel sind
bereits sichtbar, aber noch deaktiviert.
