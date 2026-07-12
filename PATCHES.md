# Mattermost Team Edition — Custom Patches

This document describes all customizations applied on top of the official
Mattermost Team Edition release (`v11.8.3`). The patched image is published as
`mattermost:latest` / `mattermost:v11.8.3-patched`.

---

## 1. Dark Theme — OS Synchronization

**Files:** `webapp/channels/src/components/theme_provider/`

Adds automatic light/dark theme switching that follows the operating system
appearance setting (macOS / Windows / Linux).

- When the OS switches to dark mode the interface switches to the **Onyx** theme.
- When the OS returns to light mode the interface restores the user's saved
  light theme (Quartz by default).
- On the Desktop App (Electron) the native `onDarkModeChanged` API and
  `getDarkMode()` are used. A matchMedia listener and a 2 s polling fallback
  cover Electron versions that do not fire the native event reliably.
- In the browser, `window.matchMedia('(prefers-color-scheme: dark)')` is used.
- The chosen theme is applied at **module-load time** (before React renders)
  via a `localStorage` snapshot so there is no flash of wrong theme on hard
  refresh.
- The System Console always uses the light theme regardless of the OS setting.
- A "Sync with OS dark/light mode" checkbox is added to
  **Settings → Display → Theme**.

**Default for new users:** OS sync is **on** by default.  
Server saves `display_settings / sync_with_os_theme = "true"` when an account
is created.

---

## 2. Cyrillic Typography

**Files:** `webapp/channels/src/fonts/`, `webapp/channels/src/sass/base/_typography.scss`

Replaces the default Metropolis typeface with fonts that have full Cyrillic
coverage:

| Font | Weight | Use |
|------|--------|-----|
| **Inter** | 400, 500, 600, 700 | UI body text |
| **Jost** | 600 | Headings |
| **Montserrat** | 600 | Display / branding |

All fonts are self-hosted as WOFF2 files — no external CDN requests.

---

## 3. Keycloak / OIDC Authentication & Group Sync

**Files:** `server/channels/app/ldap.go`, `server/channels/api4/ldap.go`,
`server/channels/api4/group.go`, `server/channels/app/keycloak_ldap.go`,
`server/channels/app/channels.go`, `server/cmd/mattermost/main.go`

Provides SSO login and group synchronization on Team Edition **without** the
enterprise LDAP plugin. There is **no built-in LDAP bind login** — user
authentication is handled entirely by the OpenID Connect provider (§4);
the code registered as the `Ldap` interface is a Keycloak-backed group
provider, not an LDAP client.

### 3a. Authentication (login)

- Login/SSO is performed via **OpenID Connect** against Keycloak (see §4).
  The generic OIDC provider is standards-based, so other OIDC identity
  providers (e.g. **Authentik**, planned) work through the same code path.
- `KeycloakLdap.DoLogin` and the other `LdapInterface` user-auth methods are
  intentional stubs that return "handled by OIDC" — no LDAP bind is performed.

### 3b. Keycloak group sync

- `KeycloakLdap` (`keycloak_ldap.go`) implements the `LdapInterface` group
  methods using the **Keycloak Admin REST API**, reusing the OIDC client
  ID/secret (`client_credentials` grant) — so the standard group-sync UI
  (System Console → Groups, team/channel sync) works unmodified.
- Groups and their members are fetched from Keycloak; on server start and on
  group link, members are synced to Mattermost groups and propagated to teams
  and channels.
- `ldapGroupsAllowed()` helper: returns `true` when the LDAP provider is the
  Keycloak provider (no license check), or when a valid license with the
  `LDAPGroups` feature is present.
- Enterprise license checks are removed from the LDAP/group API handlers:
  `syncLdap`, `testLdap`, `testLdapConnection`, `testLdapDiagnostics`,
  `migrateIDLdap`, and the group-syncable handlers in `api4/group.go`.

> **Future — Authentik:** login already works via generic OIDC. Group sync is
> currently Keycloak-Admin-API-specific; an Authentik provider would add an
> analogous group-sync backend behind the same `LdapInterface`.

---

## 4. OpenID Connect Provider (JWKS / JWT)

**Files:** `server/channels/app/oauthproviders/openid/openid.go`

Extends the built-in OpenID Connect provider:

- **JWKS caching** — public key set is fetched once and cached to avoid
  repeated requests to the identity provider on every token verification.
- **JWT parsing and verification** — RS256 / ES256 signature validation against
  the cached JWKS.
- **Fallback merging** — if the userinfo endpoint returns incomplete data,
  fields are merged from the JWT claims (useful when Keycloak does not expose
  all scopes on the userinfo endpoint).
- `sub` claim validation for correct user identity binding.

---

## 5. Synthetic License (Feature Unlocking)

**Files:** `server/public/model/license.go`,
`server/channels/app/platform/license.go`

Enables features that are gated behind an Enterprise license on the unmodified
Team Edition binary, specifically those that have been re-implemented in this
fork (see §3 and §4 above). No commercial Mattermost features are unlocked —
only the custom built-in code paths are enabled.

---

## 6. UX Defaults for New Users

The following preferences are saved automatically when a new account is created
(`server/channels/app/user.go` → `createUserOrGuest`):

| Category | Name | Value | Effect |
|----------|------|-------|--------|
| `display_settings` | `sync_with_os_theme` | `true` | OS theme sync on (§1) |
| `display_settings` | `click_to_reply` | `false` | Clicking a message does **not** auto-open the thread panel |

