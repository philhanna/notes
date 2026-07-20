import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportButton } from "./ExportButton.tsx";

describe("ExportButton", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // @ts-expect-error jsdom doesn't implement these; undo the test-only stub.
    delete URL.createObjectURL;
    // @ts-expect-error same as above.
    delete URL.revokeObjectURL;
  });

  it("downloads exactly the active document as JSON when clicked", async () => {
    const user = userEvent.setup();
    const document = { note: "hello", list: [1, 2] };

    // jsdom implements neither the Blob URL APIs nor Blob content reads, so
    // both must be stubbed rather than spied on.
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    render(<ExportButton document={document} />);
    await user.click(screen.getByRole("button", { name: "Export JSON" }));

    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("application/json");
    expect(blob.size).toBe(
      new TextEncoder().encode(JSON.stringify(document, null, 2) + "\n").length,
    );

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
