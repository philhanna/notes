import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrashView } from "./TrashView.tsx";
import { useDocument } from "../app/useDocument.ts";
import type { JsonObject } from "../domain/types.ts";

function sample(): JsonObject {
  return {
    hardinfo: "system info",
    tips: { bash: { fc: "recent history" } },
  };
}

function Harness() {
  const state = useDocument(sample());
  return (
    <div>
      <button onClick={() => void state.deleteEntry(["hardinfo"])}>
        trigger-delete
      </button>
      <button onClick={() => void state.createEntry("hardinfo", "replacement")}>
        trigger-recreate
      </button>
      <TrashView
        document={state.document}
        trash={state.trash}
        recover={state.recover}
        permanentlyDeleteTrash={state.permanentlyDeleteTrash}
        emptyTrash={state.emptyTrash}
        onClose={() => {}}
      />
    </div>
  );
}

describe("TrashView", () => {
  it("shows an empty message with nothing in trash", () => {
    render(<Harness />);
    expect(screen.getByText("Trash is empty.")).toBeInTheDocument();
  });

  it("lists a deleted record and recovers it to its original path", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("trigger-delete"));
    expect(screen.getByText("/hardinfo")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Recover" }));

    expect(screen.getByText("Trash is empty.")).toBeInTheDocument();
  });

  it("asks for a destination when the original path is occupied, and recovers there", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("trigger-delete"));
    await user.click(screen.getByText("trigger-recreate"));
    await user.click(screen.getByRole("button", { name: "Recover" }));

    expect(screen.getByText(/is occupied/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Destination/), "/tips");
    await user.type(screen.getByLabelText(/New key/), "recovered");
    await user.click(screen.getByRole("button", { name: "Recover here" }));

    expect(screen.getByText("Trash is empty.")).toBeInTheDocument();
  });

  it("permanently deletes a record after confirmation", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("trigger-delete"));
    await user.click(
      screen.getByRole("button", { name: "Delete permanently" }),
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/cannot be undone/);

    await user.click(
      within(dialog).getByRole("button", { name: "Delete permanently" }),
    );

    expect(screen.getByText("Trash is empty.")).toBeInTheDocument();
  });

  it("empties all trash after confirmation, noting it is not secure erasure", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("trigger-delete"));
    await user.click(screen.getByRole("button", { name: "Empty Trash" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/not secure erasure/);

    await user.click(
      within(dialog).getByRole("button", { name: "Empty Trash" }),
    );

    expect(screen.getByText("Trash is empty.")).toBeInTheDocument();
  });
});
