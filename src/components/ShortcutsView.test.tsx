import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShortcutsView } from "./ShortcutsView.tsx";
import type { JsonObject } from "../domain/types.ts";

function sample(): JsonObject {
  return {
    hardinfo: "system info",
    tips: { bash: { fc: "recent history" } },
  };
}

describe("ShortcutsView", () => {
  it("shows empty-state copy for both lists when nothing is pinned or recent", () => {
    render(
      <ShortcutsView
        document={sample()}
        pinnedPaths={new Set()}
        recentPaths={new Set()}
        onSelectPath={vi.fn()}
        onUnpin={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Pin an entry from its actions menu to see it here."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Entries you open appear here."),
    ).toBeInTheDocument();
  });

  it("lists pinned and recent entries with their breadcrumb, most-recent first", () => {
    render(
      <ShortcutsView
        document={sample()}
        pinnedPaths={new Set(["/hardinfo", "/tips/bash/fc"])}
        recentPaths={new Set(["/tips/bash/fc"])}
        onSelectPath={vi.fn()}
        onUnpin={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const pinnedLabels = screen.getAllByText(/^(hardinfo|fc)$/);
    expect(pinnedLabels.map((el) => el.textContent)).toEqual([
      "fc",
      "hardinfo",
      "fc",
    ]);
    expect(screen.getAllByText("Notes › tips › bash › fc")).toHaveLength(2);
  });

  it("navigates to a selected entry and closes", async () => {
    const user = userEvent.setup();
    const onSelectPath = vi.fn();
    const onClose = vi.fn();
    render(
      <ShortcutsView
        document={sample()}
        pinnedPaths={new Set(["/hardinfo"])}
        recentPaths={new Set()}
        onSelectPath={onSelectPath}
        onUnpin={vi.fn()}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^hardinfo/ }));

    expect(onSelectPath).toHaveBeenCalledWith(["hardinfo"]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("unpins an entry without navigating", async () => {
    const user = userEvent.setup();
    const onSelectPath = vi.fn();
    const onUnpin = vi.fn();
    render(
      <ShortcutsView
        document={sample()}
        pinnedPaths={new Set(["/hardinfo"])}
        recentPaths={new Set()}
        onSelectPath={onSelectPath}
        onUnpin={onUnpin}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Unpin hardinfo" }));

    expect(onUnpin).toHaveBeenCalledWith("/hardinfo");
    expect(onSelectPath).not.toHaveBeenCalled();
  });

  it("drops a pointer that no longer resolves in the document", () => {
    render(
      <ShortcutsView
        document={sample()}
        pinnedPaths={new Set(["/gone"])}
        recentPaths={new Set()}
        onSelectPath={vi.fn()}
        onUnpin={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Pin an entry from its actions menu to see it here."),
    ).toBeInTheDocument();
  });
});
