import type { JsonValue } from "../domain/types.ts";
import { isJsonArray, isJsonObject } from "../domain/types.ts";

/** A short label for a container child, e.g. "array (3)" or "object (2)". */
export function describeContainer(value: JsonValue): string {
  if (isJsonArray(value)) return `array (${value.length})`;
  if (isJsonObject(value)) return `object (${Object.keys(value).length})`;
  return "";
}
