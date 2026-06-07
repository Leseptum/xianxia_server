# Xianxia MMORPG

Ein 2D isometrisches Multiplayer-RPG im Xianxia/Kultivierungs-Stil.

## Tech Stack

- **Client:** Godot 4 (.NET)
- **Backend:** SpacetimeDB 2.3.0 (C# Module)
- **Welt:** 256×256 isometrische Tilemap (Perlin Noise, 6 Biome)

## Features

- Echtzeit-Multiplayer über SpacetimeDB
- Prozedural generierte Welt (Wasser, Strand, Ebene, Wald, Berg, Schnee)
- Qi-Kultivierungssystem mit Durchbruch-Mechanik
- Spieler-Synchronisation (10x/Sekunde)
- Login & Registrierung mit SHA256-Passwort-Hashing

## Geplant

- Fraktionen & Sekten
- Geistbestien (Spirit Beasts)
- Alchemie-System
- PvP-Modi
- Spirit Crystal Wirtschaft
- OAuth Login (Discord / Google)

## Setup

### Voraussetzungen

- Godot 4 (.NET Version)
- .NET 10
- SpacetimeDB 2.3.0
- WSL2 (Ubuntu)

### Server starten

```bash
cd xianxia_server/xianxia
spacetime start
spacetime publish --server local xianxia
```

### Client starten

Projekt in Godot 4 öffnen und starten.

## Lizenz

Privat – alle Rechte vorbehalten.
