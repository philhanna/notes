import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportButton } from "./ExportButton.tsx";

describe("ExportButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error jsdom doesn't implement this; undo the test-only stub.
    delete URL.createObjectURL;
  });

  it("downloads exactly the active document as JSON when clicked", async () => {
    const user = userEvent.setup();
    const document = { note: "hello", list: [1, 2] };

    // jsdom implements neither the Blob URL APIs nor Blob content reads, so
    // both must be stubbed rather than spied on.
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
    URL.createObjectURL = createObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(<ExportButton document={document} />);
    await user.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("application/json");
    expect(blob.size).toBe(
      new TextEncoder().encode(JSON.stringify(document, null, 2) + "\n").length,
    );

    expect(clickSpy).toHaveBeenCalledOnce();
  });
});
