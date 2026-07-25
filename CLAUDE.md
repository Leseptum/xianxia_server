# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Xianxia is a 2D cultivation-themed multiplayer RPG. The backend is a SpacetimeDB module (C#); the only client currently in this repo is `pygame_client/`, a Pygame **proof-of-concept / test tool** for exercising the server (login, world map, Qi cultivation, movement) without needing the planned Godot client — see `pygame_client/README.md`. Don't assume a Godot client exists in this checkout; the top-level `README.md` describes the intended end-state stack, not what's implemented here.

## Repo layout

- `spacetimedb/` — the SpacetimeDB server module (C#, single file: `Lib.cs`). Builds to `wasi-wasm` (see `StdbModule.csproj`).
- `pygame_client/` — the Pygame test client (Python/asyncio), web-only via Pygbag/WebAssembly.
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

There is no test suite for the server; verification is via `spacetime publish` succeeding and manual play against a client.

### Pygame client (web-only — no desktop/CPython mode)

```bash
pip install pygbag
python3 pygame_client/serve_web.py           # builds + serves on :64646, binds to LAN IP (not localhost/0.0.0.0 — see README for why)
```
Talks to the local server by default (LAN IP hardcoded in `config.py` — `xianxia` isn't published on Maincloud); override with `?server=...&db=...` query params. A local `spacetime start` sends CORS headers unconditionally (verified on 2.7.0-hotfix3).

## Server architecture (`spacetimedb/Lib.cs`)

Everything lives in one `static partial class Module`. Three tables: `WorldTile` (one row per map cell, 256×256), `WorldMeta` (singleton, generation status/seed), `Player` (identity, Qi/cultivation stats, position).

- **World generation** runs once, in the `Init` reducer (fires on first publish): Perlin noise (custom implementation at the bottom of the file, not a library) determines biome per tile, gated by `WorldMeta.Generiert` so it never regenerates on republish.
- **`PlayerId` is derived from `ctx.Sender.GetHashCode()`**, not from a real auth/session system — this is a deliberate POC simplification, not a bug to silently "fix". Password hashes (`Register`/`Login` reducers) are checked but the client just sends a SHA256 hash it computed itself (see `pygame_client/screens/login_screen.py`); there's no server-side salting.
- **`Durchbruch` (breakthrough)** uses `new Random()` (not `ctx.Rng`) for the success roll — this violates the determinism rule reducers are otherwise supposed to follow ([[SpacetimeDB Critical Rules]] in `.windsurfrules`/`AGENTS.md`/`.cursor/rules/`); be aware if touching this reducer.
- Field/column naming: C# struct fields are PascalCase (`PlayerId`, `PasswordHash`), but the wire format and SQL interface expose **snake_case** (`player_id`, `password_hash`) — see `pygame_client/models.py` and `stdb_client.py`. A past commit (`3a7e71b`) exists specifically because this mismatch broke the client; when adding table columns, remember client-side SQL/JSON access uses snake_case regardless of the C# field name.

General SpacetimeDB conventions (reducers are transactional and don't return data, must be deterministic, tables read via subscriptions/SQL not reducer return values, `ctx.Sender`/`ctx.Rng`/`ctx.Timestamp` for identity/randomness/time) are documented at length in `.windsurfrules`, `AGENTS.md`, and `.cursor/rules/*.mdc` — those three files are identical copies of the same reference material, not project-specific notes.

## Pygame client architecture

The client is **web-only** (Pygbag/WebAssembly, run via `serve_web.py`) — there is no desktop/CPython runtime mode.

- `main.py` — asyncio event loop driving a small state machine: `login` → `loading_world` → `game`.
- `http_backend.py` — HTTP goes through the browser's `fetch` API via Pygbag's JS bridge (`platform.window.fetch`/`localStorage`). Everything else in the client only ever calls `http_backend.request()`/`web_storage_*` and doesn't touch the browser bridge directly. **Gotcha:** `platform.window.fetch(url, options)` cannot take a raw Python dict for `options` — the bridge doesn't auto-convert it, and calling it with a plain dict raises `TypeError: object of type 'dict' ...` inside the try/except, which then gets misreported as a generic "(evtl. CORS/Netzwerk)" error (this caused real confusion — several actual CORS/network dead-ends turned out to be this bug instead). Fix: wrap the dict with `platform.ffi(options)` first (pygbag's own documented workaround, JSON round-tripped through `window.JSON.parse` — see `pygbag/support/cross/aio/filelike.py` in the pygbag package for another real usage). Any new code that passes a Python dict/list to a JS-facing call under Pygbag needs the same `platform.ffi(...)` wrapping.
- `stdb_client.py` — thin wrapper over SpacetimeDB's HTTP API: identity bootstrap (cached to `localStorage`), `sql()` for queries, `call_reducer()` for mutations. **No WebSocket subscriptions** — the client is pure HTTP polling.
- `poll_worker.py` — polls `SELECT * FROM player` on a timer (`config.POLL_INTERVAL_SECONDS`) on a background asyncio task; rendering code only reads its cached `get_players()`, never awaits directly. Single-threaded event loop means no locking is needed between the poll task and render loop.
- `world_cache.py` — loads the full `world_tile` table (65,536 rows) fresh on every start and packs it into a compact byte buffer (`BYTES_PER_TILE = 5`) indexed by `x + y*width`. No persistent cache (the browser has no filesystem for it).
- `screens/` — `login_screen.py` (register/login) and `game_screen.py` (movement, Qi/Durchbruch actions, map overview toggle via `M`).
- `config.py` — server/db are chosen via URL query params (`?server=...&db=...`), defaulting to the local server (LAN IP hardcoded) + `xianxia` when absent — `xianxia` is not published on Maincloud.

The client does local position prediction (moves immediately on input) and throttles `UpdatePosition` reducer calls rather than sending on every frame; other players' positions only update on the next poll tick, so they visibly step rather than interpolate. This and the other POC simplifications are enumerated in `pygame_client/README.md` under "Bekannte Einschränkungen" — treat them as known/intentional rather than things to fix unless asked.
