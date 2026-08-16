# YourOwn.Chat product and license boundary

This engineering policy is not legal advice. It defines the product boundary
used by the YourOwn.Chat build and release process.

## Repository boundary

| Component | Repository and delivery | Policy |
| --- | --- | --- |
| Modified Mattermost server | Public `pilprod/mattermost` source and product image | AGPLv3 Corresponding Source is published for every deployed revision |
| Modified web client | Versioned `pilprod/yourown-chat-web` source and compiled assets | Preserve all applicable upstream licenses and notices |
| Image assembly | `pilprod/yourown-chat-mattermost` | Owns Dockerfile, immutable source pins, build metadata, and image verification |
| Platform delivery | Public `pilprod/yourown-chat` Terraform and Helm | Owns Cloud Build, scanning, attestations, Cloud Deploy, and runtime configuration |
| Independent backend and agent services | Separate processes and repositories | Communicate through documented network protocols; never import Mattermost server internals |
| Mattermost source-available enterprise packages | Excluded from the product server branch and image context | Must not be copied or reintroduced |

## Required server profile

- Build without `enterprise` or `sourceavailable` tags.
- Do not import `server/enterprise`; that directory is absent from the product
  branch.
- Set `model.BuildEnterpriseReady=false` and
  `model.BuildHashEnterprise=none`.
- Compile `model.BuildSourceURL` from the exact public server commit.
- Preserve `LICENSE.txt`, `NOTICE.txt`, and `PRODUCT-NOTICE.md` in the product
  image assembled by `pilprod/yourown-chat-mattermost`.
- Record exact server, web, and assembly commits in OCI labels and provenance.
- Generate an SBOM and max-mode provenance, scan the pushed digest, and retain
  the vulnerability report before deployment.

## Version and source contract

For product version `X.Y.Z[-suffix]`, the assembly must pin commits carrying:

- `vX.Y.Z[-suffix]-patched` in the server fork;
- `X.Y.Z[-suffix]` in the web repository;
- `X.Y.Z[-suffix]` in the assembly repository.

Cloud Build verifies the tag-to-commit relationship before compiling. Floating
branches are never release inputs. The server commit URL is the network source
offer and must resolve without authentication.

## Release checks

1. Review server and web changes independently against their upstream bases.
2. Confirm the assembly gitlinks point at the reviewed tagged commits.
3. Build only in Cloud Build from the tagged assembly revision.
4. Verify the pushed image's binaries, source labels, notices, and Team-only
   metadata.
5. Generate SBOM/provenance and pass the configured vulnerability gate.
6. Deploy to dev, run smoke tests, then require approval before production.
