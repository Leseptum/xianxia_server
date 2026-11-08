// Top-Down-Ansicht mit aufrecht stehenden Figuren, nicht gedreht: Kartennorden = Bildschirm oben.
// Konvention für den ganzen Client:
//
//   Kachel (x, y) hat ihren MITTELPUNKT bei
//     worldX = x * tileWidth
//     worldY = y * tileHeight
//
// d. h. Gitter-x läuft nach rechts, Gitter-y nach unten (wie web_client und Karteneditor).
// Die Kacheln sind quadratisch (CONFIG.TILE_WIDTH = TILE_HEIGHT); die Funktionen hier
// erlauben aber beliebige Seitenverhältnisse (die Tests nutzen bewusst ein nicht-quadratisches,
// damit vertauschte Achsen auffallen). Figuren stehen aufrecht und werden nach Y sortiert.
// Ganzzahlige Gitterkoordinaten (so speichert der Server Spieler-/NPC-Positionen) liegen genau
// auf Kachelmitten, Bruchteile (Interpolation) werden linear dazwischen projiziert.
//
// Die Phaser-TilemapLayer (view/ground.ts) wird um (-tileWidth/2, -tileHeight/2) verschoben,
// damit ihre Tile-Mitten auf dieser Konvention liegen - Phaser setzt die linke obere Ecke des
// Tile-Bildes an (x * w, y * h).

export interface TileMetrics {
  tileWidth: number;
  tileHeight: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Gitter -> Welt (Pixel), Kachelmitte. Bruchteile erlaubt. */
export function tileToWorld(tx: number, ty: number, m: TileMetrics): Point {
  return { x: tx * m.tileWidth, y: ty * m.tileHeight };
}

/** Welt (Pixel) -> Gitter, als Bruchzahl (exakte Umkehrung von tileToWorld). */
export function worldToTile(wx: number, wy: number, m: TileMetrics): Point {
  return { x: wx / m.tileWidth, y: wy / m.tileHeight };
}

/** Welt (Pixel) -> Index der Kachel, deren Rechteck den Punkt enthält. */
export function worldToTileIndex(wx: number, wy: number, m: TileMetrics): Point {
  const t = worldToTile(wx, wy, m);
  return { x: Math.floor(t.x + 0.5), y: Math.floor(t.y + 0.5) };
}

/** Begrenzungsrechteck aller Kacheln einer mapWidth x mapHeight-Karte (Weltkoordinaten). */
export function mapBounds(mapWidth: number, mapHeight: number, m: TileMetrics): Rect {
  return {
    x: -m.tileWidth / 2,
    y: -m.tileHeight / 2,
    width: mapWidth * m.tileWidth,
    height: mapHeight * m.tileHeight,
  };
}
