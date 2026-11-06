# 0005: Repositories, packages, license and releases

- Status: accepted
- Date: 2026-11-06

## Decision

- **`folkloreinc/pingpong`** is a monorepo with npm workspaces: `@pingpong-io/protocol`, `@pingpong-io/server` (with the `pingpong` CLI) and `@pingpong-io/client`. The server is also a Docker image.
- **`folkloreinc/laravel-pingpong`** is a separate repository for `folklore/laravel-pingpong`, the Laravel broadcaster: Composer packages are easier to publish from their own repository.
- **MIT** license. The repository is public.
- All `@pingpong-io/*` packages and the image share one version, managed with changesets. Releases are tagged.
- `main` is the development branch until 1.0. A `v1.x` maintenance branch is created at 1.0.0, as for the other Folklore packages.
- Spikes live in `spikes/`, as private workspaces that are never published nor imported by the packages.

## Consequences

- A change to the protocol and its server implementation can be one pull request. The PHP broadcaster follows in its own repository.
- The `@pingpong-io` npm organization has to be claimed before the first release.
