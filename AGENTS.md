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

## Fork branches, source provenance, and product handoff

This is a maintained source fork (`pilprod/mattermost`) that layers identifiable
patches on official Mattermost **Team Edition** source. This repository owns
patched server source and provenance only; it does not own the assembled product
release. `pilprod/yourown-chat-mattermost` is the release owner. It pins the
exact reviewed Mattermost server, web, and RTCD source commits and starts the
authoritative product pipeline from its own immutable product tag.

Follow these rules for any branch or tag operation. **When in doubt, ask — never
force-push or delete a shared ref without an archive and an explicit go-ahead.**

### Canonical fork branches (source only)
- **`public-patched`** — the canonical current patched source branch. It becomes
  an input to the Mattermost assembly only after its exact reviewed commit is
  pinned by `pilprod/yourown-chat-mattermost`. It is not a production branch and
  must not directly publish an image or deploy an environment. Keep its patch
  history linear (rebased patches on top of the upstream release tag), with no
  merge commits in the source patch series.
- **`public-patched-<version>`** — version-pinned snapshots of the fork at a
  given upstream release (e.g. `public-patched-11.8.3`). The one matching the
  current source base is kept identical to `public-patched`; older ones (e.g.
  `public-patched-11.8.1`) are **immutable archives** of a previous base. Do not
  rewrite or delete archives.

### Upstream mirror branches (not ours — do not touch)
- `master`, `release-*`, `cloud-*`, and the many `feature_*` / `*-backup`
  branches are mirrored from upstream `mattermost/mattermost`.
- **Never** modify, rebase, force-push, or delete them. Sync them from `upstream`
  **fast-forward only**; if a fast-forward isn't possible, leave the branch and
  report it — do not force.

### Source provenance tags
- **`v<version>-patched`** (for example, `v11.10.0-patched`) is a fork source
  provenance marker only. It must not start image publication, create or update
  `latest`, create a delivery release, or roll out any environment.
- Do not create `-dev` source tags or restore a fork-owned dev/prod build path.
- Upstream version tags (`v11.10.0`, `@mattermost/...`, etc.) are mirrored;
  never move or delete them.
- Publishing, moving, or deleting a fork tag requires separate explicit
  authorization and must preserve the exact old and new source revisions in the
  handoff. A fork-tag operation never authorizes a product release.

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
5. Update `public-patched` and `public-patched-<new>` to the reviewed source
   head. If separately authorized, create the new `v<new>-patched` provenance
   marker, then hand the exact commit to `pilprod/yourown-chat-mattermost`. Do
   not build, publish, or deploy the assembled product from this fork.

### Product release handoff

After source verification, hand the exact reviewed commit and its provenance
marker, when one is authorized, to `pilprod/yourown-chat-mattermost`. Work in
this fork stops at source verification and handoff. The release-owning
repository pins the reviewed server, web, and RTCD inputs before its product tag
is created.

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

The Cursor Docker environment is limited to repository-local verification and
must not build or publish project release artifacts.

The environment declares `mattermost/enterprise` as a Cursor multi-repo dependency. Cursor clones the repositories as siblings, so `server/Makefile` can use its default `../../enterprise` path; the install hook does not clone or symlink enterprise.

The presence of an `enterprise` sibling is not license entitlement. Commercial
or Enterprise source or features may be used only after the applicable
entitlement is verified.
