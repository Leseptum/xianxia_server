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
- Die Identität wird in `.stdb_identity.json` zwischengespeichert (gitignored) —
  wird die Datei gelöscht, verliert der Client den Zugriff auf den zuvor registrierten
  Kultivator (Server bindet `PlayerId` an die anfragende Identity).
- Kein Kollisionssystem (man kann z.B. über Wasser-Tiles laufen).
- Die Weltkarte (`WorldTile`, 65536 Zeilen) wird einmalig geladen und lokal als
  `world_cache_seed<N>.bin` zwischengespeichert (gitignored), damit nicht bei jedem
  Start die komplette Tabelle erneut abgefragt werden muss.
