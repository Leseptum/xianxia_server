# Pygame Test-Client (Xianxia)

Ein reines Proof-of-Concept/Test-Werkzeug, um den SpacetimeDB-Server (`spacetimedb/Lib.cs`)
ohne Godot zu testen: Login/Registrierung, Weltkarte, Qi-Kultivierung, Bewegung.

**Kein Ersatz für den echten Godot-Client.** Vereinfachtes 2D-Top-Down-Rendering
(keine Isometrie), Verbindung läuft über die SpacetimeDB HTTP-API mit Polling
(kein Echtzeit-WebSocket) — für ein Test-Tool ausreichend, für ein echtes Spiel nicht.

## Setup

```bash
cd pygame_client
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Server starten (in einem separaten Terminal, siehe Haupt-README)

```bash
cd ../spacetimedb
spacetime start
spacetime publish --server local xianxia
```

## Client starten

```bash
cd pygame_client
python main.py
```

Standardmäßig verbindet der Client zu `http://127.0.0.1:3000` mit Datenbank `xianxia`
(passend zu `spacetime.local.json`). Überschreibbar via Umgebungsvariablen:

```bash
export XIANXIA_SERVER_URL=http://127.0.0.1:3000
export XIANXIA_DB_NAME=xianxia
```

Für Maincloud: `XIANXIA_SERVER_URL=https://maincloud.spacetimedb.com`.

## Im Browser laufen lassen (Web-Build via Pygbag)

Der Client läuft über [Pygbag](https://github.com/pygame-web/pygbag) auch im
Browser (inkl. Handy-Browser) — kompiliert nach WebAssembly. Es ist dieselbe
Codebasis: intern wird nur die HTTP-Schicht umgeschaltet (Desktop: `requests`;
Web: die Browser-`fetch`-API), erkannt an `sys.platform == "emscripten"`.

```bash
pip install pygbag
# aus dem Repo-Root (pygbag erwartet main.py als Einstieg):
python -m pygbag pygame_client/main.py
```

Das startet einen lokalen Testserver auf <http://localhost:8000>. Für ein
statisches Deployment (GitHub Pages, itch.io, …) den Ordner `pygame_client/build/web/`
hochladen.

Server/Datenbank im Web per URL-Query-Param wählen (Default: Maincloud):

```
index.html?server=https://maincloud.spacetimedb.com&db=xianxia
```

### ⚠️ CORS (wichtig)

Im Browser erzwingt `fetch` **CORS**: Der SpacetimeDB-Server muss
`Access-Control-Allow-Origin` senden und Preflight-Requests (`OPTIONS`) für
`POST` mit `Authorization`/`Content-Type` beantworten — sonst blockt der Browser
**jede** Anfrage, unabhängig vom Client-Code.

- **Maincloud** sendet i.d.R. passende CORS-Header → funktioniert.
- Ein lokaler `spacetime start` erlaubt CORS evtl. nicht. Dann entweder gegen
  Maincloud testen oder einen CORS-fähigen Reverse-Proxy davorschalten.
- Ein `http://`-Server ist aus einer `https://`-Seite ohnehin geblockt
  (Mixed Content) — im Web also einen `https://`-Endpunkt verwenden.

## Steuerung

- **Login-Screen**: Name/Passwort eingeben, "Registrieren" (neuer Kultivator) oder
  "Login" (bestehender Kultivator).
- **Bewegung**: WASD oder Pfeiltasten.
- **Qi sammeln**: Button unten rechts, ruft den `QiSammeln`-Reducer auf (+10 Qi).
- **Durchbruch**: aktiv sobald Qi voll ist, ruft den `Durchbruch`-Reducer auf.
- **M**: wechselt zwischen normaler (Kamera folgt Spieler) und Kartenansicht
  (ganze 256x256-Weltkarte auf den Bildschirm skaliert, alle Spieler als Punkte).

## Bekannte Einschränkungen (bewusste Vereinfachungen für den POC)

- HTTP-Polling statt WebSocket-Subscriptions: andere Spieler "springen" alle ~400ms
  nach, statt weich zu interpolieren. Die eigene Figur bewegt sich lokal sofort
  (Client-Prediction), nur `UpdatePosition` wird gedrosselt an den Server geschickt.
- Die Identität wird auf dem Desktop in `.stdb_identity.json` zwischengespeichert
  (gitignored), im Browser im `localStorage` — wird sie gelöscht, verliert der
  Client den Zugriff auf den zuvor registrierten Kultivator (Server bindet
  `PlayerId` an die anfragende Identity).
- Kein Kollisionssystem (man kann z.B. über Wasser-Tiles laufen).
- Die Weltkarte (`WorldTile`, 65536 Zeilen) wird einmalig geladen und auf dem
  Desktop lokal als `world_cache_seed<N>.bin` zwischengespeichert (gitignored).
  Im Browser gibt es kein persistentes Dateisystem → dort wird die Karte bei
  jedem Start frisch geladen (ein einzelner Query).
- Pygbag/WASM liefert eine Web-/PWA-Version, **keinen** nativen App-Store-Build
  (kein APK/IPA). Für echtes Mobile bleibt Godot der Weg.
