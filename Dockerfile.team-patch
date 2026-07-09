# syntax=docker/dockerfile:1.6
# Builds a patched Mattermost Team Edition image.
# Context: repository root (where server/ and webapp/ live).
# Usage:
#   docker build -f Dockerfile.team-patch -t mattermost-team-patch:latest .

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
# Pinned to 1.26.4: ships the patched stdlib for CVE-2026-42504 (mime),
# CVE-2026-27145 (crypto/x509) and CVE-2026-42507 (net/textproto).
FROM golang:1.26.4-alpine AS server-builder

WORKDIR /src/server
COPY server/ .

# Build metadata injected from CI, shown in the "About Mattermost" dialog.
# BUILD_NUMBER  = git tag name (e.g. v11.8.1-patched)
# BUILD_HASH    = full 40-char git commit SHA
# EE_BUILD_HASH = Cloud Build build ID (UUID)
# BUILD_DATE    = UTC ISO-8601 build timestamp
ARG BUILD_NUMBER=0
ARG BUILD_HASH=dev
ARG EE_BUILD_HASH=
ARG BUILD_DATE=

# go.work wires the main module (.) to the embedded public sub-module (./public).
# This mirrors what `make setup-go-work` does for Team Edition (no enterprise).
RUN go work init && go work use . && go work use ./public

RUN --mount=type=cache,target=/root/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    MODEL=github.com/mattermost/mattermost/server/public/model; \
    LDFLAGS="-s -w"; \
    LDFLAGS="$LDFLAGS -X $MODEL.BuildNumber=$BUILD_NUMBER"; \
    LDFLAGS="$LDFLAGS -X $MODEL.BuildHash=$BUILD_HASH"; \
    LDFLAGS="$LDFLAGS -X $MODEL.BuildHashEnterprise=$EE_BUILD_HASH"; \
    LDFLAGS="$LDFLAGS -X $MODEL.BuildDate=$BUILD_DATE"; \
    CGO_ENABLED=0 GOOS=linux \
    go build -buildvcs=false -ldflags="$LDFLAGS" \
        -o /out/mattermost ./cmd/mattermost && \
    CGO_ENABLED=0 GOOS=linux \
    go build -buildvcs=false -ldflags="$LDFLAGS" \
        -o /out/mmctl ./cmd/mmctl

# Fail the build if either binary was not compiled with the patched toolchain.
RUN go version /out/mattermost | grep -q 'go1\.26\.4' \
    || (echo "FATAL: mattermost not built with Go 1.26.4" && exit 1)
RUN go version /out/mmctl | grep -q 'go1\.26\.4' \
    || (echo "FATAL: mmctl not built with Go 1.26.4" && exit 1)


# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — final image
# The official image already has the correct directory layout, plugins,
# i18n files, etc.  We only replace the binary and the webapp assets.
# ─────────────────────────────────────────────────────────────────────────────
FROM mattermost/mattermost-team-edition:11.8 AS runtime

USER root

# Replace Go binaries — both compiled with go1.26.4 to clear the stdlib CVEs.
COPY --from=server-builder --chown=2000:2000 \
    /out/mattermost /mattermost/bin/mattermost
COPY --from=server-builder --chown=2000:2000 \
    /out/mmctl /mattermost/bin/mmctl

# Replace the compiled webapp.
# The official image serves static files from /mattermost/client/.
COPY --from=webapp-builder --chown=2000:2000 \
    /src/webapp/channels/dist/ /mattermost/client/

USER 2000
