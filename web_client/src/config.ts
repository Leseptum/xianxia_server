// Server/DB are chosen via URL query params, e.g.
//   index.html?server=wss://maincloud.spacetimedb.com&db=xianxia
//
// Default, derived from the page's own hostname (no address to hardcode/keep
// in sync):
//  - http:// (localhost/LAN IP dev): same host, port 3000 (where `spacetime
//    start` listens), ws:// (SpacetimeDB's WebSocket API, unencrypted).
//  - https:// (reverse-proxied/tunneled): a bare :3000 default would be
//    blocked as mixed content, and arbitrary ports usually aren't tunneled
//    anyway. Instead assume SpacetimeDB is reachable one hostname over, with
//    a "db" prefix - e.g. this page on "antalia.leseptum.de" implies
//    "wss://dbantalia.leseptum.de". Matches this project's own tunnel setup;
//    override with ?server=... if yours is named differently.
const params = new URLSearchParams(location.search);

// Exported (and taking a location-like object rather than reading the global
// `location` directly) purely so this branches on its own, without a real
// browser location, e.g. in src/config.test.ts.
export function deriveServerUri(loc: Pick<Location, "protocol" | "hostname" | "search">): string {
  const override = new URLSearchParams(loc.search).get("server");
  if (override) {
    // Accept an http(s):// override too (matches the old config.js convention)
    // and normalize it to the ws(s):// scheme the SDK expects.
    return override.replace(/^http/, "ws");
  }
  return loc.protocol === "https:" ? `wss://db${loc.hostname}` : `ws://${loc.hostname}:3000`;
}

export const CONFIG = {
  SERVER_URI: deriveServerUri(location),
  DATABASE_NAME: params.get("db") || "xianxia",
  TILE_SIZE: 24,
  STEP_INTERVAL_MS: 150, // time between grid steps while a movement key is held
  HUD_HEIGHT: 90,
  MAP_MARGIN: 20,
};
