# syntax=docker/dockerfile:1

# The Pingpong image: the server and the pingpong CLI. Build it from the repository root:
#
#   docker build -f docker/Dockerfile -t pingpong .
#
# The base image is the same as Eclair's, pinned by digest.

FROM node:24.22.0-trixie-slim@sha256:7f486cabe892bff8fef04c0f7da8dba84a560be3e4e2740b7a86afc57ebec315 AS node

# The Pingpong packages, as they are published to npm, with their production dependencies. The
# dashboard ships its built app only (decision 0009): it brings no runtime dependency.
FROM node AS app

WORKDIR /src

COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY spikes/socket-io/package.json spikes/socket-io/
RUN npm ci --ignore-scripts

COPY config config
COPY packages packages
RUN npm run build -w @pingpong-io/protocol -w @pingpong-io/dashboard -w @pingpong-io/server \
    && mkdir /tmp/packs \
    && npm pack -w @pingpong-io/protocol -w @pingpong-io/dashboard -w @pingpong-io/server \
        --pack-destination /tmp/packs

# Unpack each package where npm expects its workspace, then install the server's production
# dependencies from the lockfile. The other workspaces only need their package.json for it.
WORKDIR /app
RUN cp /src/package.json /src/package-lock.json . \
    && for workspace in protocol dashboard server; do \
        mkdir -p "packages/${workspace}"; \
        tar -xzf /tmp/packs/pingpong-io-${workspace}-*.tgz -C "packages/${workspace}" --strip-components=1; \
    done \
    && mkdir -p packages/client spikes/socket-io \
    && cp /src/packages/client/package.json packages/client/ \
    && cp /src/spikes/socket-io/package.json spikes/socket-io/ \
    && npm ci --omit=dev --ignore-scripts --no-audit --no-fund -w @pingpong-io/server \
    && rm -rf /root/.npm

FROM node AS runtime

ARG DEBIAN_FRONTEND=noninteractive

# npm, Yarn and Corepack come with the Node image. Pingpong doesn't run them, and they bring their
# own dependencies to keep patched.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
        /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
        /usr/local/bin/docker-entrypoint.sh

RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=app /app /app
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/pingpong-entrypoint

# npm doesn't link the bin of a workspace package, so the pingpong command is a small wrapper.
RUN printf '#!/bin/sh\nexec node /app/packages/server/dist/cli/main.js "$@"\n' >/usr/local/bin/pingpong \
    && chmod 0755 /usr/local/bin/pingpong

# The pingpong user can only write to /var/lib/pingpong, the mount point of the data volume for a
# SQLite database.
RUN userdel --remove node \
    && groupadd --gid 10001 pingpong \
    && useradd --uid 10001 --gid pingpong --home-dir /nonexistent --no-create-home \
        --shell /usr/sbin/nologin pingpong \
    && install -d -o pingpong -g pingpong -m 0700 /var/lib/pingpong

ENV NODE_ENV=production \
    PINGPONG_PORT=3000

LABEL org.opencontainers.image.title="Pingpong" \
    org.opencontainers.image.description="Self-hosted, multi-tenant realtime server on Socket.IO" \
    org.opencontainers.image.source="https://github.com/folkloreinc/pingpong" \
    org.opencontainers.image.licenses="MIT"

USER pingpong
WORKDIR /app
EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--", "pingpong-entrypoint"]
CMD ["serve"]
