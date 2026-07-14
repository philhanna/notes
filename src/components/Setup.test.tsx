import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Setup } from "./Setup.tsx";
import type { AuthState } from "../auth/useAuth.ts";
import { loadRepoConfig } from "../auth/repoConfig.ts";

function auth(): AuthState {
  return {
    status: "signed-in",
    userCode: null,
    verificationUri: null,
    signIn: vi.fn(),
    cancelSignIn: vi.fn(),
    signOut: vi.fn(),
    getAccessToken: async () => ({ ok: true, value: "test-token" }),
  };
}

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

async function fillAndSubmit(owner: string, repo: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Owner"), owner);
  await user.type(screen.getByLabelText("Repository"), repo);
  await user.click(screen.getByRole("button", { name: "Connect" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Setup", () => {
  it("connects to an existing private, writable repository and saves the config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/repos/philhanna/notes-data")) {
          return fakeResponse(200, {
            private: true,
            default_branch: "main",
            permissions: { push: true },
          });
        }
        return fakeResponse(200, {
          content: btoa(JSON.stringify({ hardinfo: "system info" }) + "\n"),
          sha: "abc123",
        });
      }),
    );

    const onReady = vi.fn();
    render(<Setup auth={auth()} onReady={onReady} />);
    await fillAndSubmit("philhanna", "notes-data");

    expect(onReady).toHaveBeenCalledWith(
      { owner: "philhanna", repo: "notes-data", branch: "main" },
      { document: { hardinfo: "system info" }, sha: "abc123" },
    );
    expect(loadRepoConfig()).toEqual({
      owner: "philhanna",
      repo: "notes-data",
      branch: "main",
    });
  });

  it("rejects a public repository without creating anything", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse(200, {
          private: false,
          default_branch: "main",
          permissions: { push: true },
        }),
      ),
    );

    const onReady = vi.fn();
    render(<Setup auth={auth()} onReady={onReady} />);
    await fillAndSubmit("philhanna", "public-repo");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /must be private/,
    );
    expect(onReady).not.toHaveBeenCalled();
    expect(loadRepoConfig()).toBeNull();
  });

  it("rejects a repository the app cannot write to", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse(200, {
          private: true,
          default_branch: "main",
          permissions: { push: false },
        }),
      ),
    );

    const onReady = vi.fn();
    render(<Setup auth={auth()} onReady={onReady} />);
    await fillAndSubmit("philhanna", "readonly-repo");

    expect(await screen.findByRole("alert")).toHaveTextContent(/not writable/);
    expect(onReady).not.toHaveBeenCalled();
  });
});
