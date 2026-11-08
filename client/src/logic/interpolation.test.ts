import { describe, expect, it } from "vitest";
import { chebyshev, InterpolatedPosition, lerp } from "./interpolation";

describe("lerp", () => {
  it("returns the endpoints at t=0 and t=1 and the midpoint at t=0.5", () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(lerp(5, -5, 0.25)).toBe(2.5);
  });
});

describe("chebyshev", () => {
  it("is the larger of the two axis distances", () => {
    expect(chebyshev({ x: 0, y: 0 }, { x: 3, y: -1 })).toBe(3);
    expect(chebyshev({ x: 2, y: 2 }, { x: 1, y: 6 })).toBe(4);
  });
});

describe("InterpolatedPosition", () => {
  it("starts at rest at its initial position", () => {
    const p = new InterpolatedPosition(5, 7);
    expect(p.sample(0)).toEqual({ x: 5, y: 7 });
    expect(p.sample(1e9)).toEqual({ x: 5, y: 7 });
    expect(p.isMoving(0)).toBe(false);
  });

  it("moves linearly to a new target over the given duration and then stays there", () => {
    const p = new InterpolatedPosition(0, 0);
    p.setTarget(1, 0, 1000, 100);
    expect(p.sample(1000)).toEqual({ x: 0, y: 0 });
    expect(p.sample(1025)).toEqual({ x: 0.25, y: 0 });
    expect(p.sample(1050)).toEqual({ x: 0.5, y: 0 });
    expect(p.isMoving(1050)).toBe(true);
    expect(p.sample(1100)).toEqual({ x: 1, y: 0 });
    expect(p.sample(5000)).toEqual({ x: 1, y: 0 });
    expect(p.isMoving(1100)).toBe(false);
  });

  it("clamps samples taken before the movement started", () => {
    const p = new InterpolatedPosition(0, 0);
    p.setTarget(0, 2, 1000, 100);
    expect(p.sample(900)).toEqual({ x: 0, y: 0 });
  });

  it("retargets mid-flight from the currently shown position, without a jump", () => {
    const p = new InterpolatedPosition(0, 0);
    p.setTarget(1, 0, 0, 100);
    const shownBefore = p.sample(60); // 0.6 of the way
    p.setTarget(1, 1, 60, 100);
    const shownAfter = p.sample(60);
    expect(shownAfter.x).toBeCloseTo(shownBefore.x, 10);
    expect(shownAfter.y).toBeCloseTo(shownBefore.y, 10);
    // ...and then continues toward the new target.
    expect(p.sample(110)).toEqual({ x: 0.8, y: 0.5 });
    expect(p.sample(160)).toEqual({ x: 1, y: 1 });
    expect(p.target).toEqual({ x: 1, y: 1 });
  });

  it("does not restart an in-progress move when the same target is set again", () => {
    const p = new InterpolatedPosition(0, 0);
    p.setTarget(2, 0, 0, 100);
    p.setTarget(2, 0, 90, 100); // e.g. a Player row update that only changed Qi
    expect(p.sample(100)).toEqual({ x: 2, y: 0 });
  });

  it("snaps instead of sliding when the jump exceeds the snap distance", () => {
    const p = new InterpolatedPosition(10, 10);
    p.setTarget(40, 10, 0, 150, 3);
    expect(p.sample(0)).toEqual({ x: 40, y: 10 });
    expect(p.isMoving(0)).toBe(false);
  });

  it("measures the snap distance from the shown position, not the old target", () => {
    const p = new InterpolatedPosition(0, 0);
    p.setTarget(3, 0, 0, 100, 3); // within snap distance -> slides
    expect(p.sample(0)).toEqual({ x: 0, y: 0 });
    // At t=0 the shown position is still (0,0): (4,0) is 4 away -> snap.
    p.setTarget(4, 0, 0, 100, 3);
    expect(p.sample(0)).toEqual({ x: 4, y: 0 });
  });

  it("snaps when the duration is zero", () => {
    const p = new InterpolatedPosition(0, 0);
    p.setTarget(1, 1, 0, 0);
    expect(p.sample(0)).toEqual({ x: 1, y: 1 });
  });

  it("snapTo cancels a running move", () => {
    const p = new InterpolatedPosition(0, 0);
    p.setTarget(1, 0, 0, 100);
    p.snapTo(5, 5);
    expect(p.sample(50)).toEqual({ x: 5, y: 5 });
    expect(p.isMoving(50)).toBe(false);
  });
});
