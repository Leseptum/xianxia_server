import { describe, expect, it } from "vitest";
import { sha256Hex } from "./sha256";

// FIPS 180-4 / well-known SHA-256 test vectors.
describe("sha256Hex", () => {
  it("hashes the empty string", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("hashes 'abc'", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("hashes a 56-byte message (crosses one padding block boundary)", () => {
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
  });

  it("is deterministic and case/whitespace sensitive", () => {
    expect(sha256Hex("hello")).toBe(sha256Hex("hello"));
    expect(sha256Hex("hello")).not.toBe(sha256Hex("Hello"));
    expect(sha256Hex("hello")).not.toBe(sha256Hex("hello "));
  });
});
