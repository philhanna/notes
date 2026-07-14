export type JsonScalar = string | number | boolean | null;

export type JsonArray = JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue = JsonScalar | JsonArray | JsonObject;

/**
 * A location within a document, as an array of object keys and array
 * indices. The root is the empty path. JSON Pointer strings are only used
 * at URL, repository metadata, and display boundaries (see path.ts).
 */
export type Path = ReadonlyArray<string | number>;

export type ValueKind =
  "object" | "array" | "string" | "number" | "boolean" | "null";

export function isJsonObject(
  value: JsonValue | undefined,
): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonArray(value: JsonValue | undefined): value is JsonArray {
  return Array.isArray(value);
}

export function isJsonScalar(
  value: JsonValue | undefined,
): value is JsonScalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function isContainer(
  value: JsonValue | undefined,
): value is JsonObject | JsonArray {
  return isJsonObject(value) || isJsonArray(value);
}

export function kindOf(value: JsonValue): ValueKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  if (type === "object") return "object";
  return type as "string" | "number" | "boolean";
}

/**
 * True when replacing `previous` with `next` crosses a scalar/container or
 * object/array boundary and therefore requires explicit confirmation
 * (design.md 6.2, 7.1). Scalar-to-scalar edits (for example string to
 * number) never require confirmation — that is ordinary value-input
 * inference, not a structural replacement.
 */
export function requiresReplacementConfirmation(
  previous: JsonValue,
  next: JsonValue,
): boolean {
  const previousIsContainer = isContainer(previous);
  const nextIsContainer = isContainer(next);
  if (previousIsContainer !== nextIsContainer) return true;
  if (previousIsContainer && nextIsContainer) {
    return kindOf(previous) !== kindOf(next);
  }
  return false;
}
