# Xianxia-Spielclient (Phaser 3)

Der eigentliche Spielclient: Phaser 3 + TypeScript (Vite, offizielles `spacetimedb`-SDK),
Schrägansicht von oben (nicht gedreht: Norden = oben; Kacheln 64×40). Spricht mit demselben SpacetimeDB-Modul
(`spacetimedb/Lib.cs`) wie der ältere Top-Down-Testclient `web_client/`, der als Testwerkzeug und
für den Karteneditor (`web_client/editor.html`) bestehen bleibt.

## Server starten (separates Terminal)

```bash
spacetime start
scripts/publish.sh local     # aus dem Repo-Root, siehe CLAUDE.md
```

## Client starten

```bash
cd client
npm install   # einmalig
npm run dev
```

Wie beim `web_client` bindet Vite an alle Interfaces; der Standard-Server wird aus dem
aufgerufenen Hostnamen abgeleitet (`ws://<host>:3000` über `http:`, `wss://db<host>` über
`https:`), Override per `?server=...&db=...`:

```
http://localhost:5173/?server=ws://127.0.0.1:3000&db=xianxia
```

Produktions-Build (statische Dateien in `dist/`, Phaser als eigener Chunk):

```bash
npm run build      # tsc --noEmit + vite build
npm run preview
```

Tests (reine Logik, ohne Phaser/Browser): `npm test`.

## Steuerung

- **Login-Screen**: Name/Passwort, "Registrieren" oder "Login" (Enter = Login). Gleicher Ablauf
  und gleiche Meldungen wie im `web_client`, Passwort wird clientseitig per SHA-256 gehasht.
- **Bewegung**: WASD oder Pfeiltasten, Feld für Feld. Die Tasten bewegen entlang der
  Gitterachsen wie im `web_client`: **W = oben (Norden), S = unten, A = links, D = rechts**.
  Wasser und Berge
  blockieren (client- und serverseitig).
- **Mausrad**: Zoom (0,3×–3×). Unter 0,6× werden Namensschilder ausgeblendet.
- **Qi sammeln** / **Durchbruch** / **Angreifen**: Buttons unten rechts. Durchbruch wird aktiv,
  sobald das Qi voll ist, Angreifen sobald ein NPC auf einem der 8 Nachbarfelder steht.
  Ergebnis eines Durchbruchs wird kurz eingeblendet.
- **M** oder **Karte (M)**: Kartenübersicht (Norden oben, wie Welt und Karteneditor).
- **Logout**: verwirft die Identity dieses Tabs und lädt neu (wie im `web_client`).

Änderungen aus dem Karteneditor (Terrain, NPCs, Spieler verschieben/löschen) erscheinen live.

## Mehrere Spieler testen

Die Identity liegt wie im `web_client` in `sessionStorage` (pro Tab). Phaser pausiert die
Spielschleife in Hintergrund-Tabs — zum gleichzeitigen Zuschauen also zwei **Fenster**
nebeneinander statt zwei Tabs im selben Fenster verwenden. Die Verbindung eines verdeckten Tabs
läuft weiter; beim Zurückwechseln stimmt der Zustand sofort wieder.

## Bekannte Einschränkungen (Phase 1)

- Platzhalter-Grafik: Biome als programmatisch erzeugte Kacheln, Figuren als einfarbige Formen.
- Keine Touch-Steuerung (der `web_client` hat ein D-Pad; im Phaser-Client noch nicht).
- Neue Spieler starten auf (128,128) — bei Seed 42 Wasser, rundherum ebenfalls Wasser, man kann
  sich dort nicht bewegen. Server-Bug in `Register`, nicht im Client; bis zu einem Fix den
  Spieler im Karteneditor auf Land ziehen.
- Kein automatischer Reconnect bei Verbindungsabbruch (wie `web_client`).

Architektur und Konventionen: siehe `CLAUDE.md`, Abschnitt "Game client architecture".
