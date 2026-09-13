import { describe, expect, it } from "vitest";
import { formatValueForEditing, inferValue } from "./inference.ts";

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

describe("formatValueForEditing", () => {
  it.each([
    ["hello", "hello"],
    ['say "hi"', 'say "hi"'],
    ["line one\nline two", "line one\nline two"],
    ["C:\\temp", "C:\\temp"],
    ["[hello", "[hello"],
  ])("shows the string %j as plain unescaped text", (value, expected) => {
    expect(formatValueForEditing(value)).toBe(expected);
  });

  it.each([
    ["123", '"123"'],
    ["true", '"true"'],
    ["null", '"null"'],
    ['"hello"', '"\\"hello\\""'],
    ["[1, 2]", '"[1, 2]"'],
  ])(
    "quotes the string %j that would otherwise change type",
    (value, expected) => {
      expect(formatValueForEditing(value)).toBe(expected);
    },
  );

  it.each([123, true, null, [1, 2], { a: 1 }])(
    "shows the non-string %j as JSON",
    (value) => {
      expect(formatValueForEditing(value)).toBe(JSON.stringify(value));
    },
  );

  it.each([
    "hello",
    'say "hi"',
    "line one\nline two",
    "123",
    '"hello"',
    123,
    null,
    [1, "two"],
  ])("round-trips %j unchanged through inferValue", (value) => {
    expect(inferValue(formatValueForEditing(value)).value).toEqual(value);
  });
});
