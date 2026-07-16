import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { DocumentState, MutationError } from "../app/useDocument.ts";
import {
  deriveVisibleTree,
  expandAncestors,
  nearestExistingPath,
  pathsEqual,
  remapArrayReorderPath,
  remapArrayReorderPointers,
  remapPointerSet,
  removePointerSubtree,
  replacePathPrefix,
  validateExpandedPaths,
} from "../app/treeViewState.ts";
import type { VisibleTreeNode } from "../app/treeViewState.ts";
import {
  adjustPathAfterRemoval,
  encodePointer,
  resolvePointer,
} from "../domain/path.ts";
import { err } from "../domain/result.ts";
import type { Result } from "../domain/result.ts";
import { getAtPath, listChildren } from "../domain/tree.ts";
import type { JsonObject, JsonValue, Path } from "../domain/types.ts";
import { isContainer, isJsonArray, isJsonObject } from "../domain/types.ts";
import { TreeRow } from "./TreeRow.tsx";
import type { Destination, RowEditor } from "./TreeRow.tsx";

export interface TreeViewState {
  expandedPaths: Set<string>;
  selectedPath: Path;
  focusedPath: Path;
  setExpandedPaths: (
    value: Set<string> | ((previous: Set<string>) => Set<string>),
  ) => void;
  setSelectedPath: (path: Path) => void;
  setFocusedPath: (path: Path) => void;
}

interface TreeBrowserProps {
  state: DocumentState;
  treeState?: TreeViewState;
  revealPath?: Path | null;
  onRevealHandled?: () => void;
}

