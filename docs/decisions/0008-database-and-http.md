# 0008: PostgreSQL or SQLite through Kysely, Fastify for the API

- Status: accepted
- Date: 2026-11-06

## Context

Pingpong stores little: projects, their keys, encrypted secrets, origins and limits. Messages are never stored; recovery and history live in memory or in Redis. Eclair, the other shared Node service, runs on MySQL, PostgreSQL or SQLite through Kysely, with Fastify for its API.

## Decision

- **PostgreSQL** in production, **SQLite** (`node:sqlite`) for development, tests and installs on a single machine. Both go through Kysely, with the same portable migrations. MySQL isn't supported: nothing needs it.
- The SQLite adapter, the migrations runner and the encryption of secrets come from Eclair.
- **Fastify** serves the HTTP API on the same HTTP server as Socket.IO. The API reads the raw body, so it can check the request's signature (decision 0007).
- Projects are read through a cache with a short time to live, so a change made by the CLI or another server shows within seconds without reading the database on every connection.

## Consequences

- CI runs the server's tests on PostgreSQL 16 and on SQLite.
- Adding MySQL later means a new dialect in `database/connection.ts` and running the tests on it.
