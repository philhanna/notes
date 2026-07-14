import type { JsonObject, JsonValue, Path, ValueKind } from "./types.ts";
import { isJsonArray, isJsonObject, kindOf } from "./types.ts";
import type { Result } from "./result.ts";
import { err, ok } from "./result.ts";
import { findExistingKey } from "./keys.ts";
import { decodePointerSegments, encodePointer, resolvePointerSegments } from "./path.ts";
import type { TreeError } from "./tree.ts";
import {
  createObjectEntry,
  getAtPath,
  insertArrayElementAt,
  insertAtDestination,
  removeEntry,
} from "./tree.ts";

export const TRASH_SCHEMA_VERSION = 1;

/**
 * A single deleted entry (design.md 7.3): a stable ID, UTC deletion time,
 * its original JSON Pointer path (a string — repository metadata, per
 * impl.md 2's "encode/decode JSON Pointer only at ... boundaries"), its
 * value's kind, and the complete deleted value (all descendants included,
 * for a container).
 */
export interface TrashRecord {
  id: string;
  deletedAt: string;
  originalPath: string;
  type: ValueKind;
  value: JsonValue;
}

export interface TrashDocument {
  version: typeof TRASH_SCHEMA_VERSION;
  records: TrashRecord[];
}

export const EMPTY_TRASH: TrashDocument = { version: TRASH_SCHEMA_VERSION, records: [] };

/**
 * Removes the entry at `path` from the active tree and appends one complete
 * trash record for it (design.md 7.3: "Deleting a container includes all
 * descendants in that one record"). `id`/`deletedAt` are supplied by the
 * caller so this stays pure and deterministic for tests; the app layer
 * generates them (crypto.randomUUID(), new Date().toISOString()).
 */
export function deleteToTrash(
  document: JsonObject,
  trash: TrashDocument,
  path: Path,
  record: { id: string; deletedAt: string },
): Result<{ document: JsonObject; trash: TrashDocument }, TreeError> {
  if (path.length === 0) return err({ kind: "cannot-delete-root" });
  const removed = removeEntry(document, path);
  if (!removed.ok) return removed;

  const newRecord: TrashRecord = {
    id: record.id,
    deletedAt: record.deletedAt,
    originalPath: encodePointer(path),
    type: kindOf(removed.value.value),
    value: removed.value.value,
  };
  return ok({
    document: removed.value.document,
    trash: { version: trash.version, records: [...trash.records, newRecord] },
  });
}

/**
 * Restores a trash record and removes it from trash, all-or-nothing
 * (design.md 7.3: "either restore the entire record and remove it from
 * trash or do neither"). Without an explicit `destination`, tries the
 * record's original path: if its parent no longer resolves, or (for an
 * object parent) the original key is now occupied, this fails with
 * `destination-required` rather than guessing a fallback — the caller
 * should then ask the user to choose one explicitly. An array parent has no
 * "occupied" concept, so it always succeeds, reinserting at the original
 * position. With an explicit `destination`, the value is placed exactly
 * like move/copy (object destinations require a key; array destinations
 * append), surfacing the ordinary duplicate-key/not-object/etc. errors for
 * the caller's own destination picker to show inline.
 */
export function recoverFromTrash(
  document: JsonObject,
  trash: TrashDocument,
  trashId: string,
  destination?: { parentPath: Path; key?: string },
): Result<{ document: JsonObject; trash: TrashDocument }, TreeError> {
  const record = trash.records.find((candidate) => candidate.id === trashId);
  if (record === undefined) {
    return err({ kind: "trash-record-not-found", id: trashId });
  }

  const inserted = destination
    ? insertAtDestination(
        document,
        destination.parentPath,
        record.value,
        destination.key,
      )
    : insertAtOriginalPath(document, record);
  if (!inserted.ok) return inserted;

  return ok({
    document: inserted.value,
    trash: {
      version: trash.version,
      records: trash.records.filter((candidate) => candidate.id !== trashId),
    },
  });
}

function insertAtOriginalPath(
  document: JsonObject,
  record: TrashRecord,
): Result<JsonObject, TreeError> {
  const segments = decodePointerSegments(record.originalPath);
  if (segments.length === 0) return err({ kind: "destination-required" });
  const parentSegments = segments.slice(0, -1);
  const leaf = segments[segments.length - 1]!;

  const parentPath = resolvePointerSegments(document, parentSegments);
  if (parentPath === undefined) return err({ kind: "destination-required" });

  const parent = getAtPath(document, parentPath);
  if (isJsonObject(parent)) {
    if (findExistingKey(parent, leaf) !== undefined) {
      return err({ kind: "destination-required" });
    }
    return createObjectEntry(document, parentPath, leaf, record.value);
  }
  if (isJsonArray(parent)) {
    return insertArrayElementAt(document, parentPath, Number(leaf), record.value);
  }
  return err({ kind: "destination-required" });
}

/** Removes a trash record permanently, without restoring it. */
export function permanentlyDelete(
  trash: TrashDocument,
  trashId: string,
): Result<TrashDocument, TreeError> {
  if (!trash.records.some((record) => record.id === trashId)) {
    return err({ kind: "trash-record-not-found", id: trashId });
  }
  return ok({
    version: trash.version,
    records: trash.records.filter((record) => record.id !== trashId),
  });
}

/**
 * Clears all trash records (design.md 7.3's Empty Trash). Never fails —
 * emptying already-empty trash is a harmless no-op — so unlike the other
 * trash operations this is not wrapped in a Result.
 */
export function emptyTrash(trash: TrashDocument): TrashDocument {
  return { version: trash.version, records: [] };
}

export type TrashParseError =
  | { kind: "syntax"; message: string }
  | { kind: "invalid-root" }
  | { kind: "unsupported-version" }
  | { kind: "invalid-record"; index: number };

/** Deterministic serialization, matching serialize.ts's discipline. */
export function serializeTrash(trash: TrashDocument): string {
  return JSON.stringify(trash, null, 2) + "\n";
}

export function parseTrash(text: string): Result<TrashDocument, TrashParseError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return err({
      kind: "syntax",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return validateTrash(parsed);
}

const VALUE_KINDS = new Set<ValueKind>([
  "object",
  "array",
  "string",
  "number",
  "boolean",
  "null",
]);

/**
 * Validates trash-file shape beyond plain JSON parsing: the root must have
 * the expected schema version and a records array, and every record must
 * have the required fields with the right primitive types. An unknown
 * version fails closed rather than being silently coerced, and a
 * structurally invalid record fails the whole file rather than being
 * dropped — this is what "malformed trash data fails safely without
 * damaging the active document" (impl.md Phase 3 exit criteria) means: the
 * failure is visible to the caller, not swallowed.
 */
export function validateTrash(
  value: unknown,
): Result<TrashDocument, TrashParseError> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("version" in value) ||
    !("records" in value)
  ) {
    return err({ kind: "invalid-root" });
  }
  const { version, records } = value as { version: unknown; records: unknown };
  if (version !== TRASH_SCHEMA_VERSION) return err({ kind: "unsupported-version" });
  if (!Array.isArray(records)) return err({ kind: "invalid-root" });

  for (let index = 0; index < records.length; index++) {
    if (!isValidRecord(records[index])) return err({ kind: "invalid-record", index });
  }
  return ok({ version: TRASH_SCHEMA_VERSION, records: records as TrashRecord[] });
}

function isValidRecord(value: unknown): value is TrashRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.deletedAt === "string" &&
    typeof record.originalPath === "string" &&
    typeof record.type === "string" &&
    VALUE_KINDS.has(record.type as ValueKind) &&
    "value" in record
  );
}
