import { useState } from "react";
import type { FormEvent } from "react";
import type { DocumentState } from "../app/useDocument.ts";
import { resolvePointer } from "../domain/path.ts";
import type { JsonObject } from "../domain/types.ts";
import type { TrashDocument, TrashRecord } from "../domain/trash.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { describeError } from "./errors.ts";

interface TrashViewProps {
  document: JsonObject;
  trash: TrashDocument;
  recover: DocumentState["recover"];
  permanentlyDeleteTrash: DocumentState["permanentlyDeleteTrash"];
  emptyTrash: DocumentState["emptyTrash"];
  onClose: () => void;
}

/**
 * Lists trash records with recover/permanent-delete actions and an Empty
 * Trash control (design.md 7.3). Recovering without a destination tries the
 * record's original path first; a `destination-required` domain error opens
 * an inline destination picker instead of guessing a fallback.
 */
export function TrashView({
  document,
  trash,
  recover,
  permanentlyDeleteTrash,
  emptyTrash,
  onClose,
}: TrashViewProps) {
  const [error, setError] = useState<string | null>(null);
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);
  const [emptying, setEmptying] = useState(false);

  async function handleEmptyTrash() {
    setEmptying(true);
    const result = await emptyTrash();
    setEmptying(false);
    setConfirmingEmpty(false);
    if (!result.ok) setError(describeError(result.error));
  }

  return (
    <div className="trash-view">
      <div className="trash-view__header">
        <h2>Trash</h2>
        <button type="button" onClick={onClose}>
          Back to notes
        </button>
      </div>

      {trash.records.length === 0 ? (
        <p className="trash-view__empty">Trash is empty.</p>
      ) : (
        <>
          <ul className="trash-list">
            {trash.records.map((record) => (
              <TrashRow
                key={record.id}
                record={record}
                document={document}
                recover={recover}
                permanentlyDeleteTrash={permanentlyDeleteTrash}
              />
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setConfirmingEmpty(true)}
            disabled={emptying}
          >
            Empty Trash
          </button>
        </>
      )}

      {confirmingEmpty && (
        <ConfirmDialog
          message="Permanently delete every item in trash? Earlier Git commits may still contain this data — this is not secure erasure."
          confirmLabel="Empty Trash"
          onConfirm={() => void handleEmptyTrash()}
          onCancel={() => setConfirmingEmpty(false)}
        />
      )}

      {error && (
        <p className="trash-view__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface TrashRowProps {
  record: TrashRecord;
  document: JsonObject;
  recover: DocumentState["recover"];
  permanentlyDeleteTrash: DocumentState["permanentlyDeleteTrash"];
}

function TrashRow({
  record,
  document,
  recover,
  permanentlyDeleteTrash,
}: TrashRowProps) {
  const [needsDestination, setNeedsDestination] = useState(false);
  const [confirmingPermanent, setConfirmingPermanent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleRecover() {
    setSaving(true);
    const result = await recover(record.id);
    setSaving(false);
    if (result.ok) {
      setNeedsDestination(false);
      setError(null);
      return;
    }
    if (
      result.error.source === "domain" &&
      result.error.error.kind === "destination-required"
    ) {
      setNeedsDestination(true);
      setError(null);
      return;
    }
    setError(describeError(result.error));
  }

  async function handleDestinationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const destinationPointer = String(data.get("destination") ?? "");
    const key = String(data.get("key") ?? "").trim();
    const parentPath = resolvePointer(document, destinationPointer);
    if (parentPath === undefined) {
      setError("That location no longer exists.");
      return;
    }
    setSaving(true);
    const result = await recover(
      record.id,
      key === "" ? { parentPath } : { parentPath, key },
    );
    setSaving(false);
    if (result.ok) {
      setNeedsDestination(false);
      setError(null);
    } else {
      setError(describeError(result.error));
    }
  }

  async function handlePermanentDelete() {
    setSaving(true);
    const result = await permanentlyDeleteTrash(record.id);
    setSaving(false);
    setConfirmingPermanent(false);
    if (!result.ok) setError(describeError(result.error));
  }

  return (
    <li className="trash-row">
      <div className="trash-row__main">
        <code className="trash-row__path">{record.originalPath}</code>
        <span className="trash-row__type">{record.type}</span>
        <time className="trash-row__deleted-at" dateTime={record.deletedAt}>
          {record.deletedAt}
        </time>
      </div>

      <div className="trash-row__actions">
        <button
          type="button"
          onClick={() => void handleRecover()}
          disabled={saving}
        >
          Recover
        </button>
        <button
          type="button"
          onClick={() => setConfirmingPermanent(true)}
          disabled={saving}
        >
          Delete permanently
        </button>
      </div>

      {needsDestination && (
        <form
          className="trash-row__destination"
          onSubmit={(event) => void handleDestinationSubmit(event)}
        >
          <p>
            &ldquo;{record.originalPath}&rdquo; is occupied. Choose another
            destination.
          </p>
          <label htmlFor={`trash-destination-${record.id}`}>
            Destination (JSON Pointer to the containing object or array)
          </label>
          <input
            id={`trash-destination-${record.id}`}
            name="destination"
            placeholder="/tips"
            autoFocus
          />
          <label htmlFor={`trash-key-${record.id}`}>
            New key (object destinations only)
          </label>
          <input id={`trash-key-${record.id}`} name="key" />
          <button type="submit" disabled={saving}>
            Recover here
          </button>
          <button
            type="button"
            onClick={() => setNeedsDestination(false)}
            disabled={saving}
          >
            Cancel
          </button>
        </form>
      )}

      {confirmingPermanent && (
        <ConfirmDialog
          message={`Permanently delete "${record.originalPath}" from trash? This cannot be undone from the app.`}
          confirmLabel="Delete permanently"
          onConfirm={() => void handlePermanentDelete()}
          onCancel={() => setConfirmingPermanent(false)}
        />
      )}

      {error && (
        <p className="trash-row__error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
