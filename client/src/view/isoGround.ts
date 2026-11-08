import * as Phaser from "phaser";
import type { WorldGrid } from "../world";
import { forEachVisibleTile, type IsoMetrics } from "../logic/iso";
import { TEXTURES, TILESET_MARGIN, TILESET_SPACING, tileIndexForBiom } from "./textures";

export const GROUND_DEPTH = -1_000_000;

export interface IsoGround {
  readonly layer: Phaser.Tilemaps.TilemapLayer;
  /** Kachel aus dem (bereits aktualisierten) WorldGrid neu übernehmen - für Editor-Änderungen. */
  refreshTile(x: number, y: number): void;
}

/**
 * Baut aus dem WorldGrid eine isometrische (Diamond-)Phaser-Tilemap, ein Tile pro Biom.
 *
 * Phaser legt die linke obere Ecke von Tile (x, y) auf ((x-y)*w/2, (x+y)*h/2) relativ zur
 * Layer-Position - der Layer wird daher um (-w/2, -h/2) verschoben, damit Tile-MITTEN auf der
 * Konvention aus logic/iso.ts (tileToWorld) liegen, die auch Figuren und Kamera benutzen.
 */
export function createIsoGround(scene: Phaser.Scene, grid: WorldGrid, m: IsoMetrics): IsoGround {
  const mapData = new Phaser.Tilemaps.MapData({
    name: "welt",
    width: grid.breite,
    height: grid.hoehe,
    tileWidth: m.tileWidth,
    tileHeight: m.tileHeight,
    orientation: Phaser.Tilemaps.Orientation.ISOMETRIC,
  });
  const map = new Phaser.Tilemaps.Tilemap(scene, mapData);
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
  installIsoCull(layer, m);

  return {
    layer,
    refreshTile(x, y) {
      layer.putTileAt(tileIndexForBiom(grid.getBiom(x, y)), x, y, false);
    },
  };
}

/**
 * Ersetzt Phasers IsometricCullTiles (iteriert jeden Frame über ALLE 65536 Tiles) durch
 * forEachVisibleTile, das analytisch nur die sichtbaren Diagonalzeilen besucht.
 * cullCallback ist eine dokumentierte, öffentliche Property von TilemapLayer.
 */
function installIsoCull(layer: Phaser.Tilemaps.TilemapLayer, m: IsoMetrics): void {
  const data = layer.layer.data;
  const width = layer.layer.width;
  const height = layer.layer.height;
  layer.cullCallback = (
    _layerData: Phaser.Tilemaps.LayerData,
    camera: Phaser.Cameras.Scene2D.Camera,
    out: Phaser.Tilemaps.Tile[]
  ): Phaser.Tilemaps.Tile[] => {
    out.length = 0;
    forEachVisibleTile(camera.worldView, width, height, m, 1, (x, y) => {
      const tile = data[y][x];
      if (tile && tile.index !== -1 && tile.visible && tile.alpha > 0) out.push(tile);
    });
    return out;
  };
}
