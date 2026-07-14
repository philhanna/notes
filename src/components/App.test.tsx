import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App.tsx";

const TOKEN_KEY = "notes/auth-token";
const REPO_CONFIG_KEY = "notes/repo-config";

function seedSignedIn() {
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      accessToken: "test-token",
      accessTokenExpiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    }),
  );
}

function seedRepoConfig() {
  localStorage.setItem(
    REPO_CONFIG_KEY,
    JSON.stringify({ owner: "philhanna", repo: "notes-data", branch: "main" }),
  );
}

function fakeResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("shows a sign-in screen when signed out", () => {
    render(<App />);
    expect(
      screen.getByRole("button", { name: "Sign in with GitHub" }),
    ).toBeInTheDocument();
  });

  it("shows setup when signed in with no stored repository", async () => {
    seedSignedIn();
    render(<App />);
    expect(
      await screen.findByRole("heading", {
        name: "Connect your notes repository",
      }),
    ).toBeInTheDocument();
  });

  it("loads and shows the document when signed in with a stored repository", async () => {
    seedSignedIn();
    seedRepoConfig();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse(200, {
          content: btoa(JSON.stringify({ hardinfo: "system info" }) + "\n"),
          sha: "abc123",
        }),
      ),
    );

    render(<App />);
    expect(await screen.findByText("hardinfo")).toBeInTheDocument();
  });

  it("shows an error and a sign-out control when the document fails to load", async () => {
    seedSignedIn();
    seedRepoConfig();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(404, { message: "Not Found" })),
    );

    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be found/i,
    );
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
  });
});
