import { useMemo, useState } from "react";
import { buildSearchIndex, search } from "../domain/search.ts";
import type { SearchResult } from "../domain/search.ts";
import type { JsonObject, Path } from "../domain/types.ts";

interface SearchViewProps {
  document: JsonObject;
  onNavigate: (path: Path) => void;
  onClose: () => void;
}

/**
 * Full-text search over the active tree (design.md 6.1, 11). The index is
 * rebuilt whenever `document` changes — after loading and after every
 * successful mutation, since `document` is the same state TreeBrowser
 * renders from. Selecting a result navigates to its containing level and
 * closes search, matching "navigate to the containing level" (design.md 11).
 */
export function SearchView({ document, onNavigate, onClose }: SearchViewProps) {
  const [query, setQuery] = useState("");
  const index = useMemo(() => buildSearchIndex(document), [document]);
  const results = useMemo(() => search(index, query), [index, query]);

  function handleSelect(result: SearchResult) {
    onNavigate(result.containerPath);
    onClose();
  }

  return (
    <div className="search-view">
      <div className="search-view__header">
        <h2>Search</h2>
        <button type="button" onClick={onClose}>
          Back to notes
        </button>
      </div>

      <label htmlFor="search-query">Search notes</label>
      <input
        id="search-query"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
      />

      {query.trim() !== "" && (
        <p className="search-view__count" role="status">
          {results.length} {results.length === 1 ? "result" : "results"}
        </p>
      )}

      {results.length > 0 && (
        <ul className="search-results">
          {results.map((result, index_) => (
            <li key={index_}>
              <button
                type="button"
                className="search-results__item"
                onClick={() => handleSelect(result)}
              >
                <span className="search-results__label">{result.label}</span>
                <span className="search-results__breadcrumb">
                  {result.breadcrumb}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
