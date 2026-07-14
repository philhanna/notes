import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";

describe("App", () => {
  it("shows the sign-in prompt", () => {
    render(<App />);

    expect(
      screen.getByText("Sign in with GitHub to open your notes."),
    ).toBeInTheDocument();
  });
});
