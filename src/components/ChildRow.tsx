import { useState } from "react";
import type { FormEvent } from "react";
import type { MutationError } from "../app/useDocument.ts";
import type { ChildEntry } from "../domain/tree.ts";
import type { Result } from "../domain/result.ts";
import type { JsonObject, JsonValue, Path } from "../domain/types.ts";
import { isContainer, isJsonArray, isJsonObject } from "../domain/types.ts";
import { ValueEditor } from "./ValueEditor.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { describeError } from "./errors.ts";

interface ChildRowProps {
  entry: ChildEntry;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onOpen: (path: Path) => void;
  onRename: (
    oldKey: string,
    newKey: string,
  ) => Promise<Result<JsonObject, MutationError>>;
  onSetValue: (
    path: Path,
    value: JsonValue,
    confirmReplace?: boolean,
  ) => Promise<Result<JsonObject, MutationError>>;
  onMoveUp: () => Promise<Result<JsonObject, MutationError>>;
  onMoveDown: () => Promise<Result<JsonObject, MutationError>>;
  onRelocate: (
    kind: "move" | "copy",
    destinationPointer: string,
    newKey: string | undefined,
  ) => Promise<Result<JsonObject, MutationError>>;
  onDelete: () => Promise<Result<JsonObject, MutationError>>;
}

type Mode = "view" | "edit-value" | "rename" | "relocate";

