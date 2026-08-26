import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { loadRepoConfig } from "../auth/repoConfig.ts";
import type { RepoConfig } from "../auth/repoConfig.ts";
import { useAuth } from "../auth/useAuth.ts";
import {
  clearShortcuts,
  loadPinned,
  loadRecent,
  savePinned,
  saveRecent,
} from "../app/shortcutsStorage.ts";
import { useDocument } from "../app/useDocument.ts";
import { useOnlineStatus } from "../app/useOnlineStatus.ts";
import type { JsonObject } from "../domain/types.ts";
import type { Path } from "../domain/types.ts";
import {
  activateWaitingServiceWorker,
  registerServiceWorker,
} from "../pwa/registerServiceWorker.ts";
import { createGithubRepository } from "../persistence/githubRepository.ts";
import type { Repository } from "../persistence/repository.ts";
import { describePersistError } from "./errors.ts";
import { SearchIcon, SignOutIcon, StarIcon } from "./icons.tsx";
import { SearchView } from "./SearchView.tsx";
import { ShortcutsView } from "./ShortcutsView.tsx";
import { SignIn } from "./SignIn.tsx";
import { Setup } from "./Setup.tsx";
import { TreeBrowser } from "./TreeBrowser.tsx";

const TREE_EXPANSION_KEY = "notes/tree-expanded";

type LoadState =
  | { phase: "idle" }
  | { phase: "setup" }
  | { phase: "loading" }
  | {
      phase: "ready";
      config: RepoConfig;
      repository: Repository;
      document: JsonObject;
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
  const [retryCount, setRetryCount] = useState(0);
  const [headerActions, setHeaderActions] = useState<HTMLElement | null>(null);
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
        sha: result.value.sha,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [auth.status, auth.getAccessToken, retryCount]);

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
            sha: loaded.sha,
          });
        }}
      />
    );
  } else if (state.phase === "error") {
    body = (
      <>
        <p role="alert">{state.message}</p>
        <button type="button" onClick={() => setRetryCount((n) => n + 1)}>
          Retry
        </button>
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
        actionsContainer={headerActions}
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
          <h1>My Notes</h1>
          <nav
            className="app-actions"
            aria-label="Note actions"
            ref={setHeaderActions}
          />
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
  actionsContainer,
}: {
  state: Extract<LoadState, { phase: "ready" }>;
  onSignOut: () => void;
  actionsContainer: HTMLElement | null;
}) {
  const documentState = useDocument(state.document, {
    repository: state.repository,
    initialSha: state.sha,
  });
  const [view, setView] = useState<"tree" | "search" | "shortcuts">("tree");
  const [expandedPaths, setExpandedPaths] =
    useState<Set<string>>(loadExpandedPaths);
  const [selectedPath, setSelectedPath] = useState<Path>([]);
  const [focusedPath, setFocusedPath] = useState<Path>([]);
  const [revealPath, setRevealPath] = useState<Path | null>(null);
  const [pinnedPaths, setPinnedPaths] = useState<Set<string>>(loadPinned);
  const [recentPaths, setRecentPaths] = useState<Set<string>>(loadRecent);

  useEffect(() => {
    localStorage.setItem(
      TREE_EXPANSION_KEY,
      JSON.stringify([...expandedPaths]),
    );
  }, [expandedPaths]);

  useEffect(() => {
    savePinned(pinnedPaths);
  }, [pinnedPaths]);

  useEffect(() => {
    saveRecent(recentPaths);
  }, [recentPaths]);

  function signOut() {
    localStorage.removeItem(TREE_EXPANSION_KEY);
    clearShortcuts();
    onSignOut();
  }

  function unpin(pointer: string) {
    setPinnedPaths((previous) => {
      const next = new Set(previous);
      next.delete(pointer);
      return next;
    });
  }

  return (
    <>
      {view === "search" && (
        <SearchView
          document={documentState.document}
          onSelectPath={(path) => setRevealPath(path)}
          onClose={() => setView("tree")}
        />
      )}
      {view === "shortcuts" && (
        <ShortcutsView
          document={documentState.document}
          pinnedPaths={pinnedPaths}
          recentPaths={recentPaths}
          onSelectPath={(path) => setRevealPath(path)}
          onUnpin={unpin}
          onClose={() => setView("tree")}
        />
      )}
      {view === "tree" && (
        <TreeBrowser
          state={documentState}
          treeState={{
            expandedPaths,
            selectedPath,
            focusedPath,
            pinnedPaths,
            recentPaths,
            setExpandedPaths,
            setSelectedPath,
            setFocusedPath,
            setPinnedPaths,
            setRecentPaths,
          }}
          revealPath={revealPath}
          onRevealHandled={() => setRevealPath(null)}
        />
      )}
      {actionsContainer &&
        createPortal(
          <>
            {view === "tree" && (
              <>
                <button
                  type="button"
                  className="app-actions__button"
                  title="Search"
                  onClick={() => setView("search")}
                >
                  <SearchIcon />
                  <span className="visually-hidden">Search</span>
                </button>
                <button
                  type="button"
                  className="app-actions__button"
                  title="Pinned & recent"
                  onClick={() => setView("shortcuts")}
                >
                  <StarIcon />
                  <span className="visually-hidden">Pinned &amp; recent</span>
                </button>
              </>
            )}
            <button
              type="button"
              className="app-actions__button"
              title="Sign out"
              onClick={signOut}
            >
              <SignOutIcon />
              <span className="visually-hidden">Sign out</span>
            </button>
          </>,
          actionsContainer,
        )}
    </>
  );
}

function loadExpandedPaths(): Set<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(TREE_EXPANSION_KEY) ?? "[]");
    if (!Array.isArray(stored)) return new Set([""]);
    const pointers = stored.filter(
      (value): value is string => typeof value === "string",
    );
    return new Set(pointers.length === 0 ? [""] : pointers);
  } catch {
    return new Set([""]);
  }
}
