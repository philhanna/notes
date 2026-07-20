import { serializeDocument, serializeValue } from "../domain/serialize.ts";
import type { JsonObject, JsonValue } from "../domain/types.ts";

export interface DocumentExport {
  filename: string;
  content: string;
  mimeType: string;
}

/**
 * Active-tree-only JSON export (design.md 10, 12): exactly the document's
 * current content, deterministically formatted. There is nothing else in
 * scope to accidentally include, since this only ever receives the document,
 * never credentials. `now` is injectable for
 * deterministic tests; the caller passes `new Date()` in real use.
 */
export function exportDocument(
  document: JsonObject,
  now: Date = new Date(),
): DocumentExport {
  return {
    filename: `notes-export-${isoDateStamp(now)}.json`,
    content: serializeDocument(document),
    mimeType: "application/json",
  };
}

/**
 * Same document-only guarantee as {@link exportDocument} (design.md 10, 12),
 * scoped to a single tree row: given only that node's own value and label,
 * so nothing outside the exported subtree can end up in the file.
 */
export function exportNode(
  value: JsonValue,
  label: string,
  now: Date = new Date(),
): DocumentExport {
  return {
    filename: `${slugify(label)}-${isoDateStamp(now)}.json`,
    content: serializeValue(value),
    mimeType: "application/json",
  };
}

function slugify(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "node" : slug;
}

function isoDateStamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace(/[:T]/g, "-");
}
