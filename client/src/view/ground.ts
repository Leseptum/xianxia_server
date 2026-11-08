import * as Phaser from "phaser";
import type { WorldGrid } from "../world";
import type { TileMetrics } from "../logic/projection";
import { TEXTURES, TILESET_MARGIN, TILESET_SPACING, tileIndexForBiom } from "./textures";

export const GROUND_DEPTH = -1_000_000;

export interface Ground {
  readonly layer: Phaser.Tilemaps.TilemapLayer;
  /** Kachel aus dem (bereits aktualisierten) WorldGrid neu übernehmen - für Editor-Änderungen. */
  refreshTile(x: number, y: number): void;
}

/**
 * Baut aus dem WorldGrid eine orthogonale Phaser-Tilemap (ein Tile pro Biom, Kacheln
 * tileWidth x tileHeight - siehe logic/projection.ts).
 *
 * Phaser legt die linke obere Ecke von Tile (x, y) auf (x*w, y*h) relativ zur Layer-Position -
 * der Layer wird daher um (-w/2, -h/2) verschoben, damit Tile-MITTEN auf tileToWorld liegen,
 * das auch Figuren und Kamera benutzen. Phasers eingebautes orthogonales Culling berechnet den
 * sichtbaren Ausschnitt direkt aus der Kamera, da ist kein eigener cullCallback nötig.
 */
export function createGround(scene: Phaser.Scene, grid: WorldGrid, m: TileMetrics): Ground {
  const map = scene.make.tilemap({
    width: grid.breite,
    height: grid.hoehe,
    tileWidth: m.tileWidth,
    tileHeight: m.tileHeight,
  });
  const tileset = map.addTilesetImage(
    "biome",
    TEXTURES.biomeTiles,
    m.tileWidth,
    m.tileHeight,
    TILESET_MARGIN,
    TILESET_SPACING
  );
  if (!tileset) throw new Error("Biom-Tileset konnte nicht angelegt werden.");
  const layer = map.createBlankLayer("boden", tileset, -m.tileWidth / 2, -m.tileHeight / 2);
  if (!layer) throw new Error("Boden-Layer konnte nicht angelegt werden.");

  const rows: number[][] = [];
  for (let y = 0; y < grid.hoehe; y++) {
    const row = new Array<number>(grid.breite);
    for (let x = 0; x < grid.breite; x++) row[x] = tileIndexForBiom(grid.getBiom(x, y));
    rows.push(row);
  }
  layer.putTilesAt(rows, 0, 0, false);
  layer.setDepth(GROUND_DEPTH);

  return {
    layer,
    refreshTile(x, y) {
      layer.putTileAt(tileIndexForBiom(grid.getBiom(x, y)), x, y, false);
    },
  };
}
