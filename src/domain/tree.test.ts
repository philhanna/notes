import { describe, expect, it } from "vitest";
import {
  createArrayElement,
  createObjectEntry,
  getAtPath,
  listChildren,
  renameKey,
  reorderArrayElement,
  setValueAtPath,
} from "./tree.ts";
import type { JsonObject } from "./types.ts";

function sample(): JsonObject {
  return {
    hardinfo: "The ultimate system information viewer",
    tips: {
      bash: {
        fc: "Puts recent history in editor",
      },
    },
    "with-rating": ["#! /bin/bash", "pytest -v"],
  };
}

describe("getAtPath", () => {
  it("resolves nested object and array segments", () => {
    expect(getAtPath(sample(), ["tips", "bash", "fc"])).toBe(
      "Puts recent history in editor",
    );
    expect(getAtPath(sample(), ["with-rating", 1])).toBe("pytest -v");
  });

  it("returns undefined for a missing path", () => {
    expect(getAtPath(sample(), ["nope"])).toBeUndefined();
    expect(getAtPath(sample(), ["with-rating", 9])).toBeUndefined();
  });
});

describe("listChildren", () => {
  it("lists object entries in order", () => {
    const result = listChildren(sample(), []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        result.value.map((entry) => entry.kind === "object-entry" && entry.key),
      ).toEqual(["hardinfo", "tips", "with-rating"]);
    }
  });

  it("lists array elements by index", () => {
    const result = listChildren(sample(), ["with-rating"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        {
          kind: "array-element",
          index: 0,
          value: "#! /bin/bash",
          path: ["with-rating", 0],
        },
        {
          kind: "array-element",
          index: 1,
          value: "pytest -v",
          path: ["with-rating", 1],
        },
      ]);
    }
  });

  it("fails without mutating on a scalar path", () => {
    const doc = sample();
    const result = listChildren(doc, ["hardinfo"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not-container");
    expect(doc).toEqual(sample());
  });
});

describe("createObjectEntry", () => {
  it("adds a new scalar entry", () => {
    const doc = sample();
    const result = createObjectEntry(doc, [], "new-key", "new value");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(getAtPath(result.value, ["new-key"])).toBe("new value");
      expect(getAtPath(doc, ["new-key"])).toBeUndefined();
    }
  });

  it("adds a new nested object entry", () => {
    const doc = sample();
    const result = createObjectEntry(doc, ["tips"], "python", {
      functions: "top level",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(getAtPath(result.value, ["tips", "python", "functions"])).toBe(
        "top level",
      );
      expect(getAtPath(result.value, ["tips", "bash", "fc"])).toBe(
        "Puts recent history in editor",
      );
    }
  });

  it("rejects an empty key without mutating", () => {
    const doc = sample();
    const result = createObjectEntry(doc, [], "", "value");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("empty-key");
    expect(doc).toEqual(sample());
  });

  it("rejects a duplicate key differing only by case, without mutating", () => {
    const doc = sample();
    const result = createObjectEntry(doc, [], "HARDINFO", "dup");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ kind: "duplicate-key", key: "hardinfo" });
    }
    expect(doc).toEqual(sample());
  });

  it("fails on an invalid destination that is not an object, without mutating", () => {
    const doc = sample();
    const result = createObjectEntry(doc, ["with-rating"], "key", "value");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not-object");
    expect(doc).toEqual(sample());
  });

  it("fails on a nonexistent destination, without mutating", () => {
    const doc = sample();
    const result = createObjectEntry(doc, ["missing", "path"], "key", "value");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not-found");
    expect(doc).toEqual(sample());
  });
});

describe("createArrayElement", () => {
  it("appends to the end of an array", () => {
    const doc = sample();
    const result = createArrayElement(doc, ["with-rating"], "echo done");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(getAtPath(result.value, ["with-rating"])).toEqual([
        "#! /bin/bash",
        "pytest -v",
        "echo done",
      ]);
    }
    expect(doc).toEqual(sample());
  });

  it("fails when the destination is not an array, without mutating", () => {
    const doc = sample();
    const result = createArrayElement(doc, ["tips"], "value");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not-array");
    expect(doc).toEqual(sample());
  });
});

describe("renameKey", () => {
  it("renames a key, preserving position and value", () => {
    const doc = sample();
    const result = renameKey(doc, [], "hardinfo", "sysinfo");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value)).toEqual([
        "sysinfo",
        "tips",
        "with-rating",
      ]);
      expect(result.value["sysinfo"]).toBe(
        "The ultimate system information viewer",
      );
    }
  });

  it("allows a case-only rename", () => {
    const doc = sample();
    const result = renameKey(doc, [], "hardinfo", "HardInfo");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value)).toContain("HardInfo");
    }
  });

  it("rejects renaming onto an existing key, without mutating", () => {
    const doc = sample();
    const result = renameKey(doc, [], "hardinfo", "tips");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("duplicate-key");
    expect(doc).toEqual(sample());
  });

  it("rejects renaming a nonexistent key, without mutating", () => {
    const doc = sample();
    const result = renameKey(doc, [], "nope", "whatever");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not-found");
    expect(doc).toEqual(sample());
  });
});

describe("setValueAtPath", () => {
  it("updates a scalar in place", () => {
    const doc = sample();
    const result = setValueAtPath(doc, ["hardinfo"], "updated");
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(getAtPath(result.value, ["hardinfo"])).toBe("updated");
    expect(doc).toEqual(sample());
  });

  it("requires confirmation to replace a scalar with a container", () => {
    const doc = sample();
    const result = setValueAtPath(doc, ["hardinfo"], { nested: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("confirmation-required");
    expect(doc).toEqual(sample());
  });

  it("succeeds replacing a scalar with a container once confirmed", () => {
    const doc = sample();
    const result = setValueAtPath(doc, ["hardinfo"], { nested: true }, true);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(getAtPath(result.value, ["hardinfo", "nested"])).toBe(true);
  });

  it("requires confirmation to change an object into an array", () => {
    const doc = sample();
    const result = setValueAtPath(doc, ["tips"], [1, 2]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("confirmation-required");
    expect(doc).toEqual(sample());
  });

  it("does not require confirmation for same-kind replacement", () => {
    const doc = sample();
    const result = setValueAtPath(doc, ["with-rating"], ["only one line"]);
    expect(result.ok).toBe(true);
  });

  it("does not require confirmation for a scalar type change", () => {
    const doc = sample();
    const result = setValueAtPath(doc, ["hardinfo"], 123);
    expect(result.ok).toBe(true);
    if (result.ok) expect(getAtPath(result.value, ["hardinfo"])).toBe(123);
  });

  it("fails on a nonexistent path, without mutating", () => {
    const doc = sample();
    const result = setValueAtPath(doc, ["nope"], "value");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not-found");
    expect(doc).toEqual(sample());
  });
});

describe("reorderArrayElement", () => {
  it("moves an element to a later position", () => {
    const doc = sample();
    const result = reorderArrayElement(doc, ["with-rating"], 0, 1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(getAtPath(result.value, ["with-rating"])).toEqual([
        "pytest -v",
        "#! /bin/bash",
      ]);
    }
    expect(doc).toEqual(sample());
  });

  it("fails on an out-of-range index, without mutating", () => {
    const doc = sample();
    const result = reorderArrayElement(doc, ["with-rating"], 0, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("index-out-of-range");
    expect(doc).toEqual(sample());
  });
});
