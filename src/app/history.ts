import { anyPathOverlaps, changedPaths } from "../domain/diff.ts";
import { getAtPath } from "../domain/tree.ts";
import type { JsonObject, JsonValue, Path } from "../domain/types.ts";
import type { Result } from "../domain/result.ts";
import { err, ok } from "../domain/result.ts";
import type { Repository } from "../persistence/repository.ts";
import type { PersistError } from "../persistence/types.ts";

export interface HistoryRevision {
  sha: string;
  message: string;
  date: string;
  /** The value at the requested path as of this commit; `undefined` if the path didn't exist there. */
  value: JsonValue | undefined;
}

const DEFAULT_CONCURRENCY = 4;

/**
 * Finds the revisions relevant to `path` among one page of commits that
 * touched remember.json (design.md 10: "The history UI derives relevant
 * revisions by comparing the selected JSON Pointer path across commits").
 * `repository.listDocumentHistory` already narrows to commits that changed
 * remember.json's content at all; this narrows further to ones where
 * `path` specifically changed, by fetching each candidate commit's document
 * (design.md 11's "fetch historical versions lazily") with bounded
 * concurrency (design.md 11's "bound concurrent GitHub calls to avoid
 * rate-limit bursts") and diffing each against its immediate predecessor in
 * the page. The oldest commit in a page has no fetched predecessor to
 * compare against, so it is conservatively always reported as relevant —
 * the true boundary may lie on an earlier page; call again with a higher
 * `page` to look further back.
 */
export async function findRelevantRevisions(
  repository: Repository,
  path: Path,
  options: { page?: number; concurrency?: number } = {},
): Promise<Result<HistoryRevision[], PersistError>> {
  const commitsResult = await repository.listDocumentHistory(options.page ?? 1);
  if (!commitsResult.ok) return commitsResult;
  const commits = commitsResult.value;
  if (commits.length === 0) return ok([]);

  const documents = new Array<JsonObject | undefined>(commits.length);
  let firstError: PersistError | undefined;

  async function worker(startIndex: number): Promise<void> {
    for (
      let index = startIndex;
      index < commits.length;
      index += DEFAULT_CONCURRENCY
    ) {
      if (firstError) return;
      const result = await repository.loadDocumentAt(commits[index]!.sha);
      if (!result.ok) {
        firstError = result.error;
        return;
      }
      documents[index] = result.value;
    }
  }

  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, commits.length),
  );
  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
  if (firstError) return err(firstError);

  const revisions: HistoryRevision[] = [];
  for (let index = 0; index < commits.length; index++) {
    const after = documents[index]!;
    const before = documents[index + 1];
    const relevant =
      before === undefined ||
      anyPathOverlaps([path], changedPaths(before, after));
    if (!relevant) continue;
    revisions.push({
      sha: commits[index]!.sha,
      message: commits[index]!.message,
      date: commits[index]!.date,
      value: getAtPath(after, path),
    });
  }
  return ok(revisions);
}
