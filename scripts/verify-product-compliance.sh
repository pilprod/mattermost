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
    "$repo_root/docs/product-compliance.md" \
    "$repo_root/scripts/verify-product-image.sh"; do
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

for required_label in \
    org.opencontainers.image.revision \
    org.opencontainers.image.version \
    org.opencontainers.image.created \
    org.opencontainers.image.licenses; do
    grep -q "$required_label=" "$dockerfile" ||
        fail "OCI provenance label is missing: $required_label"
done

grep -q 'BuildSourceURL=' "$dockerfile" ||
    fail "server binary does not embed the Corresponding Source URL"

grep -q 'SOURCE_URL.*exact BUILD_HASH' "$dockerfile" ||
    fail "build does not bind the Corresponding Source URL to the exact revision"

grep -q 'LICENSE.txt NOTICE.txt PRODUCT-NOTICE.md /mattermost/licenses/' "$dockerfile" ||
    fail "license and notice files are not copied into the final image"

grep -qx 'server/enterprise' "$repo_root/.dockerignore" ||
    fail "server/enterprise is not excluded from the Docker build context"

if test -d "$repo_root/server/enterprise" &&
    find "$repo_root/server/enterprise" -type f -print -quit | grep . >/dev/null; then
    fail "source-available server/enterprise files are present in the product tree"
fi

if grep -R --include='*.go' 'mattermost/server/v8/enterprise' "$repo_root/server" >/dev/null; then
    grep -R --include='*.go' 'mattermost/server/v8/enterprise' "$repo_root/server" >&2
    fail "public Go source still imports Mattermost enterprise packages"
fi

if grep -E 'go build .*(-tags|--tags)[= ]*(enterprise|sourceavailable)' "$dockerfile" >/dev/null; then
    fail "product Dockerfile enables a restricted build tag"
fi

if grep -q 'mattermost/server/v8/enterprise' "$repo_root/server/cmd/mattermost/main.go"; then
    fail "server entrypoint imports Mattermost enterprise packages"
fi

if grep -q 'mattermost/server/v8/enterprise' "$repo_root/server/cmd/mmctl/commands/compliance_export.go"; then
    fail "mmctl compliance export imports a source-available server package"
fi

grep -q '^BUILD_ENTERPRISE := false$' "$repo_root/server/Makefile" ||
    fail "server Makefile does not fail closed to Team-only builds"

if grep -q 'BUILD_TAGS += sourceavailable' "$repo_root/server/Makefile"; then
    fail "server Makefile can enable source-available build tags"
fi

grep -q 'props\["BuildSourceURL"\]' "$repo_root/server/config/client.go" ||
    fail "Corresponding Source URL is not exposed to network clients"

grep -q "id='sourceCodeLink'" "$repo_root/webapp/channels/src/components/about_build_modal/about_build_modal.tsx" ||
    fail "About dialog does not prominently display the Source Code link"

if test -d "$repo_root/../enterprise"; then
    fail "private enterprise sibling repository is present next to the product source"
fi

sh -n "$repo_root/scripts/verify-product-image.sh" ||
    fail "product image verification script has invalid shell syntax"

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
            go list -deps ./cmd/mattermost ./cmd/mmctl
    )

    if printf '%s\n' "$dependencies" | grep '/enterprise/' >/dev/null; then
        printf '%s\n' "$dependencies" | grep '/enterprise/' >&2
        fail "default product dependency graph imports enterprise packages"
    fi
else
    printf '%s\n' 'warning: Go is unavailable; dependency graph check skipped' >&2
fi

printf '%s\n' 'product compliance checks passed'
