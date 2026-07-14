import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TreeBrowser } from "./TreeBrowser.tsx";
import { useDocument } from "../app/useDocument.ts";
import { createInMemoryRepository } from "../persistence/inMemoryRepository.ts";
import type { JsonObject } from "../domain/types.ts";

function sample(): JsonObject {
  return {
    hardinfo: "v1",
    sibling: "untouched",
  };
}

function Harness({
  repository,
}: {
  repository: ReturnType<typeof createInMemoryRepository>;
}) {
  const state = useDocument(sample(), { repository, initialSha: "sha-0" });
  return (
    <>
      <button
        type="button"
        onClick={() => void state.setValue(["hardinfo"], "v2")}
      >
        trigger-update
      </button>
      <TreeBrowser state={state} />
    </>
  );
}

describe("History and restore (design.md 10)", () => {
  it("previews an earlier revision without altering the current value, then restores it, leaving siblings unchanged", async () => {
    const user = userEvent.setup();
    const repository = createInMemoryRepository({
      initialDocument: sample(),
    });

    render(<Harness repository={repository} />);
    // A second commit, so there are two revisions of /hardinfo to choose from.
    await user.click(screen.getByRole("button", { name: "trigger-update" }));
    expect(screen.getByText('"v2"')).toBeInTheDocument();

    const hardinfoRow = screen.getByText("hardinfo").closest("li")!;
    await user.click(
      within(hardinfoRow).getByRole("button", { name: "History" }),
    );

    // The oldest revision (v1) appears once loaded.
    const initialEntry = await screen.findByText("Initialize remember.json");
    await user.click(initialEntry);

    // Preview shows the historical value but does not change the live tree.
    expect(
      screen.getByRole("heading", { name: "Selected revision" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/"v1"/).length).toBeGreaterThan(0);
    expect(screen.getByText('"v2"')).toBeInTheDocument(); // still the current value in the row behind the panel
    expect(repository.commits).toHaveLength(1); // no commit made just from previewing

    await user.click(
      screen.getByRole("button", { name: "Restore this revision" }),
    );
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Restore" }));

    expect(repository.commits).toHaveLength(2);
    expect(repository.commits[1]?.message).toBe(
      "Restore /hardinfo to revision sha-0",
    );
    expect(screen.getByText('"v1"')).toBeInTheDocument();
    // The untouched sibling was never part of the restored path.
    expect(screen.getByText('"untouched"')).toBeInTheDocument();
  });
});
