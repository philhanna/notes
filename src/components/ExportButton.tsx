import { downloadExport } from "../app/downloadExport.ts";
import { exportDocument } from "../app/exportDocument.ts";
import type { JsonObject } from "../domain/types.ts";

interface ExportButtonProps {
  document: JsonObject;
}

/**
 * Downloads the active tree as JSON (design.md 10, 12): only ever given
 * `document`, so credentials and repository settings have no way to end up
 * in the file. Export happens only when the user
 * clicks this — nothing here runs on a schedule.
 */
export function ExportButton({ document: activeDocument }: ExportButtonProps) {
  function handleExport() {
    downloadExport(exportDocument(activeDocument));
  }

  return (
    <button className="export-button" type="button" onClick={handleExport}>
      Export JSON
    </button>
  );
}
