# Xianxia MMORPG

Ein 2D Multiplayer-RPG im Xianxia/Kultivierungs-Stil.

## Tech Stack

- **Backend:** SpacetimeDB (C# Modul, `spacetimedb/`)
- **Spielclient:** `client/` — Phaser 3 + TypeScript (Vite, offizielles `spacetimedb`-SDK), Schrägansicht von oben (Norden = oben), siehe `client/README.md`. Ein Godot-Client ist nicht (mehr) geplant.
- **Testclient & Karteneditor:** `web_client/` — älterer TypeScript-Testclient (Top-Down, ohne Phaser) zum schnellen Ausprobieren der Reducer/Tabellen, plus der Karteneditor `web_client/editor.html`, siehe `web_client/README.md`.
- **Welt:** 256×256 Tilemap, Perlin-Noise-generiert, 6 Biome

## Features

- Multiplayer über SpacetimeDB — Positions-Updates laufen live über WebSocket-Subscriptions (offizielles SDK, kein Polling), im Spielclient mit Interpolation zwischen den Updates
- Weltkarte in Schrägansicht von oben (Phaser-Tilemap, Figuren nach Tiefe sortiert), Kamera folgt dem Spieler, Zoom per Mausrad
- Prozedural generierte Welt (Wasser, Strand, Ebene, Wald, Berg, Schnee)
- Qi-Kultivierungssystem mit Durchbruch-Mechanik
- Login & Registrierung mit SHA256-Passwort-Hashing
- NPCs (Tiere, Menschen, Fabelwesen) bevölkern die Karte, bewegen sich per Server-Tick und sind angreifbar (HP-basiert, kein Respawn/Loot bisher)
- Mehrere Karten parallel, Karteneditor (`web_client/editor.html`) für Biome/Ressourcen, NPCs und Spieler

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
- Node.js 22+ (für `client/` und `web_client/`, jeweils Vite + `spacetimedb`-SDK)
- Linux (getestet unter Ubuntu 24.04 / WSL2)

### Server starten

```bash
spacetime start
scripts/publish.sh local
```

### Spielclient starten

```bash
cd client
npm install
npm run dev
```

Details und Steuerung siehe `client/README.md`; Testclient und Karteneditor siehe `web_client/README.md`.

## Lizenz

Privat – alle Rechte vorbehalten.
