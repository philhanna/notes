import type { JsonArray, JsonObject, JsonValue, Path } from "./types.ts";
import {
  isJsonArray,
  isJsonObject,
  requiresReplacementConfirmation,
} from "./types.ts";
import type { Result } from "./result.ts";
import { err, ok } from "./result.ts";
import { findExistingKey, keysEqualIgnoreCase } from "./keys.ts";

export type TreeError =
  | { kind: "not-found"; path: Path }
  | { kind: "not-object"; path: Path }
  | { kind: "not-array"; path: Path }
  | { kind: "not-container"; path: Path }
  | { kind: "empty-key" }
  | { kind: "duplicate-key"; key: string }
  | { kind: "index-out-of-range"; index: number }
  | { kind: "confirmation-required" };

export type ChildEntry =
  | { kind: "object-entry"; key: string; value: JsonValue; path: Path }
  | { kind: "array-element"; index: number; value: JsonValue; path: Path };

/** Reads the value at `path`, or `undefined` if no such location exists. */
export function getAtPath(
  document: JsonValue,
  path: Path,
): JsonValue | undefined {
  let current: JsonValue | undefined = document;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!isJsonArray(current)) return undefined;
      current = current[segment];
    } else {
      if (!isJsonObject(current)) return undefined;
      current = Object.hasOwn(current, segment) ? current[segment] : undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
}

/** Lists the immediate children of the object or array at `path`. */
export function listChildren(
  document: JsonValue,
  path: Path,
): Result<ChildEntry[], TreeError> {
  const value = getAtPath(document, path);
  if (value === undefined) return err({ kind: "not-found", path });
  if (isJsonObject(value)) {
    return ok(
      Object.entries(value).map(([key, entryValue]) => ({
        kind: "object-entry" as const,
        key,
        value: entryValue,
        path: [...path, key],
      })),
    );
  }
  if (isJsonArray(value)) {
    return ok(
      value.map((entryValue, index) => ({
        kind: "array-element" as const,
        index,
        value: entryValue,
        path: [...path, index],
      })),
    );
  }
  return err({ kind: "not-container", path });
}

function requireObject(
  document: JsonValue,
  path: Path,
): Result<JsonObject, TreeError> {
  const value = getAtPath(document, path);
  if (value === undefined) return err({ kind: "not-found", path });
  if (!isJsonObject(value)) return err({ kind: "not-object", path });
  return ok(value);
}

function requireArray(
  document: JsonValue,
  path: Path,
): Result<JsonArray, TreeError> {
  const value = getAtPath(document, path);
  if (value === undefined) return err({ kind: "not-found", path });
  if (!isJsonArray(value)) return err({ kind: "not-array", path });
  return ok(value);
}

/**
 * Immutably replaces the value at `path`, cloning every container it
 * passes through so unrelated branches of the document keep their
 * original object/array identity. `path` must resolve within `current`;
 * callers first validate that with getAtPath/requireObject/requireArray.
 */
function replaceAt(
  current: JsonValue,
  path: Path,
  depth: number,
  newValue: JsonValue,
): JsonValue {
  if (depth === path.length) return newValue;
  const segment = path[depth]!;
  if (typeof segment === "number") {
    if (!isJsonArray(current)) throw new Error("replaceAt: expected array");
    const copy = current.slice();
    const child = copy[segment];
    if (child === undefined) throw new Error("replaceAt: index out of range");
    copy[segment] = replaceAt(child, path, depth + 1, newValue);
    return copy;
  }
  if (!isJsonObject(current)) throw new Error("replaceAt: expected object");
  const copy = { ...current };
  const child = copy[segment];
  if (child === undefined) throw new Error("replaceAt: missing key");
  copy[segment] = replaceAt(child, path, depth + 1, newValue);
  return copy;
}

