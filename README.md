# Xianxia MMORPG

Ein 2D Multiplayer-RPG im Xianxia/Kultivierungs-Stil.

## Tech Stack

- **Backend:** SpacetimeDB (C# Modul, `spacetimedb/`)
- **Client:** aktuell nur `web_client/` — ein TypeScript-Testclient (Vite + offizielles `spacetimedb`-SDK, Top-Down-Grid-Rendering, kein Isometrie) zum Ausprobieren der Reducer/Tabellen ohne echten Spiel-Client, siehe `web_client/README.md`. Ob der finale Client dabei bleibt oder auf Godot 4 (.NET) umgestellt wird, ist noch offen — im Repo existiert bislang kein Godot-Projekt.
- **Welt:** 256×256 Tilemap, Perlin-Noise-generiert, 6 Biome

## Features

- Multiplayer über SpacetimeDB — Positions-Updates laufen live über WebSocket-Subscriptions (offizielles SDK, kein Polling)
- Prozedural generierte Welt (Wasser, Strand, Ebene, Wald, Berg, Schnee)
- Qi-Kultivierungssystem mit Durchbruch-Mechanik
- Login & Registrierung mit SHA256-Passwort-Hashing
- Karteneditor (`web_client/editor.html`) zum Bemalen von Biomen/Ressourcen pro Kachel

## Geplant

- Fraktionen & Sekten
- Geistbestien (Spirit Beasts)
- Alchemie-System
- PvP-Modi
- Spirit Crystal Wirtschaft
- OAuth Login (Discord / Google)

## Setup

### Voraussetzungen

- .NET SDK 8.0
- SpacetimeDB CLI (Modul nutzt `SpacetimeDB.Runtime` 2.3.x; getestete CLI-Version 2.7.0)
- Node.js 22+ (für `web_client/`, Vite + `spacetimedb`-SDK)
- Linux (getestet unter Ubuntu 24.04 / WSL2)

### Server starten

```bash
cd spacetimedb
spacetime start
spacetime publish --server local xianxia
```

### Client starten

```bash
cd web_client
npm install
npm run dev
```

Details, Steuerung und Mehrspieler-Test siehe `web_client/README.md`.

## Lizenz

Privat – alle Rechte vorbehalten.
