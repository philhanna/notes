import { describe, expect, it } from "vitest";
import { affectedPaths } from "./concurrency.ts";

describe("affectedPaths", () => {
  it("names the destination array, not the appended index, for create-element", () => {
    expect(
      affectedPaths({ kind: "create-element", path: ["list", 3] }),
    ).toEqual({
      document: [["list"]],
      trash: [],
    });
  });

  it("names both source and destination for move and copy", () => {
    expect(
      affectedPaths({ kind: "move", path: ["a"], newPath: ["b", "a"] }),
    ).toEqual({ document: [["a"], ["b", "a"]], trash: [] });
    expect(
      affectedPaths({ kind: "copy", path: ["a"], newPath: ["b", "a"] }),
    ).toEqual({ document: [["a"], ["b", "a"]], trash: [] });
  });

  it("names the trash record by ID for recover and permanent-delete", () => {
    expect(
      affectedPaths({ kind: "recover", path: ["a"], trashId: "t1" }),
    ).toEqual({ document: [["a"]], trash: ["t1"] });
    expect(
      affectedPaths({ kind: "permanent-delete", path: ["a"], trashId: "t1" }),
    ).toEqual({ document: [], trash: ["t1"] });
  });

  it("treats empty-trash as sensitive to any trash change", () => {
    expect(affectedPaths({ kind: "empty-trash" })).toEqual({
      document: [],
      trash: "all",
    });
  });
});
