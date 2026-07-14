import { describe, expect, it } from "vitest";
import { inferValue } from "./inference.ts";

describe("inferValue", () => {
  it.each([
    ["123", 123, "number"],
    ["true", true, "boolean"],
    ["false", false, "boolean"],
    ["null", null, "null"],
    ['"123"', "123", "string"],
  ] as const)("infers %s", (input, expected, kind) => {
    const result = inferValue(input);
    expect(result.value).toEqual(expected);
    expect(result.kind).toBe(kind);
  });

  it("infers a JSON array", () => {
    const result = inferValue("[1, 2]");
    expect(result.value).toEqual([1, 2]);
    expect(result.kind).toBe("array");
  });

  it("infers an unquoted string as a string", () => {
    const result = inferValue("hello world");
    expect(result.value).toBe("hello world");
    expect(result.kind).toBe("string");
  });

  it("infers JSON-looking but invalid text as a string", () => {
    const result = inferValue("[hello");
    expect(result.value).toBe("[hello");
    expect(result.kind).toBe("string");
  });

  it("infers a JSON object as a navigable container", () => {
    const result = inferValue('{"a": 1}');
    expect(result.value).toEqual({ a: 1 });
    expect(result.kind).toBe("object");
  });
});
