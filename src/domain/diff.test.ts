import { describe, expect, it } from "vitest";
import { anyPathOverlaps, changedPaths, pathsOverlap } from "./diff.ts";

describe("changedPaths", () => {
  it("reports nothing for identical documents", () => {
    expect(changedPaths({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toEqual([]);
  });

  it("reports a changed scalar at its own path", () => {
    expect(changedPaths({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual([["b"]]);
  });

  it("reports different keys as independent, disjoint changes", () => {
    const before = { a: 1, b: 2 };
    const after = { a: 10, b: 2 };
    expect(changedPaths(before, after)).toEqual([["a"]]);
  });

  it("reports an added key at its own path", () => {
    expect(changedPaths({ a: 1 }, { a: 1, b: 2 })).toEqual([["b"]]);
  });

  it("reports a removed key at its own path", () => {
    expect(changedPaths({ a: 1, b: 2 }, { a: 1 })).toEqual([["b"]]);
  });

  it("recurses into nested objects", () => {
    expect(
      changedPaths(
        { tips: { bash: { fc: "old" } } },
        { tips: { bash: { fc: "new" } } },
      ),
    ).toEqual([["tips", "bash", "fc"]]);
  });

  it("compares equal-length arrays index by index", () => {
    expect(changedPaths({ list: [1, 2, 3] }, { list: [1, 9, 3] })).toEqual([
      ["list", 1],
    ]);
  });

  it("reports the whole array as changed when its length differs", () => {
    expect(changedPaths({ list: [1, 2] }, { list: [1, 2, 3] })).toEqual([
      ["list"],
    ]);
  });

  it("reports a type change (object to array) at its own path", () => {
    expect(changedPaths({ a: {} }, { a: [] })).toEqual([["a"]]);
  });
});

describe("pathsOverlap", () => {
  it("is true for identical paths", () => {
    expect(pathsOverlap(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("is true when one path is an ancestor of the other", () => {
    expect(pathsOverlap(["a"], ["a", "b"])).toBe(true);
    expect(pathsOverlap(["a", "b"], ["a"])).toBe(true);
  });

  it("is false for unrelated paths", () => {
    expect(pathsOverlap(["a"], ["b"])).toBe(false);
  });
});

describe("anyPathOverlaps", () => {
  it("is false when no pair overlaps", () => {
    expect(anyPathOverlaps([["a"]], [["b"], ["c", "d"]])).toBe(false);
  });

  it("is true when any pair overlaps", () => {
    expect(anyPathOverlaps([["a", "b"]], [["a"]])).toBe(true);
  });

  it("is false for two empty lists", () => {
    expect(anyPathOverlaps([], [])).toBe(false);
  });
});
