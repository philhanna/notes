import type { JsonObject } from "./types.ts";

/** Object keys compare case-insensitively; spelling is otherwise preserved. */
export function keysEqualIgnoreCase(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Returns the actual spelling of a key in `object` that matches `key`
 * case-insensitively, or `undefined` if no entry matches.
 */
export function findExistingKey(
  object: JsonObject,
  key: string,
): string | undefined {
  return Object.keys(object).find((existing) =>
    keysEqualIgnoreCase(existing, key),
  );
}
