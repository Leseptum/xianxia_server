import { describe, expect, it } from "vitest";
import { deriveServerUri } from "./config";

describe("deriveServerUri", () => {
  it("derives ws://<host>:3000 on a plain http: page", () => {
    expect(deriveServerUri({ protocol: "http:", hostname: "192.168.1.50", search: "" })).toBe(
      "ws://192.168.1.50:3000"
    );
  });

  it("derives wss://db<host> on an https: page", () => {
    expect(deriveServerUri({ protocol: "https:", hostname: "antalia.leseptum.de", search: "" })).toBe(
      "wss://dbantalia.leseptum.de"
    );
  });

  it("honors a ?server= override as-is when already ws(s)://", () => {
    expect(
      deriveServerUri({ protocol: "https:", hostname: "antalia.leseptum.de", search: "?server=wss://maincloud.spacetimedb.com" })
    ).toBe("wss://maincloud.spacetimedb.com");
  });

  it("normalizes an http(s):// ?server= override to ws(s)://", () => {
    expect(
      deriveServerUri({ protocol: "http:", hostname: "localhost", search: "?server=https://maincloud.spacetimedb.com" })
    ).toBe("wss://maincloud.spacetimedb.com");
    expect(deriveServerUri({ protocol: "http:", hostname: "localhost", search: "?server=http://example.com" })).toBe(
      "ws://example.com"
    );
  });
});
