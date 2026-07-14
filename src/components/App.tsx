import { useEffect, useState } from "react";
import { loadRepoConfig } from "../auth/repoConfig.ts";
import type { RepoConfig } from "../auth/repoConfig.ts";
import { useAuth } from "../auth/useAuth.ts";
import { useDocument } from "../app/useDocument.ts";
import { useOnlineStatus } from "../app/useOnlineStatus.ts";
import type { JsonObject } from "../domain/types.ts";
import type { TrashDocument } from "../domain/trash.ts";
import {
  activateWaitingServiceWorker,
  registerServiceWorker,
} from "../pwa/registerServiceWorker.ts";
import { createGithubRepository } from "../persistence/githubRepository.ts";
import type { Repository } from "../persistence/repository.ts";
import { describePersistError } from "./errors.ts";
import { ExportButton } from "./ExportButton.tsx";
import { SearchView } from "./SearchView.tsx";
import { SignIn } from "./SignIn.tsx";
import { Setup } from "./Setup.tsx";
import { TreeBrowser } from "./TreeBrowser.tsx";
import { TrashView } from "./TrashView.tsx";

type LoadState =
  | { phase: "idle" }
  | { phase: "setup" }
  | { phase: "loading" }
  | {
      phase: "ready";
      config: RepoConfig;
      repository: Repository;
      document: JsonObject;
      trash: TrashDocument;
      sha: string;
    }
  | { phase: "error"; message: string };

/**
 * Phase 2 (impl.md): sign in, connect the dedicated repository, then browse
 * and edit it against GitHub. Phase 1's local fixture-data browser is
 * superseded by this — see useDocument.ts for how the same tree operations
 * now persist through a Repository.
 */
export function App() {
  const auth = useAuth();
  const [state, setState] = useState<LoadState>({ phase: "idle" });
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const isOnline = useOnlineStatus();

  useEffect(() => {
    registerServiceWorker(() => setUpdateAvailable(true));
  }, []);

  useEffect(() => {
    if (auth.status !== "signed-in") {
      setState({ phase: "idle" });
      return;
    }
    const config = loadRepoConfig();
    if (!config) {
      setState({ phase: "setup" });
      return;
    }
    setState({ phase: "loading" });
    let cancelled = false;
    const repository = createGithubRepository(config, auth.getAccessToken);
    void repository.loadDocument().then((result) => {
      // React 19 StrictMode double-invokes effects in development, which
      // would otherwise fire this loadDocument twice and let whichever
      // call resolves second clobber state with a possibly stale result.
      if (cancelled) return;
      if (!result.ok) {
        setState({
          phase: "error",
          message: describePersistError(result.error),
        });
        return;
      }
      setState({
        phase: "ready",
        config,
        repository,
        document: result.value.document,
        trash: result.value.trash,
        sha: result.value.sha,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [auth.status, auth.getAccessToken]);

  let body;
  if (auth.status !== "signed-in") {
    body = <SignIn auth={auth} />;
  } else if (state.phase === "setup") {
    body = (
      <Setup
        auth={auth}
        onReady={(config, loaded) => {
          setState({
            phase: "ready",
            config,
            repository: createGithubRepository(config, auth.getAccessToken),
            document: loaded.document,
            trash: loaded.trash,
            sha: loaded.sha,
          });
        }}
      />
    );
  } else if (state.phase === "error") {
    body = (
      <>
        <p role="alert">{state.message}</p>
        <button type="button" onClick={auth.signOut}>
          Sign out
        </button>
      </>
    );
  } else if (state.phase !== "ready") {
    body = <p>Loading…</p>;
  } else {
    body = (
      <ReadyApp
        key={`${state.config.owner}/${state.config.repo}`}
        state={state}
        onSignOut={auth.signOut}
      />
    );
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <main id="main-content">
        <header className="app-header">
          <img
            className="app-header__icon"
            src={`${import.meta.env.BASE_URL}nature-herb.png`}
            alt=""
            width="60"
            height="60"
          />
          <h1>Notes</h1>
        </header>
        {!isOnline && (
          <p className="status-banner status-banner--offline" role="status">
            You&rsquo;re offline. Sign-in and saving need an internet
            connection.
          </p>
        )}
        {updateAvailable && (
          <p className="status-banner status-banner--update" role="status">
            An update is available.{" "}
            <button type="button" onClick={activateWaitingServiceWorker}>
              Reload
            </button>
          </p>
        )}
        {body}
      </main>
    </>
  );
}

function ReadyApp({
  state,
  onSignOut,
}: {
  state: Extract<LoadState, { phase: "ready" }>;
  onSignOut: () => void;
}) {
  const documentState = useDocument(state.document, {
    repository: state.repository,
    initialSha: state.sha,
    initialTrash: state.trash,
  });
  const [view, setView] = useState<"tree" | "trash" | "search">("tree");
  return (
    <>
      <nav className="app-actions" aria-label="Note actions">
        <button type="button" onClick={onSignOut}>
          Sign out
        </button>
        {view !== "search" && (
          <button type="button" onClick={() => setView("search")}>
            Search
          </button>
        )}
        {view !== "trash" && (
          <button type="button" onClick={() => setView("trash")}>
            Trash ({documentState.trash.records.length})
          </button>
        )}
        <ExportButton document={documentState.document} />
      </nav>
      {view === "trash" && (
        <TrashView
          document={documentState.document}
          trash={documentState.trash}
          recover={documentState.recover}
          permanentlyDeleteTrash={documentState.permanentlyDeleteTrash}
          emptyTrash={documentState.emptyTrash}
          onClose={() => setView("tree")}
        />
      )}
      {view === "search" && (
        <SearchView
          document={documentState.document}
          onNavigate={documentState.navigate}
          onClose={() => setView("tree")}
        />
      )}
      {view === "tree" && <TreeBrowser state={documentState} />}
    </>
  );
}