/** One row of the tree browser's child list (design.md 6.1). */
export function ChildRow({
  entry,
  canMoveUp,
  canMoveDown,
  onOpen,
  onRename,
  onSetValue,
  onMoveUp,
  onMoveDown,
  onRelocate,
  onDelete,
}: ChildRowProps) {
  const [mode, setMode] = useState<Mode>("view");
  const [relocateKind, setRelocateKind] = useState<"move" | "copy">("move");
  const [error, setError] = useState<string | null>(null);
  const [pendingValue, setPendingValue] = useState<JsonValue | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  const label = entry.kind === "object-entry" ? entry.key : `[${entry.index}]`;
  const container = isContainer(entry.value);

  function resetToView() {
    setMode("view");
    setPendingValue(null);
    setError(null);
  }

  async function handleValueSubmit(value: JsonValue) {
    setSaving(true);
    const result = await onSetValue(entry.path, value, false);
    setSaving(false);
    if (result.ok) {
      resetToView();
      return;
    }
    if (
      result.error.source === "domain" &&
      result.error.error.kind === "confirmation-required"
    ) {
      setError(null);
      setPendingValue(value);
      return;
    }
    setError(describeError(result.error));
  }

  async function handleConfirmReplace() {
    if (pendingValue === null) return;
    setSaving(true);
    const result = await onSetValue(entry.path, pendingValue, true);
    setSaving(false);
    if (result.ok) {
      resetToView();
    } else {
      setError(describeError(result.error));
      setPendingValue(null);
    }
  }

  async function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newKey = String(
      new FormData(event.currentTarget).get("newKey") ?? "",
    );
    setSaving(true);
    const result = await onRename(label, newKey);
    setSaving(false);
    if (result.ok) {
      resetToView();
    } else {
      setError(describeError(result.error));
    }
  }

  async function handleMoveUp() {
    setSaving(true);
    const result = await onMoveUp();
    setSaving(false);
    if (!result.ok) setError(describeError(result.error));
  }

  async function handleMoveDown() {
    setSaving(true);
    const result = await onMoveDown();
    setSaving(false);
    if (!result.ok) setError(describeError(result.error));
  }

  function openRelocate(kind: "move" | "copy") {
    setRelocateKind(kind);
    setMode("relocate");
  }

  async function handleRelocateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const destinationPointer = String(data.get("destination") ?? "");
    const newKeyInput = String(data.get("newKey") ?? "").trim();
    setSaving(true);
    const result = await onRelocate(
      relocateKind,
      destinationPointer,
      newKeyInput === "" ? undefined : newKeyInput,
    );
    setSaving(false);
    if (result.ok) {
      resetToView();
    } else {
      setError(describeError(result.error));
    }
  }

  async function handleDeleteConfirm() {
    setSaving(true);
    const result = await onDelete();
    setSaving(false);
    setConfirmingDelete(false);
    if (!result.ok) setError(describeError(result.error));
  }

  return (
    <li className="child-row">
      <div className="child-row__main">
        {container ? (
          <button
            type="button"
            className="child-row__open"
            onClick={() => onOpen(entry.path)}
          >
            {label} — {describeContainer(entry.value)}
          </button>
        ) : (
          <span className="child-row__label">{label}</span>
        )}
        {!container && mode === "view" && (
          <code className="child-row__preview">
            {JSON.stringify(entry.value)}
          </code>
        )}
      </div>

      {mode === "view" && (
        <div className="child-row__actions">
          <button
            type="button"
            onClick={() => setMode("edit-value")}
            disabled={saving}
          >
            Edit
          </button>
          {entry.kind === "object-entry" && (
            <button
              type="button"
              onClick={() => setMode("rename")}
              disabled={saving}
            >
              Rename
            </button>
          )}
          {entry.kind === "array-element" && (
            <>
              <button
                type="button"
                onClick={() => void handleMoveUp()}
                disabled={saving || !canMoveUp}
                aria-label={`Move ${label} up`}
              >
                Move up
              </button>
              <button
                type="button"
                onClick={() => void handleMoveDown()}
                disabled={saving || !canMoveDown}
                aria-label={`Move ${label} down`}
              >
                Move down
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => openRelocate("move")}
            disabled={saving}
          >
            Move to…
          </button>
          <button
            type="button"
            onClick={() => openRelocate("copy")}
            disabled={saving}
          >
            Copy to…
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={saving}
          >
            Delete
          </button>
        </div>
      )}

      {mode === "edit-value" && (
        <>
          <ValueEditor
            idPrefix={`edit-${label}`}
            initialText={JSON.stringify(entry.value)}
            submitLabel="Save"
            onSubmit={(value) => void handleValueSubmit(value)}
            onCancel={resetToView}
          />
          {pendingValue !== null && (
            <ConfirmDialog
              message={`Replacing "${label}" changes its type and discards its current content. Continue?`}
              confirmLabel="Replace"
              onConfirm={() => void handleConfirmReplace()}
              onCancel={() => setPendingValue(null)}
            />
          )}
        </>
      )}

      {mode === "rename" && (
        <form
          className="child-row__rename"
          onSubmit={(event) => void handleRenameSubmit(event)}
        >
          <label htmlFor={`rename-${label}`}>New key</label>
          <input
            id={`rename-${label}`}
            name="newKey"
            defaultValue={label}
            autoFocus
          />
          <button type="submit" disabled={saving}>
            Save
          </button>
          <button type="button" onClick={resetToView} disabled={saving}>
            Cancel
          </button>
        </form>
      )}

      {mode === "relocate" && (
        <form
          className="child-row__relocate"
          onSubmit={(event) => void handleRelocateSubmit(event)}
        >
          <label htmlFor={`destination-${label}`}>
            Destination (JSON Pointer to the containing object or array)
          </label>
          <input
            id={`destination-${label}`}
            name="destination"
            placeholder="/tips"
            autoFocus
          />
          <label htmlFor={`new-key-${label}`}>New key (object destinations only)</label>
          <input id={`new-key-${label}`} name="newKey" placeholder={label} />
          <button type="submit" disabled={saving}>
            {relocateKind === "move" ? "Move" : "Copy"}
          </button>
          <button type="button" onClick={resetToView} disabled={saving}>
            Cancel
          </button>
        </form>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          message={`Delete "${label}"? It will be moved to trash.`}
          confirmLabel="Delete"
          onConfirm={() => void handleDeleteConfirm()}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

      {error && (
        <p className="child-row__error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function describeContainer(value: JsonValue): string {
  if (isJsonArray(value)) return `array (${value.length})`;
  if (isJsonObject(value)) return `object (${Object.keys(value).length})`;
  return "";
}