### Click-to-open-thread disabled by default

In stock Mattermost, clicking anywhere on a message opens the thread in the
right-hand side panel. This patch sets `click_to_reply = false` so the panel
only opens when the user explicitly clicks **Reply**. Users can re-enable it in
**Settings → Display → Click to open threads**.

---

## 7. RHS Thread Panel — Wider Resize Limit

**File:** `webapp/channels/src/sass/layout/_sidebar-right.scss`

The stock application caps the right-hand side (thread / reply) panel at
400–776 px depending on viewport size. This patch replaces all fixed
`max-width` breakpoint values with `50vw`, allowing the panel to be dragged
up to **half the screen width** on any viewport.

The minimum width (304 px on wide screens) is preserved for usability.

---

## 8. Build Info in "About Mattermost" Dialog

**Files:** `Dockerfile`

The standard Team Edition build ships with empty **Build Number**, **Build Hash**
and **Build Date** fields in the "About Mattermost" dialog. This patch injects
them from the CI pipeline at compile time via Go ldflags:

| Field | Source |
|-------|--------|
| Build Number | Google Cloud Build `$BUILD_ID` |
| Build Hash | Short git commit SHA (`$SHORT_SHA`) |
| Build Date | UTC timestamp of the build (`date -u +%Y-%m-%dT%H:%M:%SZ`) |

Applied to both the `mattermost` and `mmctl` binaries.

---

## 9. Docker Build & CI/CD Pipeline

**Files:** `Dockerfile`

### Dockerfile

Multi-stage build (`Dockerfile`):

| Stage | Base | Output |
|-------|------|--------|
| `webapp-builder` | `node:24-bookworm-slim` | Compiled JS/CSS assets |
| `server-builder` | `golang:1.26.4-alpine` | `mattermost` + `mmctl` binaries |
| `runtime` | `mattermost/mattermost-team-edition:11.8` | Final image |

The final stage replaces only the server binaries and the webapp assets;
all other files (plugins, i18n, config templates) come from the official image.

Build assertions in `server-builder` fail loudly if either binary is not
compiled with Go 1.26.4.

### CI / Cloud Build

Image builds are triggered by pushing a `v*-patched` tag; the image is published
to Artifact Registry tagged `:<tag>` **and** `:latest`.

The Cloud Build pipeline configuration is **managed outside this repository**
(the former in-repo `gcp/cloudbuild.yaml` was removed). The build still uses the
multi-stage `Dockerfile` above and injects the build-info ldflags from CI
environment variables.

---

## 10. Security — Go Stdlib CVE Fixes

**Files:** `Dockerfile`, `server/go.mod`, `server/public/go.mod`,
`server/.go-version`

The toolchain is pinned to **Go 1.26.4** (released 2026-06-02), which ships
patched versions of the standard library that fix:

| CVE | Severity | Package | Description |
|-----|----------|---------|-------------|
| CVE-2026-42504 | High | `mime` | Quadratic CPU in `WordDecoder.DecodeHeader` |
| CVE-2026-27145 | Medium | `crypto/x509` | Quadratic `VerifyHostname` with many SANs |
| CVE-2026-42507 | Medium | `net/textproto` | Unescaped input in error messages |

Both `mattermost` and `mmctl` are compiled with this toolchain so neither
binary carries the vulnerable stdlib.

The remaining findings (glibc, openssl) originate from the upstream
`mattermost-team-edition:11.8` base image and have no upstream fix available.

---

## 11. Right-Click Context Menu on Messages

**File:** `webapp/channels/src/components/post/post_component.tsx`

Adds a Slack-like right-click context menu to every message. Right-clicking on
any message body prevents the browser's native context menu and instead opens
the post's existing **More actions** (dot-menu) inline — the same menu that
appears when hovering a message and clicking the `⋯` button.

- Works in the centre channel feed, RHS thread panel, and search results.
- Disabled while a post is being edited.
- Disabled on mobile view (touch devices retain native context menu behaviour).
- No new menu items are introduced; the menu reuses the full action set already
  present in the dot-menu (Reply, Forward, React, Save, Pin, Edit, Delete …).

---

## 12. Session Cookie Hardening (`SameSite=Lax`)

**File:** `server/channels/app/login.go`

Stock Mattermost leaves the `SameSite` attribute unset on the auth cookies
(`MMAUTHTOKEN`, `MMUSERID`, `MMCSRF`), relying on the browser default. This
patch sets `SameSite=Lax` **explicitly** on all three cookies when they are not
embedded (iframe) cookies.

- Reduces the risk of the auth cookie leaking in a cross-site context (a
  session-hijacking / CSRF vector).
- `Lax` still permits the top-level GET redirect used by the Keycloak/OIDC
  login flow, so SSO is unaffected.
- The existing embedded-cookie path (`SameSite=None` + `Secure`, for iframe
  embedding) is preserved unchanged.

`MMAUTHTOKEN` remains `HttpOnly` + `Secure` (on HTTPS) as before, so it is not
readable from JavaScript.

> **Operational session hardening** (recommended, configured in the System
> Console / IdP rather than patched into the binary) is documented separately —
> see the deployment security notes. In short: front bot/brute-force protection
> and MFA belong at the Keycloak/Authentik IdP, while Mattermost should run with
> a bounded `SessionLengthWebInHours`, a non-zero `SessionIdleTimeoutInMinutes`,
> `TerminateSessionsOnPasswordChange=true`, and `ExtendSessionLengthWithActivity`
> per the deployment's needs.
