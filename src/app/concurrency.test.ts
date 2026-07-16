import { describe, expect, it } from "vitest";
import { affectedPaths } from "./concurrency.ts";

describe("affectedPaths", () => {
  it("names the destination array, not the appended index, for create-element", () => {
    expect(
      affectedPaths({ kind: "create-element", path: ["list", 3] }),
    ).toEqual([["list"]]);
  });

  it("names both source and destination for move and copy", () => {
    expect(
      affectedPaths({ kind: "move", path: ["a"], newPath: ["b", "a"] }),
    ).toEqual([["a"], ["b", "a"]]);
    expect(
      affectedPaths({ kind: "copy", path: ["a"], newPath: ["b", "a"] }),
    ).toEqual([["a"], ["b", "a"]]);
  });

  it("names the deleted path for delete", () => {
    expect(affectedPaths({ kind: "delete", path: ["a"] })).toEqual([["a"]]);
  });
});
