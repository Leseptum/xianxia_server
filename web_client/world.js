// Biom enum values match spacetimedb/Lib.cs's `Biom` byte enum.
const BIOM = { WASSER: 0, STRAND: 1, EBENE: 2, WALD: 3, BERG: 4, SCHNEE: 5 };

const BIOM_FARBEN = {
  [BIOM.WASSER]: [40, 90, 200],
  [BIOM.STRAND]: [230, 210, 150],
  [BIOM.EBENE]: [140, 200, 90],
  [BIOM.WALD]: [40, 110, 50],
  [BIOM.BERG]: [120, 120, 125],
  [BIOM.SCHNEE]: [240, 240, 245],
};

function biomColorCss(biom) {
  const [r, g, b] = BIOM_FARBEN[biom] || [0, 0, 0];
  return `rgb(${r},${g},${b})`;
}

const BYTES_PER_TILE = 5; // biom, kraeuter, spirit_stones, holz, erz

class WorldGrid {
  constructor(breite, hoehe, tileData) {
    this.breite = breite;
    this.hoehe = hoehe;
    this.tileData = tileData; // Uint8Array, BYTES_PER_TILE bytes per tile, indexed x + y*breite
    this.minimapCanvas = this._buildMinimap();
  }

  _offset(x, y) {
    if (x < 0 || y < 0 || x >= this.breite || y >= this.hoehe) return -1;
    return (x + y * this.breite) * BYTES_PER_TILE;
  }

  getBiom(x, y) {
    const o = this._offset(x, y);
    return o < 0 ? null : this.tileData[o];
  }

  getTile(x, y) {
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
  setTile(x, y, tile) {
    const o = this._offset(x, y);
    if (o < 0) return;
    this.tileData[o] = tile.biom;
    this.tileData[o + 1] = tile.kraeuter;
    this.tileData[o + 2] = tile.spiritStones;
    this.tileData[o + 3] = tile.holz;
    this.tileData[o + 4] = tile.erz;

    const ctx = this.minimapCanvas.getContext("2d");
    const [r, g, b] = BIOM_FARBEN[tile.biom] || [0, 0, 0];
    const pixel = ctx.createImageData(1, 1);
    pixel.data.set([r, g, b, 255]);
    ctx.putImageData(pixel, x, y);
  }

  _buildMinimap() {
    const canvas = document.createElement("canvas");
    canvas.width = this.breite;
    canvas.height = this.hoehe;
    const ctx = canvas.getContext("2d");
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

async function loadWorld(client) {
  const metaRows = await client.sql("SELECT * FROM world_meta");
  if (!metaRows.length) {
    throw new Error("world_meta ist leer - wurde die Welt bereits generiert (Init-Reducer gelaufen)?");
  }

  const meta = metaRows[0];
  const breite = Number(meta.breite);
  const hoehe = Number(meta.hoehe);

  const tiles = await client.sql("SELECT * FROM world_tile");
  const tileData = new Uint8Array(breite * hoehe * BYTES_PER_TILE);
  for (const tile of tiles) {
    const x = Number(tile.x);
    const y = Number(tile.y);
    const o = (x + y * breite) * BYTES_PER_TILE;
    tileData[o] = Number(tile.biom_typ) & 0xff;
    tileData[o + 1] = Number(tile.kraeuter_menge) & 0xff;
    tileData[o + 2] = Number(tile.spirit_stones) & 0xff;
    tileData[o + 3] = Number(tile.holz) & 0xff;
    tileData[o + 4] = Number(tile.erz) & 0xff;
  }

  return new WorldGrid(breite, hoehe, tileData);
}
