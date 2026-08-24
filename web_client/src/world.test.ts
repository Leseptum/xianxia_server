import { describe, expect, it } from "vitest";
import { BIOM, WorldGrid, biomColorCss } from "./world";

// jsdom creates real <canvas> elements but doesn't implement the 2D drawing API
// (getContext("2d") returns null) without the native `canvas` package - not worth
// pulling in a heavy native dependency just so WorldGrid's constructor doesn't
// throw, since these tests only care about its data logic (getBiom/getTile/
// setTile), not actual pixels. A minimal stub is enough for that.
HTMLCanvasElement.prototype.getContext = ((): unknown => ({
  createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  putImageData: () => {},
})) as typeof HTMLCanvasElement.prototype.getContext;

describe("biomColorCss", () => {
  it("maps every known biome to a distinct rgb() string", () => {
    const colors = new Set(Object.values(BIOM).map((b) => biomColorCss(b)));
    expect(colors.size).toBe(Object.values(BIOM).length);
    expect(biomColorCss(BIOM.WASSER)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });

  it("falls back to black for an unknown biome id", () => {
    expect(biomColorCss(99)).toBe("rgb(0,0,0)");
  });
});

describe("WorldGrid", () => {
  // 2x2 world, 5 bytes/tile (biom, kraeuter, spiritStones, holz, erz) - matches
  // BYTES_PER_TILE in src/world.ts.
  function makeGrid(): WorldGrid {
    // (0,0)=Wasser, (1,0)=Ebene, (0,1)=Wald, (1,1)=Berg
    const data = new Uint8Array([
      BIOM.WASSER, 0, 0, 0, 0,
      BIOM.EBENE, 3, 0, 1, 0,
      BIOM.WALD, 5, 0, 4, 0,
      BIOM.BERG, 0, 2, 0, 6,
    ]);
    return new WorldGrid(2, 2, data);
  }

  it("reads back biomes at each coordinate", () => {
    const grid = makeGrid();
    expect(grid.getBiom(0, 0)).toBe(BIOM.WASSER);
    expect(grid.getBiom(1, 0)).toBe(BIOM.EBENE);
    expect(grid.getBiom(0, 1)).toBe(BIOM.WALD);
    expect(grid.getBiom(1, 1)).toBe(BIOM.BERG);
  });

  it("returns null out of bounds", () => {
    const grid = makeGrid();
    expect(grid.getBiom(-1, 0)).toBeNull();
    expect(grid.getBiom(0, -1)).toBeNull();
    expect(grid.getBiom(2, 0)).toBeNull();
    expect(grid.getBiom(0, 2)).toBeNull();
  });

  it("reads back the full resource tuple via getTile", () => {
    const grid = makeGrid();
    expect(grid.getTile(1, 0)).toEqual({ biom: BIOM.EBENE, kraeuter: 3, spiritStones: 0, holz: 1, erz: 0 });
    expect(grid.getTile(5, 5)).toBeNull();
  });

  it("setTile overwrites a tile in place, leaving others untouched", () => {
    const grid = makeGrid();
    grid.setTile(0, 0, { biom: BIOM.SCHNEE, kraeuter: 1, spiritStones: 2, holz: 3, erz: 4 });
    expect(grid.getTile(0, 0)).toEqual({ biom: BIOM.SCHNEE, kraeuter: 1, spiritStones: 2, holz: 3, erz: 4 });
    // untouched neighbor
    expect(grid.getTile(1, 0)).toEqual({ biom: BIOM.EBENE, kraeuter: 3, spiritStones: 0, holz: 1, erz: 0 });
  });

  it("setTile out of bounds is a no-op, not a throw", () => {
    const grid = makeGrid();
    expect(() => grid.setTile(9, 9, { biom: BIOM.WALD, kraeuter: 0, spiritStones: 0, holz: 0, erz: 0 })).not.toThrow();
  });
});
