# Pygame Test-Client (Xianxia)

Ein reines Proof-of-Concept/Test-Werkzeug, um den SpacetimeDB-Server (`spacetimedb/Lib.cs`)
ohne Godot zu testen: Login/Registrierung, Weltkarte, Qi-Kultivierung, Bewegung.

**Kein Ersatz für den echten Godot-Client.** Vereinfachtes 2D-Top-Down-Rendering
(keine Isometrie), Verbindung läuft über die SpacetimeDB HTTP-API mit Polling
(kein Echtzeit-WebSocket) — für ein Test-Tool ausreichend, für ein echtes Spiel nicht.

Der Client läuft ausschließlich als Web-Build (Pygbag/WebAssembly) im Browser —
es gibt keinen Desktop/CPython-Modus.

## Server starten (in einem separaten Terminal, siehe Haupt-README)

```bash
cd ../spacetimedb
spacetime start
spacetime publish --server local xianxia
```

## Im Browser laufen lassen (Web-Build via Pygbag)

Der Client läuft über [Pygbag](https://github.com/pygame-web/pygbag) im
Browser (inkl. Handy-Browser) — kompiliert nach WebAssembly. HTTP läuft
komplett über die Browser-`fetch`-API.

### Schnellstart (empfohlen)

```bash
pip install pygbag
python3 pygame_client/serve_web.py
```

Das baut den Client und serviert ihn auf **Port 64646**. Das Script bindet an
deine **LAN-IP** und gibt die zu verwendende URL aus — z.B.:

```
http://192.168.178.65:64646/
```

**Genau diese URL** verwenden, auch auf demselben Rechner (bei Bind auf die
LAN-IP funktioniert `localhost:64646` *nicht*). Vom Handy im selben Netz dieselbe
URL öffnen.

- Nur auf diesem Rechner (localhost): `XIANXIA_WEB_HOST=localhost python3 pygame_client/serve_web.py`
- Bestimmte IP erzwingen: `XIANXIA_WEB_HOST=192.168.178.65 python3 pygame_client/serve_web.py`
- Anderer Port: `XIANXIA_WEB_PORT=8080 python3 pygame_client/serve_web.py`

> **Troubleshooting:** Bleibt der Browser bei „Downloading…“ hängen und die
> Konsole zeigt eine URL mit Host `0.0.0.0` (z.B.
> `http://0.0.0.0:64646//cdn/…/pythons.js`)? Dann wurde an `0.0.0.0` gebunden —
> pygbag backt die Bind-Adresse in die Asset-URLs, und `0.0.0.0` lehnt der
> Browser ab. `serve_web.py` bindet deshalb an einen konkreten Host; öffne exakt
> die vom Script ausgegebene URL.

### Manuell / Deployment

```bash
# aus dem Repo-Root (pygbag erwartet main.py als Einstieg):
python -m pygbag pygame_client/main.py        # Testserver auf :8000
```

Für ein statisches Deployment (GitHub Pages, itch.io, eigener Apache …) den
Ordner `pygame_client/build/web/` hochladen. Achtung: der ausliefernde Server
muss die Cross-Origin-Header `Cross-Origin-Opener-Policy` /
`Cross-Origin-Embedder-Policy` setzen (das macht `serve_web.py` bzw. pygbags
Testserver automatisch).

Server/Datenbank im Web per URL-Query-Param wählen (Default: lokaler Server,
LAN-IP fest in `config.py` hinterlegt — `xianxia` ist aktuell nicht auf
Maincloud veröffentlicht):

```
index.html?server=https://maincloud.spacetimedb.com&db=xianxia
```

### ⚠️ CORS (wichtig)

Im Browser erzwingt `fetch` **CORS**: Der SpacetimeDB-Server muss
`Access-Control-Allow-Origin` senden und Preflight-Requests (`OPTIONS`) für
`POST` mit `Authorization`/`Content-Type` beantworten — sonst blockt der Browser
**jede** Anfrage, unabhängig vom Client-Code.

- **Maincloud** sendet passende CORS-Header → funktioniert.
- Ein lokaler `spacetime start` sendet ebenfalls unconditional
  `Access-Control-Allow-Origin: *` (getestet mit Version 2.7.0-hotfix3, keine
  Konfiguration nötig) — CORS ist hier also normalerweise kein Thema.
- Ein `http://`-Server ist aus einer `https://`-Seite ohnehin geblockt
  (Mixed Content) — im Web also einen `https://`-Endpunkt verwenden.

**Wichtig für lokales Testen:** `serve_web.py` liefert nur die *Oberfläche* auf
`:64646` aus. Die Welt/Daten holt der Browser weiterhin direkt von SpacetimeDB
(`:3000`) — dorthin muss der Browser also eine Netzwerkroute haben (z.B. beim
Testen vom Handy: gleiches LAN, nicht nur derselbe Rechner). Der Default in
`config.py` zeigt bereits auf den lokalen Server (LAN-IP fest eingetragen), die
nackte URL ohne `?server=`-Parameter reicht also:
`http://192.168.178.65:64646/`. `xianxia` ist derzeit **nicht** auf Maincloud
veröffentlicht — für einen Test gegen Maincloud müsste explizit
`?server=https://maincloud.spacetimedb.com&db=xianxia` gesetzt werden (schlägt
aktuell mit 404 fehl, solange die DB dort nicht existiert).

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
- Die Identität wird im `localStorage` des Browsers zwischengespeichert — wird
  er gelöscht, verliert der Client den Zugriff auf den zuvor registrierten
  Kultivator (Server bindet `PlayerId` an die anfragende Identity).
- Kein Kollisionssystem (man kann z.B. über Wasser-Tiles laufen).
- Die Weltkarte (`WorldTile`, 65536 Zeilen) wird bei jedem Start frisch geladen
  (ein einzelner Query) — kein persistenter Cache, der Browser hat kein
  Dateisystem dafür.
- Pygbag/WASM liefert eine Web-/PWA-Version, **keinen** nativen App-Store-Build
  (kein APK/IPA). Für echtes Mobile bleibt Godot der Weg.
