import { afterEach, describe, expect, it } from "vitest";
import { loadRepoConfig, saveRepoConfig } from "./repoConfig.ts";

afterEach(() => {
  localStorage.clear();
});

describe("repoConfig", () => {
  it("round-trips a saved config", () => {
    expect(loadRepoConfig()).toBeNull();
    saveRepoConfig({ owner: "philhanna", repo: "notes-data", branch: "main" });
    expect(loadRepoConfig()).toEqual({
      owner: "philhanna",
      repo: "notes-data",
      branch: "main",
    });
  });

  it("is stored separately from the auth token", () => {
    saveRepoConfig({ owner: "philhanna", repo: "notes-data", branch: "main" });
    expect(localStorage.getItem("notes/auth-token")).toBeNull();
    expect(localStorage.getItem("notes/repo-config")).not.toBeNull();
  });
});
