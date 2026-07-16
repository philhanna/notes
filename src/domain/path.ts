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
 * Walks `doc` following raw (unescaped) JSON Pointer segments, producing the
 * typed Path (array indices as numbers, object keys as strings) found along
 * the way, or `undefined` if the segments do not resolve to an existing
 * location in `doc`. Used by resolvePointer (whole-pointer resolution).
 */
export function resolvePointerSegments(
  doc: JsonValue,
  segments: readonly string[],
): Path | undefined {
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
  return resolvePointerSegments(doc, decodePointerSegments(pointer));
}

/**
 * True when `candidate` is `ancestor` itself or lies within its subtree.
 * Drives cycle prevention for `move` (design.md 7.2: "A container cannot be
 * moved into itself or one of its descendants").
 */
export function isPathWithinOrEqual(ancestor: Path, candidate: Path): boolean {
  if (candidate.length < ancestor.length) return false;
  return ancestor.every((segment, index) => candidate[index] === segment);
}

/**
 * Adjusts `path` for having just removed the array element at
 * `removedPath`. Only a segment inside the same parent array, at an index
 * greater than the removed one, shifts down by one; everything else
 * (object removals, unrelated paths, deeper segments under a shifted
 * index) keeps its own segments unchanged apart from that one entry.
 */
export function adjustPathAfterRemoval(removedPath: Path, path: Path): Path {
  const parentLength = removedPath.length - 1;
  if (parentLength < 0) return path;
  if (path.length <= parentLength) return path;
  const removedIndex = removedPath[parentLength];
  if (typeof removedIndex !== "number") return path;
  for (let i = 0; i < parentLength; i++) {
    if (path[i] !== removedPath[i]) return path;
  }
  const segment = path[parentLength];
  if (typeof segment !== "number" || segment <= removedIndex) return path;
  const adjusted = path.slice();
  adjusted[parentLength] = segment - 1;
  return adjusted;
}
