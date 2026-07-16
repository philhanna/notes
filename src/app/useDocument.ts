import { useCallback, useMemo, useState } from "react";
import type { ChildEntry, TreeError } from "../domain/tree.ts";
import {
  copy as copyInTree,
  createArrayElement,
  createObjectEntry,
  deleteEntry as deleteEntryInTree,
  getAtPath,
  listChildren,
  move as moveInTree,
  renameKey,
  reorderArrayElement,
  setValueAtPath,
} from "../domain/tree.ts";
import type { Result } from "../domain/result.ts";
import { err, ok } from "../domain/result.ts";
import type { JsonObject, JsonValue, Path } from "../domain/types.ts";
import { isJsonArray, isJsonObject } from "../domain/types.ts";
import { anyPathOverlaps, changedPaths } from "../domain/diff.ts";
import { affectedPaths } from "./concurrency.ts";
import type { Operation, Repository } from "../persistence/repository.ts";
import type { PersistError } from "../persistence/types.ts";

/**
 * `TreeError` and `PersistError` both use a `kind` discriminant and their
 * value sets overlap (both have a `"not-found"` kind, for example), so a
 * mutation failure is tagged with its source rather than merged into one
 * flat union. `"conflict"` is distinct from a plain `"persist"` failure:
 * it means a concurrent write was detected, reconciliation was attempted,
 * and the affected paths genuinely overlapped (Phase 4, design.md 7.4) —
 * local state has already been refreshed to the latest saved revision by
 * the time this is returned, so a plain retry of the same mutator call now
 * operates against current data.
 */
export type MutationError =
  | { source: "domain"; error: TreeError }
  | { source: "persist"; error: PersistError }
  | { source: "conflict"; documentChanged: Path[] };

export interface DocumentPersistence {
  repository: Repository;
  /** The `sha` `initialDocument` was loaded at. */
  initialSha: string;
}

export interface DocumentState {
  document: JsonObject;
  currentPath: Path;
  children: ChildEntry[];
  navigate: (path: Path) => void;
  createEntry: (
    key: string,
    value: JsonValue,
  ) => Promise<Result<JsonObject, MutationError>>;
  createElement: (
    value: JsonValue,
  ) => Promise<Result<JsonObject, MutationError>>;
  rename: (
    oldKey: string,
    newKey: string,
  ) => Promise<Result<JsonObject, MutationError>>;
  setValue: (
    path: Path,
    value: JsonValue,
    confirmReplace?: boolean,
  ) => Promise<Result<JsonObject, MutationError>>;
  reorder: (
    fromIndex: number,
    toIndex: number,
  ) => Promise<Result<JsonObject, MutationError>>;
  move: (
    fromPath: Path,
    toParentPath: Path,
    newKey?: string,
  ) => Promise<Result<JsonObject, MutationError>>;
  copy: (
    fromPath: Path,
    toParentPath: Path,
    newKey?: string,
  ) => Promise<Result<JsonObject, MutationError>>;
  deleteEntry: (path: Path) => Promise<Result<JsonObject, MutationError>>;
}

/** Where `move`/`copy` placed a value, for the commit message only (design.md 9's "value-free"). */
function describeInsertedPath(
  document: JsonObject,
  toParentPath: Path,
  key: string | undefined,
  fromPath: Path,
): Path {
  const parent = getAtPath(document, toParentPath);
  if (isJsonObject(parent)) {
    const lastSourceSegment = fromPath[fromPath.length - 1];
    const resolvedKey =
      key ?? (typeof lastSourceSegment === "string" ? lastSourceSegment : "");
    return [...toParentPath, resolvedKey];
  }
  if (isJsonArray(parent)) return [...toParentPath, parent.length];
  return toParentPath;
}

/** Recomputes an operation's result against a given document, so it can be reapplied against a freshly reloaded base (Phase 4). */
type Recompute = (document: JsonObject) => Result<JsonObject, TreeError>;

/**
 * Holds a document and the currently browsed path in local component state
 * and applies domain operations at that path (Phase 1 of impl.md). When
 * `persistence` is supplied (Phase 2), each successful operation is also
 * committed through its `Repository` before local state is updated, so a
 * failed write leaves both the displayed document and the caller's pending
 * input untouched (design.md 9, 13). Without `persistence`, mutators still
 * return a Promise, resolved in the same microtask against local state only.
 *
 * On a stale-`sha` conflict (design.md 7.4, Phase 4), `asDocumentResult`
 * reloads the latest revision, compares the operation's affected paths
 * against what actually changed since `sha`, and either reapplies the
 * operation once against the fresh base (disjoint changes) or reports a
 * `"conflict"` `MutationError` with local state already refreshed
 * (overlapping changes) — see `asDocumentResult` below.
 */
