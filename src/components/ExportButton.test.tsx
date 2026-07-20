import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportButton } from "./ExportButton.tsx";

describe("ExportButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error jsdom doesn't implement these; undo the test-only stubs.
    delete URL.createObjectURL;
    // @ts-expect-error same as above.
    delete navigator.canShare;
    // @ts-expect-error same as above.
    delete navigator.share;
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

  it("shares the document via the Web Share API instead of the download anchor when the platform supports it", async () => {
    const user = userEvent.setup();
    const document = { note: "hello", list: [1, 2] };

    const canShare = vi.fn().mockReturnValue(true);
    const share = vi.fn().mockResolvedValue(undefined);
    navigator.canShare = canShare;
    navigator.share = share;
    const createObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(<ExportButton document={document} />);
    await user.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(share).toHaveBeenCalledOnce();
    const file = share.mock.calls[0]![0].files[0] as File;
    expect(file.name).toMatch(/^notes-export-.*\.json$/);
    expect(file.type).toBe("application/json");
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
