import { exportDocument } from "../app/exportDocument.ts";
import type { JsonObject } from "../domain/types.ts";

interface ExportButtonProps {
  document: JsonObject;
}

/**
 * Downloads the active tree as JSON (design.md 10, 12): only ever given
 * `document`, so trash, history metadata, credentials, and repository
 * settings have no way to end up in the file. Export happens only when the
 * user clicks this — nothing here runs on a schedule.
 */
export function ExportButton({ document: activeDocument }: ExportButtonProps) {
  function handleExport() {
    const { filename, content, mimeType } = exportDocument(activeDocument);
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button type="button" onClick={handleExport}>
      Export JSON
    </button>
  );
}