export function useDocument(
  initialDocument: JsonObject,
  persistence?: DocumentPersistence,
): DocumentState {
  const [document, setDocument] = useState(initialDocument);
  const [currentPath, setCurrentPath] = useState<Path>([]);
  const [sha, setSha] = useState<string | null>(
    persistence?.initialSha ?? null,
  );

  const children = useMemo(() => {
    const result = listChildren(document, currentPath);
    return result.ok ? result.value : [];
  }, [document, currentPath]);

  const navigate = useCallback((path: Path) => setCurrentPath(path), []);

  /**
   * The single save path every mutator goes through. `recompute` must be
   * safe to call again against a different document — it is called once
   * against current local state, and, on a disjoint conflict, once more
   * against the freshly reloaded state.
   */
  const asDocumentResult = useCallback(
    async (
      recompute: Recompute,
      operation: Operation,
    ): Promise<Result<JsonObject, MutationError>> => {
      const first = recompute(document);
      if (!first.ok) return err({ source: "domain", error: first.error });
      if (!persistence) {
        setDocument(first.value);
        return ok(first.value);
      }
      if (sha === null) {
        throw new Error("useDocument: missing sha for a persisted document");
      }

      const saved = await persistence.repository.save(
        { document: first.value },
        sha,
        operation,
      );
      if (saved.ok) {
        setDocument(first.value);
        setSha(saved.value.sha);
        return ok(first.value);
      }
      if (saved.error.kind !== "conflict") {
        return err({ source: "persist", error: saved.error });
      }

      // Stale write — reload and decide whether to reapply or stop (design.md 7.4).
      const reloaded = await persistence.repository.loadDocument();
      if (!reloaded.ok)
        return err({ source: "persist", error: reloaded.error });

      const documentChanged = changedPaths(document, reloaded.value.document);
      const affected = affectedPaths(operation);
      const overlaps = anyPathOverlaps(affected, documentChanged);

      if (overlaps) {
        setDocument(reloaded.value.document);
        setSha(reloaded.value.sha);
        return err({ source: "conflict", documentChanged });
      }

      // Disjoint — reapply once against the fresh base (design.md 7.4's "retry once").
      const retry = recompute(reloaded.value.document);
      if (!retry.ok) {
        setDocument(reloaded.value.document);
        setSha(reloaded.value.sha);
        return err({ source: "domain", error: retry.error });
      }
      const retrySaved = await persistence.repository.save(
        { document: retry.value },
        reloaded.value.sha,
        operation,
      );
      if (!retrySaved.ok) {
        setDocument(reloaded.value.document);
        setSha(reloaded.value.sha);
        return err({ source: "persist", error: retrySaved.error });
      }
      setDocument(retry.value);
      setSha(retrySaved.value.sha);
      return ok(retry.value);
    },
    [persistence, sha, document],
  );

  const createEntry = useCallback(
    (key: string, value: JsonValue) =>
      asDocumentResult(
        (doc) => createObjectEntry(doc, currentPath, key, value),
        { kind: "create-entry", path: [...currentPath, key] },
      ),
    [asDocumentResult, currentPath],
  );

  const createElement = useCallback(
    (value: JsonValue) =>
      asDocumentResult((doc) => createArrayElement(doc, currentPath, value), {
        kind: "create-element",
        path: [...currentPath, children.length],
      }),
    [asDocumentResult, currentPath, children.length],
  );

  const rename = useCallback(
    (oldKey: string, newKey: string) =>
      asDocumentResult((doc) => renameKey(doc, currentPath, oldKey, newKey), {
        kind: "rename",
        path: [...currentPath, oldKey],
        newPath: [...currentPath, newKey],
      }),
    [asDocumentResult, currentPath],
  );

  const setValue = useCallback(
    (path: Path, value: JsonValue, confirmReplace = false) =>
      asDocumentResult(
        (doc) => setValueAtPath(doc, path, value, confirmReplace),
        { kind: "set-value", path },
      ),
    [asDocumentResult],
  );

  const reorder = useCallback(
    (fromIndex: number, toIndex: number) =>
      asDocumentResult(
        (doc) => reorderArrayElement(doc, currentPath, fromIndex, toIndex),
        { kind: "reorder", path: currentPath },
      ),
    [asDocumentResult, currentPath],
  );

  const move = useCallback(
    (fromPath: Path, toParentPath: Path, newKey?: string) =>
      asDocumentResult(
        (doc) => moveInTree(doc, fromPath, toParentPath, newKey),
        {
          kind: "move",
          path: fromPath,
          newPath: describeInsertedPath(
            document,
            toParentPath,
            newKey,
            fromPath,
          ),
        },
      ),
    [asDocumentResult, document],
  );

  const copy = useCallback(
    (fromPath: Path, toParentPath: Path, newKey?: string) =>
      asDocumentResult(
        (doc) => copyInTree(doc, fromPath, toParentPath, newKey),
        {
          kind: "copy",
          path: fromPath,
          newPath: describeInsertedPath(
            document,
            toParentPath,
            newKey,
            fromPath,
          ),
        },
      ),
    [asDocumentResult, document],
  );

  const deleteEntry = useCallback(
    (path: Path) =>
      asDocumentResult((doc) => deleteEntryInTree(doc, path), {
        kind: "delete",
        path,
      }),
    [asDocumentResult],
  );

  return {
    document,
    currentPath,
    children,
    navigate,
    createEntry,
    createElement,
    rename,
    setValue,
    move,
    copy,
    deleteEntry,
    reorder,
  };
}
