import { useState } from "react";
import { clearDraft, loadDraft, saveDraft } from "./draftStorage.ts";

interface Draft {
  text: string;
  setText: (text: string) => void;
  clear: () => void;
}

/**
 * A text field's value, mirrored to sessionStorage under `storageKey` so it
 * survives a safe-refresh (docs/design.md 13) without surviving past the
 * session. Falls back to `initialText` when no draft is stored.
 */
export function useDraft(storageKey: string, initialText: string): Draft {
  const [text, setTextState] = useState(
    () => loadDraft(storageKey) ?? initialText,
  );

  function setText(next: string) {
    setTextState(next);
    if (next === "") {
      clearDraft(storageKey);
    } else {
      saveDraft(storageKey, next);
    }
  }

  function clear() {
    setTextState(initialText);
    clearDraft(storageKey);
  }

  return { text, setText, clear };
}
