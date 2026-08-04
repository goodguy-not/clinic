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
database connection string. `apps/web/.env.local` is loaded by Next.js and holds only what
the web tier needs. Nothing loads the root `.env` into the web application, so the database
connection string never enters the Next.js process — NestJS owns PostgreSQL
(CLAUDE.md, Architecture boundary).

Two secrets have no usable default and must be generated before anything starts. Generate
each once, then paste the **same** `INTERNAL_API_KEY` into both files:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`INTERNAL_API_KEY` goes in both `.env` and `apps/web/.env.local`; `SESSION_COOKIE_SECRET`
goes in `apps/web/.env.local` only. Both example files ship placeholders that say
`change_me` — they are not secrets and must never be used off a development machine. See
[Environment variables](#environment-variables) for the full list.

Both applications validate their environment and fail fast. The API refuses to boot on an
invalid environment; the web application validates in `next.config.ts`, so `next build`,
`next dev` and `next start` all abort before serving a request if any required variable is
missing or malformed, naming the ones at fault. CI proves this for each of the five.

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

| Endpoint                           | Purpose                                       |
| ---------------------------------- | --------------------------------------------- |
| `http://localhost:3001/health`     | API liveness; does not touch the database     |
| `http://localhost:3001/health/db`  | Database reachability; needs the internal key |
| `http://localhost:3000/api/health` | Web health, including API reachability        |
| `http://localhost:3000/login`      | Sign in                                       |

The development database is published on host port **5433**, not 5432, so it does not
collide with a locally installed PostgreSQL.

Nobody can sign in until a first manager exists. See
[Bootstrapping the first manager](#bootstrapping-the-first-manager).

## Checks

```bash
pnpm check
```

Runs, in order: format check, lint, architecture boundary, contracts build, typecheck,
unit tests, builds. Individual steps are available as `pnpm format:check`, `pnpm lint`,
`pnpm check:boundary`, `pnpm build:contracts`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

`pnpm check` deliberately needs **no database**, so it stays runnable on a machine with
nothing but Node. The database-backed suite is separate:

```bash
pnpm test:int
```

It requires `DATABASE_URL` pointing at a disposable database — see
[Integration tests](#integration-tests). CI runs both
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

## Authentication and audit (Milestone 1)

### Where the boundary sits

The browser talks only to Next.js. Next.js owns browser cookies, CSRF plumbing and
Persian error mapping. NestJS owns users, sessions, authentication decisions,
authorization, audit writes, database access and transactions.

```text
browser ──cookies──> Next.js ──x-internal-key────> NestJS ──> PostgreSQL
                              x-request-id
                              x-session-id (only after the cookie signature verifies)
                              x-client-ip / x-client-user-agent
```

**NestJS never trusts an identity claim from the web tier.** `x-user-id`, `x-user-role`,
`x-permissions` and `authorization` are read nowhere in `apps/api`. Identity comes from one
place: hash the opaque token in `x-session-id`, look it up in `user_session`, join
`app_user`. Role, status and permissions are re-resolved on every request, so a demotion,
a disable or a revocation takes effect on the very next call with no cached claim to
invalidate.

The outbound header set is built from scratch in `apps/web/src/server/api-client.ts`, which
accepts **no header bag**. There is no parameter through which a browser-supplied header
could be forwarded, so the rule holds by function signature rather than by review.

### Sessions

NestJS generates a 32-byte random token and stores **only its SHA-256 hash**, so a leaked
backup or query log yields nothing replayable. Next signs the token into a versioned opaque
cookie (`v1.<payload>.<HMAC-SHA256>`) verified with a timing-safe comparison. That signature
is defence in depth; the authoritative check is always the database lookup.

- rolling idle expiry **8 h**, absolute cap **12 h**, the cap enforced by a `CHECK` so no
  renewal bug can exceed it;
- `last_seen_at` is rewritten at most once per **5 minutes**;
- if a stale-session renewal affects zero rows, the request re-reads once and is rejected if
  the session is no longer valid — the pre-renewal snapshot is never used;
- every timestamp and expiry comparison is computed by PostgreSQL: `transaction_timestamp()`
  for facts that must agree with their audit row, `clock_timestamp()` for liveness;
- `cookieMaxAgeSeconds` is computed **in SQL** and used verbatim by Next, so the web tier
  never becomes a second security clock.

### Cookies and CSRF

|          | `DEPLOYMENT_MODE=production` | `non-production`     |
| -------- | ---------------------------- | -------------------- |
| session  | `__Host-clinic_session`      | `clinic_session_dev` |
| CSRF     | `__Host-clinic_csrf`         | `clinic_csrf_dev`    |
| `Secure` | always                       | no                   |

`HttpOnly`, `SameSite=Lax`, `Path=/` and no `Domain` in both. Different **names** per mode,
so a development cookie can never be mistaken for a production one, and no runtime flag can
weaken a production cookie.

CSRF is a signed double-submit pair: an HttpOnly cookie plus a server-rendered hidden field.
Before login the token is bound to nothing; after login it is bound to a fingerprint of the
raw session token, domain-separated so it is not the value NestJS uses as its database key.
A pre-login token replayed after authentication fails, and the reverse fails too.

Origin validation is strict on every state-changing handler: present, parseable, and an
exact match against `WEB_ALLOWED_ORIGINS`. **There is no `Referer` fallback** — `Referer` is
stripped by privacy settings far more often than `Origin` is, so a fallback becomes the path
everyone takes and the strict check stops meaning anything.

`apps/web/src/proxy.ts` does exactly one thing: issue the pre-login CSRF cookie for
`GET /login`. It cannot call NestJS, authenticate, authorize or reset a session, and tests
assert each prohibition.

**No handler mutates an authentication cookie on GET.** `SameSite=Lax` sends cookies on a
cross-site top-level GET navigation, so a cookie-clearing GET would let any page on the
internet sign a staff member out. Session reset is therefore a POST reached from a form on
`/session-expired`; its GET returns 405 with `Allow: POST`.

### Roles and permissions

| Permission            | Manager | Receptionist |
| --------------------- | :-----: | :----------: |
| `user.read`           |   yes   |      —       |
| `user.create`         |   yes   |      —       |
| `user.update_role`    |   yes   |      —       |
| `user.update_status`  |   yes   |      —       |
| `user.reset_password` |   yes   |      —       |
| `user.unlock`         |   yes   |      —       |
| `session.revoke_any`  |   yes   |      —       |

A receptionist holds **no** permission in Milestone 1 — deliberate, not an oversight. Their
access is the self-service endpoints, which need authentication but no permission.

Permission _names_ live in `@clinic/contracts` so the web tier can decide what to render.
The authoritative role-to-permission map lives in `apps/api` and nowhere else.

Four access classifications, one per route, deny-by-default: `PublicEndpoint` (`/health`
only), `InternalOnly` (internal key, no session — `/health/db` and `/auth/login`),
`AuthenticatedOnly`, and `RequirePermissions`. A route carrying none is rejected by the
first guard **and** fails a coverage test.

### Audit

`audit_log` is append-only, enforced by PostgreSQL: `BEFORE UPDATE`, `BEFORE DELETE` and
`BEFORE TRUNCATE` triggers raising SQLSTATE `23001`. The `TRUNCATE` trigger is not optional
— `TRUNCATE` bypasses row-level triggers entirely. `app_user` carries the same delete and
truncate protection, because user rows are permanent historical records.

`AuditService.record(tx, context, entry)` takes a transaction client as its first required
argument, so "the audit row commits with the state change" is a type error to get wrong, and
a runtime check rejects the base client. Payloads are hand-built; there is no automatic
diffing, which would capture password hashes and bury real changes under `last_seen_at`
churn. A payload guard throws on secret-looking keys and on any `$argon2` string, and a
database `CHECK` catches anything that gets past it.

**The durability boundary:** an unauthenticated request that does not cause a state
transition on an existing active account writes nothing to `audit_log`. Unknown usernames,
malformed identifiers, already-locked and disabled accounts, and forged session cookies go
to a rotatable operational security log instead — otherwise an attacker could grow an
unprunable table without bound. Successful logins and account-bound failure and lockout
transitions **are** audited transactionally.

One foreign key exists on `audit_log`: `actor_user_id`. `session_id` deliberately has none,
so expired sessions stay purgeable while the audit reference survives.

### Password policy

Length is measured in **Unicode code points of the NFC-normalised string** (NIST
SP 800-63B) — not UTF-16 units, not grapheme clusters: minimum 15, maximum 128, with
ill-formed input rejected first. No composition rules, no periodic expiry. Paste, autofill
and password managers are permitted, and a boundary check fails the build if anything blocks
them.

Argon2id at `m = 19456 KiB, t = 2, p = 1` behind a four-way concurrency semaphore. Every
login attempt performs **exactly one** verification — an unknown username is checked against
a dummy hash built at startup — and the outcome is computed only afterwards, so a locked or
disabled account costs the same as any other. Five failures inside a 15-minute window lock an
account for 15 minutes.

Persian and Arabic yeh and kaf are **never** folded together: they are different letters and
must remain different passwords. Persian (U+06F0–U+06F9) and Arabic-Indic (U+0660–U+0669)
digits _are_ folded to ASCII, but **only inside weak-pattern detection** — never for hashing,
storage, verification, NFC or general comparison. That is what lets one rule recognise
`۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵`, `١٢٣٤٥٦٧٨٩٠١٢٣٤٥` and `123456789012345` as the same weak shape, including
when they are mixed.

Keyboard-walk detection covers the standard Iranian layout (ISIRI 9147), **per row only**.
Rows are never joined: a slice spanning two rows is not something anyone can type, and
treating it as a walk would invent key adjacency. Slices of the Persian home row are real
words — `سیب` (apple) is three consecutive keys — which is why matching is whole-password and
never substring. Legacy, mobile and vendor-variant layouts are out of scope and not claimed.

The common-password list is the ≥15-character residue of a pinned public corpus:

```text
upstream   https://github.com/danielmiessler/SecLists
path       Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt
tag        2026.1
commit     190c6f7bd58c847ceadfe57d9853592737f059e8
licence    MIT (Copyright (c) 2018 Daniel Miessler)
retrieved  2026-08-04
entries    10,898
```

The plan originally named `10-million-password-list-top-1000000.txt`; that path does not
exist at this tag, because upstream renamed the file to credit its actual source. The
committed file carries the full provenance header, the source checksum and the exact
reproducible filter command, and is refreshed only by a reviewed pull request. It is never
fetched at build or run time, and there is no online breached-password lookup.

## Environment variables

Never commit a real value for any of these. `.env` and `.env.local` are ignored; the
`.example` files are the reviewed templates.

### `apps/api` — repository-root `.env`

| Variable                 | Required | Purpose                                                   |
| ------------------------ | -------- | --------------------------------------------------------- |
| `DATABASE_URL`           | yes      | PostgreSQL connection string. Never given to `apps/web`.  |
| `INTERNAL_API_KEY`       | yes      | Shared secret proving a request came from the web server. |
| `API_PORT`               | no       | Defaults to 3001.                                         |
| `NODE_ENV`               | no       | Defaults to `development`.                                |
| `PASSWORD_BLOCKED_TERMS` | no       | Comma-separated clinic terms a password may not contain.  |

### `apps/web` — `apps/web/.env.local`

| Variable                | Required | Purpose                                                   |
| ----------------------- | -------- | --------------------------------------------------------- |
| `DEPLOYMENT_MODE`       | yes      | `production` or `non-production`. No default, by design.  |
| `API_BASE_URL`          | yes      | Where NestJS listens.                                     |
| `INTERNAL_API_KEY`      | yes      | Must match the API's value.                               |
| `SESSION_COOKIE_SECRET` | yes      | HMAC key for the session and CSRF cookie signatures.      |
| `WEB_ALLOWED_ORIGINS`   | yes      | Comma-separated exact origins. All `https` in production. |

`DEPLOYMENT_MODE` is independent of `NODE_ENV` on purpose. `next start` forces
`NODE_ENV=production` even when you are testing a production build over plain HTTP on a LAN,
and that is a non-production _deployment_. Tying cookie security to `NODE_ENV` would either
break that case or invite an override flag that eventually gets set on a real server.
Nothing is exposed through `NEXT_PUBLIC_*`, and a boundary check fails the build if a
`NEXT_PUBLIC_` variable ever names a secret.

## Bootstrapping the first manager

There is no self-registration and no seeded account. The first manager is created from a
shell on the machine that can already reach the database, by an operator who could read it
anyway. An environment-driven bootstrap would put a plaintext password in the process list
and the deploy manifest; a migration or seed would commit a permanent, shared,
world-readable credential.

```bash
pnpm --filter @clinic/api build
```

```bash
pnpm --filter @clinic/api exec node dist/cli/main.js bootstrap-manager --username <username> --display-name "<display name>"
```

It refuses if **any** user row already exists, and an advisory lock serialises concurrent
attempts so only one can win. The generated password is printed once to stdout — never
through the logger, which in production is a shipping pipeline — and only its Argon2 hash is
stored. A password change is required at first sign-in.

Recovery, for a forgotten manager password. There is no email or SMS channel by design, so
this is the escape hatch:

```bash
pnpm --filter @clinic/api exec node dist/cli/main.js reset-password --username <username>
```

It applies the normal password policy, revokes the target's live sessions, forces a change at
next sign-in, and audits as a `SYSTEM` actor. Both commands accept `--password-stdin` to read
a password from a pipe. **Neither accepts `--password <value>`** — it is refused outright,
because by the time it runs the value is already in shell history and the process list.

## Integration tests

These run against real PostgreSQL. They truncate every table and temporarily disable the
audit triggers, so they need a **disposable** database — which is also a live demonstration
of the gap a separate non-owner runtime role would close in production.

```bash
docker exec clinic-db psql -U clinic -d postgres -c "CREATE DATABASE clinic_test"
```

```bash
DATABASE_URL='postgresql://clinic:clinic_dev_only@localhost:5433/clinic_test?schema=public' pnpm --filter @clinic/api exec prisma migrate deploy
```

```bash
DATABASE_URL='postgresql://clinic:clinic_dev_only@localhost:5433/clinic_test?schema=public' INTERNAL_API_KEY=<32+ synthetic characters> pnpm test:int
```

The harness accepts only a database whose name ends in `_test` or `_ci`. That is an
allowlist, not a blocklist: excluding `clinic_dev` by name would protect one database and let
a stray `DATABASE_URL` pointing at a pilot instance straight through.

`clinic_dev` is yours. Nothing in the test suite writes to it.

## Product priorities

This is a pediatric rehabilitation clinic in Iran. Security and accounting correctness are
non-negotiable; within that, implementation decisions also prioritise real clinic usability.
Internal surfaces aim at fast low-friction workflows, readable Persian RTL layouts,
responsive and accessible controls, clear error recovery, correct Iranian date, time, number
and toman presentation, and predictable loading, empty, success and error states. Internal
authentication and administration pages are **not** optimised for search engines and stay
`noindex`.

The Milestone 1 pages here are deliberately minimal and are **not** the model for that. They
exist to prove an authentication and audit boundary and are reached rarely. See
[docs/DECISION_LOG.md](docs/DECISION_LOG.md) for the full principles, which govern Milestone 2
onward.
