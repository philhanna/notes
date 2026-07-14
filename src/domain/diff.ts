import type { JsonValue, Path } from "./types.ts";
import { isJsonArray, isJsonObject } from "./types.ts";
import { isPathWithinOrEqual } from "./path.ts";

/**
 * The minimal set of paths where `before` and `after` differ (Phase 4's
 * conflict detection, design.md 7.4: "compare the operation's affected
 * paths with changes since its base"). Object keys are compared
 * individually — a key added, removed, or changed is reported at its own
 * path — so edits to different keys of the same object are disjoint. Array
 * elements are compared index by index only when both arrays have the same
 * length; any length difference (append, delete, reorder producing a
 * different length is impossible, but insertion/removal is not) reports
 * the array's own path as changed rather than trying to align shifted
 * indices. This is a conservative, intentionally simple approximation —
 * safe in the direction of "ask the user to confirm" rather than silently
 * merging concurrent array edits.
 */
export function changedPaths(
  before: JsonValue,
  after: JsonValue,
  path: Path = [],
): Path[] {
  if (deepEqual(before, after)) return [];

  if (isJsonObject(before) && isJsonObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const result: Path[] = [];
    for (const key of keys) {
      const hasBefore = Object.hasOwn(before, key);
      const hasAfter = Object.hasOwn(after, key);
      if (!hasBefore || !hasAfter) {
        result.push([...path, key]);
        continue;
      }
      result.push(...changedPaths(before[key]!, after[key]!, [...path, key]));
    }
    return result;
  }

  if (
    isJsonArray(before) &&
    isJsonArray(after) &&
    before.length === after.length
  ) {
    const result: Path[] = [];
    for (let index = 0; index < before.length; index++) {
      result.push(
        ...changedPaths(before[index]!, after[index]!, [...path, index]),
      );
    }
    return result;
  }

  return [path];
}

/** True when `a` and `b` are the same path, or one is an ancestor of the other. */
export function pathsOverlap(a: Path, b: Path): boolean {
  return isPathWithinOrEqual(a, b) || isPathWithinOrEqual(b, a);
}

/** True when any path in `affected` overlaps any path in `changed`. */
export function anyPathOverlaps(affected: Path[], changed: Path[]): boolean {
  return affected.some((a) => changed.some((c) => pathsOverlap(a, c)));
}

function deepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (isJsonArray(a) && isJsonArray(b)) {
    return (
      a.length === b.length &&
      a.every((value, index) => deepEqual(value, b[index]!))
    );
  }
  if (isJsonObject(a) && isJsonObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key) => Object.hasOwn(b, key) && deepEqual(a[key]!, b[key]!),
    );
  }
  return false;
}
