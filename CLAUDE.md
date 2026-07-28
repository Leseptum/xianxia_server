# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Xianxia is a 2D cultivation-themed multiplayer RPG. The backend is a SpacetimeDB module (C#); the only client currently in this repo is `web_client/`, a plain HTML/CSS/JS **proof-of-concept / test tool** for exercising the server (login, world map, Qi cultivation, movement) without needing the planned Godot client — see `web_client/README.md`. Don't assume a Godot client exists in this checkout; the top-level `README.md` describes the intended end-state stack, not what's implemented here.

## Repo layout

- `spacetimedb/` — the SpacetimeDB server module (C#, single file: `Lib.cs`). Builds to `wasi-wasm` (see `StdbModule.csproj`).
- `web_client/` — the JS test client, static files served by any plain HTTP server (no build step, no dependencies).
- `spacetime.json` / `spacetime.local.json` — CLI config (maincloud server + module path; local DB name `xianxia`).

## Commands

### Server (spacetimedb/)

```bash
spacetime start                              # run a local SpacetimeDB instance
spacetime publish --server local xianxia     # build + publish the module locally
spacetime publish xianxia --yes              # publish to maincloud (default server)
spacetime logs xianxia -f                    # tail server logs
spacetime sql xianxia "SELECT * FROM player" # ad-hoc query (snake_case table/column names, see below)
```

There is no test suite for the server; verification is via `spacetime publish` succeeding and manual inspection via `spacetime sql`/`spacetime logs`.

### Web client (web_client/)

```bash
cd web_client && python3 -m http.server 8080  # any static file server works
```

Talks to `http://<page-hostname>:3000` by default over plain HTTP (LAN dev), or `https://db<page-hostname>` over HTTPS (reverse-proxied/tunneled) — both derived from the URL the page was loaded from, not hardcoded; see `config.js` below. Override with `?server=...&db=...` query params.

## Server architecture (`spacetimedb/Lib.cs`)

Everything lives in one `static partial class Module`. Three tables: `WorldTile` (one row per map cell, 256×256), `WorldMeta` (singleton, generation status/seed), `Player` (identity, Qi/cultivation stats, position).

- **World generation** runs once, in the `Init` reducer (fires on first publish): Perlin noise (custom implementation at the bottom of the file, not a library) determines biome per tile, gated by `WorldMeta.Generiert` so it never regenerates on republish.
- **`PlayerId` is derived from `ctx.Sender.GetHashCode()`**, not from a real auth/session system — this is a deliberate POC simplification, not a bug to silently "fix". Password hashes (`Register`/`Login` reducers) are checked but are expected to arrive as a SHA256 hash already computed by the caller; there's no server-side salting.
- **`Durchbruch` (breakthrough)** uses `new Random()` (not `ctx.Rng`) for the success roll — this violates the determinism rule reducers are otherwise supposed to follow ([[SpacetimeDB Critical Rules]] in `.windsurfrules`/`AGENTS.md`/`.cursor/rules/`); be aware if touching this reducer.
- **`UpdatePosition` enforces collision**: it looks up the target tile via `WorldTile.TileId.Find((uint)(ix + iy * WELT_BREITE))` — same formula `WeltGenerieren` uses to assign `TileId`, so no extra index is needed for an O(1) lookup — and silently drops the update (position stays unchanged) if the tile is `Wasser` or `Berg`. Water/mountain are also blocked client-side (`web_client/app.js`) for immediate visual feedback, but the server check is what actually prevents a modified/malicious client from walking through them.
- **`EditTile`** is the map-editor reducer (`web_client/editor.html`): overwrites a tile's biome + all four resource fields by `(x, y)`, no access control (matches the rest of this POC — see `PlayerId` note above). Bounds- and enum-range-checked, silently no-ops otherwise like every other reducer here.
- Field/column naming: C# struct fields are PascalCase (`PlayerId`, `PasswordHash`), but the wire format and SQL interface expose **snake_case** (`player_id`, `password_hash`) — any client, tool, or `spacetime sql` query must use snake_case regardless of the C# field name.

General SpacetimeDB conventions (reducers are transactional and don't return data, must be deterministic, tables read via subscriptions/SQL not reducer return values, `ctx.Sender`/`ctx.Rng`/`ctx.Timestamp` for identity/randomness/time) are documented at length in `.windsurfrules`, `AGENTS.md`, and `.cursor/rules/*.mdc` — those three files are identical copies of the same reference material, not project-specific notes.

## Web client architecture (`web_client/`)

Plain HTML/CSS/JS, no framework/build step/npm — `fetch`, `sessionStorage`, and `<canvas>` are used directly, no bridge layer needed (unlike the retired Pygbag/WASM client this replaced).

- `stdb_client.js` — thin wrapper over SpacetimeDB's HTTP API: `POST /v1/identity` for identity bootstrap, `sql()` (`POST .../sql`, raw SQL string as body, response is `[{schema:{elements:[{name:{some:col}}]}, rows:[[...]]}]` — zipped into row objects), `callReducer()` (`POST .../call/<name>`, JSON array of positional args). **No WebSocket subscriptions** — pure HTTP polling, same as the server's general HTTP interface. Identity is cached in **`sessionStorage`, not `localStorage`** — deliberately, since it's scoped per tab rather than shared across all tabs of the origin: opening a second tab gets its own fresh identity for free, which is how you test two players at once with this client (see `web_client/README.md`). `app.js`'s "Logout" button just clears this and reloads.
- `sha256.js` — a from-scratch pure-JS SHA-256 (the password hash the server's `Register`/`Login` reducers expect), used instead of `crypto.subtle.digest` because Web Crypto only works in secure contexts (https, or `localhost`/`127.0.0.1`) and this client is meant to also be opened via a plain `http://<LAN-IP>` (see `config.js` below), where `crypto.subtle` is `undefined`.
- `config.js` — server/db picked via URL query params (`?server=...&db=...`); default server URL is derived from the page's own hostname/protocol rather than hardcoded. Over `http:` (localhost/LAN IP dev), same host + `:3000`. Over `https:` (reverse-proxied/tunneled), a `:3000` default would be blocked as mixed content regardless of whether that port is even reachable under the domain — instead it assumes SpacetimeDB is tunneled one hostname over with a `db` prefix (e.g. page on `antalia.leseptum.de` → `https://dbantalia.leseptum.de`), matching this project's actual tunnel setup. `app.js`'s `boot()` still detects an `https:` page ending up with an `http:` server URL (e.g. via an explicit `?server=` override) and surfaces that specific mixed-content case explicitly rather than a generic connection-failed message.
- `world.js` — loads `world_meta` + `world_tile` once at startup into a `Uint8Array`, `BYTES_PER_TILE` (5: biome + kraeuter/spirit_stones/holz/erz) bytes per tile, indexed `x + y*width`, plus a pre-rendered offscreen `<canvas>` minimap (`putImageData`) for the full-map view. `getBiom(x, y)` (used by both the game and collision) only ever reads byte 0 of each tile's block; `getTile()`/`setTile()` expose/mutate the full 5-byte tile and are what `editor.js` uses — `setTile()` repaints just the affected minimap pixel rather than rebuilding the whole canvas, for instant feedback while painting.
- `app.js` — state machine (`login` → `loading` → `game`): hashes the password client-side (`sha256Hex`), calls `register`/`login` then polls for the player's own row by name (insert isn't visible until the reducer's transaction commits — retried since `Register` on an identity that's already registered a *different* name is a silent no-op, not an error, see the field/column naming note above). Polls `SELECT * FROM player` every `CONFIG.POLL_INTERVAL_MS` (400ms) into a `Map`. `M` toggles between the camera-follow view and the full-map view. Movement is **grid-based**, not continuous: one integer tile per step, 4 directions only (an `else if` chain in `update()` picks a single axis, so holding two keys never moves diagonally), re-triggered every `CONFIG.STEP_INTERVAL_MS` while a key is held rather than every frame — `game.posX`/`posY` are always whole tile coordinates, `isWalkable()` (checked against `Wasser`/`Berg`/out-of-bounds) gates each step before it's applied and sent via `update_position`.
- `editor.html` + `editor.js` — standalone map editor, no login/player needed (`EditTile` is anonymous like every other reducer here). Reuses `config.js`/`stdb_client.js`/`world.js` as-is via `<script>` tags; doesn't load `sha256.js` or `app.js`. Renders the whole map by scaling `worldGrid.minimapCanvas` onto a bigger `<canvas>` (`SCALE = 4` px/tile, `image-rendering: pixelated`/`imageSmoothingEnabled = false` for crisp tile edges) rather than a second tile-loop renderer. A "brush" (biome + 4 resource values, set via the side panel) is applied on click/drag; drag painting dedupes by tile so a single mouse-down-and-drag over one tile only fires one `edit_tile` call, not one per `mousemove` event.

Reducer/table names on the wire are snake_case versions of the C# method/struct names (`update_position`, `qi_sammeln`, `world_tile`, `edit_tile`, etc.) — see the field/column naming note above.
