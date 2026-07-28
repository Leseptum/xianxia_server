// Server/DB are chosen via URL query params, e.g.
//   index.html?server=https://maincloud.spacetimedb.com&db=xianxia
//
// Default, derived from the page's own hostname (no address to hardcode/keep
// in sync):
//  - http:// (localhost/LAN IP dev): same host, port 3000 (where `spacetime
//    start` listens).
//  - https:// (reverse-proxied/tunneled): a bare :3000 default would be
//    blocked as mixed content, and arbitrary ports usually aren't tunneled
//    anyway. Instead assume SpacetimeDB is reachable one hostname over, with
//    a "db" prefix - e.g. this page on "antalia.leseptum.de" implies
//    "https://dbantalia.leseptum.de". Matches this project's own tunnel setup;
//    override with ?server=... if yours is named differently.
const params = new URLSearchParams(location.search);

const DEFAULT_SERVER_URL =
  location.protocol === "https:" ? `https://db${location.hostname}` : `http://${location.hostname}:3000`;
const DEFAULT_DB = "xianxia";

const CONFIG = {
  SERVER_URL: params.get("server") || DEFAULT_SERVER_URL,
  DATABASE_NAME: params.get("db") || DEFAULT_DB,
  TILE_SIZE: 24,
  POLL_INTERVAL_MS: 400,
  STEP_INTERVAL_MS: 150, // time between grid steps while a movement key is held
  HUD_HEIGHT: 90,
  MAP_MARGIN: 20,
};
