import { useEffect, useState } from "react";
import type { DocumentState } from "../app/useDocument.ts";
import type { HistoryRevision } from "../app/history.ts";
import type { JsonValue, Path } from "../domain/types.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { describeError, describePersistError } from "./errors.ts";

interface HistoryPanelProps {
  path: Path;
  label: string;
  currentValue: JsonValue | undefined;
  history: NonNullable<DocumentState["history"]>;
  restore: DocumentState["restore"];
  onClose: () => void;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; revisions: HistoryRevision[] };

/**
 * Revision history for one path (design.md 10): lists the revisions where
 * this path actually changed, lets the user preview one and compare it with
 * the current value, and restore it as a new commit. Preview and compare
 * never call a mutator, so they cannot alter current state; only Restore
 * does, and only after confirmation.
 */
export function HistoryPanel({
  path,
  label,
  currentValue,
  history,
  restore,
  onClose,
}: HistoryPanelProps) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    void history(path).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setState({
          phase: "error",
          message: describePersistError(result.error),
        });
        return;
      }
      setState({ phase: "ready", revisions: result.value });
    });
    return () => {
      cancelled = true;
    };
  }, [history, path]);

  const selected =
    state.phase === "ready"
      ? state.revisions.find((revision) => revision.sha === selectedSha)
      : undefined;

  async function handleRestore() {
    if (!selected) return;
    setRestoring(true);
    const result = await restore(path, selected.value ?? null, selected.sha);
    setRestoring(false);
    setConfirming(false);
    if (result.ok) {
      onClose();
    } else {
      setRestoreError(describeError(result.error));
    }
  }

  return (
    <div className="history-panel">
      <div className="history-panel__header">
        <h2>History: {label}</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>

      {state.phase === "loading" && <p>Loading history…</p>}
      {state.phase === "error" && (
        <p role="alert" className="history-panel__error">
          {state.message}
        </p>
      )}
      {state.phase === "ready" && state.revisions.length === 0 && (
        <p>No history found for this location.</p>
      )}

      {state.phase === "ready" && state.revisions.length > 0 && (
        <ul className="history-list">
          {state.revisions.map((revision) => (
            <li key={revision.sha}>
              <button
                type="button"
                className="history-list__item"
                aria-pressed={revision.sha === selectedSha}
                onClick={() =>
                  setSelectedSha(
                    revision.sha === selectedSha ? null : revision.sha,
                  )
                }
              >
                <time dateTime={revision.date}>{revision.date}</time>
                <span>{revision.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="history-preview">
          <div>
            <h3>Selected revision</h3>
            <pre>{JSON.stringify(selected.value, null, 2) ?? "(removed)"}</pre>
          </div>
          <div>
            <h3>Current</h3>
            <pre>{JSON.stringify(currentValue, null, 2) ?? "(none)"}</pre>
          </div>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={restoring}
          >
            Restore this revision
          </button>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          message={`Restore "${label}" to its state from ${selected?.date ?? ""}? This replaces the current value with a new commit; later history is not erased.`}
          confirmLabel="Restore"
          onConfirm={() => void handleRestore()}
          onCancel={() => setConfirming(false)}
        />
      )}

      {restoreError && (
        <p className="history-panel__error" role="alert">
          {restoreError}
        </p>
      )}
    </div>
  );
}