/** Adds a new named entry to the object at `parentPath` (design.md 7.1). */
export function createObjectEntry(
  document: JsonObject,
  parentPath: Path,
  key: string,
  value: JsonValue,
): Result<JsonObject, TreeError> {
  const parentResult = requireObject(document, parentPath);
  if (!parentResult.ok) return parentResult;
  const parent = parentResult.value;

  if (key === "") return err({ kind: "empty-key" });
  const existing = findExistingKey(parent, key);
  if (existing !== undefined)
    return err({ kind: "duplicate-key", key: existing });

  const newParent: JsonObject = { ...parent, [key]: value };
  return ok(replaceAt(document, parentPath, 0, newParent) as JsonObject);
}

/** Appends a new element to the array at `parentPath` (design.md 5.3). */
export function createArrayElement(
  document: JsonObject,
  parentPath: Path,
  value: JsonValue,
): Result<JsonObject, TreeError> {
  const parentResult = requireArray(document, parentPath);
  if (!parentResult.ok) return parentResult;

  const newParent = [...parentResult.value, value];
  return ok(replaceAt(document, parentPath, 0, newParent) as JsonObject);
}

/**
 * Renames an object entry's key, case-preserving, allowing a case-only
 * rename of the same entry but rejecting a collision with any other key
 * (design.md 5.2).
 */
export function renameKey(
  document: JsonObject,
  parentPath: Path,
  oldKey: string,
  newKey: string,
): Result<JsonObject, TreeError> {
  const parentResult = requireObject(document, parentPath);
  if (!parentResult.ok) return parentResult;
  const parent = parentResult.value;

  if (!Object.hasOwn(parent, oldKey)) {
    return err({ kind: "not-found", path: [...parentPath, oldKey] });
  }
  if (newKey === "") return err({ kind: "empty-key" });

  if (!keysEqualIgnoreCase(oldKey, newKey)) {
    const existing = findExistingKey(parent, newKey);
    if (existing !== undefined)
      return err({ kind: "duplicate-key", key: existing });
  }

  const newParent: JsonObject = {};
  for (const [key, entryValue] of Object.entries(parent)) {
    newParent[key === oldKey ? newKey : key] = entryValue;
  }
  return ok(replaceAt(document, parentPath, 0, newParent) as JsonObject);
}

/**
 * Replaces the value already present at `path`. Crossing a scalar/container
 * or object/array boundary requires `confirmReplace: true` (design.md 6.2,
 * 7.1); otherwise the call fails with `confirmation-required` and leaves
 * the document unchanged so the caller can ask the user to confirm.
 */
export function setValueAtPath(
  document: JsonObject,
  path: Path,
  newValue: JsonValue,
  confirmReplace = false,
): Result<JsonObject, TreeError> {
  const existing = getAtPath(document, path);
  if (existing === undefined) return err({ kind: "not-found", path });

  if (path.length === 0 && !isJsonObject(newValue)) {
    return err({ kind: "not-object", path });
  }
  if (requiresReplacementConfirmation(existing, newValue) && !confirmReplace) {
    return err({ kind: "confirmation-required" });
  }

  return ok(replaceAt(document, path, 0, newValue) as JsonObject);
}

/** Moves the array element at `fromIndex` to `toIndex` (design.md 5.3). */
export function reorderArrayElement(
  document: JsonObject,
  parentPath: Path,
  fromIndex: number,
  toIndex: number,
): Result<JsonObject, TreeError> {
  const parentResult = requireArray(document, parentPath);
  if (!parentResult.ok) return parentResult;
  const parent = parentResult.value;

  if (fromIndex < 0 || fromIndex >= parent.length) {
    return err({ kind: "index-out-of-range", index: fromIndex });
  }
  if (toIndex < 0 || toIndex >= parent.length) {
    return err({ kind: "index-out-of-range", index: toIndex });
  }

  const newParent = parent.slice();
  const moved = newParent.splice(fromIndex, 1)[0]!;
  newParent.splice(toIndex, 0, moved);
  return ok(replaceAt(document, parentPath, 0, newParent) as JsonObject);
}
