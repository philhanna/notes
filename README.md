# Remember Notes

An installable, responsive browser for hierarchical JSON notes. The current
vertical slice uses `docs/remember.json` as fixture data and keeps edits in
memory. Pure domain operations and a repository interface separate the UI from
the planned GitHub persistence adapter.

## Development

Supported runtimes are current LTS Node releases: Node 20.19+, 22.13+, or 24+.

```sh
npm install
npm run dev
```

Quality gates:

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

The production build contains only the application shell and generic demo data;
it never imports the real sample notes from `docs/remember.json`.

## Implementation status

Implemented from `docs/impl.md`:

- strict Vite, React, TypeScript, Vitest, ESLint, and PWA foundation;
- pure JSON paths, validation, inference, deterministic serialization, search,
  and immutable add/update/rename/copy/move/delete/reorder operations;
- responsive tree navigation and editor with confirmations, preserved invalid
  input, search, breadcrumbs, and keyboard array controls; and
- persistence contract with a deterministic in-memory implementation.

Not yet implemented are the credential-dependent GitHub App spike and Phases
2–6: GitHub authentication/persistence, trash transactions, concurrency,
history/restoration/export, production security hardening, and live browser
acceptance tests. These require a GitHub App client ID, a disposable private
repository, and a deployed Pages origin to validate the plan's assumptions.
