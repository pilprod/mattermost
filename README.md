# YourOwn.Chat Server

> Product compliance draft based on the public Mattermost Team Edition
> codebase. This branch is not yet a production product release.

YourOwn.Chat Server is the public AGPL-covered collaboration server. Closed
clients, agent services, the control plane, and other commercial components
must remain separately deployed programs communicating through documented
network APIs.

The engineering license boundary, source-offer requirements, build profile,
branding policy, and release checklist are documented in
[docs/product-compliance.md](docs/product-compliance.md).

## Docs
If you need to install Docker Image:
```sh
docker image inspect europe-west3-docker.pkg.dev/yourown-chat/docker/mattermost:<tag_with_patched>
```

## How to build the binary locally

Go to the server module:

```sh
cd server
```

If `go.work` is missing for some reason, create it once:

```sh
go work init
go work use .
go work use ./public
```

Build a binary for your machine, mostly to check that everything compiles:

```sh
go build -buildvcs=false -o ./bin/mattermost ./cmd/mattermost
```

Check it:

```sh
./bin/mattermost version
```

If you need the same linux binary that goes into the Docker image:

```sh
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
	go build -buildvcs=false -ldflags='-s -w' \
	-o ./bin/mattermost-linux-amd64 \
	./cmd/mattermost
```

Or build only the binary inside Docker, without building the full image:

```sh
docker run --rm \
	-v "$PWD/server:/src/server" \
	-v gomod-cache:/go/pkg/mod \
	-v gobuild-cache:/root/.cache/go-build \
	-w /src/server \
	golang:1.26-alpine \
	sh -lc 'go work init 2>/dev/null || true; go work use . ./public; CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -buildvcs=false -ldflags="-s -w" -o ./bin/mattermost-linux-amd64 ./cmd/mattermost'
```

Short version: for a quick compile check, `go build ./cmd/mattermost` is usually enough. For the container, build with `GOOS=linux GOARCH=amd64`.

## How to run the container

If you changed code and want to test it locally, build the full Docker image from the repo root with the same tag that compose already uses:

```sh
docker build \
	--build-arg SOURCE_URL=https://github.com/pilprod/mattermost/tree/<exact-commit> \
	-t europe-west3-docker.pkg.dev/yourown-chat/docker/mattermost:<tag_with_patched> \
	.
```

Then recreate only the patched Mattermost container:

```sh
cd /Users/pilprod/Projects/chatops/mvp
docker compose up -d --force-recreate --no-deps mattermost-patched
```

After push to `public-pached-11.7`, Cloud Build publishes this image:

```sh
europe-west3-docker.pkg.dev/yourown-chat/docker/mattermost:<tag_with_patched>
```

On the server, pull it and recreate only the patched Mattermost container:

```sh
cd ~/chat-stack
docker compose pull mattermost-patched
docker compose up -d --force-recreate mattermost-patched
```

Quick check after restart:

```sh
docker compose logs -f --tail=100 mattermost-patched
```

## Licensing and source availability

This repository preserves the upstream Mattermost licenses, copyright notices,
and third-party attributions in [LICENSE.txt](LICENSE.txt) and
[NOTICE.txt](NOTICE.txt). Fork-specific attribution is in
[PRODUCT-NOTICE.md](PRODUCT-NOTICE.md).

The modified server is delivered under AGPLv3. Every network deployment must
prominently offer its users the exact Corresponding Source. Configure the
application's About link to the immutable source commit:

```text
MM_SUPPORTSETTINGS_ABOUTLINK=https://github.com/pilprod/mattermost/tree/<exact-commit>
```

This repository does not claim ownership of Mattermost trademarks. Mattermost
and its related marks belong to Mattermost, Inc. YourOwn.Chat Server is not
produced, sponsored, or endorsed by Mattermost, Inc.

Official references:

- https://github.com/mattermost/mattermost/blob/master/LICENSE.txt
- https://www.gnu.org/licenses/agpl-3.0.html
- https://mattermost.com/trademark-standards-of-use/
