#!/bin/sh

set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
dockerfile="$repo_root/Dockerfile"

fail() {
    printf 'product compliance check failed: %s\n' "$*" >&2
    exit 1
}

for required_file in \
    "$repo_root/LICENSE.txt" \
    "$repo_root/NOTICE.txt" \
    "$repo_root/PRODUCT-NOTICE.md" \
    "$repo_root/.dockerignore" \
    "$repo_root/docs/product-compliance.md"; do
    test -s "$required_file" || fail "missing required file: $required_file"
done

grep -q '^FROM mattermost/mattermost-team-edition:' "$dockerfile" ||
    fail "runtime image is not Mattermost Team Edition"

grep -q 'BuildEnterpriseReady=false' "$dockerfile" ||
    fail "BuildEnterpriseReady is not explicitly false"

grep -q 'BuildHashEnterprise=none' "$dockerfile" ||
    fail "BuildHashEnterprise is not explicitly none"

grep -q 'org.opencontainers.image.source=' "$dockerfile" ||
    fail "OCI source label is missing"

grep -q 'LICENSE.txt NOTICE.txt PRODUCT-NOTICE.md /mattermost/licenses/' "$dockerfile" ||
    fail "license and notice files are not copied into the final image"

grep -qx 'server/enterprise' "$repo_root/.dockerignore" ||
    fail "server/enterprise is not excluded from the Docker build context"

if grep -E 'go build .*(-tags|--tags)[= ]*(enterprise|sourceavailable)' "$dockerfile" >/dev/null; then
    fail "product Dockerfile enables a restricted build tag"
fi

if grep -q 'mattermost/server/v8/enterprise' "$repo_root/server/cmd/mattermost/main.go"; then
    fail "server entrypoint imports Mattermost enterprise packages"
fi

if grep -q -- '-o /out/mmctl' "$dockerfile"; then
    fail "product build compiles mmctl with source-available dependencies"
fi

if test -d "$repo_root/../enterprise"; then
    fail "private enterprise sibling repository is present next to the product source"
fi

if command -v go >/dev/null 2>&1; then
    temp_dir=$(mktemp -d)
    trap 'rm -rf "$temp_dir"' EXIT HUP INT TERM

    (
        cd "$temp_dir"
        go work init >/dev/null
        go work use "$repo_root/server" "$repo_root/server/public" >/dev/null
    )

    dependencies=$(
        cd "$repo_root/server"
        GOWORK="$temp_dir/go.work" GOFLAGS= \
            go list -deps ./cmd/mattermost
    )

    if printf '%s\n' "$dependencies" | grep '/enterprise/' >/dev/null; then
        printf '%s\n' "$dependencies" | grep '/enterprise/' >&2
        fail "default product dependency graph imports enterprise packages"
    fi
else
    printf '%s\n' 'warning: Go is unavailable; dependency graph check skipped' >&2
fi

printf '%s\n' 'product compliance checks passed'
