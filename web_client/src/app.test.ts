import { describe, expect, it } from "vitest";
import { clamp, toPlayerState } from "./app";
import type { Player as PlayerRow } from "./module_bindings/types";

// Deliberately not testing isWalkable/update/render/boot or anything else that
// reads app.ts's module-level `game`/`connection` state - that needs a live
// DOM + a real SpacetimeDB connection to exercise meaningfully (see the
// review notes this test suite came out of). clamp/toPlayerState are the only
// two pure, already-exported-for-this-purpose helpers in this file.

describe("clamp", () => {
  it("passes values already inside the range through unchanged", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to the lower bound", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps to the upper bound", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("handles min === max", () => {
    expect(clamp(3, 7, 7)).toBe(7);
  });
});

describe("toPlayerState", () => {
  it("copies only the HUD/render-relevant fields off a Player row", () => {
    const row = {
      playerId: 123n,
      name: "les",
      qi: 42n,
      qiMaximum: 100n,
      stufe: 2,
      posX: 130.5,
      posY: 64,
    } as PlayerRow;

    expect(toPlayerState(row)).toEqual({
      playerId: 123n,
      name: "les",
      qi: 42n,
      qiMaximum: 100n,
      stufe: 2,
      posX: 130.5,
      posY: 64,
    });
  });
});
