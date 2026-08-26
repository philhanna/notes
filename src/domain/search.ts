import type { JsonObject, JsonValue, Path } from "./types.ts";
import { isJsonArray, isJsonObject, isJsonScalar } from "./types.ts";
import { encodePointer } from "./path.ts";

/**
 * One searchable node of the tree (design.md 11): an object entry or array
 * element, with lowercase text for its key (if any), its scalar value (if
 * any), and its full breadcrumb, so `search` never re-walks the document or
 * re-lowercases anything per query.
 */
export interface SearchEntry {
  path: Path;
  keyText: string | null;
  valueText: string | null;
  breadcrumbText: string;
}

export type SearchIndex = SearchEntry[];

export interface SearchResult {
  path: Path;
  /** The containing object or array — where a result navigates to (design.md 11). */
  containerPath: Path;
  breadcrumb: string;
  label: string;
  matchedIn: "key" | "value" | "breadcrumb";
}

/** A friendly, case-preserving breadcrumb string rooted at the tree's "Notes" label. */
export function breadcrumbFor(path: Path): string {
  return ["Notes", ...path.map(String)].join(" › ");
}

/** A path's final segment, formatted the way a tree row displays it. */
export function labelFor(path: Path): string {
  const last = path[path.length - 1];
  return typeof last === "number" ? `[${last}]` : String(last);
}

function scalarText(value: JsonValue): string {
  if (value === null) return "null";
  return String(value);
}

/**
 * Walks the whole document once, building the flat index `search` scans
 * (design.md 11: "the PWA walks the tree and builds an in-memory index").
 * Only object keys and scalar values are indexed as distinct fields — a
 * container's own breadcrumb is still indexed so a path-only query still
 * finds it, per the value-column being `null` for containers.
 */
export function buildSearchIndex(document: JsonObject): SearchIndex {
  const entries: SearchIndex = [];

  function visit(value: JsonValue, path: Path): void {
    if (isJsonObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        const childPath = [...path, key];
        entries.push({
          path: childPath,
          keyText: key.toLowerCase(),
          valueText: isJsonScalar(child)
            ? scalarText(child).toLowerCase()
            : null,
          breadcrumbText: breadcrumbFor(childPath).toLowerCase(),
        });
        visit(child, childPath);
      }
      return;
    }
    if (isJsonArray(value)) {
      value.forEach((child, index) => {
        const childPath = [...path, index];
        entries.push({
          path: childPath,
          keyText: null,
          valueText: isJsonScalar(child)
            ? scalarText(child).toLowerCase()
            : null,
          breadcrumbText: breadcrumbFor(childPath).toLowerCase(),
        });
        visit(child, childPath);
      });
    }
  }

  visit(document, []);
  return entries;
}

/**
 * Case-insensitive substring match against key, scalar value, or breadcrumb
 * text (design.md 11: "A result matches when its key, scalar value, or
 * breadcrumb path contains the query"). No phrase, prefix, or field-scoped
 * query syntax — one plain-text box, by design. A blank query matches
 * nothing rather than the whole document.
 */
export function search(index: SearchIndex, query: string): SearchResult[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];

  const results: SearchResult[] = [];
  for (const entry of index) {
    const matchedIn = entry.keyText?.includes(needle)
      ? "key"
      : entry.valueText?.includes(needle)
        ? "value"
        : entry.breadcrumbText.includes(needle)
          ? "breadcrumb"
          : null;
    if (matchedIn === null) continue;

    results.push({
      path: entry.path,
      containerPath: entry.path.slice(0, -1),
      breadcrumb: breadcrumbFor(entry.path),
      label: labelFor(entry.path),
      matchedIn,
    });
  }
  return results;
}

/** For diagnostics/tests: renders a result's path as a JSON Pointer. */
export function resultPointer(result: SearchResult): string {
  return encodePointer(result.path);
}
