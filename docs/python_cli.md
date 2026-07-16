This app already uses GitHub’s REST API directly. The browser signs you in, receives a token, and then reads/writes the private data repository through `api.github.com`.

For a Python CLI, the cleanest approach is to use its own fine-grained personal access token while operating on the same repository.

## 1. Create a token for the CLI

In GitHub:

1. Open **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. Select only the private repository containing `remember.json`.
3. Grant **Repository permissions → Contents: Read and write**.
4. Give the token an expiration date.

GitHub’s Git Database endpoints accept fine-grained PATs, GitHub App user tokens, and installation tokens; writes require `Contents: write`. [GitHub token documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens), [Git blobs API](https://docs.github.com/en/rest/git/blobs)

Put the token in an environment variable rather than in source code:

```bash
export GH_TOKEN='github_pat_...'
export NOTES_REPO='philhanna/notes-data'
export NOTES_BRANCH='main'
```

The web app still uses its own GitHub App authorization. The PAT is a separate credential for the CLI; both credentials access the same repository.

## 2. How the app reads the data

The app performs approximately these calls:

```text
GET /repos/OWNER/REPO/git/ref/heads/main
  └─ obtains the current commit SHA

GET /repos/OWNER/REPO/git/commits/COMMIT_SHA
  └─ obtains the tree SHA

GET /repos/OWNER/REPO/git/trees/TREE_SHA?recursive=1
  └─ finds remember.json

GET /repos/OWNER/REPO/git/blobs/BLOB_SHA
  └─ downloads and Base64-decodes the file
```

That implementation is in [gitDataApi.ts](/home/saspeh/dev/notes/src/persistence/gitDataApi.ts) and [githubRepository.ts](/home/saspeh/dev/notes/src/persistence/githubRepository.ts).

The only relevant file is `remember.json`: the active notes tree. There is no
separate trash or recovery file — a delete simply removes the key from
`remember.json`.

## 3. Why saving requires several API calls

The app intentionally uses GitHub’s lower-level Git Database API instead of simply uploading `remember.json`.

A safe save is:

```text
Create new blob(s)
       ↓
Create a new tree based on the old tree
       ↓
Create a commit whose parent is the previously read commit
       ↓
Conditionally advance refs/heads/main with force=false
```

This matters because if the web app or another CLI writes first, GitHub
rejects the stale branch update instead of silently overwriting the newer
data.

The app implements that sequence in [githubRepository.ts](/home/saspeh/dev/notes/src/persistence/githubRepository.ts:239). GitHub documents the underlying [blob](https://docs.github.com/en/rest/git/blobs), [tree](https://docs.github.com/en/rest/git/trees), [commit](https://docs.github.com/en/rest/git/commits), and [reference](https://docs.github.com/en/rest/git/refs) endpoints.

## 4. Minimal compatible Python example

Install the HTTP dependency:

```bash
python -m pip install requests
```

This example reads `remember.json`, runs your edit function, and commits the result with stale-write protection:

```python
import base64
import json
import os

import requests


TOKEN = os.environ["GH_TOKEN"]
OWNER, REPO = os.environ["NOTES_REPO"].split("/", 1)
BRANCH = os.environ.get("NOTES_BRANCH", "main")

API = f"https://api.github.com/repos/{OWNER}/{REPO}"
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2026-03-10",
}


def api(method, path, **kwargs):
    response = requests.request(
        method,
        f"{API}{path}",
        headers=HEADERS,
        timeout=30,
        **kwargs,
    )

    if response.status_code == 422:
        raise RuntimeError(
            "Save conflict: the repository changed. Reload and retry."
        )

    response.raise_for_status()
    return response.json() if response.content else None


def load_notes():
    ref = api("GET", f"/git/ref/heads/{BRANCH}")
    base_commit = ref["object"]["sha"]

    commit = api("GET", f"/git/commits/{base_commit}")
    base_tree = commit["tree"]["sha"]

    tree = api("GET", f"/git/trees/{base_tree}?recursive=1")
    entry = next(
        item for item in tree["tree"]
        if item["path"] == "remember.json" and item["type"] == "blob"
    )

    blob = api("GET", f"/git/blobs/{entry['sha']}")
    raw = base64.b64decode(blob["content"]).decode("utf-8")

    return json.loads(raw), base_commit, base_tree


def save_notes(notes, base_commit, base_tree, message):
    # Match the web app's deterministic JSON formatting.
    text = json.dumps(
        notes,
        ensure_ascii=False,
        indent=2,
    ) + "\n"

    blob = api(
        "POST",
        "/git/blobs",
        json={"content": text, "encoding": "utf-8"},
    )

    tree = api(
        "POST",
        "/git/trees",
        json={
            "base_tree": base_tree,
            "tree": [{
                "path": "remember.json",
                "mode": "100644",
                "type": "blob",
                "sha": blob["sha"],
            }],
        },
    )

    commit = api(
        "POST",
        "/git/commits",
        json={
            "message": message,
            "tree": tree["sha"],
            "parents": [base_commit],
        },
    )

    api(
        "PATCH",
        f"/git/refs/heads/{BRANCH}",
        json={
            "sha": commit["sha"],
            "force": False,
        },
    )

    return commit["sha"]


notes, base_commit, base_tree = load_notes()

# Example CLI mutation:
notes["where-was-i"] = "Working on the Python API client"

new_commit = save_notes(
    notes,
    base_commit,
    base_tree,
    "Set /where-was-i",
)

print(f"Saved commit {new_commit}")
```

After this finishes, refreshing the web app will load that commit and display the new value.

## Compatibility rules

A Python client should preserve these app invariants:

- The root of `remember.json` must be a JSON object.
- Object keys must be nonempty.
- Keys in the same object must be unique case-insensitively; `Home` and `home` cannot coexist.
- Serialize with two-space indentation and a trailing newline.
- Avoid note values in commit messages because messages appear in the Git log.
- Never use `force: true` when updating the branch.
- On HTTP `409` or `422`, reload the current state and reapply the intended operation.
- Deletes are permanent: just remove the key from `remember.json`. There is no trash or recovery file to keep in sync.

The browser’s authentication relay is unnecessary for a Python CLI using a PAT. It exists only because browsers enforce CORS restrictions on GitHub’s device-flow endpoints; normal Python HTTP requests do not have that restriction. If desired, the CLI could instead implement the same GitHub App device flow and obtain its own app user token, but PAT authentication is substantially simpler for a personal CLI.