export function TreeBrowser({
  state,
  treeState,
  revealPath = null,
  onRevealHandled,
}: TreeBrowserProps) {
  const [localExpanded, setLocalExpanded] = useState<Set<string>>(
    () => new Set([""]),
  );
  const [localSelected, setLocalSelected] = useState<Path>([]);
  const [localFocused, setLocalFocused] = useState<Path>([]);
  const [editing, setEditing] = useState<RowEditor | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const expandedPaths = treeState?.expandedPaths ?? localExpanded;
  const selectedPath = treeState?.selectedPath ?? localSelected;
  const focusedPath = treeState?.focusedPath ?? localFocused;
  const setExpandedPaths = treeState?.setExpandedPaths ?? setLocalExpanded;
  const setSelectedPath = treeState?.setSelectedPath ?? setLocalSelected;
  const setFocusedPath = treeState?.setFocusedPath ?? setLocalFocused;

  const visibleNodes = useMemo(
    () => deriveVisibleTree(state.document, expandedPaths),
    [state.document, expandedPaths],
  );
  const destinations = useMemo(
    () => collectDestinations(state.document),
    [state.document],
  );
  const focusedPointer = encodePointer(focusedPath);

  useEffect(() => {
    const validExpanded = validateExpandedPaths(state.document, expandedPaths);
    if (
      validExpanded.size !== expandedPaths.size ||
      [...validExpanded].some((pointer) => !expandedPaths.has(pointer))
    ) {
      setExpandedPaths(validExpanded);
    }
    const nextSelected = nearestExistingPath(state.document, selectedPath);
    if (!pathsEqual(nextSelected, selectedPath)) setSelectedPath(nextSelected);
    const nextFocused = nearestExistingPath(state.document, focusedPath);
    if (!pathsEqual(nextFocused, focusedPath)) setFocusedPath(nextFocused);
    if (editing && getAtPath(state.document, editing.path) === undefined) {
      setEditing(null);
    }
  }, [
    state.document,
    expandedPaths,
    selectedPath,
    focusedPath,
    editing,
    setExpandedPaths,
    setSelectedPath,
    setFocusedPath,
  ]);

  useEffect(() => {
    if (revealPath === null) return;
    setExpandedPaths((previous) => expandAncestors(previous, revealPath));
    setSelectedPath(revealPath);
    setFocusedPath(revealPath);
  }, [revealPath, setExpandedPaths, setSelectedPath, setFocusedPath]);

  useEffect(() => {
    if (revealPath === null) return;
    const pointer = encodePointer(revealPath);
    if (!visibleNodes.some((node) => node.pointer === pointer)) return;
    const row = rowRefs.current.get(pointer);
    row?.focus();
    row?.scrollIntoView?.({ block: "nearest" });
    onRevealHandled?.();
  }, [revealPath, visibleNodes, onRevealHandled]);

  useEffect(() => {
    if (!visibleNodes.some((node) => node.pointer === focusedPointer)) {
      const parent = nearestVisibleAncestor(visibleNodes, focusedPath);
      setFocusedPath(parent.path);
    }
  }, [visibleNodes, focusedPath, focusedPointer, setFocusedPath]);

  function focusPath(path: Path) {
    setFocusedPath(path);
    const row = rowRefs.current.get(encodePointer(path));
    row?.focus();
    row?.scrollIntoView?.({ block: "nearest" });
  }

  function toggle(path: Path) {
    const pointer = encodePointer(path);
    setExpandedPaths((previous) => {
      const next = new Set(previous);
      if (next.has(pointer)) next.delete(pointer);
      else next.add(pointer);
      return next;
    });
    if (
      expandedPaths.has(pointer) &&
      focusedPath.length > path.length &&
      path.every((segment, index) => focusedPath[index] === segment)
    ) {
      focusPath(path);
    }
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLLIElement>,
    node: VisibleTreeNode,
  ) {
    if (event.target !== event.currentTarget) return;
    const index = visibleNodes.findIndex(
      (candidate) => candidate.pointer === node.pointer,
    );
    let target: Path | null = null;
    if (event.key === "ArrowDown") {
      target =
        visibleNodes[Math.min(index + 1, visibleNodes.length - 1)]?.path ??
        null;
    } else if (event.key === "ArrowUp") {
      target = visibleNodes[Math.max(index - 1, 0)]?.path ?? null;
    } else if (event.key === "Home") {
      target = visibleNodes[0]?.path ?? null;
    } else if (event.key === "End") {
      target = visibleNodes[visibleNodes.length - 1]?.path ?? null;
    } else if (event.key === "ArrowRight" && node.container) {
      if (!node.expanded) toggle(node.path);
      else target = visibleNodes[index + 1]?.path ?? null;
    } else if (event.key === "ArrowLeft") {
      if (node.container && node.expanded) toggle(node.path);
      else target = node.parentPath;
    } else if (event.key === "Enter" || event.key === " ") {
      setSelectedPath(node.path);
    } else {
      return;
    }
    event.preventDefault();
    if (target) focusPath(target);
  }

  function updatePathState(oldPath: Path, newPath: Path) {
    setExpandedPaths((previous) =>
      expandAncestors(remapPointerSet(previous, oldPath, newPath), newPath),
    );
    setSelectedPath(replacePathPrefix(selectedPath, oldPath, newPath));
    setFocusedPath(replacePathPrefix(focusedPath, oldPath, newPath));
  }

  async function rename(parentPath: Path, oldKey: string, newKey: string) {
    const result = await state.rename(parentPath, oldKey, newKey);
    if (result.ok) {
      const newPath = [...parentPath, newKey];
      updatePathState([...parentPath, oldKey], newPath);
      requestAnimationFrame(() => focusPath(newPath));
    }
    return result;
  }

  async function reorder(parentPath: Path, fromIndex: number, toIndex: number) {
    const result = await state.reorder(parentPath, fromIndex, toIndex);
    if (result.ok) {
      setExpandedPaths((previous) =>
        remapArrayReorderPointers(previous, parentPath, fromIndex, toIndex),
      );
      setSelectedPath(
        remapArrayReorderPath(selectedPath, parentPath, fromIndex, toIndex),
      );
      setFocusedPath(
        remapArrayReorderPath(focusedPath, parentPath, fromIndex, toIndex),
      );
    }
    return result;
  }

  async function relocate(
    kind: "move" | "copy",
    path: Path,
    destinationPointer: string,
    newKey?: string,
  ): Promise<Result<JsonObject, MutationError>> {
    const destination = resolvePointer(state.document, destinationPointer);
    if (destination === undefined) {
      return err({ source: "domain", error: { kind: "not-found", path: [] } });
    }
    const sourceParent = path.slice(0, -1);
    const sourceParentValue = getAtPath(state.document, sourceParent);
    const adjustedDestination =
      kind === "move" ? adjustPathAfterRemoval(path, destination) : destination;
    const result =
      kind === "move"
        ? await state.move(path, destination, newKey)
        : await state.copy(path, destination, newKey);
    if (result.ok && kind === "move") {
      const destinationValue = getAtPath(result.value, adjustedDestination);
      const sourceSegment = path[path.length - 1];
      const insertedPath = isJsonObject(destinationValue)
        ? [
            ...adjustedDestination,
            newKey ?? (typeof sourceSegment === "string" ? sourceSegment : ""),
          ]
        : isJsonArray(destinationValue)
          ? [...adjustedDestination, destinationValue.length - 1]
          : adjustedDestination;
      if (isJsonArray(sourceParentValue)) {
        setExpandedPaths((previous) =>
          expandAncestors(
            removePointerSubtree(previous, sourceParent),
            insertedPath,
          ),
        );
        setSelectedPath(insertedPath);
        setFocusedPath(insertedPath);
      } else {
        updatePathState(path, insertedPath);
      }
      requestAnimationFrame(() => focusPath(insertedPath));
    }
    return result;
  }

  async function deleteEntry(path: Path) {
    const parentPath = path.slice(0, -1);
    const parent = getAtPath(state.document, parentPath);
    const result = await state.deleteEntry(path);
    if (result.ok) {
      setExpandedPaths((previous) => {
        const withoutSubtree = removePointerSubtree(previous, path);
        if (isJsonArray(parent))
          withoutSubtree.delete(encodePointer(parentPath));
        return withoutSubtree;
      });
      setSelectedPath(parentPath);
      focusPath(parentPath);
      setEditing(null);
    }
    return result;
  }

  async function setValue(
    path: Path,
    value: JsonValue,
    confirmReplace?: boolean,
  ) {
    const result = await state.setValue(path, value, confirmReplace);
    if (result.ok) {
      setExpandedPaths((previous) => {
        const pointer = encodePointer(path);
        const next = new Set(
          [...previous].filter(
            (candidate) => !candidate.startsWith(`${pointer}/`),
          ),
        );
        if (!isContainer(value)) next.delete(encodePointer(path));
        return validateExpandedPaths(result.value, next);
      });
    }
    return result;
  }

  function renderNode(node: VisibleTreeNode): ReactNode {
    const children = visibleNodes.filter(
      (candidate) =>
        candidate.parentPath !== null &&
        pathsEqual(candidate.parentPath, node.path),
    );
    return (
      <TreeRow
        key={node.pointer}
        node={node}
        selected={pathsEqual(selectedPath, node.path)}
        focused={pathsEqual(focusedPath, node.path)}
        editing={editing}
        destinations={destinations}
        registerRef={(pointer, element) => {
          if (element) rowRefs.current.set(pointer, element);
          else rowRefs.current.delete(pointer);
        }}
        onFocus={setFocusedPath}
        onSelect={setSelectedPath}
        onToggle={toggle}
        onKeyDown={handleKeyDown}
        onEdit={(next) => {
          setEditing(next);
          if (next === null) focusPath(node.path);
        }}
        onCreateEntry={state.createEntry}
        onCreateElement={state.createElement}
        onRename={rename}
        onSetValue={setValue}
        onReorder={reorder}
        onRelocate={relocate}
        onDelete={deleteEntry}
      >
        {children.length > 0 && (
          <ul role="group" className="tree-group">
            {children.map(renderNode)}
          </ul>
        )}
      </TreeRow>
    );
  }

  const root = visibleNodes[0];
  return (
    <div className="tree-browser">
      <h2 className="visually-hidden">Notes tree</h2>
      <div className="tree-surface">
        <ul className="tree" role="tree" aria-label="Notes">
          {root && renderNode(root)}
        </ul>
      </div>
    </div>
  );
}

function nearestVisibleAncestor(
  visibleNodes: VisibleTreeNode[],
  path: Path,
): VisibleTreeNode {
  for (let length = path.length; length >= 0; length -= 1) {
    const pointer = encodePointer(path.slice(0, length));
    const node = visibleNodes.find(
      (candidate) => candidate.pointer === pointer,
    );
    if (node) return node;
  }
  return visibleNodes[0]!;
}

function collectDestinations(document: JsonObject): Destination[] {
  const destinations: Destination[] = [];
  function visit(path: Path, label: string, depth: number) {
    const value = getAtPath(document, path);
    if (!isContainer(value)) return;
    destinations.push({ path, pointer: encodePointer(path), label, depth });
    const children = listChildren(document, path);
    if (!children.ok) return;
    for (const child of children.value) {
      if (!isContainer(child.value)) continue;
      visit(
        child.path,
        child.kind === "object-entry" ? child.key : `[${child.index}]`,
        depth + 1,
      );
    }
  }
  visit([], "Notes", 0);
  return destinations;
}
