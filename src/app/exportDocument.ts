import { serializeDocument } from "../domain/serialize.ts";
import type { JsonObject } from "../domain/types.ts";

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

function isoDateStamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace(/[:T]/g, "-");
}
