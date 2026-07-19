import { useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  ReactNode,
} from "react";
import type { MutationError } from "../app/useDocument.ts";
import type { VisibleTreeNode } from "../app/treeViewState.ts";
import { pathsEqual } from "../app/treeViewState.ts";
import { encodePointer, isPathWithinOrEqual } from "../domain/path.ts";
import { renderBlock, renderInline } from "../domain/markdown.ts";
import type { Result } from "../domain/result.ts";
import type { JsonObject, JsonValue, Path } from "../domain/types.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { CreateEntryForm } from "./CreateEntryForm.tsx";
import { describeError } from "./errors.ts";
import { ValueEditor } from "./ValueEditor.tsx";

export type RowEditor =
  | { mode: "view"; path: Path }
  | { mode: "edit-value"; path: Path }
  | { mode: "rename"; path: Path }
  | { mode: "relocate"; path: Path; kind: "move" | "copy" }
  | { mode: "create"; path: Path };

export interface Destination {
  path: Path;
  pointer: string;
  label: string;
  depth: number;
}

interface TreeRowProps {
  node: VisibleTreeNode;
  selected: boolean;
  focused: boolean;
  editing: RowEditor | null;
  destinations: Destination[];
  children?: ReactNode;
  registerRef: (pointer: string, element: HTMLLIElement | null) => void;
  onFocus: (path: Path) => void;
  onSelect: (path: Path) => void;
  onToggle: (path: Path) => void;
  onKeyDown: (
    event: KeyboardEvent<HTMLLIElement>,
    node: VisibleTreeNode,
  ) => void;
  onEdit: (editor: RowEditor | null) => void;
  onCreateEntry: (
    parentPath: Path,
    key: string,
    value: JsonValue,
  ) => Promise<Result<JsonObject, MutationError>>;
  onCreateElement: (
    parentPath: Path,
    value: JsonValue,
  ) => Promise<Result<JsonObject, MutationError>>;
  onRename: (
    parentPath: Path,
    oldKey: string,
    newKey: string,
  ) => Promise<Result<JsonObject, MutationError>>;
  onSetValue: (
    path: Path,
    value: JsonValue,
    confirmReplace?: boolean,
  ) => Promise<Result<JsonObject, MutationError>>;
  onReorder: (
    parentPath: Path,
    fromIndex: number,
    toIndex: number,
  ) => Promise<Result<JsonObject, MutationError>>;
  draggedPath: Path | null;
  onDragStart: (path: Path) => void;
  onDragEnd: () => void;
  onRelocate: (
    kind: "move" | "copy",
    path: Path,
    destinationPointer: string,
    newKey?: string,
  ) => Promise<Result<JsonObject, MutationError>>;
  onDelete: (path: Path) => Promise<Result<JsonObject, MutationError>>;
}

