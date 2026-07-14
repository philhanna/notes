import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchView } from "./SearchView.tsx";
import type { JsonObject } from "../domain/types.ts";

function sample(): JsonObject {
  return {
    hardinfo: "system info",
    tips: { bash: { fc: "recent history" } },
    club_ids: [42, "member-7"],
  };
}

describe("SearchView", () => {
  it("shows no results before a query is entered", () => {
    render(
      <SearchView document={sample()} onNavigate={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("finds a case-insensitive match, plus anything nested under it by breadcrumb", async () => {
    const user = userEvent.setup();
    render(
      <SearchView document={sample()} onNavigate={vi.fn()} onClose={vi.fn()} />,
    );

    await user.type(screen.getByLabelText("Search notes"), "BASH");

    // Matches the "bash" key itself, plus "fc" nested under it (its
    // breadcrumb also contains "bash") — see domain/search.test.ts.
    expect(screen.getByRole("status")).toHaveTextContent("2 results");
    expect(screen.getAllByRole("button", { name: /bash|fc/ })).toHaveLength(2);
  });

  it("navigates to the containing level and closes on selecting a result", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(
      <SearchView
        document={sample()}
        onNavigate={onNavigate}
        onClose={onClose}
      />,
    );

    await user.type(screen.getByLabelText("Search notes"), "recent history");
    await user.click(screen.getByRole("button", { name: /fc/ }));

    expect(onNavigate).toHaveBeenCalledWith(["tips", "bash"]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows a zero-result count for a query that matches nothing", async () => {
    const user = userEvent.setup();
    render(
      <SearchView document={sample()} onNavigate={vi.fn()} onClose={vi.fn()} />,
    );
    await user.type(screen.getByLabelText("Search notes"), "nonexistent");
    expect(screen.getByRole("status")).toHaveTextContent("0 results");
  });
});
