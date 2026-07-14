import { sampleDocument } from "../app/fixtures/sampleDocument.ts";
import { useDocument } from "../app/useDocument.ts";
import { TreeBrowser } from "./TreeBrowser.tsx";

/**
 * Phase 1 (impl.md): a local tree browser over fixture data, with no
 * GitHub authentication or persistence yet — those arrive in Phase 2.
 */
export function App() {
  const state = useDocument(sampleDocument);
  return (
    <main>
      <h1>Notes</h1>
      <TreeBrowser state={state} />
    </main>
  );
}
