import { useEffect, useRef, useState } from "react";
import type { DocumentState, MutationError } from "../app/useDocument.ts";
import { encodePointer, resolvePointer } from "../domain/path.ts";
import { err } from "../domain/result.ts";
import type { Result } from "../domain/result.ts";
import { getAtPath } from "../domain/tree.ts";
import type { JsonObject, Path } from "../domain/types.ts";
import { isJsonArray } from "../domain/types.ts";
import { Breadcrumbs } from "./Breadcrumbs.tsx";
import { ChildRow } from "./ChildRow.tsx";
import { CreateEntryForm } from "./CreateEntryForm.tsx";
import { HistoryPanel } from "./HistoryPanel.tsx";

interface TreeBrowserProps {
  state: DocumentState;
}

/** The main screen: breadcrumbs, immediate children, and entry creation (design.md 6.1). */
export function TreeBrowser({ state }: TreeBrowserProps) {
  const {
    document,
    currentPath,
    children,
    navigate,
    createEntry,
    createElement,
    rename,
    setValue,
    reorder,
    move,
    copy,
    deleteEntry,
    history,
    restore,
  } = state;
  const [showHistory, setShowHistory] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const current = getAtPath(document, currentPath);
  const isArray = isJsonArray(current);
  const levelLabel =
    currentPath.length === 0
      ? "Notes"
      : String(currentPath[currentPath.length - 1]);
  const pathKey = encodePointer(currentPath);

  // Move focus to the current level's heading after breadcrumb/child
  // navigation, since there is no router providing a navigation lifecycle
  // to hook (react-router-dom is listed as a dependency but was never
  // wired up — view switching is plain useState).
  useEffect(() => {
    headingRef.current?.focus();
  }, [pathKey]);

  function relocate(
    kind: "move" | "copy",
    path: Path,
    destinationPointer: string,
    newKey: string | undefined,
  ): Promise<Result<JsonObject, MutationError>> {
    const toParentPath = resolvePointer(document, destinationPointer);
    if (toParentPath === undefined) {
      return Promise.resolve(
        err({ source: "domain", error: { kind: "not-found", path: [] } }),
      );
    }
    return kind === "move"
      ? move(path, toParentPath, newKey)
      : copy(path, toParentPath, newKey);
  }

  return (
    <div className="tree-browser">
      <div className="tree-browser__header">
        <Breadcrumbs path={currentPath} onNavigate={navigate} />
        <h2 ref={headingRef} tabIndex={-1} className="tree-browser__heading">
          {levelLabel}
        </h2>
      </div>

      {children.length === 0 ? (
        <p className="tree-browser__empty">This level is empty.</p>
      ) : (
        <ul className="child-list">
          {children.map((entry) => {
            const index = entry.kind === "array-element" ? entry.index : -1;
            return (
              <ChildRow
                key={entry.kind === "object-entry" ? entry.key : entry.index}
                entry={entry}
                canMoveUp={entry.kind === "array-element" && index > 0}
                canMoveDown={
                  entry.kind === "array-element" && index < children.length - 1
                }
                onOpen={navigate}
                onRename={rename}
                onSetValue={setValue}
                onMoveUp={() => reorder(index, index - 1)}
                onMoveDown={() => reorder(index, index + 1)}
                onRelocate={(kind, destinationPointer, newKey) =>
                  relocate(kind, entry.path, destinationPointer, newKey)
                }
                onDelete={() => deleteEntry(entry.path)}
                history={history}
                restore={restore}
              />
            );
          })}
        </ul>
      )}

      <CreateEntryForm
        isArray={isArray}
        storageKey={encodePointer(currentPath)}
        onCreateEntry={createEntry}
        onCreateElement={createElement}
      />

      {history && (
        <button
          type="button"
          className="tree-browser__history"
          onClick={() => setShowHistory(true)}
        >
          History
        </button>
      )}

      {showHistory && history && (
        <HistoryPanel
          path={currentPath}
          label={levelLabel}
          currentValue={current}
          history={history}
          restore={restore}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
