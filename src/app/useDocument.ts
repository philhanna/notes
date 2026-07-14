import { useCallback, useMemo, useState } from "react";
import type { ChildEntry, TreeError } from "../domain/tree.ts";
import {
  copy as copyInTree,
  createArrayElement,
  createObjectEntry,
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
import type { TrashDocument, TrashRecord } from "../domain/trash.ts";
import {
  changedTrashIds,
  deleteToTrash,
  EMPTY_TRASH,
  emptyTrash as emptyTrashDomain,
  permanentlyDelete,
  recoverFromTrash,
} from "../domain/trash.ts";
import { decodePointerSegments } from "../domain/path.ts";
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
 * `document`/`trash` local state has already been refreshed to the latest
 * saved revision by the time this is returned, so a plain retry of the
 * same mutator call now operates against current data.
 */
export type MutationError =
  | { source: "domain"; error: TreeError }
  | { source: "persist"; error: PersistError }
  | { source: "conflict"; documentChanged: Path[]; trashChanged: string[] };

export interface DocumentPersistence {
  repository: Repository;
  /** The `sha` `initialDocument` was loaded at. */
  initialSha: string;
  /** The trash `initialDocument` was loaded alongside. Defaults to empty for a brand-new document. */
  initialTrash?: TrashDocument;
}

export interface DocumentState {
  document: JsonObject;
  trash: TrashDocument;
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
  recover: (
    trashId: string,
    destination?: { parentPath: Path; key?: string },
  ) => Promise<Result<JsonObject, MutationError>>;
  permanentlyDeleteTrash: (
    trashId: string,
  ) => Promise<Result<TrashDocument, MutationError>>;
  emptyTrash: () => Promise<Result<TrashDocument, MutationError>>;
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

type DocAndTrash = { document: JsonObject; trash: TrashDocument };
/** Recomputes an operation's result against a given document/trash pair, so it can be reapplied against a freshly reloaded base (Phase 4). */
type Recompute = (
  document: JsonObject,
  trash: TrashDocument,
) => Result<DocAndTrash, TreeError>;

/**
 * Holds a document and the currently browsed path in local component state
 * and applies domain operations at that path (Phase 1 of impl.md). When
 * `persistence` is supplied (Phase 2), each successful operation is also
 * committed through its `Repository` before local state is updated, so a
 * failed write leaves both the displayed document and the caller's pending
 * input untouched (design.md 9, 13). Without `persistence`, mutators still
 * return a Promise, resolved in the same microtask against local state only.
 *
 * On a stale-`sha` conflict (design.md 7.4, Phase 4), `commitCore` reloads
 * the latest revision, compares the operation's affected paths against what
 * actually changed since `sha`, and either reapplies the operation once
 * against the fresh base (disjoint changes) or reports a `"conflict"`
 * `MutationError` with local state already refreshed (overlapping changes) —
 * see `commitCore` below.
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
  const [trash, setTrash] = useState<TrashDocument>(
    persistence?.initialTrash ?? EMPTY_TRASH,
  );

  const children = useMemo(() => {
    const result = listChildren(document, currentPath);
    return result.ok ? result.value : [];
  }, [document, currentPath]);

  const navigate = useCallback((path: Path) => setCurrentPath(path), []);

  /**
   * The single save path every mutator goes through. `recompute` must be
   * safe to call again against a different (document, trash) pair — it is
   * called once against current local state, and, on a disjoint conflict,
   * once more against the freshly reloaded state.
   */
  const commitCore = useCallback(
    async (
      recompute: Recompute,
      operation: Operation,
    ): Promise<Result<DocAndTrash, MutationError>> => {
      const first = recompute(document, trash);
      if (!first.ok) return err({ source: "domain", error: first.error });
      if (!persistence) {
        setDocument(first.value.document);
        setTrash(first.value.trash);
        return ok(first.value);
      }
      if (sha === null) {
        throw new Error("useDocument: missing sha for a persisted document");
      }

      const saved = await persistence.repository.save(
        first.value,
        sha,
        operation,
      );
      if (saved.ok) {
        setDocument(first.value.document);
        setTrash(first.value.trash);
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
      const trashChanged = changedTrashIds(trash, reloaded.value.trash);
      const affected = affectedPaths(operation);
      const overlaps =
        anyPathOverlaps(affected.document, documentChanged) ||
        (affected.trash === "all"
          ? trashChanged.length > 0
          : affected.trash.some((id) => trashChanged.includes(id)));

      if (overlaps) {
        setDocument(reloaded.value.document);
        setTrash(reloaded.value.trash);
        setSha(reloaded.value.sha);
        return err({ source: "conflict", documentChanged, trashChanged });
      }

      // Disjoint — reapply once against the fresh base (design.md 7.4's "retry once").
      const retry = recompute(reloaded.value.document, reloaded.value.trash);
      if (!retry.ok) {
        setDocument(reloaded.value.document);
        setTrash(reloaded.value.trash);
        setSha(reloaded.value.sha);
        return err({ source: "domain", error: retry.error });
      }
      const retrySaved = await persistence.repository.save(
        retry.value,
        reloaded.value.sha,
        operation,
      );
      if (!retrySaved.ok) {
        setDocument(reloaded.value.document);
        setTrash(reloaded.value.trash);
        setSha(reloaded.value.sha);
        return err({ source: "persist", error: retrySaved.error });
      }
      setDocument(retry.value.document);
      setTrash(retry.value.trash);
      setSha(retrySaved.value.sha);
      return ok(retry.value);
    },
    [persistence, sha, document, trash],
  );

  const asDocumentResult = useCallback(
    async (
      recompute: Recompute,
      operation: Operation,
    ): Promise<Result<JsonObject, MutationError>> => {
      const result = await commitCore(recompute, operation);
      return result.ok ? ok(result.value.document) : result;
    },
    [commitCore],
  );

  const asTrashResult = useCallback(
    async (
      recompute: Recompute,
      operation: Operation,
    ): Promise<Result<TrashDocument, MutationError>> => {
      const result = await commitCore(recompute, operation);
      return result.ok ? ok(result.value.trash) : result;
    },
    [commitCore],
  );

  const createEntry = useCallback(
    (key: string, value: JsonValue) =>
      asDocumentResult(
        (doc, tr) => {
          const result = createObjectEntry(doc, currentPath, key, value);
          return result.ok ? ok({ document: result.value, trash: tr }) : result;
        },
        { kind: "create-entry", path: [...currentPath, key] },
      ),
    [asDocumentResult, currentPath],
  );

  const createElement = useCallback(
    (value: JsonValue) =>
      asDocumentResult(
        (doc, tr) => {
          const result = createArrayElement(doc, currentPath, value);
          return result.ok ? ok({ document: result.value, trash: tr }) : result;
        },
        { kind: "create-element", path: [...currentPath, children.length] },
      ),
    [asDocumentResult, currentPath, children.length],
  );

  const rename = useCallback(
    (oldKey: string, newKey: string) =>
      asDocumentResult(
        (doc, tr) => {
          const result = renameKey(doc, currentPath, oldKey, newKey);
          return result.ok ? ok({ document: result.value, trash: tr }) : result;
        },
        {
          kind: "rename",
          path: [...currentPath, oldKey],
          newPath: [...currentPath, newKey],
        },
      ),
    [asDocumentResult, currentPath],
  );

  const setValue = useCallback(
    (path: Path, value: JsonValue, confirmReplace = false) =>
      asDocumentResult(
        (doc, tr) => {
          const result = setValueAtPath(doc, path, value, confirmReplace);
          return result.ok ? ok({ document: result.value, trash: tr }) : result;
        },
        { kind: "set-value", path },
      ),
    [asDocumentResult],
  );

  const reorder = useCallback(
    (fromIndex: number, toIndex: number) =>
      asDocumentResult(
        (doc, tr) => {
          const result = reorderArrayElement(
            doc,
            currentPath,
            fromIndex,
            toIndex,
          );
          return result.ok ? ok({ document: result.value, trash: tr }) : result;
        },
        { kind: "reorder", path: currentPath },
      ),
    [asDocumentResult, currentPath],
  );

  const move = useCallback(
    (fromPath: Path, toParentPath: Path, newKey?: string) =>
      asDocumentResult(
        (doc, tr) => {
          const result = moveInTree(doc, fromPath, toParentPath, newKey);
          return result.ok ? ok({ document: result.value, trash: tr }) : result;
        },
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
        (doc, tr) => {
          const result = copyInTree(doc, fromPath, toParentPath, newKey);
          return result.ok ? ok({ document: result.value, trash: tr }) : result;
        },
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
    (path: Path) => {
      const record = {
        id: crypto.randomUUID(),
        deletedAt: new Date().toISOString(),
      };
      return asDocumentResult(
        (doc, tr) => deleteToTrash(doc, tr, path, record),
        { kind: "delete", path },
      );
    },
    [asDocumentResult],
  );

  const recover = useCallback(
    (trashId: string, destination?: { parentPath: Path; key?: string }) => {
      const record: TrashRecord | undefined = trash.records.find(
        (candidate) => candidate.id === trashId,
      );
      const path = record ? decodePointerSegments(record.originalPath) : [];
      return asDocumentResult(
        (doc, tr) => recoverFromTrash(doc, tr, trashId, destination),
        { kind: "recover", path, trashId },
      );
    },
    [asDocumentResult, trash],
  );

  const permanentlyDeleteTrash = useCallback(
    (trashId: string) => {
      const record = trash.records.find(
        (candidate) => candidate.id === trashId,
      );
      const path = record ? decodePointerSegments(record.originalPath) : [];
      return asTrashResult(
        (doc, tr) => {
          const result = permanentlyDelete(tr, trashId);
          return result.ok
            ? ok({ document: doc, trash: result.value })
            : result;
        },
        { kind: "permanent-delete", path, trashId },
      );
    },
    [asTrashResult, trash],
  );

  const emptyTrashMutator = useCallback(
    () =>
      asTrashResult(
        (doc, tr) => ok({ document: doc, trash: emptyTrashDomain(tr) }),
        { kind: "empty-trash" },
      ),
    [asTrashResult],
  );

  return {
    document,
    trash,
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
    recover,
    permanentlyDeleteTrash,
    emptyTrash: emptyTrashMutator,
    reorder,
  };
}
