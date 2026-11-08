import { describe, expect, it } from "vitest";
import { Emitter } from "./emitter";

type Events = { ping: [number, string]; done: [] };

describe("Emitter", () => {
  it("delivers typed arguments to every handler of an event", () => {
    const e = new Emitter<Events>();
    const got: Array<[number, string]> = [];
    e.on("ping", (n, s) => got.push([n, s]));
    e.on("ping", (n, s) => got.push([n * 10, s.toUpperCase()]));
    e.emit("ping", 1, "a");
    expect(got).toEqual([
      [1, "a"],
      [10, "A"],
    ]);
  });

  it("does nothing for an event without handlers", () => {
    expect(() => new Emitter<Events>().emit("done")).not.toThrow();
  });

  it("stops delivering after unsubscribing", () => {
    const e = new Emitter<Events>();
    let calls = 0;
    const off = e.on("done", () => calls++);
    e.emit("done");
    off();
    e.emit("done");
    expect(calls).toBe(1);
  });

  it("lets a handler unsubscribe itself during emit without skipping others", () => {
    const e = new Emitter<Events>();
    const order: string[] = [];
    const offA = e.on("done", () => {
      order.push("a");
      offA();
    });
    e.on("done", () => order.push("b"));
    e.emit("done");
    e.emit("done");
    expect(order).toEqual(["a", "b", "b"]);
  });
});
