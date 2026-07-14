const STORAGE_KEY = "notes/repo-config";

/** Non-secret dedicated-repository selection, stored apart from tokens (design.md 8). */
export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
}

export function loadRepoConfig(): RepoConfig | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RepoConfig;
  } catch {
    return null;
  }
}

export function saveRepoConfig(config: RepoConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
