import { parseDocument, serializeDocument } from "../domain/serialize.ts";
import { EMPTY_TRASH, parseTrash, serializeTrash } from "../domain/trash.ts";
import type { TrashDocument } from "../domain/trash.ts";
import type { JsonObject } from "../domain/types.ts";
import type { Result } from "../domain/result.ts";
import { err, ok } from "../domain/result.ts";
import { describeOperation } from "./commitMessage.ts";
import type {
  LoadedDocument,
  Operation,
  Repository,
  RepositoryCheck,
} from "./repository.ts";
import type { PersistError } from "./types.ts";

export interface InMemoryRepositoryOptions {
  initialDocument?: JsonObject;
  initialTrash?: TrashDocument;
  isPrivate?: boolean;
  writable?: boolean;
  defaultBranch?: string;
}

export interface InMemoryCommit {
  message: string;
  document: JsonObject;
  trash: TrashDocument;
}

export interface InMemoryRepository extends Repository {
  commits: InMemoryCommit[];
}

/** An in-memory Repository fake for tests (design.md 4's "persistence contract tests"). */
export function createInMemoryRepository(
  options: InMemoryRepositoryOptions = {},
): InMemoryRepository {
  let document: JsonObject | null = options.initialDocument ?? null;
  let trash: TrashDocument = options.initialTrash ?? EMPTY_TRASH;
  let sha: string | null = document ? "sha-0" : null;
  let commitCount = 0;
  const commits: InMemoryCommit[] = [];

  function nextSha(): string {
    commitCount += 1;
    return `sha-${commitCount}`;
  }

  async function checkRepository(): Promise<
    Result<RepositoryCheck, PersistError>
  > {
    return ok({
      private: options.isPrivate ?? true,
      writable: options.writable ?? true,
      defaultBranch: options.defaultBranch ?? "main",
    });
  }

  async function loadDocument(): Promise<Result<LoadedDocument, PersistError>> {
    if (document === null || sha === null) return err({ kind: "not-found" });
    return ok({ document, trash, sha });
  }

  async function ensureDocument(): Promise<
    Result<LoadedDocument, PersistError>
  > {
    const existing = await loadDocument();
    if (existing.ok) return existing;
    document = {};
    sha = nextSha();
    commits.push({ message: "Initialize remember.json", document, trash });
    return ok({ document, trash, sha });
  }

  async function save(
    state: { document: JsonObject; trash: TrashDocument },
    baseSha: string,
    operation: Operation,
  ): Promise<Result<{ sha: string }, PersistError>> {
    if (sha !== baseSha) return err({ kind: "conflict" });
    const parsedDocument = parseDocument(serializeDocument(state.document));
    if (!parsedDocument.ok) return err({ kind: "malformed" });
    const parsedTrash = parseTrash(serializeTrash(state.trash));
    if (!parsedTrash.ok) return err({ kind: "malformed" });
    document = parsedDocument.value;
    trash = parsedTrash.value;
    sha = nextSha();
    commits.push({ message: describeOperation(operation), document, trash });
    return ok({ sha });
  }

  return {
    checkRepository,
    ensureDocument,
    loadDocument,
    save,
    commits,
  };
}
