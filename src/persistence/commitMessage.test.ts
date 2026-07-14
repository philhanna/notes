import { describe, expect, it } from "vitest";
import { describeOperation } from "./commitMessage.ts";

describe("describeOperation", () => {
  it("describes create-entry and create-element by full path", () => {
    expect(
      describeOperation({ kind: "create-entry", path: ["tips", "bash"] }),
    ).toBe("Create /tips/bash");
    expect(describeOperation({ kind: "create-element", path: [3] })).toBe(
      "Create /3",
    );
  });

  it("describes rename with both paths", () => {
    expect(
      describeOperation({
        kind: "rename",
        path: ["tips", "bash"],
        newPath: ["tips", "shell"],
      }),
    ).toBe("Rename /tips/bash to /tips/shell");
  });

  it("describes set-value and reorder", () => {
    expect(
      describeOperation({ kind: "set-value", path: ["where-was-i"] }),
    ).toBe("Set /where-was-i");
    expect(describeOperation({ kind: "reorder", path: ["with-rating"] })).toBe(
      "Reorder /with-rating",
    );
  });

  it("never includes a value, only paths", () => {
    const message = describeOperation({
      kind: "set-value",
      path: ["secret key"],
    });
    expect(message).toBe("Set /secret key");
  });

  it("describes move and copy with both paths", () => {
    expect(
      describeOperation({
        kind: "move",
        path: ["tips", "bash", "fc"],
        newPath: ["shell", "bash", "fc"],
      }),
    ).toBe("Move /tips/bash/fc to /shell/bash/fc");
    expect(
      describeOperation({
        kind: "copy",
        path: ["tips"],
        newPath: ["tips-copy"],
      }),
    ).toBe("Copy /tips to /tips-copy");
  });

  it("describes delete, recover, and permanent-delete by original path", () => {
    expect(describeOperation({ kind: "delete", path: ["with-rating"] })).toBe(
      "Delete /with-rating",
    );
    expect(
      describeOperation({
        kind: "recover",
        path: ["with-rating"],
        trashId: "t1",
      }),
    ).toBe("Restore /with-rating from trash");
    expect(
      describeOperation({
        kind: "permanent-delete",
        path: ["with-rating"],
        trashId: "t1",
      }),
    ).toBe("Permanently delete /with-rating");
  });

  it("describes empty-trash without a path", () => {
    expect(describeOperation({ kind: "empty-trash" })).toBe("Empty trash");
  });
});
