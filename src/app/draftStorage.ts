const PREFIX = "notes:draft:";

/**
 * Session-scoped (not local-storage) persistence for in-progress free-text
 * edits, so a safe-refresh (docs/design.md 13) or accidental reload doesn't
 * discard unsaved input. Session-scoped rather than persistent so a draft
 * never survives past the current browser session (cross-phase safeguard:
 * "keep dialogs and pending editor state in memory during a session").
 */
export function saveDraft(key: string, text: string): void {
  sessionStorage.setItem(PREFIX + key, text);
}

export function loadDraft(key: string): string | null {
  return sessionStorage.getItem(PREFIX + key);
}

export function clearDraft(key: string): void {
  sessionStorage.removeItem(PREFIX + key);
}
