import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("shows the tree browser with the fixture document's top-level keys", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Notes" })).toBeInTheDocument();
    expect(screen.getByText("hardinfo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^tips/ })).toBeInTheDocument();
  });
});
