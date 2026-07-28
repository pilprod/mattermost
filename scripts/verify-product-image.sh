#!/bin/sh

set -eu

if [ "$#" -ne 4 ]; then
    printf '%s\n' \
        "usage: $0 IMAGE EXPECTED_VERSION EXPECTED_REVISION EXPECTED_SOURCE_URL" >&2
    exit 2
fi

image=$1
expected_version=$2
expected_revision=$3
expected_source_url=$4

fail() {
    printf 'product image verification failed: %s\n' "$*" >&2
    exit 1
}

label() {
    docker image inspect \
        --format "{{ index .Config.Labels \"$1\" }}" \
        "$image"
}

test "$(label org.opencontainers.image.source)" = "$expected_source_url" ||
    fail "OCI source label does not match the immutable Corresponding Source"

test "$(label org.opencontainers.image.revision)" = "$expected_revision" ||
    fail "OCI revision label does not match the source commit"

test "$(label org.opencontainers.image.version)" = "$expected_version" ||
    fail "OCI version label does not match the source tag"

test "$(label org.opencontainers.image.licenses)" = "AGPL-3.0-only" ||
    fail "OCI license label is not AGPL-3.0-only"

created=$(label org.opencontainers.image.created)
test -n "$created" || fail "OCI creation timestamp is empty"

version_output=$(
    docker run --rm --entrypoint /mattermost/bin/mattermost "$image" version
)

printf '%s\n' "$version_output" |
    grep -Fq "Build Number: $expected_version" ||
    fail "server binary build number does not match the source tag"

printf '%s\n' "$version_output" |
    grep -Fq "Build Hash: $expected_revision" ||
    fail "server binary build hash does not match the source commit"

printf '%s\n' "$version_output" |
    grep -Fq "Build Enterprise Ready: false" ||
    fail "server binary is not a Team-only build"

docker run --rm --entrypoint /bin/sh "$image" -ceu '
    test -s /mattermost/licenses/LICENSE.txt
    test -s /mattermost/licenses/NOTICE.txt
    test -s /mattermost/licenses/PRODUCT-NOTICE.md
    grep -Fq "GNU Affero General Public License" /mattermost/licenses/LICENSE.txt
    grep -Fq "YourOwn.Chat Server modification notice" /mattermost/licenses/PRODUCT-NOTICE.md
' || fail "required license and attribution files are missing from the image"

printf '%s\n' 'product image verification passed'
