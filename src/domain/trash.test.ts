import { describe, expect, it } from "vitest";
import {
  EMPTY_TRASH,
  TRASH_SCHEMA_VERSION,
  deleteToTrash,
  emptyTrash,
  parseTrash,
  permanentlyDelete,
  recoverFromTrash,
  serializeTrash,
  validateTrash,
} from "./trash.ts";
import type { TrashDocument } from "./trash.ts";
import { getAtPath } from "./tree.ts";
import type { JsonObject, Path } from "./types.ts";

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

const RECORD_INPUT = { id: "trash-1", deletedAt: "2026-07-14T00:00:00.000Z" };

function deletedState(path: Path) {
  const result = deleteToTrash(sample(), EMPTY_TRASH, path, RECORD_INPUT);
  if (!result.ok) throw new Error("setup: expected delete to succeed");
  return result.value;
}

describe("deleteToTrash", () => {
  it("removes a scalar entry and records it in trash", () => {
    const doc = sample();
    const result = deleteToTrash(doc, EMPTY_TRASH, ["hardinfo"], RECORD_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(getAtPath(result.value.document, ["hardinfo"])).toBeUndefined();
      expect(result.value.trash.records).toEqual([
        {
          id: "trash-1",
          deletedAt: "2026-07-14T00:00:00.000Z",
          originalPath: "/hardinfo",
          type: "string",
          value: "The ultimate system information viewer",
        },
      ]);
    }
    expect(doc).toEqual(sample());
  });

  it("captures a container's complete descendant content", () => {
    const result = deleteToTrash(sample(), EMPTY_TRASH, ["tips"], RECORD_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.trash.records[0]?.value).toEqual({
        bash: { fc: "Puts recent history in editor" },
      });
      expect(result.value.trash.records[0]?.type).toBe("object");
    }
  });

  it("appends to existing trash records rather than replacing them", () => {
    const existing: TrashDocument = {
      version: TRASH_SCHEMA_VERSION,
      records: [
        {
          id: "earlier",
          deletedAt: "2026-01-01T00:00:00.000Z",
          originalPath: "/gone",
          type: "null",
          value: null,
        },
      ],
    };
    const result = deleteToTrash(sample(), existing, ["hardinfo"], RECORD_INPUT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.trash.records.map((record) => record.id)).toEqual([
        "earlier",
        "trash-1",
      ]);
    }
  });

  it("rejects deleting the document root, without mutating", () => {
    const doc = sample();
    const result = deleteToTrash(doc, EMPTY_TRASH, [], RECORD_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("cannot-delete-root");
    expect(doc).toEqual(sample());
  });

  it("fails on a nonexistent path, without mutating", () => {
    const doc = sample();
    const result = deleteToTrash(doc, EMPTY_TRASH, ["nope"], RECORD_INPUT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not-found");
    expect(doc).toEqual(sample());
  });
});

