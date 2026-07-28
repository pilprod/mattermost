# syntax=docker/dockerfile:1.6
# Builds the AGPL-covered YourOwn.Chat Server from the public Mattermost Team
# Edition source. This product build must never use the `enterprise` or
# `sourceavailable` Go build tags.
# Context: repository root (where server/ and webapp/ live).
# Usage:
#   docker build -t mattermost-team-patch:latest .

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — webapp (JS/CSS assets)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS webapp-builder

WORKDIR /src/webapp

# Copy all sources first — postinstall needs workspace dirs (platform/*) to exist.
COPY webapp/ .
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev
# Outputs to channels/dist/
RUN npm run build


# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — server binary (Go)
# ─────────────────────────────────────────────────────────────────────────────
# Pinned to 1.26.5: ships the patched stdlib for CVE-2026-39822 and
# CVE-2026-42505, on top of the earlier CVE-2026-42504 (mime),
# CVE-2026-27145 (crypto/x509) and CVE-2026-42507 (net/textproto) fixes.
FROM golang:1.26.5-alpine AS server-builder

WORKDIR /src/server
COPY server/ .

# Build metadata injected from CI.
# BUILD_NUMBER  = git tag name (e.g. v11.8.1-patched)
# BUILD_HASH    = full 40-char git commit SHA
# BUILD_DATE    = UTC ISO-8601 build timestamp
ARG BUILD_NUMBER=0
ARG BUILD_HASH=dev
ARG BUILD_DATE=
ARG SOURCE_URL

# go.work wires the main module (.) to the embedded public sub-module (./public).
# This mirrors what `make setup-go-work` does for Team Edition (no enterprise).
RUN go work init && go work use . && go work use ./public

RUN --mount=type=cache,target=/root/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    test -n "$SOURCE_URL" || \
        (echo "FATAL: SOURCE_URL must identify the immutable Corresponding Source" && exit 1); \
    MODEL=github.com/mattermost/mattermost/server/public/model; \
    LDFLAGS="-s -w"; \
    LDFLAGS="$LDFLAGS -X $MODEL.BuildNumber=$BUILD_NUMBER"; \
    LDFLAGS="$LDFLAGS -X $MODEL.BuildHash=$BUILD_HASH"; \
    LDFLAGS="$LDFLAGS -X $MODEL.BuildHashEnterprise=none"; \
    LDFLAGS="$LDFLAGS -X $MODEL.BuildEnterpriseReady=false"; \
    LDFLAGS="$LDFLAGS -X $MODEL.BuildSourceURL=$SOURCE_URL"; \
    LDFLAGS="$LDFLAGS -X $MODEL.BuildDate=$BUILD_DATE"; \
    CGO_ENABLED=0 GOOS=linux \
    go build -buildvcs=false -ldflags="$LDFLAGS" \
        -o /out/mattermost ./cmd/mattermost && \
    CGO_ENABLED=0 GOOS=linux \
    go build -buildvcs=false -ldflags="$LDFLAGS" \
        -o /out/mmctl ./cmd/mmctl

# Fail the build if either binary was not compiled with the patched toolchain.
RUN go version /out/mattermost | grep -q 'go1\.26\.5' \
    || (echo "FATAL: mattermost not built with Go 1.26.5" && exit 1)
RUN go version /out/mmctl | grep -q 'go1\.26\.5' \
    || (echo "FATAL: mmctl not built with Go 1.26.5" && exit 1)


# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — final image
# The official image already has the correct directory layout, plugins,
# i18n files, etc.  We only replace the binary and the webapp assets.
# ─────────────────────────────────────────────────────────────────────────────
FROM mattermost/mattermost-team-edition:11.9 AS runtime

ARG SOURCE_URL

LABEL org.opencontainers.image.title="YourOwn.Chat Server" \
      org.opencontainers.image.description="AGPL collaboration server based on Mattermost Team Edition" \
      org.opencontainers.image.source="${SOURCE_URL}" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

USER root

# Replace both public binaries.
COPY --from=server-builder --chown=2000:2000 \
    /out/mattermost /mattermost/bin/mattermost
COPY --from=server-builder --chown=2000:2000 \
    /out/mmctl /mattermost/bin/mmctl

# Replace the compiled webapp.
# The official image serves static files from /mattermost/client/.
COPY --from=webapp-builder --chown=2000:2000 \
    /src/webapp/channels/dist/ /mattermost/client/

# Keep upstream attribution and the fork modification notice in every image.
COPY --chown=2000:2000 \
    LICENSE.txt NOTICE.txt PRODUCT-NOTICE.md /mattermost/licenses/

USER 2000
