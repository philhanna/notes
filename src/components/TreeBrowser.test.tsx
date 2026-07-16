import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TreeBrowser } from "./TreeBrowser.tsx";
import { useDocument } from "../app/useDocument.ts";
import type { JsonObject } from "../domain/types.ts";

function sample(): JsonObject {
  return {
    hardinfo: "system info",
    tips: { bash: { fc: "recent history" } },
    list: [1, 2, 3],
  };
}

function Harness() {
  const state = useDocument(sample());
  return <TreeBrowser state={state} />;
}

async function openActions(
  user: ReturnType<typeof userEvent.setup>,
  row: HTMLElement,
  label: string,
) {
  await user.click(within(row).getByLabelText(`Actions for ${label}`));
}

describe("TreeBrowser", () => {
  it("shows child counts for object and array containers", () => {
    render(<Harness />);

    expect(
      screen.getByRole("button", { name: "tips — 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "list — 3" }),
    ).toBeInTheDocument();
  });

  it("navigates into a container via breadcrumbs and back", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "tips — 1" }));

    expect(screen.getByRole("button", { name: /^bash/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notes" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Notes" }));
    expect(screen.getByText("hardinfo")).toBeInTheDocument();
  });

  it("creates a new object entry and shows it in the list", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText("Key"), "new-key");
    await user.type(screen.getByLabelText("Value"), "hello world");
    await user.click(screen.getByRole("button", { name: "Add entry" }));

    expect(screen.getByText("new-key")).toBeInTheDocument();
  });

  it("shows a validation error and preserves the typed key on a duplicate", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText("Key"), "hardinfo");
    await user.type(screen.getByLabelText("Value"), "dup");
    await user.click(screen.getByRole("button", { name: "Add entry" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/already exists/);
    expect(screen.getByLabelText("Key")).toHaveValue("hardinfo");
  });

  it("renames an object entry", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const hardinfoRow = screen.getByText("hardinfo").closest("li")!;
    await openActions(user, hardinfoRow, "hardinfo");
    await user.click(
      within(hardinfoRow).getByRole("button", { name: "Rename" }),
    );
    const input = screen.getByLabelText("New key");
    await user.clear(input);
    await user.type(input, "sysinfo");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("sysinfo")).toBeInTheDocument();
    expect(screen.queryByText("hardinfo")).not.toBeInTheDocument();
  });

  it("reorders array elements with the move controls", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /^list/ }));
    const values = () =>
      screen.getAllByText(/^[123]$/).map((el) => el.textContent);
    expect(values()).toEqual(["1", "2", "3"]);

    const firstRow = screen.getByText("1").closest("li")!;
    await openActions(user, firstRow, "[0]");
    await user.click(screen.getByRole("button", { name: "Move [0] down" }));
    expect(values()).toEqual(["2", "1", "3"]);
  });

  it("deletes an entry after confirmation, permanently", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const hardinfoRow = screen.getByText("hardinfo").closest("li")!;
    await openActions(user, hardinfoRow, "hardinfo");
    await user.click(
      within(hardinfoRow).getByRole("button", { name: "Delete" }),
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(/cannot be undone/);

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(screen.queryByText("hardinfo")).not.toBeInTheDocument();
  });

  it("moves an entry to a chosen destination", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const hardinfoRow = screen.getByText("hardinfo").closest("li")!;
    await openActions(user, hardinfoRow, "hardinfo");
    await user.click(
      within(hardinfoRow).getByRole("button", { name: "Move to…" }),
    );
    await user.type(screen.getByLabelText(/Destination/), "/tips");
    await user.click(screen.getByRole("button", { name: "Move" }));

    expect(screen.queryByText("hardinfo")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^tips/ }));
    expect(screen.getByText("hardinfo")).toBeInTheDocument();
  });

  it("copies an entry to a chosen destination, leaving the original in place", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const hardinfoRow = screen.getByText("hardinfo").closest("li")!;
    await openActions(user, hardinfoRow, "hardinfo");
    await user.click(
      within(hardinfoRow).getByRole("button", { name: "Copy to…" }),
    );
    await user.type(screen.getByLabelText(/Destination/), "/tips");
    await user.type(screen.getByLabelText(/New key/), "hardinfo-copy");
    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(screen.getByText("hardinfo")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^tips/ }));
    expect(screen.getByText("hardinfo-copy")).toBeInTheDocument();
  });

  it("requires confirmation to replace a scalar with a container, and applies it once confirmed", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const hardinfoRow = screen.getByText("hardinfo").closest("li")!;
    await openActions(user, hardinfoRow, "hardinfo");
    await user.click(within(hardinfoRow).getByRole("button", { name: "Edit" }));
    const textbox = within(hardinfoRow).getByLabelText("Value");
    fireEvent.change(textbox, { target: { value: '{"a":1}' } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Replace" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^hardinfo/ }),
    ).toBeInTheDocument();
  });

  it("moves focus to the level heading after breadcrumb navigation", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /^tips/ }));
    expect(screen.getByRole("heading", { name: "tips" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Notes" }));
    expect(screen.getByRole("heading", { name: "Notes" })).toHaveFocus();
  });

  it("writes a typed but unsaved value through to sessionStorage as it's typed", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const hardinfoRow = screen.getByText("hardinfo").closest("li")!;
    await openActions(user, hardinfoRow, "hardinfo");
    await user.click(within(hardinfoRow).getByRole("button", { name: "Edit" }));
    const textbox = within(hardinfoRow).getByLabelText("Value");
    await user.clear(textbox);
    await user.type(textbox, "not yet saved");

    expect(sessionStorage.getItem("notes:draft:value:/hardinfo")).toBe(
      "not yet saved",
    );
  });

  it("restores a draft already in sessionStorage when the editor opens (post safe-refresh)", async () => {
    sessionStorage.setItem("notes:draft:value:/hardinfo", "not yet saved");
    const user = userEvent.setup();
    render(<Harness />);

    const hardinfoRow = screen.getByText("hardinfo").closest("li")!;
    await openActions(user, hardinfoRow, "hardinfo");
    await user.click(within(hardinfoRow).getByRole("button", { name: "Edit" }));

    expect(within(hardinfoRow).getByLabelText("Value")).toHaveValue(
      "not yet saved",
    );
  });

  it("clears a create-entry draft once the entry is saved", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);

    await user.type(screen.getByLabelText("Key"), "draft-key");
    await user.type(screen.getByLabelText("Value"), "draft value");
    await user.click(screen.getByRole("button", { name: "Add entry" }));
    unmount();

    render(<Harness />);
    expect(screen.getByLabelText("Key")).toHaveValue("");
    expect(screen.getByLabelText("Value")).toHaveValue("");
  });
});