describe("recoverFromTrash", () => {
  it("restores a scalar to its original path when free", () => {
    const { document, trash } = deletedState(["hardinfo"]);
    const result = recoverFromTrash(document, trash, "trash-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(getAtPath(result.value.document, ["hardinfo"])).toBe(
        "The ultimate system information viewer",
      );
      expect(result.value.trash.records).toEqual([]);
    }
  });

  it("restores an array element at its original position", () => {
    const { document, trash } = deletedState(["with-rating", 0]);
    const result = recoverFromTrash(document, trash, "trash-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(getAtPath(result.value.document, ["with-rating"])).toEqual([
        "#! /bin/bash",
        "pytest -v",
      ]);
    }
  });

  it("requires a destination when the original key is occupied, without mutating", () => {
    const { document, trash } = deletedState(["hardinfo"]);
    const occupied: JsonObject = { ...document, hardinfo: "someone else's" };
    const result = recoverFromTrash(occupied, trash, "trash-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("destination-required");
    expect(occupied.hardinfo).toBe("someone else's");
    expect(trash.records).toHaveLength(1);
  });

  it("requires a destination when an ancestor of the original path is gone, without mutating", () => {
    const { document, trash } = deletedState(["tips", "bash", "fc"]);
    const strippedAncestor: JsonObject = { ...document, tips: {} };
    const result = recoverFromTrash(strippedAncestor, trash, "trash-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("destination-required");
    expect(trash.records).toHaveLength(1);
  });

  it("restores to an explicit destination", () => {
    const { document, trash } = deletedState(["hardinfo"]);
    const result = recoverFromTrash(document, trash, "trash-1", {
      parentPath: ["tips"],
      key: "restored",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(getAtPath(result.value.document, ["tips", "restored"])).toBe(
        "The ultimate system information viewer",
      );
      expect(result.value.trash.records).toEqual([]);
    }
  });

  it("rejects an explicit destination that collides, without mutating", () => {
    const { document, trash } = deletedState(["hardinfo"]);
    const result = recoverFromTrash(document, trash, "trash-1", {
      parentPath: [],
      key: "tips",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("duplicate-key");
    expect(trash.records).toHaveLength(1);
  });

  it("fails for an unknown trash id", () => {
    const result = recoverFromTrash(sample(), EMPTY_TRASH, "nope");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        kind: "trash-record-not-found",
        id: "nope",
      });
    }
  });
});

describe("permanentlyDelete", () => {
  it("removes the record by id", () => {
    const { trash } = deletedState(["hardinfo"]);
    const result = permanentlyDelete(trash, "trash-1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.records).toEqual([]);
    expect(trash.records).toHaveLength(1);
  });

  it("fails for an unknown trash id", () => {
    const result = permanentlyDelete(EMPTY_TRASH, "nope");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        kind: "trash-record-not-found",
        id: "nope",
      });
    }
  });
});

describe("emptyTrash", () => {
  it("clears all records", () => {
    const { trash } = deletedState(["hardinfo"]);
    expect(emptyTrash(trash)).toEqual({
      version: TRASH_SCHEMA_VERSION,
      records: [],
    });
    expect(trash.records).toHaveLength(1);
  });

  it("is a no-op on already-empty trash", () => {
    expect(emptyTrash(EMPTY_TRASH)).toEqual(EMPTY_TRASH);
  });
});

describe("serializeTrash / parseTrash / validateTrash", () => {
  it("round-trips through serialize and parse", () => {
    const { trash } = deletedState(["hardinfo"]);
    const parsed = parseTrash(serializeTrash(trash));
    expect(parsed).toEqual({ ok: true, value: trash });
  });

  it("rejects invalid JSON syntax", () => {
    const result = parseTrash("not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("syntax");
  });

  it("rejects a non-object root", () => {
    expect(validateTrash([])).toEqual({ ok: false, error: { kind: "invalid-root" } });
    expect(validateTrash("nope")).toEqual({
      ok: false,
      error: { kind: "invalid-root" },
    });
  });

  it("rejects an unsupported schema version", () => {
    const result = validateTrash({ version: 2, records: [] });
    expect(result).toEqual({ ok: false, error: { kind: "unsupported-version" } });
  });

  it("rejects a non-array records field", () => {
    const result = validateTrash({ version: TRASH_SCHEMA_VERSION, records: {} });
    expect(result).toEqual({ ok: false, error: { kind: "invalid-root" } });
  });

  it("rejects a record missing a required field", () => {
    const result = validateTrash({
      version: TRASH_SCHEMA_VERSION,
      records: [{ id: "1", deletedAt: "now", originalPath: "/x", type: "string" }],
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid-record", index: 0 },
    });
  });

  it("rejects a record with an invalid type field", () => {
    const result = validateTrash({
      version: TRASH_SCHEMA_VERSION,
      records: [
        {
          id: "1",
          deletedAt: "now",
          originalPath: "/x",
          type: "not-a-kind",
          value: 1,
        },
      ],
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid-record", index: 0 },
    });
  });
});
