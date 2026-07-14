import { describe, expect, it } from "vitest";
import {
  decodePointerSegments,
  encodePointer,
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
