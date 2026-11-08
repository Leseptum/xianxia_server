import { describe, expect, it } from "vitest";
import { BIOM } from "../world";
import { directionFromKeys, isWalkableBiom, PredictedPosition, type DirectionKeys } from "./movement";

const NONE: DirectionKeys = { up: false, down: false, left: false, right: false };

describe("directionFromKeys", () => {
  it("maps each key to the same grid direction as web_client", () => {
    expect(directionFromKeys({ ...NONE, up: true })).toEqual({ dx: 0, dy: -1 });
    expect(directionFromKeys({ ...NONE, down: true })).toEqual({ dx: 0, dy: 1 });
    expect(directionFromKeys({ ...NONE, left: true })).toEqual({ dx: -1, dy: 0 });
    expect(directionFromKeys({ ...NONE, right: true })).toEqual({ dx: 1, dy: 0 });
  });

  it("returns null when no key is held", () => {
    expect(directionFromKeys(NONE)).toBeNull();
  });

  it("never moves diagonally: left > right > up > down, like web_client's else-if chain", () => {
    expect(directionFromKeys({ up: true, down: true, left: true, right: true })).toEqual({ dx: -1, dy: 0 });
    expect(directionFromKeys({ ...NONE, up: true, right: true })).toEqual({ dx: 1, dy: 0 });
    expect(directionFromKeys({ ...NONE, up: true, down: true })).toEqual({ dx: 0, dy: -1 });
  });
});

describe("isWalkableBiom", () => {
  it("blocks water and mountains (Lib.cs IstBegehbar) and out-of-map (null)", () => {
    expect(isWalkableBiom(BIOM.WASSER)).toBe(false);
    expect(isWalkableBiom(BIOM.BERG)).toBe(false);
    expect(isWalkableBiom(null)).toBe(false);
  });

  it("allows every other biome", () => {
    for (const b of [BIOM.STRAND, BIOM.EBENE, BIOM.WALD, BIOM.SCHNEE]) expect(isWalkableBiom(b)).toBe(true);
  });
});

describe("PredictedPosition", () => {
  const all = () => true;
  const right = { dx: 1, dy: 0 };
  const left = { dx: -1, dy: 0 };
  const up = { dx: 0, dy: -1 };

  it("floors the initial server position like web_client", () => {
    const p = new PredictedPosition(12.9, 3.2);
    expect([p.x, p.y]).toEqual([12, 3]);
  });

  it("applies a walkable step locally and counts it as pending", () => {
    const p = new PredictedPosition(5, 5);
    expect(p.tryStep(right, all, 10, 10)).toEqual({ x: 6, y: 5 });
    expect([p.x, p.y]).toEqual([6, 5]);
    expect(p.pendingSteps).toBe(1);
  });

  it("rejects a step onto an unwalkable tile without moving", () => {
    const p = new PredictedPosition(5, 5);
    const walkable = (x: number, y: number) => !(x === 6 && y === 5);
    expect(p.tryStep(right, walkable, 10, 10)).toBeNull();
    expect([p.x, p.y]).toEqual([5, 5]);
    expect(p.pendingSteps).toBe(0);
  });

  it("rejects stepping off the map edge", () => {
    const p = new PredictedPosition(0, 0);
    expect(p.tryStep(left, all, 10, 10)).toBeNull();
    expect(p.tryStep(up, all, 10, 10)).toBeNull();
    const q = new PredictedPosition(9, 9);
    expect(q.tryStep(right, all, 10, 10)).toBeNull();
    expect(q.pendingSteps).toBe(0);
  });

  it("does not reconcile while later steps are still in flight", () => {
    const p = new PredictedPosition(0, 0);
    p.tryStep(right, all, 10, 10); // -> 1,0
    p.tryStep(right, all, 10, 10); // -> 2,0
    // First ack: the server row is at 1,0, i.e. behind the prediction - expected, not an error.
    expect(p.settle({ x: 1, y: 0 })).toBe(false);
    expect([p.x, p.y]).toEqual([2, 0]);
    // Last ack confirms 2,0.
    expect(p.settle({ x: 2, y: 0 })).toBe(false);
    expect([p.x, p.y]).toEqual([2, 0]);
    expect(p.pendingSteps).toBe(0);
  });

  it("corrects to the server position once the last pending step settles", () => {
    const p = new PredictedPosition(0, 0);
    p.tryStep(right, all, 10, 10); // predicted 1,0 - but the server rejected it
    expect(p.settle({ x: 0, y: 0 })).toBe(true);
    expect([p.x, p.y]).toEqual([0, 0]);
  });

  it("ignores server row updates while own steps are pending", () => {
    const p = new PredictedPosition(0, 0);
    p.tryStep(right, all, 10, 10);
    expect(p.serverUpdate({ x: 1, y: 0 })).toBe(false);
    expect(p.serverUpdate({ x: 50, y: 50 })).toBe(false);
    expect([p.x, p.y]).toEqual([1, 0]);
  });

  it("adopts external server moves (e.g. editor) when nothing is pending", () => {
    const p = new PredictedPosition(0, 0);
    expect(p.serverUpdate({ x: 40, y: 41 })).toBe(true);
    expect([p.x, p.y]).toEqual([40, 41]);
    expect(p.serverUpdate({ x: 40, y: 41 })).toBe(false); // unchanged -> no correction
  });

  it("treats a rejected reducer call like a settled step", () => {
    const p = new PredictedPosition(3, 3);
    p.tryStep(up, all, 10, 10);
    expect(p.settle(null)).toBe(false); // no row available -> keep prediction
    expect(p.pendingSteps).toBe(0);
    expect(p.settle({ x: 3, y: 3 })).toBe(true); // never goes below zero pending
  });
});
