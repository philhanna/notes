// Phase 2 live check (impl.md): exercises the real src/auth and
// src/persistence adapters — not a reimplementation of their logic —
// against the real deployed relay and the real philhanna/notes-data
// repository. Confirms checkRepository, loadDocument, a conditional
// saveDocument, and a rejected stale-sha saveDocument all work end to end,
// per impl.md's rule not to treat GitHub integration claims as verified by
// reasoning alone. Throwaway script, not application code. Uses the
// still-valid refresh token from spike 1 instead of a fresh interactive
// device-flow approval. Run:
//   node --experimental-strip-types spikes/05-phase2-live-check.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { refreshAccessToken } from "../src/auth/deviceFlow.ts";
import { createGithubRepository } from "../src/persistence/githubRepository.ts";
import type { RepoConfig } from "../src/auth/repoConfig.ts";

const REPO = process.env.SPIKE_REPO ?? "philhanna/notes-data";
const [owner, repo] = REPO.split("/");

async function main() {
  const stored = JSON.parse(
    await readFile(new URL("./.local/token.json", import.meta.url), "utf8"),
  );
  const refreshed = await refreshAccessToken(stored.refresh_token);
  if (!refreshed.ok) {
    throw new Error(`refresh failed: ${JSON.stringify(refreshed.error)}`);
  }
  const accessToken = refreshed.value.accessToken;
  const getAccessToken = async () => ({
    ok: true as const,
    value: accessToken,
  });
  console.log("Refreshed access token via the deployed relay: OK");

  const probe = createGithubRepository(
    { owner, repo, branch: "" },
    getAccessToken,
  );
  const check = await probe.checkRepository();
  if (!check.ok)
    throw new Error(`checkRepository failed: ${JSON.stringify(check.error)}`);
  console.log("checkRepository:", check.value);

  const config: RepoConfig = { owner, repo, branch: check.value.defaultBranch };
  const repository = createGithubRepository(config, getAccessToken);

  const loaded = await repository.ensureDocument();
  if (!loaded.ok)
    throw new Error(
      `ensureDocument/loadDocument failed: ${JSON.stringify(loaded.error)}`,
    );
  const originalDocument = loaded.value.document;
  console.log(
    "loadDocument: OK, top-level keys:",
    Object.keys(originalDocument),
  );

  const marker = `phase2-live-check-${Date.now()}`;
  const withMarker = { ...originalDocument, _phase2LiveCheck: marker };
  const saved = await repository.saveDocument(withMarker, loaded.value.sha, {
    kind: "set-value",
    path: ["_phase2LiveCheck"],
  });
  if (!saved.ok)
    throw new Error(`saveDocument failed: ${JSON.stringify(saved.error)}`);
  console.log("saveDocument (fresh sha): OK, new sha", saved.value.sha);

  const staleSave = await repository.saveDocument(
    withMarker,
    loaded.value.sha,
    {
      kind: "set-value",
      path: ["_phase2LiveCheck"],
    },
  );
  console.log(
    "saveDocument (stale sha) status:",
    staleSave.ok ? "UNEXPECTED OK" : staleSave.error.kind,
  );

  const restored = await repository.saveDocument(
    originalDocument,
    saved.value.sha,
    { kind: "set-value", path: ["_phase2LiveCheck"] },
  );
  if (!restored.ok) {
    throw new Error(`restore failed: ${JSON.stringify(restored.error)}`);
  }
  console.log("Restored original document: OK, sha", restored.value.sha);

  const fixture = {
    repo: REPO,
    checkRepository: check.value,
    loadDocumentKeys: Object.keys(originalDocument),
    saveDocumentFreshSha: { ok: true, newSha: saved.value.sha },
    saveDocumentStaleSha: staleSave.ok
      ? { ok: true }
      : { ok: false, errorKind: staleSave.error.kind },
    restoredSha: restored.value.sha,
    conclusion:
      !staleSave.ok && staleSave.error.kind === "conflict"
        ? "Phase 2 persistence adapter verified live against philhanna/notes-data"
        : "UNEXPECTED — review manually",
  };
  await mkdir(new URL("./fixtures/", import.meta.url), { recursive: true });
  await writeFile(
    new URL("./fixtures/05-phase2-live-check.json", import.meta.url),
    JSON.stringify(fixture, null, 2) + "\n",
  );
  console.log("\nConclusion:", fixture.conclusion);
  console.log("Fixture written to spikes/fixtures/05-phase2-live-check.json");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
