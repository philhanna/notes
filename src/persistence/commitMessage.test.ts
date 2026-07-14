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
});
