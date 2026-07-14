import type { JsonValue, Path } from "./types.ts";
import { isJsonArray, isJsonObject } from "./types.ts";

/**
 * Encodes a typed Path (object keys and array indices) as a JSON Pointer
 * string (RFC 6901), escaping `~` as `~0` and `/` as `~1`. The root path
 * (`[]`) encodes as the empty string.
 */
export function encodePointer(path: Path): string {
  if (path.length === 0) return "";
  return path.map((segment) => "/" + escapeSegment(String(segment))).join("");
}

function escapeSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function unescapeSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

/**
 * Splits a JSON Pointer string into its raw, unescaped text segments,
 * without resolving whether each segment is an object key or an array
 * index (that requires walking a document; see resolvePointer).
 */
export function decodePointerSegments(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) {
    throw new Error(`invalid JSON pointer: ${pointer}`);
  }
  return pointer.slice(1).split("/").map(unescapeSegment);
}

const ARRAY_INDEX = /^(0|[1-9]\d*)$/;

/**
 * Walks `doc` following a JSON Pointer string, producing the typed Path
 * (array indices as numbers, object keys as strings) that resolvePointer
 * found along the way, or `undefined` if the pointer does not resolve to
 * an existing location in `doc`.
 */
export function resolvePointer(
  doc: JsonValue,
  pointer: string,
): Path | undefined {
  const segments = decodePointerSegments(pointer);
  const path: (string | number)[] = [];
  let current: JsonValue = doc;
  for (const raw of segments) {
    if (isJsonArray(current)) {
      if (!ARRAY_INDEX.test(raw)) return undefined;
      const index = Number(raw);
      const next = current[index];
      if (next === undefined) return undefined;
      path.push(index);
      current = next;
    } else if (isJsonObject(current)) {
      if (!Object.hasOwn(current, raw)) return undefined;
      const next = current[raw];
      if (next === undefined) return undefined;
      path.push(raw);
      current = next;
    } else {
      return undefined;
    }
  }
  return path;
}
