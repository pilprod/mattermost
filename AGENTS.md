# Engineering Governance

Before making any change in this repository:

1. Initialize the pinned `.engineering-public` submodule.
2. Read `.engineering-public/README.md` and every public policy document it
   lists.
3. If `.engineering-private/AGENTS.md` exists, read it and every private
   document it requires before applying the repository-specific instructions
   below.

The public rules always apply. A local `.engineering-private` overlay is
optional only for ordinary public-source work. Internal, release,
infrastructure, migration, secret, or production work must not proceed when
that overlay is unavailable or unread. This file is a discovery adapter and
does not create or override policy.

---

# AGENTS.md

Explicitly import subdirectory instruction files that must always be in context:
@server/AGENTS.md

## Branches, Tags & Releases

This is a customized fork (`pilprod/mattermost`) that layers fork patches on top
of official Mattermost **Team Edition** releases. Follow these rules for any
branch/tag operation. **When in doubt, ask — never force-push or delete a shared
ref without an archive and an explicit go-ahead.**

### Canonical fork branches (ours — treat as production)
- **`public-patched`** — the live production branch. This is what CI builds and
  what gets deployed. It always equals *the current supported upstream release +
  all fork patches*. Keep its history linear (rebased patches on top of the
  release tag), no merge commits.
- **`public-patched-<version>`** — version-pinned snapshots of the fork at a
  given upstream release (e.g. `public-patched-11.8.3`). The one matching the
  current release is kept identical to `public-patched`; older ones (e.g.
  `public-patched-11.8.1`) are **immutable archives** of a previous base. Do not
  rewrite or delete archives.

### Upstream mirror branches (not ours — do not touch)
- `master`, `release-*`, `cloud-*`, and the many `feature_*` / `*-backup`
  branches are mirrored from upstream `mattermost/mattermost`.
- **Never** modify, rebase, force-push, or delete them. Sync them from `upstream`
  **fast-forward only**; if a fast-forward isn't possible, leave the branch and
  report it — do not force.

### Tags
- **`v<version>-patched`** is the **only** release-tag pattern (e.g.
  `v11.8.3-patched`). CI builds an image on any
  `v*-patched` tag and publishes `<image>:<tag>` **and** `<image>:latest`.
- **No `-dev` tags/builds.** The `v*-patched-dev` tag pattern and its Cloud Build
  path were removed on purpose — do not reintroduce them.
- Upstream version tags (`v11.8.3`, `@mattermost/...`, etc.) are mirrored;
  never move or delete them.
- Moving a `-patched` release tag is done with `git tag -f` + `git push --force`
  **only** for the fork's own tags.

### Porting the fork to a new upstream release
1. Create `public-patched-<new>` from the new upstream tag and replay the fork
   patches: `git rebase --onto v<new> v<old> public-patched-<new>` (or rebase
   `public-patched`). Resolve conflicts, keep history linear.
2. **Prove equivalence:** `git diff public-patched public-patched-<new>` must
   equal the upstream `git diff v<old> v<new>` delta (same file set; only blob
   hashes / hunk offsets differ). If it doesn't, a patch was dropped or altered.
3. Build-verify Team Edition (`go build ./...` — see `server/AGENTS.md` and use a
   `go.work` linking `.` + `./public`; no enterprise sibling needed for TE).
4. Archive the outgoing base as `public-patched-<old>`.
5. Fast-forward `public-patched` to the new head, keep `public-patched-<new>` in
   sync, and move/create the `v<new>-patched` tag.

### Safety rules
- Before any force-update of `public-patched`, first create an archival branch
  (`public-patched-<oldversion>`) at the current tip, then push with
  `--force-with-lease` (never a bare `--force`).
- Do **not** create ad-hoc `*-backup` branches for the fork; use version-pinned
  `public-patched-<version>` archives instead.
- Work in throwaway worktrees (`git worktree add`); **never edit the main
  checkout** or another session's worktree directly. Clean worktrees up when done.
- Rename branches only via the provided tooling, never `git branch -m` on shared
  branches.

## Pull Requests

When creating a pull request, follow `.github/PULL_REQUEST_TEMPLATE.md` exactly:

- Remove all `<!-- -->` comments.
- Omit sections that are not applicable (Ticket Link, Screenshots) — do not write N/A, just remove the header.
- The `#### Release Note` header and its "```release-note" fenced code block **must always be present** (WITHOUT escaping the ``` characters). Write `NONE` if the change has no API, schema, UI, or breaking changes.

## Cursor Cloud Agents

This repository has a checked-in Cloud Agent environment under `.cursor/`. Docker is started by `.cursor/scripts/cloud-agent-start.sh`; if Docker is unavailable in Cloud, treat that as an environment failure rather than falling back to snapshot assumptions.

The environment declares `mattermost/enterprise` as a Cursor multi-repo dependency. Cursor clones the repositories as siblings, so `server/Makefile` can use its default `../../enterprise` path; the install hook does not clone or symlink enterprise.
