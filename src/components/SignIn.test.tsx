import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignIn } from "./SignIn.tsx";
import type { AuthState } from "../auth/useAuth.ts";

function auth(overrides: Partial<AuthState> = {}): AuthState {
  return {
    status: "signed-out",
    userCode: null,
    verificationUri: null,
    signIn: vi.fn(),
    cancelSignIn: vi.fn(),
    signOut: vi.fn(),
    getAccessToken: vi.fn(),
    ...overrides,
  };
}

describe("SignIn", () => {
  it("shows a sign-in button when signed out, which starts device flow", async () => {
    const user = userEvent.setup();
    const state = auth();
    render(<SignIn auth={state} />);

    const button = screen.getByRole("button", { name: "Sign in with GitHub" });
    await user.click(button);
    expect(state.signIn).toHaveBeenCalledOnce();
  });

  it("shows the device code and verification link while authorizing", async () => {
    const user = userEvent.setup();
    const state = auth({
      status: "authorizing",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
    });
    render(<SignIn auth={state} />);

    expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "https://github.com/login/device" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.cancelSignIn).toHaveBeenCalledOnce();
  });
});
