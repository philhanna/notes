import type { DocumentExport } from "./exportDocument.ts";

/** Triggers a browser download of a previously built export (design.md 10, 12): no network request, so the content never leaves the device except via this save dialog. */
export function downloadExport({ filename, content, mimeType }: DocumentExport) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
