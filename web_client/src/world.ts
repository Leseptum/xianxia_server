import { tables, type DbConnection } from "./module_bindings";

// Biom enum values match spacetimedb/Lib.cs's `Biom` byte enum.
export const BIOM = { WASSER: 0, STRAND: 1, EBENE: 2, WALD: 3, BERG: 4, SCHNEE: 5 } as const;
export type Biom = (typeof BIOM)[keyof typeof BIOM];

const BIOM_FARBEN: Record<number, [number, number, number]> = {
  [BIOM.WASSER]: [40, 90, 200],
  [BIOM.STRAND]: [230, 210, 150],
  [BIOM.EBENE]: [140, 200, 90],
  [BIOM.WALD]: [40, 110, 50],
  [BIOM.BERG]: [120, 120, 125],
  [BIOM.SCHNEE]: [240, 240, 245],
};

export function biomColorCss(biom: number): string {
  const [r, g, b] = BIOM_FARBEN[biom] || [0, 0, 0];
  return `rgb(${r},${g},${b})`;
}

const BYTES_PER_TILE = 5; // biom, kraeuter, spirit_stones, holz, erz

export interface Tile {
  biom: number;
  kraeuter: number;
  spiritStones: number;
  holz: number;
  erz: number;
}

export class WorldGrid {
  breite: number;
  hoehe: number;
  tileData: Uint8Array; // BYTES_PER_TILE bytes per tile, indexed x + y*breite
  minimapCanvas: HTMLCanvasElement;

  constructor(breite: number, hoehe: number, tileData: Uint8Array) {
    this.breite = breite;
    this.hoehe = hoehe;
    this.tileData = tileData;
    this.minimapCanvas = this._buildMinimap();
  }

  private _offset(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.breite || y >= this.hoehe) return -1;
    return (x + y * this.breite) * BYTES_PER_TILE;
  }

  getBiom(x: number, y: number): number | null {
    const o = this._offset(x, y);
    return o < 0 ? null : this.tileData[o];
  }

  getTile(x: number, y: number): Tile | null {
    const o = this._offset(x, y);
    if (o < 0) return null;
    return {
      biom: this.tileData[o],
      kraeuter: this.tileData[o + 1],
      spiritStones: this.tileData[o + 2],
      holz: this.tileData[o + 3],
      erz: this.tileData[o + 4],
    };
  }

  /** Writes a tile locally (e.g. after a successful EditTile reducer call) and
   * repaints just that minimap pixel, without rebuilding the whole minimap. */
  setTile(x: number, y: number, tile: Tile): void {
    const o = this._offset(x, y);
    if (o < 0) return;
    this.tileData[o] = tile.biom;
    this.tileData[o + 1] = tile.kraeuter;
    this.tileData[o + 2] = tile.spiritStones;
    this.tileData[o + 3] = tile.holz;
    this.tileData[o + 4] = tile.erz;

    const ctx = this.minimapCanvas.getContext("2d")!;
    const [r, g, b] = BIOM_FARBEN[tile.biom] || [0, 0, 0];
    const pixel = ctx.createImageData(1, 1);
    pixel.data.set([r, g, b, 255]);
    ctx.putImageData(pixel, x, y);
  }

  private _buildMinimap(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = this.breite;
    canvas.height = this.hoehe;
    const ctx = canvas.getContext("2d")!;
    const imageData = ctx.createImageData(this.breite, this.hoehe);
    for (let i = 0; i < this.breite * this.hoehe; i++) {
      const [r, g, b] = BIOM_FARBEN[this.tileData[i * BYTES_PER_TILE]] || [0, 0, 0];
      imageData.data[i * 4] = r;
      imageData.data[i * 4 + 1] = g;
      imageData.data[i * 4 + 2] = b;
      imageData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }
}

/**
 * Subscribes to world_meta/world_tile and, once the subscription is applied,
 * packs the (one-time, static) world into a WorldGrid. Replaces the old
 * client.sql("SELECT * FROM world_tile") one-shot fetch - the subscription
 * itself is still only used for this single initial load (the world never
 * changes outside the map editor), so no ongoing onInsert/onUpdate handling
 * is needed here.
 */
export function loadWorld(connection: DbConnection): Promise<WorldGrid> {
  return new Promise((resolve, reject) => {
    connection
      .subscriptionBuilder()
      .onApplied(() => {
        const meta = connection.db.worldMeta.iter().next().value;
        if (!meta) {
          reject(new Error("world_meta ist leer - wurde die Welt bereits generiert (Init-Reducer gelaufen)?"));
          return;
        }

        const breite = meta.breite;
        const hoehe = meta.hoehe;
        const tileData = new Uint8Array(breite * hoehe * BYTES_PER_TILE);
        for (const tile of connection.db.worldTile.iter()) {
          const o = (tile.x + tile.y * breite) * BYTES_PER_TILE;
          tileData[o] = tile.biomTyp & 0xff;
          tileData[o + 1] = tile.kraeuterMenge & 0xff;
          tileData[o + 2] = tile.spiritStones & 0xff;
          tileData[o + 3] = tile.holz & 0xff;
          tileData[o + 4] = tile.erz & 0xff;
        }

        resolve(new WorldGrid(breite, hoehe, tileData));
      })
      .onError((ctx) => reject(ctx.event ?? new Error("Subscription auf world_meta/world_tile fehlgeschlagen")))
      .subscribe([tables.worldMeta, tables.worldTile]);
  });
}
