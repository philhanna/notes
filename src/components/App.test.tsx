import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App.tsx";
import {
  createFakeGraph,
  fakeResponse,
  installFetch,
} from "../test/fakeGitGraph.ts";

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
    installFetch(createFakeGraph({ hardinfo: "system info" }));

    render(<App />);
    expect(await screen.findByText("hardinfo")).toBeInTheDocument();
  });

  it("deletes an entry to trash and recovers it, end to end against the repository", async () => {
    const user = userEvent.setup();
    seedSignedIn();
    seedRepoConfig();
    const graph = createFakeGraph({ hardinfo: "system info" });
    installFetch(graph);

    render(<App />);
    const hardinfoRow = (await screen.findByText("hardinfo")).closest("li")!;

    await user.click(
      within(hardinfoRow).getByLabelText("Actions for hardinfo"),
    );
    await user.click(
      within(hardinfoRow).getByRole("button", { name: "Delete" }),
    );
    const confirm = screen.getByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    expect(screen.queryByText("hardinfo")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Trash/ }));
    expect(screen.getByText("/hardinfo")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Recover" }));
    await user.click(screen.getByRole("button", { name: "Back to notes" }));

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
