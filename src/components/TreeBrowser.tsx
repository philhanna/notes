import type { DocumentState } from "../app/useDocument.ts";
import { getAtPath } from "../domain/tree.ts";
import { isJsonArray } from "../domain/types.ts";
import { Breadcrumbs } from "./Breadcrumbs.tsx";
import { ChildRow } from "./ChildRow.tsx";
import { CreateEntryForm } from "./CreateEntryForm.tsx";

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
  } = state;

  const current = getAtPath(document, currentPath);
  const isArray = isJsonArray(current);

  return (
    <div className="tree-browser">
      <Breadcrumbs path={currentPath} onNavigate={navigate} />

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
              />
            );
          })}
        </ul>
      )}

      <CreateEntryForm
        isArray={isArray}
        onCreateEntry={createEntry}
        onCreateElement={createElement}
      />
    </div>
  );
}
