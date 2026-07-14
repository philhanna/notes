import type { JsonArray, JsonObject, JsonValue, Path } from "./types.ts";
import { isContainer, isJsonArray, isJsonObject } from "./types.ts";
import type { Result } from "./result.ts";
import { err, ok } from "./result.ts";

export type ParseError =
  | { kind: "syntax"; message: string }
  | { kind: "invalid-root" }
  | { kind: "empty-key"; path: Path }
  | { kind: "duplicate-key"; path: Path; key: string };

/**
 * Deterministic serialization (design.md 5.4): stable two-space indentation
 * and a trailing newline, so commits contain meaningful content changes
 * instead of incidental whitespace churn. Object key spelling and array
 * order are whatever the document already holds.
 */
export function serializeDocument(document: JsonObject): string {
  return JSON.stringify(document, null, 2) + "\n";
}

/** Parses and validates document text, per validateDocument. */
export function parseDocument(text: string): Result<JsonObject, ParseError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return err({
      kind: "syntax",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  return validateDocument(parsed as JsonValue);
}

/**
 * Validates domain invariants that plain JSON parsing does not enforce: the
 * root must be an object, and every object's keys must be non-empty and
 * unique case-insensitively (design.md 5.1, 5.2).
 */
export function validateDocument(
  value: JsonValue,
): Result<JsonObject, ParseError> {
  if (!isJsonObject(value)) return err({ kind: "invalid-root" });
  const error = validateContainer(value, []);
  if (error) return err(error);
  return ok(value);
}

function validateContainer(
  container: JsonObject | JsonArray,
  path: Path,
): ParseError | undefined {
  if (isJsonArray(container)) {
    for (let index = 0; index < container.length; index++) {
      const child = container[index];
      if (child !== undefined && isContainer(child)) {
        const error = validateContainer(child, [...path, index]);
        if (error) return error;
      }
    }
    return undefined;
  }

  const seenLowerKeys = new Set<string>();
  for (const key of Object.keys(container)) {
    if (key === "") return { kind: "empty-key", path };
    const lowerKey = key.toLowerCase();
    if (seenLowerKeys.has(lowerKey))
      return { kind: "duplicate-key", path, key };
    seenLowerKeys.add(lowerKey);

    const child = container[key];
    if (child !== undefined && isContainer(child)) {
      const error = validateContainer(child, [...path, key]);
      if (error) return error;
    }
  }
  return undefined;
}