export function TreeRow({
  node,
  selected,
  focused,
  editing,
  destinations,
  children,
  registerRef,
  onFocus,
  onSelect,
  onToggle,
  onKeyDown,
  onEdit,
  onCreateEntry,
  onCreateElement,
  onRename,
  onSetValue,
  onReorder,
  onRelocate,
  onDelete,
  draggedPath,
  onDragStart,
  onDragEnd,
}: TreeRowProps) {
  const [error, setError] = useState<string | null>(null);
  const [pendingValue, setPendingValue] = useState<JsonValue | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dropPosition, setDropPosition] = useState<"before" | "after" | null>(
    null,
  );
  const actionsRef = useRef<HTMLDetailsElement>(null);
  const isEditing =
    editing !== null && encodePointer(editing.path) === node.pointer;
  const isViewing = isEditing && editing.mode === "view";
  const inlinePreview = useMemo(() => {
    if (typeof node.value !== "string" || node.value.trim() === "") {
      return null;
    }
    return renderInline(node.value);
  }, [node.value]);
  const blockHtml = useMemo(() => {
    if (!isViewing || typeof node.value !== "string") return null;
    return renderBlock(node.value);
  }, [isViewing, node.value]);
  const parentPath = node.path.slice(0, -1);
  const oldKey =
    node.path.length === 0 ? "" : String(node.path[node.path.length - 1]);

  function closeActions() {
    if (actionsRef.current) actionsRef.current.open = false;
  }

  function resetEditor() {
    setError(null);
    setPendingValue(null);
    onEdit(null);
  }

  function openEditor(editor: RowEditor) {
    closeActions();
    setError(null);
    onSelect(node.path);
    if (editor.mode === "create" && node.container && !node.expanded) {
      onToggle(node.path);
    }
    onEdit(editor);
  }

  async function handleValueSubmit(value: JsonValue) {
    setSaving(true);
    const result = await onSetValue(node.path, value, false);
    setSaving(false);
    if (result.ok) {
      resetEditor();
    } else if (
      result.error.source === "domain" &&
      result.error.error.kind === "confirmation-required"
    ) {
      setError(null);
      setPendingValue(value);
    } else {
      setError(describeError(result.error));
    }
  }

  async function handleConfirmReplace() {
    if (pendingValue === null) return;
    setSaving(true);
    const result = await onSetValue(node.path, pendingValue, true);
    setSaving(false);
    if (result.ok) resetEditor();
    else {
      setError(describeError(result.error));
      setPendingValue(null);
    }
  }

  async function handleRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newKey = String(
      new FormData(event.currentTarget).get("newKey") ?? "",
    );
    setSaving(true);
    const result = await onRename(parentPath, oldKey, newKey);
    setSaving(false);
    if (result.ok) resetEditor();
    else setError(describeError(result.error));
  }

  async function handleReorder(toIndex: number) {
    if (node.index === null) return;
    closeActions();
    setSaving(true);
    const result = await onReorder(parentPath, node.index, toIndex);
    setSaving(false);
    if (!result.ok) setError(describeError(result.error));
  }

  const isDragSource =
    draggedPath !== null && pathsEqual(draggedPath, node.path);
  const draggedParentPath =
    draggedPath !== null ? draggedPath.slice(0, -1) : null;
  const canDropHere =
    node.index !== null &&
    !isDragSource &&
    draggedParentPath !== null &&
    pathsEqual(draggedParentPath, parentPath);

  function handleDragStart(event: DragEvent<HTMLSpanElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", node.pointer);
    onDragStart(node.path);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!canDropHere) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    setDropPosition(
      event.clientY - rect.top < rect.height / 2 ? "before" : "after",
    );
  }

  function handleDragLeave() {
    setDropPosition(null);
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const position = dropPosition;
    setDropPosition(null);
    if (!canDropHere || draggedPath === null || node.index === null) return;
    const fromIndex = draggedPath[draggedPath.length - 1];
    if (typeof fromIndex !== "number") return;
    const adjustedTargetIndex =
      node.index > fromIndex ? node.index - 1 : node.index;
    const toIndex =
      position === "after" ? adjustedTargetIndex + 1 : adjustedTargetIndex;
    if (toIndex === fromIndex) return;
    setSaving(true);
    const result = await onReorder(parentPath, fromIndex, toIndex);
    setSaving(false);
    if (!result.ok) setError(describeError(result.error));
  }

  async function handleRelocate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isEditing || editing.mode !== "relocate") return;
    const data = new FormData(event.currentTarget);
    const advanced = String(data.get("advancedDestination") ?? "").trim();
    const visual = String(data.get("destination") ?? "");
    const destinationPointer = advanced === "" ? visual : advanced;
    const newKey = String(data.get("newKey") ?? "").trim();
    setSaving(true);
    const result = await onRelocate(
      editing.kind,
      node.path,
      destinationPointer,
      newKey === "" ? undefined : newKey,
    );
    setSaving(false);
    if (result.ok) resetEditor();
    else setError(describeError(result.error));
  }

  async function handleDelete() {
    setSaving(true);
    const result = await onDelete(node.path);
    setSaving(false);
    setConfirmingDelete(false);
    if (!result.ok) setError(describeError(result.error));
  }

  const countLabel =
    node.kind === "array" ? `[${node.childCount}]` : `{${node.childCount}}`;
  const description = `${node.label}, ${node.kind}${
    node.container ? `, ${node.childCount} children` : ""
  }`;

  return (
    <li
      ref={(element) => registerRef(node.pointer, element)}
      id={`tree-node-${encodeURIComponent(node.pointer || "root")}`}
      className={`tree-row${selected ? " tree-row--selected" : ""}${isDragSource ? " tree-row--dragging" : ""}`}
      role="treeitem"
      aria-level={node.depth + 1}
      aria-expanded={node.container ? node.expanded : undefined}
      aria-selected={selected}
      aria-label={description}
      tabIndex={focused ? 0 : -1}
      style={{ "--tree-depth": node.depth } as CSSProperties}
      onFocus={(event) => {
        if (event.currentTarget === event.target) onFocus(node.path);
      }}
      onClick={(event) => {
        if (event.currentTarget === event.target) onSelect(node.path);
      }}
      onKeyDown={(event) => onKeyDown(event, node)}
    >
      <div
        className={`tree-row__line${
          canDropHere && dropPosition
            ? ` tree-row__line--drop-${dropPosition}`
            : ""
        }`}
        onClick={() => onSelect(node.path)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(event) => void handleDrop(event)}
      >
        <span
          className={`tree-row__drag-handle${
            node.index === null ? " tree-row__drag-handle--inactive" : ""
          }`}
          aria-hidden="true"
          draggable={node.index !== null}
          onDragStart={node.index !== null ? handleDragStart : undefined}
          onDragEnd={node.index !== null ? onDragEnd : undefined}
          onClick={(event) => event.stopPropagation()}
        >
          {node.index !== null ? "⠿" : ""}
        </span>
        {node.container ? (
          <button
            type="button"
            className="tree-row__disclosure"
            aria-label={`${node.expanded ? "Collapse" : "Expand"} ${node.label}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(node.path);
            }}
          >
            {node.expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="tree-row__disclosure tree-row__disclosure--leaf" />
        )}
        <span
          className={`tree-row__icon tree-row__icon--${node.kind}`}
          aria-hidden="true"
        >
          {node.kind === "object" ? "{}" : node.kind === "array" ? "[]" : "•"}
        </span>
        <span className="tree-row__label" title={node.label}>
          {node.label}
        </span>
        {node.container ? (
          <span className="tree-row__count">{countLabel}</span>
        ) : inlinePreview ? (
          <>
            <span className="tree-row__separator">:</span>
            <span
              className="tree-row__preview tree-row__preview--markdown"
              title={inlinePreview.plainText}
              onClick={(event) => {
                if ((event.target as HTMLElement).tagName === "A") {
                  event.stopPropagation();
                }
              }}
              dangerouslySetInnerHTML={{ __html: inlinePreview.html }}
            />
          </>
        ) : (
          <>
            <span className="tree-row__separator">:</span>
            <code
              className="tree-row__preview"
              title={JSON.stringify(node.value)}
            >
              {JSON.stringify(node.value)}
            </code>
          </>
        )}
        {selected && node.container && (
          <button
            type="button"
            className="tree-row__add"
            aria-label={`Add child to ${node.label}`}
            title={`Add child to ${node.label}`}
            onClick={(event) => {
              event.stopPropagation();
              openEditor({ mode: "create", path: node.path });
            }}
          >
            +
          </button>
        )}
        <details
          className="tree-row__actions"
          ref={actionsRef}
          onToggle={(event) => {
            if (!event.currentTarget.open) return;
            const details = event.currentTarget;
            requestAnimationFrame(() => {
              details
                .querySelector(".tree-row__actions-menu")
                ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
            });
          }}
        >
          <summary
            className="tree-row__actions-toggle"
            aria-label={`Actions for ${node.label}`}
            title={`Actions for ${node.label}`}
            onClick={(event) => event.stopPropagation()}
          >
            ⋯
          </summary>
          <div
            className="tree-row__actions-menu"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() =>
                openEditor({ mode: "edit-value", path: node.path })
              }
              disabled={saving || (editing !== null && !isEditing)}
            >
              Edit
            </button>
            {node.container && (
              <button
                type="button"
                onClick={() => openEditor({ mode: "create", path: node.path })}
                disabled={saving || (editing !== null && !isEditing)}
              >
                Add child
              </button>
            )}
            {node.path.length > 0 &&
              typeof node.path[node.path.length - 1] === "string" && (
                <button
                  type="button"
                  onClick={() =>
                    openEditor({ mode: "rename", path: node.path })
                  }
                  disabled={saving || (editing !== null && !isEditing)}
                >
                  Rename
                </button>
              )}
            {node.index !== null && (
              <>
                <button
                  type="button"
                  aria-label={`Move ${node.label} up`}
                  onClick={() => void handleReorder(node.index! - 1)}
                  disabled={saving || node.index === 0}
                >
                  Move up
                </button>
                <button
                  type="button"
                  aria-label={`Move ${node.label} down`}
                  onClick={() => void handleReorder(node.index! + 1)}
                  disabled={saving || node.index === node.siblingCount - 1}
                >
                  Move down
                </button>
              </>
            )}
            {node.path.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    openEditor({
                      mode: "relocate",
                      path: node.path,
                      kind: "move",
                    })
                  }
                  disabled={saving || (editing !== null && !isEditing)}
                >
                  Move to…
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openEditor({
                      mode: "relocate",
                      path: node.path,
                      kind: "copy",
                    })
                  }
                  disabled={saving || (editing !== null && !isEditing)}
                >
                  Copy to…
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeActions();
                    setConfirmingDelete(true);
                  }}
                  disabled={saving}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </details>
      </div>

      {isViewing && blockHtml !== null && (
        <div className="tree-row__panel tree-row__view">
          <div
            className="tree-row__view-content"
            dangerouslySetInnerHTML={{ __html: blockHtml }}
          />
          <div className="tree-row__form-actions">
            <button
              type="button"
              onClick={() =>
                openEditor({ mode: "edit-value", path: node.path })
              }
            >
              Edit
            </button>
          </div>
        </div>
      )}

      {isEditing && editing.mode === "edit-value" && (
        <div className="tree-row__panel">
          <ValueEditor
            idPrefix={`edit-${node.pointer}`}
            storageKey={node.pointer}
            initialText={JSON.stringify(node.value)}
            submitLabel="Save"
            onSubmit={(value) => void handleValueSubmit(value)}
            onCancel={resetEditor}
          />
          {pendingValue !== null && (
            <ConfirmDialog
              message={`Replacing "${node.label}" changes its type and discards its current content. Continue?`}
              confirmLabel="Replace"
              onConfirm={() => void handleConfirmReplace()}
              onCancel={() => setPendingValue(null)}
            />
          )}
        </div>
      )}

      {isEditing && editing.mode === "rename" && (
        <form
          className="tree-row__panel tree-row__form"
          onSubmit={(event) => void handleRename(event)}
        >
          <label htmlFor={`rename-${node.pointer}`}>New key</label>
          <input
            id={`rename-${node.pointer}`}
            name="newKey"
            defaultValue={oldKey}
            autoFocus
          />
          <div className="tree-row__form-actions">
            <button type="submit" disabled={saving}>
              Save
            </button>
            <button type="button" onClick={resetEditor} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {isEditing && editing.mode === "relocate" && (
        <form
          className="tree-row__panel tree-row__form"
          onSubmit={(event) => void handleRelocate(event)}
        >
          <fieldset className="destination-picker">
            <legend>{editing.kind === "move" ? "Move" : "Copy"} to</legend>
            {destinations.map((destination) => {
              const invalid =
                editing.kind === "move" &&
                isPathWithinOrEqual(node.path, destination.path);
              return (
                <label
                  key={destination.pointer}
                  className="destination-picker__item"
                  style={
                    {
                      "--destination-depth": destination.depth,
                    } as CSSProperties
                  }
                >
                  <input
                    type="radio"
                    name="destination"
                    value={destination.pointer}
                    defaultChecked={destination.pointer === ""}
                    disabled={invalid}
                  />
                  <span>{destination.label}</span>
                  {destination.pointer === node.pointer && (
                    <small>source</small>
                  )}
                </label>
              );
            })}
          </fieldset>
          <label htmlFor={`new-key-${node.pointer}`}>
            New key (object destinations only)
          </label>
          <input
            id={`new-key-${node.pointer}`}
            name="newKey"
            placeholder={oldKey}
          />
          <details>
            <summary>Advanced JSON Pointer</summary>
            <label htmlFor={`destination-${node.pointer}`}>
              Destination pointer
            </label>
            <input
              id={`destination-${node.pointer}`}
              name="advancedDestination"
              placeholder="/tips"
            />
          </details>
          <div className="tree-row__form-actions">
            <button type="submit" disabled={saving}>
              {editing.kind === "move" ? "Move" : "Copy"}
            </button>
            <button type="button" onClick={resetEditor} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {children}

      {isEditing && editing.mode === "create" && (
        <div className="tree-row__panel tree-row__create">
          <CreateEntryForm
            isArray={node.kind === "array"}
            storageKey={node.pointer}
            onCreateEntry={(key, value) => onCreateEntry(node.path, key, value)}
            onCreateElement={(value) => onCreateElement(node.path, value)}
            onCancel={resetEditor}
          />
        </div>
      )}

      {node.container && node.expanded && node.childCount === 0 && (
        <div className="tree-row__empty" role="note">
          Empty
        </div>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          message={`Delete "${node.label}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}

      {error && (
        <p className="tree-row__error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
