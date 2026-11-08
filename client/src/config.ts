// Übernommen aus web_client/src/config.ts: deriveServerUri/SERVER_URI/DATABASE_NAME/
// STEP_INTERVAL_MS sind unverändert, nur die Top-Down-Render-Konstanten des Testclients
// (TILE_SIZE/HUD_HEIGHT/MAP_MARGIN) sind durch die Projektions-/Phaser-Konstanten unten ersetzt.
//
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
  STEP_INTERVAL_MS: 150, // Zeit zwischen zwei Feld-Schritten bei gehaltener Taste (wie web_client)

  // Schrägansicht, nicht gedreht: Kacheln vertikal gestaucht - siehe src/logic/projection.ts.
  TILE_WIDTH: 64,
  TILE_HEIGHT: 40,

  // Interpolation zwischen Positionsupdates (src/logic/interpolation.ts).
  // Spieler laufen im STEP_INTERVAL_MS-Takt -> gleiche Dauer ergibt eine durchgehende
  // Laufbewegung. NPCs ziehen nur alle 3 s (NPC_TICK_INTERVALL in Lib.cs) ein Feld weiter.
  PLAYER_MOVE_MS: 150,
  NPC_MOVE_MS: 600,
  // Ab dieser Sprungweite (Tschebyschew, in Kacheln) wird nicht mehr gelaufen, sondern
  // direkt versetzt (z. B. Editor-"Spieler verschieben", Korrektur nach Verbindungsproblemen).
  SNAP_DISTANCE: 3,

  ZOOM_MIN: 0.3,
  ZOOM_MAX: 3,
  ZOOM_DEFAULT: 1,
  ZOOM_STEP: 1.15, // Faktor pro Mausrad-Raste
  LABEL_MIN_ZOOM: 0.6, // darunter werden Namensschilder/HP-Balken ausgeblendet (unlesbar klein)

  CAMERA_LERP: 0.15,
};
