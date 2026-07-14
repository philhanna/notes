import { describe, expect, it } from "vitest";
import {
  parseDocument,
  serializeDocument,
  validateDocument,
} from "./serialize.ts";
import type { JsonObject } from "./types.ts";

describe("serializeDocument / parseDocument round trip", () => {
  it.each([
    ["string", { a: "hello" }],
    ["number", { a: 123 }],
    ["boolean true", { a: true }],
    ["boolean false", { a: false }],
    ["null", { a: null }],
    ["array", { a: [1, "two", false, null] }],
    ["nested object", { a: { b: { c: 1 } } }],
    ["key with slash and tilde", { "a/b~c": 1 }],
    ["empty object and array", { obj: {}, arr: [] }],
  ] as const)("round-trips %s", (_label, doc) => {
    const text = serializeDocument(doc as JsonObject);
    const result = parseDocument(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(doc);
    }
  });

  it("produces stable, deterministic formatting", () => {
    const text = serializeDocument({ a: 1, b: [1, 2] });
    expect(text).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}\n');
  });
});

describe("validateDocument", () => {
  it("rejects a non-object root", () => {
    expect(validateDocument([1, 2]).ok).toBe(false);
    expect(validateDocument("hello").ok).toBe(false);
    expect(validateDocument(123).ok).toBe(false);
  });

  it("rejects duplicate keys differing only by case", () => {
    const result = parseDocument('{"Home": 1, "home": 2}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("duplicate-key");
    }
  });

  it("rejects duplicate keys differing only by case in a nested object", () => {
    const result = parseDocument('{"a": {"Home": 1, "home": 2}}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        kind: "duplicate-key",
        path: ["a"],
        key: "home",
      });
    }
  });

  it("accepts documents with no duplicate keys", () => {
    expect(validateDocument({ Home: 1, away: 2 }).ok).toBe(true);
  });

  it("reports invalid JSON syntax distinctly from validation errors", () => {
    const result = parseDocument("{not json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("syntax");
    }
  });
});
