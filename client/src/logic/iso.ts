// Diamond-Isometrie (2:1). Konvention für den ganzen Client:
//
//   Kachel (x, y) hat ihren MITTELPUNKT bei
//     worldX = (x - y) * tileWidth  / 2
//     worldY = (x + y) * tileHeight / 2
//
// d. h. Gitter-x läuft auf dem Bildschirm nach rechts unten, Gitter-y nach links unten,
// Kachel (0, 0) ist die oberste Spitze der Karte. Ganzzahlige Gitterkoordinaten (so speichert
// der Server Spieler-/NPC-Positionen) liegen damit genau auf Kachelmitten, und Bruchteile
// (Interpolation zwischen zwei Kacheln) werden linear dazwischen projiziert.
//
// Die Phaser-TilemapLayer (scenes/WorldScene.ts) wird um (-tileWidth/2, -tileHeight/2)
// verschoben, damit ihre Tiles exakt auf dieser Konvention liegen - Phaser selbst setzt die
// linke obere Ecke des Tile-Bildes an ((x - y) * w/2, (x + y) * h/2).

export interface IsoMetrics {
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
export function tileToWorld(tx: number, ty: number, m: IsoMetrics): Point {
  return {
    x: (tx - ty) * (m.tileWidth / 2),
    y: (tx + ty) * (m.tileHeight / 2),
  };
}

/** Welt (Pixel) -> Gitter, als Bruchzahl (exakte Umkehrung von tileToWorld). */
export function worldToTile(wx: number, wy: number, m: IsoMetrics): Point {
  const a = wx / m.tileWidth;
  const b = wy / m.tileHeight;
  return { x: b + a, y: b - a };
}

/**
 * Welt (Pixel) -> Index der Kachel, deren Raute den Punkt enthält. Die Raute von Kachel
 * (i, j) ist im Gitterraum genau das Quadrat [i-0.5, i+0.5] x [j-0.5, j+0.5], daher reicht
 * Runden der Bruch-Koordinaten.
 */
export function worldToTileIndex(wx: number, wy: number, m: IsoMetrics): Point {
  const t = worldToTile(wx, wy, m);
  return { x: Math.floor(t.x + 0.5), y: Math.floor(t.y + 0.5) };
}

/** Achsparalleles Begrenzungsrechteck aller Kachel-Rauten einer mapWidth x mapHeight-Karte. */
export function isoMapBounds(mapWidth: number, mapHeight: number, m: IsoMetrics): Rect {
  const hw = m.tileWidth / 2;
  const hh = m.tileHeight / 2;
  return {
    x: -mapHeight * hw,
    y: -hh,
    width: (mapWidth + mapHeight) * hw,
    height: (mapWidth + mapHeight) * hh,
  };
}

/**
 * Ruft fn(x, y) für jede Kachel auf, deren Rauten-Begrenzungsbox das Rechteck `view`
 * (Weltkoordinaten, z. B. camera.worldView) schneidet - zusätzlich um `padTiles` Kacheln
 * erweitert. Reihenfolge: von oben nach unten (Summe x+y aufsteigend), innerhalb einer
 * Bildschirmzeile von links nach rechts - also Painter-Reihenfolge.
 *
 * Ersatz für Phasers eingebautes IsometricCullTiles, das jeden Frame über ALLE Kacheln der
 * Karte iteriert (256x256 = 65536 tileToWorldXY-Aufrufe pro Frame). Hier wird stattdessen
 * analytisch nur über die sichtbaren Diagonalzeilen iteriert: Kachelmitte hat
 * worldY = s * hh (s = x + y) und worldX = d * hw (d = x - y), der sichtbare Bereich ist also
 * ein Intervall in s und eines in d; x = (s + d) / 2 und y = (s - d) / 2 sind genau dann
 * ganzzahlig, wenn s und d dieselbe Parität haben.
 */
export function forEachVisibleTile(
  view: Rect,
  mapWidth: number,
  mapHeight: number,
  m: IsoMetrics,
  padTiles: number,
  fn: (x: number, y: number) => void
): void {
  if (mapWidth <= 0 || mapHeight <= 0) return;
  const hw = m.tileWidth / 2;
  const hh = m.tileHeight / 2;
  const padX = padTiles * m.tileWidth;
  const padY = padTiles * m.tileHeight;

  // Raute um Mitte (cx, cy) reicht von cx-hw..cx+hw bzw. cy-hh..cy+hh. Sie schneidet das
  // (gepolsterte) Rechteck, wenn cy > top - hh && cy < bottom + hh (analog für x).
  const sLo = Math.max(0, Math.floor((view.y - padY) / hh) - 1);
  const sHi = Math.min(mapWidth + mapHeight - 2, Math.ceil((view.y + view.height + padY) / hh) + 1);
  const dLo = Math.floor((view.x - padX) / hw) - 1;
  const dHi = Math.ceil((view.x + view.width + padX) / hw) + 1;

  for (let s = sLo; s <= sHi; s++) {
    // Kartengrenzen: x >= 0 -> d >= -s; y <= H-1 -> d >= s - 2(H-1);
    //                y >= 0 -> d <= s;  x <= W-1 -> d <= 2(W-1) - s.
    let lo = Math.max(dLo, -s, s - 2 * (mapHeight - 1));
    const hi = Math.min(dHi, s, 2 * (mapWidth - 1) - s);
    if ((lo - s) % 2 !== 0) lo++;
    for (let d = lo; d <= hi; d += 2) {
      fn((s + d) / 2, (s - d) / 2);
    }
  }
}
