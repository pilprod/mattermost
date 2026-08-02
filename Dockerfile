# syntax=docker/dockerfile:1.6
# Builds a patched Mattermost Team Edition image.
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

USER root

# The upstream Team image used for the patched 11.9 build does not contain the
# Calls bundle. Keep the test-only delivery deterministic by prepackaging the
# official, signed linux/amd64 bundle instead of enabling plugin uploads or
# downloading code at runtime. Mattermost verifies the adjacent signature when
# its signature policy is enabled and honours its own edition/license behaviour;
# this image does not modify, suppress, or bypass those checks.
#
# Calls v1.12.1 was the current stable bundle when Mattermost 11.9.0 was cut.
# The checksum pins the release asset independently of mutable GitHub URLs.
ARG CALLS_PLUGIN_VERSION=v1.12.1
ARG CALLS_PLUGIN_SHA256=23b7ed5cde46d931c290b97a514224956a0fe3ce4fa2a9ef9c6990e5e150e863
ARG CALLS_PLUGIN_SIGNATURE_SHA256=f627b9b47bdd5faad0425cdf55e7e34f0bee34557e2a6d162160e512d7d5fda1
ADD --checksum=sha256:${CALLS_PLUGIN_SHA256} --chown=2000:2000 \
  https://github.com/mattermost/mattermost-plugin-calls/releases/download/${CALLS_PLUGIN_VERSION}/mattermost-plugin-calls-${CALLS_PLUGIN_VERSION}-linux-amd64.tar.gz \
  /mattermost/prepackaged_plugins/mattermost-plugin-calls-${CALLS_PLUGIN_VERSION}-linux-amd64.tar.gz
ADD --checksum=sha256:${CALLS_PLUGIN_SIGNATURE_SHA256} --chown=2000:2000 \
  https://github.com/mattermost/mattermost-plugin-calls/releases/download/${CALLS_PLUGIN_VERSION}/mattermost-plugin-calls-${CALLS_PLUGIN_VERSION}-linux-amd64.tar.gz.sig \
  /mattermost/prepackaged_plugins/mattermost-plugin-calls-${CALLS_PLUGIN_VERSION}-linux-amd64.tar.gz.sig

# Replace Go binaries — both compiled with go1.26.5 to clear the stdlib CVEs.
COPY --from=server-builder --chown=2000:2000 \
    /out/mattermost /mattermost/bin/mattermost
COPY --from=server-builder --chown=2000:2000 \
    /out/mmctl /mattermost/bin/mmctl

# Replace the compiled webapp.
# The official image serves static files from /mattermost/client/.
COPY --from=webapp-builder --chown=2000:2000 \
    /src/webapp/channels/dist/ /mattermost/client/

USER 2000
