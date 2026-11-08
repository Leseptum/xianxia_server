import { describe, expect, it } from "vitest";
import { nearestInRange } from "./combat";

describe("nearestInRange", () => {
  const npc = (id: number, posX: number, posY: number) => ({ id, posX, posY });

  it("finds NPCs on all 8 neighboring tiles (Chebyshev distance 1, like Lib.cs)", () => {
    for (const [dx, dy] of [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ]) {
      expect(nearestInRange(10, 10, [npc(1, 10 + dx, 10 + dy)])?.id).toBe(1);
    }
  });

  it("ignores NPCs two or more tiles away", () => {
    expect(nearestInRange(10, 10, [npc(1, 12, 10), npc(2, 10, 8), npc(3, 12, 12)])).toBeNull();
  });

  it("prefers the closer NPC (same tile beats a neighbor)", () => {
    expect(nearestInRange(10, 10, [npc(1, 11, 11), npc(2, 10, 10)])?.id).toBe(2);
  });

  it("returns null for no candidates", () => {
    expect(nearestInRange(0, 0, [])).toBeNull();
  });
});
