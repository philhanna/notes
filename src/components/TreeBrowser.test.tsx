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

describe("TreeBrowser", () => {
  it("navigates into a container via breadcrumbs and back", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /^tips/ }));

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

    await user.click(screen.getByRole("button", { name: "Move [0] down" }));
    expect(values()).toEqual(["2", "1", "3"]);
  });

  it("requires confirmation to replace a scalar with a container, and applies it once confirmed", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const hardinfoRow = screen.getByText("hardinfo").closest("li")!;
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
});
