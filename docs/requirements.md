# Notes app
This document describes the requirements and use cases for an
application for easily keeping key=value notes.

These requirements are kept in sync with `docs/design.md`; where the design
resolved an ambiguity left open here, this document reflects that decision
rather than the original open question (see `docs/questions.md`).

## Requirements

### Access
- Must store data in the cloud so that it can be accessed from anywhere
- Must be able to use an Android phone app to list/get/set notes
- Must be able to use a desktop Ubuntu app
- Must be able to use a web-based app from anywhere
- Must be installable as a Progressive Web App (its own icon and window on
  Android and Ubuntu), while remaining usable as an ordinary website in any
  browser that does not support installation
- Requires an internet connection; offline editing and background sync are
  not required

### Domain
- Similar to a JSON object
- Must support a tree of keys, similar to a registry or directories
- Each entry is exactly one of: an object (named children), an array
  (ordered children), or a scalar (string, number, boolean, or null) — an
  entry cannot simultaneously hold a value and have children
- Object keys must be case-insensitive for uniqueness (`Home` and `home`
  cannot coexist) but must preserve the user's original spelling for display
  and export
- Keys may contain spaces, punctuation, and special characters, including
  `/` and `~`; keys must not be empty, and there is otherwise no
  length or character restriction
- Arrays must be ordered, addressable by position, and support reordering

### Operations
- List keys at a level (like "ls")
- Drill down a level (like "cd")
- Get value for a key at this level
- Update value for that key
- Add a new key=value pair
- Add a new subtree (like "mkdir")
- Rename a key=value pair or subtree
- Move a key=value pair or subtree to another subtree
- Copy a key=value pair or subtree to another subtree, including all of a
  subtree's descendants
- Delete a key=value pair or subtree
- Must require explicit confirmation before any destructive action,
  including deletion and replacing a scalar with a subtree (or the reverse)
- Must never silently overwrite an existing key at the destination of a
  move, copy, or recovery — the user must choose how to resolve the conflict

### Trash and recovery
- Deleting a key=value pair or subtree must move it to trash rather than
  erasing it immediately
- Each trash entry must retain a stable ID, deletion time, original
  location, value type, and the complete original content (including all
  descendants, for a deleted subtree)
- Must support recovering a deleted entry to its original location, or to a
  different location if the original is now occupied
- Must support permanently deleting a single trash entry or emptying all
  trash
- Must make clear that emptying trash removes it from current view only; it
  does not erase the data from the underlying revision history

### Search
- Must support full-text, case-insensitive search across the current tree,
  matching keys, values, and breadcrumb paths
- Search must exclude trash and historical revisions

### History and restoration
- Every successful change must be recorded as a distinct, retrievable
  revision, retained indefinitely
- Must support viewing an earlier revision of a specific key or subtree,
  comparing it to the current version, and restoring just that key or
  subtree without affecting the rest of the document
- Restoring must not erase newer history; a restore must itself be
  undoable by restoring an even earlier or later revision

### Export
- Must support exporting the current tree as a standalone JSON file the
  user can save locally
- Export must contain only the active tree — no trash, history metadata,
  credentials, or repository settings

### Authentication and security
- Must authenticate the user against the cloud storage provider without the
  app ever seeing or storing the user's password
- Must request the minimum possible access — read/write to notes content
  only, and only for the one dedicated storage location, never the user's
  entire account
- Must never expose credentials, access tokens, or note content in the
  app's source code, deployed assets, logs, URLs, or local browser cache
- Must allow the user to sign out, removing locally stored credentials, and
  to revoke access entirely from the storage provider's own settings
- Is not required to provide end-to-end encryption; the storage provider
  can technically access the data, so this application must not be used as
  a password manager

### Storage and durability
- Must use a single private cloud repository as the sole backing store —
  no separate application server or database
- Must never create a storage repository or change its visibility on the
  user's behalf; the user creates and owns it
- Must rely on the storage provider's own revision history as the only
  backup mechanism; the app must not implement a separate automatic backup
  system
- Concurrent edits from two devices must not silently overwrite one
  another; conflicting writes must be detected, and the user's unsaved
  edit must be preserved when a conflict occurs

### Reliability
- Must preserve the user's unsaved input across connectivity loss, request
  errors, or an in-progress app update
- Must support rolling back to a previous version of the app if a release
  causes problems
