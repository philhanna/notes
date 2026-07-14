import { useState } from "react";
import type { FormEvent } from "react";
import type { RepoConfig } from "../auth/repoConfig.ts";
import { saveRepoConfig } from "../auth/repoConfig.ts";
import type { AuthState } from "../auth/useAuth.ts";
import { createGithubRepository } from "../persistence/githubRepository.ts";
import type { LoadedDocument } from "../persistence/repository.ts";
import { describePersistError } from "./errors.ts";

interface SetupProps {
  auth: AuthState;
  onReady: (config: RepoConfig, loaded: LoadedDocument) => void;
}

/**
 * Connects the dedicated repository (design.md 9.1): confirms it is private
 * and writable, discovers its default branch, and creates remember.json
 * only when absent. Never creates a repository or changes its visibility.
 */
export function Setup({ auth, onReady }: SetupProps) {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setChecking(true);
    setError(null);

    const probe = createGithubRepository(
      { owner, repo, branch: "" },
      auth.getAccessToken,
    );
    const check = await probe.checkRepository();
    if (!check.ok) {
      setChecking(false);
      setError(describePersistError(check.error));
      return;
    }
    if (!check.value.private) {
      setChecking(false);
      setError("This repository must be private.");
      return;
    }
    if (!check.value.writable) {
      setChecking(false);
      setError(
        "This repository is not writable with the current authorization.",
      );
      return;
    }

    const config: RepoConfig = {
      owner,
      repo,
      branch: check.value.defaultBranch,
    };
    const repository = createGithubRepository(config, auth.getAccessToken);
    const loaded = await repository.ensureDocument();
    setChecking(false);
    if (!loaded.ok) {
      setError(describePersistError(loaded.error));
      return;
    }

    saveRepoConfig(config);
    onReady(config, loaded.value);
  }

  return (
    <form className="setup" onSubmit={(event) => void handleSubmit(event)}>
      <h2>Connect your notes repository</h2>
      <div className="setup__field">
        <label htmlFor="setup-owner">Owner</label>
        <input
          id="setup-owner"
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
          required
        />
      </div>
      <div className="setup__field">
        <label htmlFor="setup-repo">Repository</label>
        <input
          id="setup-repo"
          value={repo}
          onChange={(event) => setRepo(event.target.value)}
          required
        />
      </div>
      <button className="setup__submit" type="submit" disabled={checking}>
        {checking ? "Checking…" : "Connect"}
      </button>
      {error && (
        <p className="child-row__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
