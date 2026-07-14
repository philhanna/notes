import { describe, expect, it } from "vitest";
import {
  adjustPathAfterRemoval,
  decodePointerSegments,
  encodePointer,
  isPathWithinOrEqual,
  resolvePointer,
} from "./path.ts";

describe("encodePointer", () => {
  it("encodes the root path as the empty string", () => {
    expect(encodePointer([])).toBe("");
  });

  it("encodes object keys and array indices", () => {
    expect(encodePointer(["tips", "bash", 0])).toBe("/tips/bash/0");
  });

  it("escapes ~ and / in keys", () => {
    expect(encodePointer(["a/b", "c~d"])).toBe("/a~1b/c~0d");
  });
});

describe("decodePointerSegments", () => {
  it("decodes the empty pointer as no segments", () => {
    expect(decodePointerSegments("")).toEqual([]);
  });

  it("unescapes ~1 and ~0", () => {
    expect(decodePointerSegments("/a~1b/c~0d")).toEqual(["a/b", "c~d"]);
  });

  it("round-trips through encodePointer", () => {
    const path = ["weird/key", "another~key", 3];
    expect(decodePointerSegments(encodePointer(path)).join("/")).toEqual(
      path.map(String).join("/"),
    );
  });
});

describe("resolvePointer", () => {
  const doc = {
    tips: {
      bash: ["first", "second"],
    },
    "with/slash": 1,
  };

  it("resolves an object path to typed string segments", () => {
    expect(resolvePointer(doc, "/tips/bash")).toEqual(["tips", "bash"]);
  });

  it("resolves an array segment to a numeric index", () => {
    expect(resolvePointer(doc, "/tips/bash/1")).toEqual(["tips", "bash", 1]);
  });

  it("unescapes a key containing a slash", () => {
    expect(resolvePointer(doc, "/with~1slash")).toEqual(["with/slash"]);
  });

  it("returns undefined for a missing key", () => {
    expect(resolvePointer(doc, "/nope")).toBeUndefined();
  });

  it("returns undefined for an out-of-range array index", () => {
    expect(resolvePointer(doc, "/tips/bash/9")).toBeUndefined();
  });

  it("returns undefined for a non-numeric array segment", () => {
    expect(resolvePointer(doc, "/tips/bash/first")).toBeUndefined();
  });
});

describe("isPathWithinOrEqual", () => {
  it("is true for the same path", () => {
    expect(isPathWithinOrEqual(["tips", "bash"], ["tips", "bash"])).toBe(true);
  });

  it("is true for a descendant path", () => {
    expect(isPathWithinOrEqual(["tips"], ["tips", "bash", "fc"])).toBe(true);
  });

  it("is true for the root as ancestor of any path", () => {
    expect(isPathWithinOrEqual([], ["tips"])).toBe(true);
    expect(isPathWithinOrEqual([], [])).toBe(true);
  });

  it("is false for a sibling or unrelated path", () => {
    expect(isPathWithinOrEqual(["tips"], ["with-rating"])).toBe(false);
    expect(isPathWithinOrEqual(["tips", "bash"], ["tips"])).toBe(false);
  });

  it("is false when a shared prefix diverges", () => {
    expect(isPathWithinOrEqual(["tips", "bash"], ["tips", "zsh", "fc"])).toBe(
      false,
    );
  });
});

describe("adjustPathAfterRemoval", () => {
  it("shifts a later sibling index down by one", () => {
    expect(adjustPathAfterRemoval(["items", 1], ["items", 3])).toEqual([
      "items",
      2,
    ]);
  });

  it("shifts a descendant of a later sibling", () => {
    expect(
      adjustPathAfterRemoval(["items", 1], ["items", 3, "child"]),
    ).toEqual(["items", 2, "child"]);
  });

  it("leaves an earlier sibling unchanged", () => {
    expect(adjustPathAfterRemoval(["items", 2], ["items", 0])).toEqual([
      "items",
      0,
    ]);
  });

  it("leaves an unrelated path unchanged", () => {
    expect(adjustPathAfterRemoval(["items", 1], ["tips", "bash"])).toEqual([
      "tips",
      "bash",
    ]);
  });

  it("leaves an object removal's siblings unchanged", () => {
    expect(adjustPathAfterRemoval(["tips", "bash"], ["tips", "zsh"])).toEqual([
      "tips",
      "zsh",
    ]);
  });

  it("leaves a path shorter than the removed parent unchanged", () => {
    expect(adjustPathAfterRemoval(["items", 1], ["items"])).toEqual(["items"]);
  });
});
