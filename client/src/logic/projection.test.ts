import { describe, expect, it } from "vitest";
import { mapBounds, tileToWorld, worldToTile, worldToTileIndex, type TileMetrics } from "./projection";

const M: TileMetrics = { tileWidth: 64, tileHeight: 40 };

describe("tileToWorld", () => {
  it("puts tile (0,0)'s center at the origin", () => {
    expect(tileToWorld(0, 0, M)).toEqual({ x: 0, y: 0 });
  });

  it("is not rotated: grid +x = screen right, grid +y = screen down", () => {
    expect(tileToWorld(1, 0, M)).toEqual({ x: 64, y: 0 });
    expect(tileToWorld(0, 1, M)).toEqual({ x: 0, y: 40 });
  });

  it("maps grid -y (W / north) straight up", () => {
    const from = tileToWorld(10, 10, M);
    const to = tileToWorld(10, 9, M);
    expect(to.x - from.x).toBe(0);
    expect(to.y - from.y).toBe(-40);
  });

  it("projects fractional positions linearly (interpolation)", () => {
    const a = tileToWorld(3, 7, M);
    const b = tileToWorld(4, 7, M);
    expect(tileToWorld(3.25, 7, M)).toEqual({ x: a.x + (b.x - a.x) * 0.25, y: a.y });
  });
});

describe("worldToTile", () => {
  it("inverts tileToWorld", () => {
    for (const [x, y] of [
      [0, 0],
      [255, 0],
      [0, 255],
      [128.5, 17.25],
    ]) {
      const w = tileToWorld(x, y, M);
      const t = worldToTile(w.x, w.y, M);
      expect(t.x).toBeCloseTo(x, 10);
      expect(t.y).toBeCloseTo(y, 10);
    }
  });
});

describe("worldToTileIndex", () => {
  it("returns the tile whose rectangle contains the point", () => {
    const c = tileToWorld(5, 9, M);
    expect(worldToTileIndex(c.x, c.y, M)).toEqual({ x: 5, y: 9 });
    expect(worldToTileIndex(c.x + 31, c.y + 19, M)).toEqual({ x: 5, y: 9 });
    expect(worldToTileIndex(c.x - 32, c.y - 20, M)).toEqual({ x: 5, y: 9 });
    expect(worldToTileIndex(c.x + 33, c.y, M)).toEqual({ x: 6, y: 9 });
    expect(worldToTileIndex(c.x, c.y + 21, M)).toEqual({ x: 5, y: 10 });
  });
});

describe("mapBounds", () => {
  it("spans every tile from the top-left corner of (0,0) to the bottom-right corner of the last tile", () => {
    const b = mapBounds(256, 256, M);
    expect(b).toEqual({ x: -32, y: -20, width: 256 * 64, height: 256 * 40 });
    const last = tileToWorld(255, 255, M);
    expect(b.x + b.width).toBe(last.x + 32);
    expect(b.y + b.height).toBe(last.y + 20);
  });
});
