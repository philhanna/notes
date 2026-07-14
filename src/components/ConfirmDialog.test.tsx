import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

function renderDialog() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <div>
      <button type="button">Trigger</button>
      <ConfirmDialog
        message="Delete this?"
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>,
  );
  return { onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("focuses the confirm button on open", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
  });

  it("cancels on Escape", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderDialog();

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("traps Tab focus between the confirm and cancel buttons", async () => {
    const user = userEvent.setup();
    renderDialog();
    const confirmButton = screen.getByRole("button", { name: "Delete" });
    const cancelButton = screen.getByRole("button", { name: "Cancel" });

    await user.tab();
    expect(cancelButton).toHaveFocus();

    await user.tab();
    expect(confirmButton).toHaveFocus();

    await user.tab({ shift: true });
    expect(cancelButton).toHaveFocus();
  });

  it("restores focus to the triggering control on cancel", async () => {
    const user = userEvent.setup();
    const trigger = document.createElement("button");
    trigger.textContent = "Delete row";
    document.body.appendChild(trigger);
    trigger.focus();

    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        message="Delete this?"
        confirmLabel="Delete"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
    document.body.removeChild(trigger);
  });
});
