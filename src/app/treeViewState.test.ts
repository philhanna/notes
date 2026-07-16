import { describe, expect, it } from "vitest";
import {
  deriveVisibleTree,
  expandAncestors,
  nearestExistingPath,
  remapArrayReorderPath,
  remapArrayReorderPointers,
  remapPointerSet,
  removePointerSubtree,
  validateExpandedPaths,
} from "./treeViewState.ts";
import type { JsonObject } from "../domain/types.ts";

const document: JsonObject = {
  alpha: { one: 1, nested: { leaf: true } },
  list: [{ name: "first" }, { name: "second" }, 3],
  numeric: { "0": { value: "object key" } },
};

describe("treeViewState", () => {
  it("flattens only nodes whose complete ancestor chain is expanded", () => {
    const visible = deriveVisibleTree(
      document,
      new Set(["", "/alpha", "/alpha/nested"]),
    );
    expect(visible.map((node) => node.pointer)).toEqual([
      "",
      "/alpha",
      "/alpha/nested",
      "/alpha/nested/leaf",
      "/alpha/one",
      "/list",
      "/numeric",
    ]);
  });

  it("keeps object children sorted and array children in document order", () => {
    const visible = deriveVisibleTree(
      document,
      new Set(["", "/alpha", "/list"]),
    );
    expect(
      visible
        .filter((node) => node.depth === 2 && node.path[0] === "alpha")
        .map((node) => node.label),
    ).toEqual(["nested", "one"]);
    expect(
      visible
        .filter((node) => node.depth === 2 && node.path[0] === "list")
        .map((node) => node.label),
    ).toEqual(["[0]", "[1]", "[2]"]);
  });

  it("expands every ancestor without expanding the result itself", () => {
    expect([
      ...expandAncestors(new Set(), ["alpha", "nested", "leaf"]),
    ]).toEqual(["", "/alpha", "/alpha/nested"]);
  });

  it("remaps renamed and moved subtree pointers without corrupting numeric object keys", () => {
    expect([
      ...remapPointerSet(
        new Set(["/numeric/0", "/numeric/0/value"]),
        ["numeric", "0"],
        ["renamed", "0"],
      ),
    ]).toEqual(["/renamed/0", "/renamed/0/value"]);
  });

  it("remaps array indexes for both the moved element and shifted siblings", () => {
    expect(remapArrayReorderPath(["list", 0, "name"], ["list"], 0, 2)).toEqual([
      "list",
      2,
      "name",
    ]);
    expect([
      ...remapArrayReorderPointers(
        new Set(["/list/0", "/list/1", "/list/2/name"]),
        ["list"],
        0,
        2,
      ),
    ]).toEqual(["/list/2", "/list/0", "/list/1/name"]);
  });

  it("removes deleted subtrees and reconciles invalid stored paths", () => {
    expect([
      ...removePointerSubtree(
        new Set(["", "/alpha", "/alpha/nested", "/list"]),
        ["alpha"],
      ),
    ]).toEqual(["", "/list"]);
    expect([
      ...validateExpandedPaths(
        document,
        new Set(["", "/alpha", "/alpha/one", "/missing"]),
      ),
    ]).toEqual(["", "/alpha"]);
    expect(nearestExistingPath(document, ["alpha", "missing", "leaf"])).toEqual(
      ["alpha"],
    );
  });
});
