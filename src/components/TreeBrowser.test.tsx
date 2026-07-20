import { afterEach, describe, expect, it, vi } from "vitest";
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

function row(name: RegExp) {
  return screen.getByRole("treeitem", { name });
}

async function openActions(
  user: ReturnType<typeof userEvent.setup>,
  item: HTMLElement,
  label: string,
) {
  await user.click(within(item).getByLabelText(`Actions for ${label}`));
}

describe("TreeBrowser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error jsdom doesn't implement these; undo the test-only stub.
    delete URL.createObjectURL;
    // @ts-expect-error same as above.
    delete URL.revokeObjectURL;
  });

  it("renders a compact ARIA tree with root, scalar previews, and child counts", () => {
    render(<Harness />);

    expect(screen.getByRole("tree", { name: "Notes" })).toBeInTheDocument();
    expect(row(/^Notes, object, 3 children/)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(row(/^tips, object, 1 children/)).toBeInTheDocument();
    expect(screen.getByText("{1}")).toBeInTheDocument();
    expect(screen.getByText("[3]")).toBeInTheDocument();
    expect(screen.getByText("system info")).toBeInTheDocument();
  });

  it("expands multiple branches in place and keeps their parents visible", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Expand tips" }));
    await user.click(screen.getByRole("button", { name: "Expand bash" }));
    await user.click(screen.getByRole("button", { name: "Expand list" }));

    expect(row(/^Notes,/)).toBeInTheDocument();
    expect(row(/^tips,/)).toHaveAttribute("aria-expanded", "true");
    expect(row(/^bash,/)).toHaveAttribute("aria-expanded", "true");
    expect(row(/^fc,/)).toBeInTheDocument();
    expect(row(/^\[0\],/)).toBeInTheDocument();
  });

  it("keeps selection separate from disclosure", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const tips = row(/^tips,/);
    await user.click(within(tips).getByText("tips"));
    expect(tips).toHaveAttribute("aria-selected", "true");
    expect(tips).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: "Expand tips" }));
    expect(tips).toHaveAttribute("aria-selected", "true");
    expect(tips).toHaveAttribute("aria-expanded", "true");
  });

  it("supports conventional roving-focus keyboard navigation", () => {
    render(<Harness />);
    const root = row(/^Notes,/);
    root.focus();

    fireEvent.keyDown(root, { key: "ArrowDown" });
    expect(row(/^hardinfo,/)).toHaveFocus();

    fireEvent.keyDown(row(/^hardinfo,/), { key: "End" });
    expect(row(/^tips,/)).toHaveFocus();

    fireEvent.keyDown(row(/^tips,/), { key: "ArrowRight" });
    expect(row(/^tips,/)).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(row(/^tips,/), { key: "ArrowRight" });
    expect(row(/^bash,/)).toHaveFocus();

    fireEvent.keyDown(row(/^bash,/), { key: "ArrowLeft" });
    expect(row(/^tips,/)).toHaveFocus();
  });

  it("creates a child in the exact selected container", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(within(row(/^tips,/)).getByText("tips"));
    await user.click(screen.getByRole("button", { name: "Add child to tips" }));
    await user.type(screen.getByLabelText("Key"), "new-key");
    await user.type(screen.getByLabelText("Value"), "hello world");
    await user.click(screen.getByRole("button", { name: "Add entry" }));

    expect(row(/^tips,/)).toHaveAttribute("aria-expanded", "true");
    expect(row(/^new-key,/)).toBeInTheDocument();
  });

  it("shows a validation error and preserves typed create fields", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(
      screen.getByRole("button", { name: "Add child to Notes" }),
    );
    await user.type(screen.getByLabelText("Key"), "hardinfo");
    await user.type(screen.getByLabelText("Value"), "dup");
    await user.click(screen.getByRole("button", { name: "Add entry" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/already exists/);
    expect(screen.getByLabelText("Key")).toHaveValue("hardinfo");
  });

  it("renames an object entry and keeps it visible", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const hardinfo = row(/^hardinfo,/);
    await openActions(user, hardinfo, "hardinfo");
    await user.click(within(hardinfo).getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("New key");
    await user.clear(input);
    await user.type(input, "sysinfo");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(row(/^sysinfo,/)).toBeInTheDocument();
    expect(
      screen.queryByRole("treeitem", { name: /^hardinfo,/ }),
    ).not.toBeInTheDocument();
  });

  it("reorders array elements without leaving the expanded tree", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Expand list" }));
    const first = row(/^\[0\],/);
    await openActions(user, first, "[0]");
    await user.click(
      within(first).getByRole("button", { name: "Move [0] down" }),
    );

    const previews = screen
      .getAllByRole("treeitem", { name: /^\[[0-2]\],/ })
      .map((item) => within(item).getByRole("code").textContent);
    expect(previews).toEqual(["2", "1", "3"]);
  });

  it("moves an entry with the visual destination picker", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const hardinfo = row(/^hardinfo,/);
    await openActions(user, hardinfo, "hardinfo");
    await user.click(
      within(hardinfo).getByRole("button", { name: "Move to…" }),
    );
    await user.click(screen.getByLabelText("tips"));
    await user.click(screen.getByRole("button", { name: "Move" }));

    expect(row(/^hardinfo,/)).toBeInTheDocument();
    expect(row(/^tips,/)).toHaveAttribute("aria-expanded", "true");
  });

  it("copies an entry and leaves the source in place", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const hardinfo = row(/^hardinfo,/);
    await openActions(user, hardinfo, "hardinfo");
    await user.click(
      within(hardinfo).getByRole("button", { name: "Copy to…" }),
    );
    await user.click(screen.getByLabelText("tips"));
    await user.type(screen.getByLabelText(/New key/), "hardinfo-copy");
    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(row(/^hardinfo,/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand tips" }));
    expect(row(/^hardinfo-copy,/)).toBeInTheDocument();
  });

  it("deletes permanently after confirmation and recovers focus to the parent", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const hardinfo = row(/^hardinfo,/);
    await openActions(user, hardinfo, "hardinfo");
    await user.click(within(hardinfo).getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(
      screen.queryByRole("treeitem", { name: /^hardinfo,/ }),
    ).not.toBeInTheDocument();
    expect(row(/^Notes,/)).toHaveFocus();
  });

  it("requires confirmation for destructive replacement", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const hardinfo = row(/^hardinfo,/);
    await openActions(user, hardinfo, "hardinfo");
    await user.click(within(hardinfo).getByRole("button", { name: "Edit" }));
    const textbox = within(hardinfo).getByLabelText("Value");
    fireEvent.change(textbox, { target: { value: '{"a":1}' } });
    await user.click(within(hardinfo).getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(row(/^hardinfo, object/)).toBeInTheDocument();
  });

  it("preserves edit drafts in session storage", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const hardinfo = row(/^hardinfo,/);
    await openActions(user, hardinfo, "hardinfo");
    await user.click(within(hardinfo).getByRole("button", { name: "Edit" }));
    const textbox = within(hardinfo).getByLabelText("Value");
    await user.clear(textbox);
    await user.type(textbox, "not yet saved");

    expect(sessionStorage.getItem("notes:draft:value:/hardinfo")).toBe(
      "not yet saved",
    );
  });

  it("allows only one inline editor at a time", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const hardinfo = row(/^hardinfo,/);
    await openActions(user, hardinfo, "hardinfo");
    await user.click(within(hardinfo).getByRole("button", { name: "Edit" }));

    const tips = row(/^tips,/);
    await openActions(user, tips, "tips");
    expect(within(tips).getByRole("button", { name: "Edit" })).toBeDisabled();
    expect(screen.getAllByLabelText("Value")).toHaveLength(1);
  });

  it("selecting a string row opens the read-only rendered view panel", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const hardinfo = row(/^hardinfo,/);
    await user.click(within(hardinfo).getByText("hardinfo"));

    expect(
      within(hardinfo).getByText("system info", { selector: "p" }),
    ).toBeInTheDocument();
    expect(within(hardinfo).queryByLabelText("Value")).not.toBeInTheDocument();
  });

  it("switches from the rendered view to the raw ValueEditor via Edit", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const hardinfo = row(/^hardinfo,/);
    await user.click(within(hardinfo).getByText("hardinfo"));
    const viewPanel = hardinfo.querySelector(".tree-row__view") as HTMLElement;
    await user.click(within(viewPanel).getByRole("button", { name: "Edit" }));

    expect(within(hardinfo).getByLabelText("Value")).toHaveValue(
      '"system info"',
    );
    expect(
      within(hardinfo).queryByText("system info", { selector: "p" }),
    ).not.toBeInTheDocument();
  });

  it("dismisses the rendered view panel via Cancel without editing", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const hardinfo = row(/^hardinfo,/);
    await user.click(within(hardinfo).getByText("hardinfo"));
    const viewPanel = hardinfo.querySelector(".tree-row__view") as HTMLElement;
    await user.click(within(viewPanel).getByRole("button", { name: "Cancel" }));

    expect(
      within(hardinfo).queryByText("system info", { selector: "p" }),
    ).not.toBeInTheDocument();
    expect(within(hardinfo).queryByLabelText("Value")).not.toBeInTheDocument();
    expect(hardinfo).toHaveAttribute("aria-selected", "true");
  });

  it("closes a string's view panel when selection moves to another row", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const hardinfo = row(/^hardinfo,/);
    await user.click(within(hardinfo).getByText("hardinfo"));
    expect(
      within(hardinfo).getByText("system info", { selector: "p" }),
    ).toBeInTheDocument();

    await user.click(within(row(/^tips,/)).getByText("tips"));
    expect(
      within(hardinfo).queryByText("system info", { selector: "p" }),
    ).not.toBeInTheDocument();
  });

  it("does not open a panel when selecting a number, boolean, or null row", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Expand list" }));
    const first = row(/^\[0\],/);
    await user.click(within(first).getByRole("code"));

    expect(first).toHaveAttribute("aria-selected", "true");
    expect(within(first).queryByLabelText("Value")).not.toBeInTheDocument();
    expect(first.querySelector(".tree-row__view")).not.toBeInTheDocument();
  });

  it("downloads just that row's subtree as JSON via the row's Export action", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const user = userEvent.setup();
    render(<Harness />);
    const tips = row(/^tips,/);
    await openActions(user, tips, "tips");
    await user.click(within(tips).getByRole("button", { name: "Export" }));

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("application/json");
    const expected =
      JSON.stringify({ bash: { fc: "recent history" } }, null, 2) + "\n";
    expect(blob.size).toBe(new TextEncoder().encode(expected).length);
    expect(clickSpy).toHaveBeenCalledOnce();
    // The URL is kept alive briefly so slower mobile browsers can finish
    // reading the blob before it's revoked, rather than being revoked
    // synchronously right after the click.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    const [revoke, delay] = setTimeoutSpy.mock.calls.find(
      ([, ms]) => ms === 30000,
    )!;
    (revoke as () => void)();
    expect(delay).toBe(30000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });
});
