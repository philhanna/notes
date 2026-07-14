// Phase 0 spike 3 (impl.md): prove a stale writer cannot advance the ref, and
// that this conflict is distinguishable from a network/authorization failure.
// Throwaway script, not application code. Run: node spikes/03-stale-writer.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { gh, loadToken, REPO } from "./lib.mjs";

async function buildCommitOnTopOf(token, branch, baseCommitSha, content) {
  const baseCommit = await gh(
    token,
    `/repos/${REPO}/git/commits/${baseCommitSha}`,
  );
  const blob = await gh(token, `/repos/${REPO}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content, encoding: "utf-8" }),
  });
  const tree = await gh(token, `/repos/${REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: baseCommit.body.tree.sha,
      tree: [
        {
          path: "remember.json",
          mode: "100644",
          type: "blob",
          sha: blob.body.sha,
        },
      ],
    }),
  });
  const commit = await gh(token, `/repos/${REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: "Spike 3: candidate write",
      tree: tree.body.sha,
      parents: [baseCommitSha],
    }),
  });
  return commit.body.sha;
}

async function main() {
  const token = await loadToken();

  const repo = await gh(token, `/repos/${REPO}`);
  const branch = repo.body.default_branch;

  const ref = await gh(token, `/repos/${REPO}/git/ref/heads/${branch}`);
  const baseCommitSha = ref.body.object.sha;
  console.log("Base commit (both writers start here):", baseCommitSha);

  const writerACommitSha = await buildCommitOnTopOf(
    token,
    branch,
    baseCommitSha,
    JSON.stringify({ writer: "A", at: new Date().toISOString() }, null, 2) +
      "\n",
  );
  const writerBCommitSha = await buildCommitOnTopOf(
    token,
    branch,
    baseCommitSha,
    JSON.stringify({ writer: "B", at: new Date().toISOString() }, null, 2) +
      "\n",
  );

  const writerAUpdate = await gh(
    token,
    `/repos/${REPO}/git/refs/heads/${branch}`,
    {
      method: "PATCH",
      body: JSON.stringify({ sha: writerACommitSha, force: false }),
    },
  );
  console.log(
    "Writer A (first, based on current head):",
    writerAUpdate.status,
    writerAUpdate.ok ? "OK" : "FAILED",
  );

  const writerBUpdate = await gh(
    token,
    `/repos/${REPO}/git/refs/heads/${branch}`,
    {
      method: "PATCH",
      body: JSON.stringify({ sha: writerBCommitSha, force: false }),
    },
  );
  console.log(
    "Writer B (stale, same base as A):",
    writerBUpdate.status,
    writerBUpdate.ok ? "OK" : "FAILED",
  );
  console.log("Writer B response body:", JSON.stringify(writerBUpdate.body));

  // For comparison: an auth failure, so the conflict shape above can be told
  // apart from a network/authorization failure shape.
  const authFailure = await gh(
    "not-a-real-token",
    `/repos/${REPO}/git/refs/heads/${branch}`,
    {
      method: "PATCH",
      body: JSON.stringify({ sha: writerBCommitSha, force: false }),
    },
  );
  console.log(
    "Simulated bad-auth request:",
    authFailure.status,
    JSON.stringify(authFailure.body),
  );

  const fixture = {
    branch,
    baseCommitSha,
    writerA: {
      commitSha: writerACommitSha,
      refUpdateStatus: writerAUpdate.status,
    },
    writerB: {
      commitSha: writerBCommitSha,
      refUpdateStatus: writerBUpdate.status,
      refUpdateMessage: writerBUpdate.body?.message,
    },
    authFailureStatus: authFailure.status,
    authFailureMessage: authFailure.body?.message,
    conclusion:
      writerAUpdate.ok &&
      !writerBUpdate.ok &&
      writerBUpdate.status !== authFailure.status
        ? "stale write rejected distinctly from auth failure"
        : "UNEXPECTED — review manually",
  };
  await mkdir(new URL("./fixtures/", import.meta.url), { recursive: true });
  await writeFile(
    new URL("./fixtures/03-stale-writer.json", import.meta.url),
    JSON.stringify(fixture, null, 2) + "\n",
  );
  console.log("\nConclusion:", fixture.conclusion);
  console.log("Fixture written to spikes/fixtures/03-stale-writer.json");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
