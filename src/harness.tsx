import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { useDocument } from "./app/useDocument.ts";
import { createInMemoryRepository } from "./persistence/inMemoryRepository.ts";
import { ExportButton } from "./components/ExportButton.tsx";
import { SearchView } from "./components/SearchView.tsx";
import { TreeBrowser } from "./components/TreeBrowser.tsx";
import { TrashView } from "./components/TrashView.tsx";
import "./index.css";

/**
 * A dev/test-only entry point that mounts the real tree/trash/search UI
 * against an in-memory repository (the same fake the persistence contract
 * tests use) instead of a real GitHub sign-in. Playwright's e2e suite
 * (e2e/harness.spec.ts) uses this to exercise keyboard operation, focus
 * management, and accessibility in a real browser without live GitHub
 * credentials — the same "test everything without live GitHub" pattern the
 * rest of the codebase already relies on. Never referenced by
 * `npm run build`/`index.html`, so it never ships in the deployed bundle.
 */
const FIXTURE_DOCUMENT = {
  hardinfo: "system info",
  tips: { bash: { fc: "recent history" } },
  list: [1, 2, 3],
};

export function Harness() {
  const [repository] = useState(() =>
    createInMemoryRepository({ initialDocument: FIXTURE_DOCUMENT }),
  );
  const documentState = useDocument(FIXTURE_DOCUMENT, {
    repository,
    initialSha: "sha-0",
  });
  const [view, setView] = useState<"tree" | "trash" | "search">("tree");

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <main id="main-content">
        <h1>Notes</h1>
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
      </main>
    </>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
