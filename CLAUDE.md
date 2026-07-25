# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Xianxia is a 2D cultivation-themed multiplayer RPG. This repo currently contains only the backend: a SpacetimeDB module (C#). There is no client checked in here — the planned client is Godot 4 (.NET), per the top-level `README.md`'s intended end-state stack, but it doesn't exist in this checkout yet.

## Repo layout

- `spacetimedb/` — the SpacetimeDB server module (C#, single file: `Lib.cs`). Builds to `wasi-wasm` (see `StdbModule.csproj`).
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

## Server architecture (`spacetimedb/Lib.cs`)

Everything lives in one `static partial class Module`. Three tables: `WorldTile` (one row per map cell, 256×256), `WorldMeta` (singleton, generation status/seed), `Player` (identity, Qi/cultivation stats, position).

- **World generation** runs once, in the `Init` reducer (fires on first publish): Perlin noise (custom implementation at the bottom of the file, not a library) determines biome per tile, gated by `WorldMeta.Generiert` so it never regenerates on republish.
- **`PlayerId` is derived from `ctx.Sender.GetHashCode()`**, not from a real auth/session system — this is a deliberate POC simplification, not a bug to silently "fix". Password hashes (`Register`/`Login` reducers) are checked but are expected to arrive as a SHA256 hash already computed by the caller; there's no server-side salting.
- **`Durchbruch` (breakthrough)** uses `new Random()` (not `ctx.Rng`) for the success roll — this violates the determinism rule reducers are otherwise supposed to follow ([[SpacetimeDB Critical Rules]] in `.windsurfrules`/`AGENTS.md`/`.cursor/rules/`); be aware if touching this reducer.
- Field/column naming: C# struct fields are PascalCase (`PlayerId`, `PasswordHash`), but the wire format and SQL interface expose **snake_case** (`player_id`, `password_hash`) — any client, tool, or `spacetime sql` query must use snake_case regardless of the C# field name.

General SpacetimeDB conventions (reducers are transactional and don't return data, must be deterministic, tables read via subscriptions/SQL not reducer return values, `ctx.Sender`/`ctx.Rng`/`ctx.Timestamp` for identity/randomness/time) are documented at length in `.windsurfrules`, `AGENTS.md`, and `.cursor/rules/*.mdc` — those three files are identical copies of the same reference material, not project-specific notes.
