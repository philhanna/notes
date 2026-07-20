import type { DocumentExport } from "./exportDocument.ts";

/** Triggers a download or share of a previously built export (design.md 10, 12): no network request, so the content never leaves the device except via this save/share sheet. */
export async function downloadExport({
  filename,
  content,
  mimeType,
}: DocumentExport) {
  const blob = new Blob([content], { type: mimeType });
  const file = new File([blob], filename, { type: mimeType });

  // Installed/standalone PWAs on mobile can silently fail the <a download>
  // flow below (no Blob-URL fetch/download UI in that context). The Web
  // Share API sidesteps Blob-URL navigation entirely, so prefer it whenever
  // the platform can share this file.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      throw error;
    }
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Not revoked: mobile browsers (e.g. iOS Safari) read the blob
  // asynchronously, and there's no signal for when that finishes. The
  // browser releases the URL itself when this document is torn down.
}
