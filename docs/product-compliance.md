# YourOwn.Chat product and license boundary

This is an engineering compliance draft, not legal advice. It defines the
product boundary we intend to preserve while developing a future commercial
product from the public Mattermost Team Edition codebase.

## Product boundary

| Component | Intended delivery | License policy |
| --- | --- | --- |
| YourOwn.Chat Server and in-process server modifications | Public source and container image | AGPLv3 |
| Modified web application shipped by the server | Public source | Preserve the applicable upstream Apache-2.0 and AGPL notices |
| Closed desktop and mobile clients | Separate repositories and artifacts | Proprietary, communicating only through documented network APIs |
| Agent, Temporal, billing, policy, DLP, and organization services | Separate processes and deployables | May be proprietary when they remain independent programs |
| Mattermost `server/enterprise` source-available packages | Not included in a product binary | Upstream license only; do not modify, copy, or enable for the product |
| Private `mattermost/enterprise` sibling repository | Unavailable and forbidden | Must never be present in a product build environment |

The label "Enterprise" does not decide ownership or licensing. Origin and
integration do. New code compiled into the AGPL server, linked into the same
process, or exchanging internal data structures is treated as part of the
public server. Proprietary functionality belongs behind a documented REST,
WebSocket, event, or MCP boundary in a separately deployed process.

## Required build profile

The product image is built only by the repository-root `Dockerfile`.

- The runtime base must be `mattermost/mattermost-team-edition`.
- `.dockerignore` must exclude `server/enterprise` from the build context.
- The Go build must not use `enterprise` or `sourceavailable` build tags.
- The server entrypoint must not import `server/enterprise`, including its
  placeholder package.
- `model.BuildEnterpriseReady` must be `false`.
- `model.BuildHashEnterprise` must be `none`.
- The final image must contain `LICENSE.txt`, `NOTICE.txt`, and
  `PRODUCT-NOTICE.md`.
- The final image must set `org.opencontainers.image.source` to the exact
  public commit or immutable source archive used for that image.

The upstream `server/enterprise` directory remains in upstream history but is
excluded from the product Docker context. The product server dependency graph
must not import packages from it. The current product image intentionally keeps
the unmodified `mmctl` supplied by the official Team Edition runtime image:
building `mmctl` from this source tree still imports a source-available
compliance-export helper. Before a standalone public `mmctl` is shipped, remove
that command/dependency in a dedicated change.

Before a public product repository is cut, remove unused source-available files
from the repository after confirming that Team Edition commands and tests no
longer import their shared helpers.

## Network source offer

AGPL section 13 requires a deployed modified server to prominently offer
network users the Corresponding Source for the version they are using. Every
environment must therefore set:

```text
MM_SUPPORTSETTINGS_ABOUTLINK=https://github.com/<owner>/<public-server-repo>/tree/<exact-commit>
```

The link must resolve without authentication and include:

- the exact server and webapp source used by the deployment;
- build scripts and dependency manifests needed to produce the binaries;
- the complete license and notice files;
- fork patches and generated source needed to reproduce the deployed work.

A floating branch such as `main` or `public-patched` is not sufficient for a
released image. Use an immutable tag or commit.

## Branding

User-facing Mattermost names and logos should be replaced with YourOwn.Chat
branding before commercial launch. Do not remove upstream copyright,
attribution, LICENSE, or NOTICE content. Descriptive attribution such as
"based on Mattermost Team Edition" is allowed and should not imply endorsement.

Brand replacement is independent from licensing: it neither removes AGPL
obligations nor grants rights to Mattermost trademarks.

## Release checklist

1. Run `scripts/verify-product-compliance.sh`.
2. Build without custom `GOFLAGS` or Go build tags.
3. Record the public source commit in `SOURCE_URL`.
4. Confirm the About link points to the same immutable source.
5. Inspect `mattermost version`; Enterprise Ready must be `false`.
6. Inspect the final OCI labels and `/mattermost/licenses/`.
7. Publish the source before or at the same time as the network deployment.
8. Record third-party dependency and vulnerability reports with the release.
9. Require human approval when the dependency graph, licensing boundary, or
   Corresponding Source location changes.

## Provenance rules for new code

- Add a clear copyright notice for substantial new files.
- Record whether a change is original, adapted from upstream, or imported from
  a third party.
- Do not use inaccessible Mattermost Enterprise behavior or source as a
  copy-and-rewrite reference.
- Keep proprietary requirements expressed as public protocols and acceptance
  tests, not copied implementation details.
- Review any plugin that imports server internals as server code, not
  automatically as a separate proprietary component.
