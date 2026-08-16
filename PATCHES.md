# YourOwn.Chat server patches for Mattermost 11.10

This branch is based on the official Mattermost Team Edition tag `v11.10.0`.
It intentionally contains only server-side changes. The customized web client
is versioned and released independently from `pilprod/yourown-chat-web`.

## Authentication and identity

- Adds a generic OpenID Connect provider with JWKS caching, signed JWT
  validation, `sub` binding, and claim fallback when `userinfo` is incomplete.
- Adds Keycloak Admin API-backed group discovery and membership synchronization
  behind the existing group-sync interfaces. User authentication remains OIDC;
  the implementation does not provide LDAP bind authentication.
- Sets `SameSite=Lax` explicitly for non-embedded authentication cookies while
  preserving Mattermost's `SameSite=None; Secure` behavior for embedded use.

## Server behavior

- Adds server-side defaults for OS theme synchronization and explicit
  click-to-reply behavior for newly created users.
- Exposes the immutable Corresponding Source URL in client configuration and
  server build metadata.
- Keeps the public product build Team-only: source-available
  `server/enterprise` packages and enterprise-only command wiring are absent.
- Supplies the public feature metadata needed by the independently implemented
  OIDC and Keycloak group paths. It does not import Mattermost Enterprise code.

## Release boundary

The server fork no longer owns a Dockerfile or webapp patches. Image assembly,
toolchain pinning, SBOM/provenance generation, vulnerability scanning, and
Cloud Deploy promotion live in `pilprod/yourown-chat-mattermost` and the public
platform repository. A product version `X.Y.Z[-suffix]` uses:

- server tag `vX.Y.Z[-suffix]-patched`;
- web tag `X.Y.Z[-suffix]`;
- assembly tag `X.Y.Z[-suffix]`.

The exact server commit is compiled into the binary and recorded in OCI
provenance by Cloud Build.
