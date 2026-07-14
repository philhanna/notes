import { useId, useRef } from "react";
import type { KeyboardEvent } from "react";

interface ConfirmDialogProps {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A minimal accessible confirmation prompt for destructive/type-changing
 * actions: traps focus while open, treats Escape as Cancel, and restores
 * focus to whatever triggered it once it closes.
 *
 * Focus restoration happens inside the confirm/cancel handlers themselves
 * rather than in an unmount-effect cleanup: React's StrictMode intentionally
 * mounts, unmounts, and remounts a component's effects once in development
 * (to surface missing-cleanup bugs), which would otherwise fire an unmount
 * cleanup immediately after every open and steal focus back before the user
 * did anything — driving the restore off the explicit user action avoids
 * that entirely, and is also more correct conceptually: "closing" is a
 * domain event here, not a React lifecycle detail.
 */
export function ConfirmDialog({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const messageId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  // Captured during render, before the confirm button's autoFocus (a
  // commit-phase effect) can move focus away from whatever triggered this
  // dialog.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  if (previouslyFocusedRef.current === null) {
    previouslyFocusedRef.current = document.activeElement as HTMLElement;
  }

  function confirm() {
    previouslyFocusedRef.current?.focus();
    onConfirm();
  }

  function cancel() {
    previouslyFocusedRef.current?.focus();
    onCancel();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key !== "Tab" || !containerRef.current) return;

    const focusable = Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={containerRef}
      className="confirm-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-describedby={messageId}
      onKeyDown={handleKeyDown}
    >
      <p id={messageId}>{message}</p>
      <div className="confirm-dialog__actions">
        <button type="button" onClick={confirm} autoFocus>
          {confirmLabel}
        </button>
        <button type="button" onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
