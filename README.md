# Clinic Platform

Persian RTL rehabilitation-clinic platform.

- `apps/web` — Next.js App Router: public site, internal UI, and a selective BFF.
- `apps/api` — NestJS modular monolith. Owns PostgreSQL, domain rules, transactions, and audit.
- PostgreSQL — system of record.

See [CLAUDE.md](CLAUDE.md) for the architecture boundary and non-negotiable domain rules,
[docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) for product rules, and
[docs/DECISION_LOG.md](docs/DECISION_LOG.md) for accepted decisions.

## Prerequisites

- Node.js 24 (see [.nvmrc](.nvmrc))
- pnpm 11 — `corepack enable && corepack prepare pnpm@11.18.0 --activate`, or `npm install -g pnpm`
- Docker, for the development database

## Setup

```bash
pnpm install
```

The two applications have **separate** environment files, and this separation is
deliberate rather than cosmetic.

```bash
cp .env.example .env
```

```bash
cp apps/web/.env.local.example apps/web/.env.local
```

```bash
pnpm db:up
```

The root `.env` belongs to the NestJS API and the development database; it holds the
database connection string. `apps/web/.env.local` is loaded by Next.js and contains only
`API_BASE_URL`. Nothing loads the root `.env` into the web application, so the database
connection string never enters the Next.js process — NestJS owns PostgreSQL
(CLAUDE.md, Architecture boundary).

Both applications validate their environment and fail fast. The API refuses to boot on an
invalid environment; the web application validates in `next.config.ts`, so `next build`,
`next dev` and `next start` all abort before serving a request if `API_BASE_URL` is missing.

### Prisma client

`pnpm install` generates the Prisma client automatically via the API's `postinstall`, so a
fresh clone needs no extra step. Generation reads the schema only — it never connects, and
it does not require `DATABASE_URL`.

After editing `apps/api/prisma/schema.prisma`, regenerate explicitly:

```bash
pnpm --filter @clinic/api prisma:generate
```

## Running

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

| Endpoint                           | Purpose                                   |
| ---------------------------------- | ----------------------------------------- |
| `http://localhost:3001/health`     | API liveness; does not touch the database |
| `http://localhost:3001/health/db`  | Database reachability                     |
| `http://localhost:3000/api/health` | Web health, including API reachability    |
| `http://localhost:3000/`           | Foundation status page                    |

The development database is published on host port **5433**, not 5432, so it does not
collide with a locally installed PostgreSQL.

## Checks

```bash
pnpm check
```

Runs, in order: format check, lint, architecture boundary, typecheck, tests, builds.
Individual steps are available as `pnpm format:check`, `pnpm lint`, `pnpm check:boundary`,
`pnpm typecheck`, `pnpm test`, `pnpm build`.

CI runs the same sequence against a PostgreSQL service container
(see [.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Architecture boundary

The web application must never reach the database. This is enforced mechanically, not by
convention:

- `apps/web` declares no database dependency, and ESLint blocks importing one;
- the web environment schema declares no database connection string, so there is nothing
  to connect with, and the web application has its own environment file that never
  receives one;
- CI scopes the database connection string to the only step that needs it, so web lint,
  typecheck, test and build processes never see it;
- no catch-all API route may exist — a generic proxy is forbidden.

`pnpm check:boundary` verifies these and fails the build on any violation. It scans every
hand-written file under `apps/web` — source, build configuration and environment files
alike, across `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` and `.cjs` — and has no
per-file exemptions, so the rule cannot be documented or tested away.

## Development database

```bash
pnpm db:up
```

```bash
pnpm db:down
```

Credentials in `docker-compose.yml` are synthetic and local-only. Production secrets never
live in Git. Never use real clinic data in development, tests, seeds, or logs.
