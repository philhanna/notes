import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JsonTreeView } from "./JsonTreeView.tsx";

describe("JsonTreeView", () => {
  it("sorts object entries by key", () => {
    const { container } = render(
      <JsonTreeView
        rootLabel="Current"
        value={{ zebra: 1, alpha: 2, middle: 3 }}
        emptyLabel="(none)"
      />,
    );

    expect(
      Array.from(
        container.querySelectorAll(".child-row__label"),
        (element) => element.textContent,
      ),
    ).toEqual(["alpha", "middle", "zebra"]);
  });

  it("renders an object's keys instead of a JSON blob, and lets the user drill into a subkey", async () => {
    const user = userEvent.setup();
    render(
      <JsonTreeView
        rootLabel="Current"
        value={{ profile: { name: "Ada", tags: ["math", "logic"] }, count: 2 }}
        emptyLabel="(none)"
      />,
    );

    // Rendered as keys to open, not a stringified blob.
    expect(
      screen.queryByText(/"profile":\{"name":"Ada"/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /profile/ })).toBeInTheDocument();
    expect(screen.getByText("count")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();

    // Drilling into "profile" makes it the selected node.
    await user.click(screen.getByRole("button", { name: /profile/ }));
    expect(screen.getByRole("button", { name: /tags/ })).toBeInTheDocument();
    expect(screen.queryByText("count")).not.toBeInTheDocument();

    // The breadcrumb tracks the selection and can navigate back out.
    await user.click(screen.getByRole("button", { name: "Current" }));
    expect(screen.getByText("count")).toBeInTheDocument();
  });

  it("shows a scalar selected node's value directly", () => {
    render(
      <JsonTreeView rootLabel="Current" value="hello" emptyLabel="(none)" />,
    );
    expect(screen.getByText('"hello"')).toBeInTheDocument();
  });

  it("shows the empty label when the value is undefined", () => {
    render(
      <JsonTreeView
        rootLabel="Current"
        value={undefined}
        emptyLabel="(none)"
      />,
    );
    expect(screen.getByText("(none)")).toBeInTheDocument();
  });
});
