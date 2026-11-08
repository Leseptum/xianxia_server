import { describe, expect, it } from "vitest";
import {
  forEachVisibleTile,
  isoMapBounds,
  tileToWorld,
  worldToTile,
  worldToTileIndex,
  type IsoMetrics,
  type Rect,
} from "./iso";

const M: IsoMetrics = { tileWidth: 64, tileHeight: 32 };

describe("tileToWorld", () => {
  it("puts tile (0,0)'s center at the origin", () => {
    expect(tileToWorld(0, 0, M)).toEqual({ x: 0, y: 0 });
  });

  it("maps grid +x to screen down-right and grid +y to screen down-left", () => {
    expect(tileToWorld(1, 0, M)).toEqual({ x: 32, y: 16 });
    expect(tileToWorld(0, 1, M)).toEqual({ x: -32, y: 16 });
  });

  it("maps grid -y (W / north) to screen up-right", () => {
    const from = tileToWorld(10, 10, M);
    const to = tileToWorld(10, 9, M);
    expect(to.x - from.x).toBe(32);
    expect(to.y - from.y).toBe(-16);
  });

  it("is linear, so fractional positions interpolate between tile centers", () => {
    const a = tileToWorld(3, 5, M);
    const b = tileToWorld(4, 5, M);
    const mid = tileToWorld(3.5, 5, M);
    expect(mid).toEqual({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  });
});

describe("worldToTile", () => {
  it("is the exact inverse of tileToWorld", () => {
    for (const [tx, ty] of [
      [0, 0],
      [255, 0],
      [0, 255],
      [128, 128],
      [17.25, 3.5],
      [-2, 7],
    ]) {
      const w = tileToWorld(tx, ty, M);
      const back = worldToTile(w.x, w.y, M);
      expect(back.x).toBeCloseTo(tx, 10);
      expect(back.y).toBeCloseTo(ty, 10);
    }
  });
});

describe("worldToTileIndex", () => {
  it("returns the tile whose diamond contains the point, up to just inside each corner", () => {
    const c = tileToWorld(10, 20, M);
    const e = 0.01;
    const insidePoints = [
      [c.x, c.y],
      [c.x, c.y - 16 + e], // top vertex
      [c.x + 32 - e, c.y], // right vertex
      [c.x, c.y + 16 - e], // bottom vertex
      [c.x - 32 + e, c.y], // left vertex
    ];
    for (const [wx, wy] of insidePoints) {
      expect(worldToTileIndex(wx, wy, M)).toEqual({ x: 10, y: 20 });
    }
  });

  it("crosses into the neighbor just past an edge", () => {
    const c = tileToWorld(10, 20, M);
    // Just past the upper-right edge midpoint -> neighbor in grid -y direction.
    expect(worldToTileIndex(c.x + 16 + 1, c.y - 8 - 1, M)).toEqual({ x: 10, y: 19 });
    // Just past the lower-right edge midpoint -> neighbor in grid +x direction.
    expect(worldToTileIndex(c.x + 16 + 1, c.y + 8 + 1, M)).toEqual({ x: 11, y: 20 });
  });
});

describe("isoMapBounds", () => {
  it("encloses every tile diamond's vertices exactly", () => {
    const W = 7;
    const H = 4;
    const b = isoMapBounds(W, H, M);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = tileToWorld(x, y, M);
        minX = Math.min(minX, c.x - 32);
        maxX = Math.max(maxX, c.x + 32);
        minY = Math.min(minY, c.y - 16);
        maxY = Math.max(maxY, c.y + 16);
      }
    }
    expect(b).toEqual({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
  });
});

describe("forEachVisibleTile", () => {
  function collect(view: Rect, w: number, h: number, pad = 0): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    forEachVisibleTile(view, w, h, M, pad, (x, y) => out.push([x, y]));
    return out;
  }

  /** Brute force: does tile (x, y)'s diamond bounding box intersect `view`? */
  function intersects(x: number, y: number, view: Rect): boolean {
    const c = tileToWorld(x, y, M);
    return (
      c.x + 32 > view.x &&
      c.x - 32 < view.x + view.width &&
      c.y + 16 > view.y &&
      c.y - 16 < view.y + view.height
    );
  }

  // Deterministic pseudo-random views (no Math.random in tests).
  function* views(count: number): Generator<Rect> {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < count; i++) {
      yield {
        x: -900 + rnd() * 1600,
        y: -200 + rnd() * 900,
        width: 50 + rnd() * 900,
        height: 50 + rnd() * 600,
      };
    }
  }

  it("is complete: never misses a tile that intersects the view", () => {
    const W = 23;
    const H = 17;
    for (const view of views(200)) {
      const got = new Set(collect(view, W, H).map(([x, y]) => `${x},${y}`));
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (intersects(x, y, view)) expect(got.has(`${x},${y}`), `${x},${y} in ${JSON.stringify(view)}`).toBe(true);
        }
      }
    }
  });

  it("is tight: only yields in-bounds, unique tiles within one tile of the view", () => {
    const W = 23;
    const H = 17;
    for (const view of views(200)) {
      const tiles = collect(view, W, H);
      const keys = tiles.map(([x, y]) => `${x},${y}`);
      expect(new Set(keys).size).toBe(keys.length);
      const grown: Rect = { x: view.x - 64, y: view.y - 32, width: view.width + 128, height: view.height + 64 };
      for (const [x, y] of tiles) {
        expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
        expect(x >= 0 && x < W && y >= 0 && y < H).toBe(true);
        expect(intersects(x, y, grown)).toBe(true);
      }
    }
  });

  it("yields tiles back-to-front (non-decreasing screen y)", () => {
    const tiles = collect({ x: -300, y: 0, width: 600, height: 300 }, 30, 30);
    for (let i = 1; i < tiles.length; i++) {
      const prev = tileToWorld(tiles[i - 1][0], tiles[i - 1][1], M);
      const cur = tileToWorld(tiles[i][0], tiles[i][1], M);
      expect(cur.y).toBeGreaterThanOrEqual(prev.y);
    }
  });

  it("yields every tile when the view covers the whole map", () => {
    const W = 9;
    const H = 13;
    const b = isoMapBounds(W, H, M);
    expect(collect(b, W, H)).toHaveLength(W * H);
  });

  it("yields nothing for a view entirely outside the map", () => {
    expect(collect({ x: 5000, y: 5000, width: 100, height: 100 }, 10, 10)).toEqual([]);
    expect(collect({ x: -100, y: -5000, width: 200, height: 100 }, 10, 10)).toEqual([]);
  });

  it("only visits roughly the visible tiles on a 256x256 map, not all 65536", () => {
    // ~1280x720 viewport at zoom 1 in the middle of the map.
    const center = tileToWorld(128, 128, M);
    const view = { x: center.x - 640, y: center.y - 360, width: 1280, height: 720 };
    const count = collect(view, 256, 256, 1).length;
    const visibleApprox = (1280 / 64) * (720 / 32) * 2; // two tile centers per 64x32 cell
    expect(count).toBeGreaterThan(visibleApprox * 0.9);
    expect(count).toBeLessThan(visibleApprox * 1.6);
  });
});
