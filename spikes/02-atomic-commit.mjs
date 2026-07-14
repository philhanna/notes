// Phase 0 spike 2 (impl.md): prove remember.json and .trash/trash.json can be
// written together as one atomic commit via the Git Data API, then
// conditionally advance the branch ref. Throwaway script, not application code.
// Run: node spikes/02-atomic-commit.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { gh, loadToken, REPO } from "./lib.mjs";

async function main() {
  const token = await loadToken();

  const repo = await gh(token, `/repos/${REPO}`);
  if (!repo.ok) throw new Error(`repo lookup failed: ${JSON.stringify(repo)}`);
  const branch = repo.body.default_branch;

  const ref = await gh(token, `/repos/${REPO}/git/ref/heads/${branch}`);
  if (!ref.ok) throw new Error(`ref lookup failed: ${JSON.stringify(ref)}`);
  const baseCommitSha = ref.body.object.sha;

  const baseCommit = await gh(
    token,
    `/repos/${REPO}/git/commits/${baseCommitSha}`,
  );
  const baseTreeSha = baseCommit.body.tree.sha;

  const rememberBlob = await gh(token, `/repos/${REPO}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({
      content:
        JSON.stringify(
          { spike: "phase-0", at: new Date().toISOString() },
          null,
          2,
        ) + "\n",
      encoding: "utf-8",
    }),
  });
  const trashBlob = await gh(token, `/repos/${REPO}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({
      content: JSON.stringify({ version: 1, records: [] }, null, 2) + "\n",
      encoding: "utf-8",
    }),
  });

  const tree = await gh(token, `/repos/${REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: [
        {
          path: "remember.json",
          mode: "100644",
          type: "blob",
          sha: rememberBlob.body.sha,
        },
        {
          path: ".trash/trash.json",
          mode: "100644",
          type: "blob",
          sha: trashBlob.body.sha,
        },
      ],
    }),
  });
  if (!tree.ok) throw new Error(`tree create failed: ${JSON.stringify(tree)}`);

  const commit = await gh(token, `/repos/${REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: "Spike 2: atomic multi-file commit",
      tree: tree.body.sha,
      parents: [baseCommitSha],
    }),
  });
  if (!commit.ok)
    throw new Error(`commit create failed: ${JSON.stringify(commit)}`);

  const refUpdate = await gh(token, `/repos/${REPO}/git/refs/heads/${branch}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.body.sha, force: false }),
  });

  console.log(
    "Ref update status:",
    refUpdate.status,
    refUpdate.ok ? "OK" : "FAILED",
  );
  console.log("New commit:", commit.body.sha);

  const finalTree = await gh(
    token,
    `/repos/${REPO}/git/trees/${commit.body.sha}?recursive=1`,
  );
  const paths = finalTree.body.tree.map((entry) => entry.path).sort();
  console.log("Files present in resulting commit:", paths);

  const fixture = {
    branch,
    baseCommitSha,
    newTreeSha: tree.body.sha,
    newCommitSha: commit.body.sha,
    refUpdateStatus: refUpdate.status,
    filesInCommit: paths,
  };
  await mkdir(new URL("./fixtures/", import.meta.url), { recursive: true });
  await writeFile(
    new URL("./fixtures/02-atomic-commit.json", import.meta.url),
    JSON.stringify(fixture, null, 2) + "\n",
  );
  console.log("Fixture written to spikes/fixtures/02-atomic-commit.json");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
