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
access is the self-service endpoints, which need authentication but no permission. That stays
true through Milestone 2; Milestone 3 grants them the eight family and child permissions and
nothing else (see [Families and children](#families-and-children-milestone-3)).

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

## Clinic reference data (Milestone 2)

Therapists, services, rooms and effective-dated tariffs — the data every later milestone
prices and schedules against. All of it is **manager-only**; a receptionist holds no catalog
permission and receives `403` on every route and page.

### Scope, and what is deliberately absent

Built: services with allowed durations, rooms with optional service restrictions, therapists
with supported services, and tariffs with `PAID`/`FREE` pricing, effective dating, overlap
prevention, resolution and void-and-replace correction.

Not built, and each for a stated reason:

| Absent                                                     | Why                                                                                                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Availability** (recurring windows, dated exceptions)     | Nothing consumes it until appointment booking exists. Deferred to Milestone 4, where real conflict rules will shape it.                                                                                            |
| **Therapist login**                                        | Therapist access is a separately approved decision that has not been made (PROJECT_SPEC.md 4). A therapist here is a record staff manage; there is no username, password or session, and no relation to `AppUser`. |
| **Therapist settlement percentage**                        | Effective-dated and snapshotted per session (Milestone 8). A plain column now would be the wrong shape and would invite writing one.                                                                               |
| **Family-specific tariffs**                                | Families arrive in Milestone 3. The column is additive when they do.                                                                                                                                               |
| **Receptionist catalog access**                            | No receptionist workflow reads this data yet. Milestone 4 grants the specific `.read` permissions the booking screen actually needs — a one-line change to `ROLE_PERMISSIONS`.                                     |
| Duplicate-warning workflows, near-duplicate name detection | Approved for families (Milestone 3), not for catalog entities.                                                                                                                                                     |

Real clinic data — actual service names, room names, therapists, prices — is owner-provided
(PROJECT_SPEC.md 15, 17). Nothing is seeded, and no realistic-looking clinic data appears in
code, fixtures or tests.

### Services

Name, public description, allowed durations, and an active/inactive status. `isPublic` is
recorded now and read by nothing until the public-site milestone.

A duration that any tariff has ever priced **cannot be withdrawn** — including one priced by a
voided tariff, because a voided tariff is history and history keeps its references. The
`tariff_service_id_duration_minutes_fkey` foreign key is `ON DELETE RESTRICT`, and the attempt
surfaces as `SERVICE_DURATION_IN_USE` rather than a raw constraint error. Deactivate the
service instead.

### Rooms

Name, status, and an allow-list of services. **An empty list means unrestricted** — the
common case. That asymmetry is why the form asks the question outright ("قابل استفاده برای
همهٔ خدمات" versus "محدود به خدمات انتخاب‌شده") rather than letting an untouched multi-select
mean "any service": the two are identical in the data, so the interface has to be what
distinguishes them.

A restriction naming a service that is later deactivated is **kept**. It is configuration
somebody entered, and reactivating the service must not require restoring a decision nobody
reversed.

### Therapists

Full name, specialty, status, and supported services. Names are **not unique**: two real
people may share a name and a specialty, and refusing the second would be refusing a person.

Supported services behave like room restrictions — replaced atomically with the therapist
update and its audit row, and never silently dropped when a service is deactivated. The edit
form keeps an inactive service listed, checked, and marked «خدمت غیرفعال».

### Tariffs

A price for one `(service, duration)`, either for a specific therapist or general
(`therapistId = NULL`), over an inclusive effective date range.

**Resolution** takes a service date and returns the applicable price. A therapist-specific
tariff wins over a general one for the same date; a miss is `TARIFF_MISSING`, a visible error
rather than a silent zero (PROJECT_SPEC.md 5). The service date is always the caller's — never
today — so a session in Mordad is priced by the tariff in force in Mordad, even if the service
or therapist has since been deactivated.

**Overlap** is prevented by two partial `EXCLUDE` constraints, not by reading before writing.
Two live general tariffs may not overlap for the same service and duration; two live
therapist-specific ones may not overlap for the same service, duration and therapist. A
general and a therapist-specific tariff may cover the same range — that is what makes
precedence possible. Concurrent overlapping inserts produce exactly one success and one
`TARIFF_OVERLAP`.

**Immutability.** A tariff is written once. The `tariff_enforce_immutability` trigger permits
exactly one transition — active to voided — and refuses every other change, including
unvoiding and rewriting a void reason. There is no update endpoint and no delete endpoint. A
correction voids the row and inserts a replacement in one transaction, producing two
independently inspectable audit rows (`tariff.voided`, then `tariff.created`). A replacement
must price the same service, duration and therapist scope; changing what is priced is a new
tariff, not a correction (`TARIFF_SCOPE_MISMATCH`). The price _mode_ may legitimately change
between `PAID` and `FREE` — that corrects what the price is, not what is priced.

### Paid and intentionally free

`priceMode` is explicit and is **never inferred from a zero amount**.

- `PAID` — a real price above zero, at most 1,000,000,000 toman (a fat-finger guard, not a
  modelled ceiling), and no free reason.
- `FREE` — exactly zero, a stated `freeReason`, and a request-only `confirmFreePrice: true`.

The clinic runs genuinely free programmes — complimentary screening, introductory
consultations — and that is a different fact from an ordinarily paid service discounted to
nothing for one family. The first is a `FREE` tariff; the second stays `PAID` and belongs to
the later discount model, which preserves the original price.

The confirmation is a deliberate speed bump: creating a free programme has to be something
somebody chose, not something they reached by leaving a field blank. It is **never persisted
and never audited** — there is no such column, and it appears in no audit payload.

**A `FREE` tariff says what the family pays and nothing else.** Whether the therapist is
compensated for a complimentary session, and whether the clinic absorbs the cost, is an
independent settlement decision (Milestone 8) and must not be inferred from this value.

### Dates, money and the clinic timezone

| Concern         | At rest                                           | Over the API                | In the interface                                   |
| --------------- | ------------------------------------------------- | --------------------------- | -------------------------------------------------- |
| Effective dates | PostgreSQL `DATE` (Gregorian, no time, no offset) | strict `YYYY-MM-DD` strings | Jalali, via server-rendered year/month/day selects |
| Money           | `BIGINT`, integer toman                           | decimal strings             | Persian digits, `٬` grouping, `تومان`              |

A date never crosses as a JavaScript timestamp, and money never crosses as a number — JSON has
no integer type, and a value above 2^53 would lose precision silently. `apps/api/src/common/
iso-date.ts` converts through UTC components only; local getters would shift the calendar day
either side of midnight depending on where the process runs.

The Jalali control is **not** `<input type="date">`: that widget is Gregorian in every browser,
and labelling it as Jalali would show one calendar while submitting another. Conversion happens
in the Route Handler, before the shared contract sees anything.

**The clinic business timezone is `Asia/Tehran`**, a constant in
`apps/web/src/server/clinic-time.ts`. It is used only to classify a tariff for display as
current, future or expired — never to resolve a price. Tehran is UTC+03:30 with no DST, so its
date rolls over at 20:30 UTC; using UTC or the server's local zone would mislabel a tariff for
three and a half hours of every day.

### Permissions

Fifteen catalog permissions, all held by `MANAGER` and none by `RECEPTIONIST`:

`therapist.read|create|update|update_status`, `service.read|create|update|update_status`,
`room.read|create|update|update_status`, `tariff.read|create|void`.

Voiding is separate from creating: correcting a price already in force is a different
authority from setting one, and later milestones may grant them differently.

### Endpoints

```text
GET    /catalog/services            GET    /catalog/rooms
GET    /catalog/services/:id        GET    /catalog/rooms/:id
POST   /catalog/services            POST   /catalog/rooms
PATCH  /catalog/services/:id        PATCH  /catalog/rooms/:id
PATCH  /catalog/services/:id/status PATCH  /catalog/rooms/:id/status

GET    /catalog/therapists          GET    /catalog/tariffs
GET    /catalog/therapists/:id      GET    /catalog/tariff-resolution
POST   /catalog/therapists          GET    /catalog/tariffs/:id
PATCH  /catalog/therapists/:id      POST   /catalog/tariffs
PATCH  /catalog/therapists/:id/status POST /catalog/tariffs/:id/void
```

No delete route exists on any of them. `/catalog/tariff-resolution` is deliberately not nested
under `/catalog/tariffs/`, where it would share a space with `/catalog/tariffs/:id` and depend
on route declaration order.

### Persian pages

`/services`, `/rooms`, `/therapists`, `/tariffs` — plus `new` and `[id]/edit` for the first
three, and `/tariffs/new?supersedes=<id>` for a tariff correction. There is no tariff edit page,
because there is no such thing as editing a tariff.

Server Components throughout, **zero client JavaScript on these pages**, ordinary form posts
to one Route Handler per state change, and redirect-with-error-code for failures. Tailwind
CSS v4 provides the utilities; there is no component toolkit and no client runtime. Milestone
3 adds the product's single allow-listed Client Component, on the family search screen only.

### Database objects

Seven tables — `therapist`, `service`, `service_duration`, `room`, `therapist_service`,
`room_service`, `tariff` — with two enums (`catalog_status`, `tariff_price_mode`).

The reviewed migration hand-writes what Prisma cannot express: 17 CHECK and EXCLUDE
constraints, 8 no-delete/no-truncate triggers, and the tariff immutability trigger. Every one
is pinned by name in `catalog-schema.int-spec.ts`, because `prisma migrate diff` does not see
CHECK constraints or triggers and would let one disappear silently.

`created_by_user_id` is `NOT NULL` on all four entity tables: there is no anonymous or system
path that creates clinic reference data.

The overlap constraints need the **`btree_gist`** extension, which the migration creates. It
requires extension-creation privilege — available in the dev and CI containers, and worth
confirming on any managed host before the pilot.

## Families and children (Milestone 3)

The first receptionist workflow, and the first personal data in the product: families with
their guardians, and the children who attend sessions. A family may have many children; the
balance that arrives in a later milestone belongs to the family, and every charge will name
the child (PROJECT_SPEC.md 5, 7).

This is also the first milestone a **receptionist** can use. They hold exactly the eight
family and child permissions and nothing else — no catalog, no tariffs, no user or session
administration.

### Scope, and what is deliberately absent

Built: family registration with one to six guardians, child registration, search across
family name, guardian name, child name, phone number and file number, duplicate detection
with an explicit acknowledgement step, editing, and active/inactive status for both records.

Not built, and each for a stated reason:

| Absent                                          | Why                                                                                                                                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Moving a child between families**             | It rewrites who owes for every session that child has ever had. A genuine reassignment is a designed, audited repair belonging to the milestone that owns financial history; until then PostgreSQL refuses it outright. |
| **Deleting a family or child**                  | Final records are voided or adjusted, never physically deleted (CLAUDE.md). Deactivation is the operation; no-delete triggers enforce the rest.                                                                         |
| **Merging two families found to be duplicates** | Merging moves children and, later, money. Same reason as reassignment: it belongs with financial history.                                                                                                               |
| **Family-specific tariffs, ledgers, balances**  | Milestones 5 onward. Nothing here calculates money.                                                                                                                                                                     |
| **Clinical records, diagnoses, therapy notes**  | Out of product scope entirely (CLAUDE.md, Product boundary).                                                                                                                                                            |

No real clinic data appears anywhere. Every fixture, test and example name is synthetic
(PROJECT_SPEC.md 17).

### Families and guardians

A family is a name, an optional address and note, a status, and one to six guardians.
Exactly one guardian is the primary contact, enforced by a partial unique index rather than
by application code. Guardians are current configuration, not history: an edit replaces the
set wholesale and `audit_log` records them as values, exactly as Milestone 2 does for
`therapist_service`.

Mobile and landline numbers are validated as Iranian numbers by the contract. A national
identifier (کد ملی) is optional everywhere it appears — requiring one would refuse a newborn
who does not have one yet, and slow the phone-call path this milestone exists to protect —
but when present its check digit is verified in the contract and its ten-digit shape is
pinned by a `CHECK`.

### Children

First and last name, birth date, sex, optional national identifier, optional legacy paper
file number, referral source, note and status.

`file_number` is **generated**, never accepted from a request: it is
`lpad(nextval('child_file_number_seq'), 5, '0')`, so nobody types it and nobody collides on
it. It is quoted aloud, printed and written on a paper file, so a number that could change
would not be an identifier — `child_enforce_identity_immutability` refuses any update to it,
and to `id`, `family_id`, `created_at` and `created_by_user_id`, with the same SQLSTATE
`23001` every other "the database refuses to rewrite this" failure raises.

### Search

`POST /families/search`, not `GET`. The term is a guardian's name, a child's name, a mobile
number or a file number — personal data, which must not reach a URL, browser history, a
`Referer` header or an access log.

Matching runs over normalised copies of the searchable columns (`fa_normalize`, which folds
Arabic/Persian letter variants, Persian and Arabic-Indic digits, and diacritics), so a name
typed with a Farsi ی finds one stored with an Arabic ي. A digit query matches a phone number
by suffix once it reaches four digits — shorter than that it returns most of the clinic — and
matches a file number exactly. An empty query returns the 25 most recent registrations, which
is the "I just registered them" path. Results cap at 50 with a `truncated` flag rather than
paging.

### Duplicate detection

Five rules, of which two **block** a write until a member of staff explicitly acknowledges
the candidate, and three are informational and never refuse anything:

| Rule                               | Kind          | Fires when                                                    |
| ---------------------------------- | ------------- | ------------------------------------------------------------- |
| `FAMILY_DUPLICATE_MOBILE`          | blocking      | An active family already holds one of the submitted mobiles.  |
| `CHILD_DUPLICATE_IN_FAMILY`        | blocking      | Same normalised name and identical birth date, in one family. |
| `SIMILAR_FAMILY_NAME_AND_GUARDIAN` | informational | Matching family name and a matching guardian name.            |
| `SIMILAR_CHILD_IN_OTHER_FAMILY`    | informational | Same name and birth date, in a different family.              |
| `SHARED_LANDLINE`                  | informational | Another family lists the same landline.                       |

Similarity alone is never a refusal. Two real families sharing a surname is ordinary, and
blocking them is the exact failure this milestone is built to avoid; the informational rules
return a `NoticeCode` alongside a write that succeeded.

**Blocking rules are recomputed under a lock, not merely read.** A check that reads before it
writes is not a check under concurrency: two receptionists registering the same family at the
same moment both read "no duplicate" and both insert. Every blocking rule is therefore
recomputed while a transaction-scoped advisory lock is held on the value being compared, with
one global lock order — `registration_draft` → `family` → `child` → advisory keys, and
ascending numeric key order within a class — so no two transactions can deadlock. Keys come
from PostgreSQL's own `hashtextextended`; a second implementation in Node would have to agree
bit for bit forever, and the day it stopped agreeing the mechanism would fail open.

The candidates offered back carry a family name, who answers the phone and the **last four
digits** of the number — enough to recognise a family, not a copy of an identifier in an
error body that staff may never read.

### Registration drafts

A duplicate is only detectable after a submission, and a Route Handler cannot render a page,
so something has to hold what was typed across the confirmation step. That something is a
`registration_draft` row, not a cookie: a signed cookie gives integrity, not confidentiality,
and a family with an address, a note and several guardians can exceed practical cookie size
limits — failing intermittently, and only for the largest records.

A draft is transient workflow state, not a domain record. It is never audited (auditing one
would create a permanent record of a submission that was never made), it carries no
no-delete or no-truncate trigger because deletion is how it ends, and neither its payload nor
its token is ever logged. It expires after ten minutes, measured by PostgreSQL.

Missing, expired, already consumed, wrong user, wrong session and wrong purpose all answer
`DRAFT_NOT_FOUND`. A draft token is a bearer credential, and distinguishing those conditions
would tell its holder which one they tripped — the same reasoning behind
`AUTH_INVALID_CREDENTIALS`.

The token reaches the browser exactly once, in the body of the `409`, and the web tier puts
it straight into an **HttpOnly cookie**. It never appears in a form field, in the
confirmation page's markup, or in a redirect target.

### Audit and personal data

`audit_log` is append-only and permanent, so anything copied into it is a second, unbounded,
undeletable store of that value. National identifiers and phone numbers are therefore reduced
to their last four digits — enough to confirm a row refers to the number in front of you, not
enough to be a copy of it. Names, notes and addresses are written in full: a change to a name
_is_ the fact being recorded.

Three layers enforce it. `audit-safe.ts` is the only place a family or child payload is
built; `assertAuditPayloadSafe` walks every payload and throws on an identifier that is
neither `null` nor exactly masked; and `audit_log_masked_identifiers_chk` makes PostgreSQL
refuse the row. The masked shapes are exact rather than prefixed — six asterisks and four
digits is unsatisfiable by a ten-digit value — so a full identifier cannot masquerade as a
masked one.

### Permissions

Eight permissions, held by both roles:

`family.read|create|update|update_status`, `child.read|create|update|update_status`.

A receptionist held no permission at all through Milestones 1 and 2. From here they hold
exactly these and nothing else, and `permissions.spec.ts` asserts both halves — what they
have, and what they still do not.

### Endpoints

```text
POST   /families/search              POST   /families/:familyId/children
GET    /families/:id                 GET    /children/:id
POST   /families                     PATCH  /children/:id
PATCH  /families/:id                 PATCH  /children/:id/status
PATCH  /families/:id/status          POST   /children/confirm-registration
POST   /families/confirm-registration POST  /children/confirm-update
POST   /families/confirm-update

GET    /registration-drafts/current
POST   /registration-drafts/discard
```

Search is a `POST` because its body is personal data. There is no delete route on anything,
and no route that changes a child's `familyId`. Each confirmation route lives on the
controller that owns the write it completes and supplies its own `DraftPurpose`, so a token
minted for one flow can never be spent on another.

### Persian pages

`/families`, `/families/new`, `/families/confirm`, `/families/[id]`, `/families/[id]/edit`,
`/families/[id]/children/new`, `/children/[id]/edit`.

Every one is `force-dynamic` and `noindex`, and every one carries `Cache-Control: no-store`
from `next.config.ts` — a cached family page on a shared reception machine is readable by
whoever sits down next. `Referrer-Policy` is `same-origin` rather than `no-referrer` on these
pages; see the decision log entry of 2026-08-09 for why `no-referrer` silently breaks every
form on them.

These pages hold the product's **one Client Component**,
`app/families/family-search.tsx`, whose entire job is to own `useActionState`. Family search
is a Server Action rather than a Route Handler precisely so the term never needs a URL, a
redirect or a cookie to survive — and reading an action's return value requires a client
hook. It is named in `CLIENT_COMPONENT_ALLOWLIST` in `scripts/check-web-boundary.mjs`, so a
second one is a visible diff in review rather than a quiet drift back towards a
client-rendered application. Everything else remains a Server Component.

`handler-coverage.test.ts` enumerates every `'use server'` module and fails the build for one
that does not resolve a session and name a permission — a Server Action is a
browser-reachable endpoint that no Route Handler guard covers.

### Database objects

Four tables — `family`, `guardian`, `child`, `registration_draft` — with four enums
(`record_status`, `guardian_relationship`, `child_sex`, `draft_purpose`).

The reviewed migration hand-writes 26 CHECK constraints, three partial unique indexes
(`guardian_one_primary_per_family_uq`, `child_national_id_uq`,
`child_legacy_paper_file_number_uq`), four no-delete/no-truncate triggers on `family` and
`child`, the child identity immutability trigger, and four functions: `fa_normalize`,
`search_like_escape`, `clinic_date` and `audit_identifiers_masked`. Every one is pinned by
name in `families-schema.int-spec.ts`, because `prisma migrate diff` does not see CHECK
constraints or triggers and would let one disappear silently.

`guardian` and `registration_draft` deliberately carry no delete trigger, for different
reasons: guardians are configuration replaced wholesale and recorded as audit values, and a
draft is meant to be consumed and removed.

As in both earlier migrations, a table owner can still `ALTER TABLE ... DISABLE TRIGGER`.
Closing that needs a runtime database role that does not own these tables, and remains a
production hardening item.

## Appointments (Milestone 4)

The clinic diary. Therapist working hours, one-time and weekly-recurring bookings,
conflict protection, the day view a receptionist keeps open, and the recorded
outcome of every session.

This is the first milestone with **daily traffic**, and the first where a
receptionist holds an operational authority beyond family records: they run the
diary end to end, including the one authorised override, and hold no permission
to reverse a completion.

### Scope, and what is deliberately absent

Built: recurring weekly availability with dated exceptions, one-time booking,
weekly recurrence with preview and all-or-nothing creation, therapist/room/child
conflict protection, move, cancellation by family or clinic, completion,
per-participant attendance, manager-only reopen, the daily operational review, and
a read-only tariff suggestion.

Not built, and each for a stated reason:

| Absent                                       | Why                                                                                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Price snapshot on the appointment**        | The snapshot exists so a session is charged the price of the day it happened, and booking is not that day. It arrives in Milestone 5 with the charge (decision log, 2026-08-13). |
| **Any charge, payment, balance or discount** | Milestone 5 onward. Nothing here reads a tariff except one read-only screen query, and nothing here writes an amount.                                                            |
| **`RESCHEDULED` and `VOIDED` statuses**      | A move is an audited in-place update of the same row, and there is no financial record yet to void (decision log, 2026-08-13).                                                   |
| **Group bookings**                           | The two-level structure is built and an individual appointment has exactly one participant. Multi-participant booking needs approved group billing rules.                        |
| **Multi-weekday or monthly recurrence**      | One weekday per series. A child seen twice a week is two series, which keeps "this and all future occurrences" a question with one answer.                                       |
| **Extending a series**                       | Not an approved operation. Shortening one is `cancel-from`; a longer arrangement is a new series.                                                                                |
| **Deleting an appointment**                  | A cancelled session stays visible in its day and in every report of it (PROJECT_SPEC.md 14). No-delete triggers enforce it.                                                      |
| **Therapist self-service scheduling**        | Therapist login is separately approved and has not been (PROJECT_SPEC.md 4).                                                                                                     |

No real clinic data appears anywhere. Every fixture, test and example is
synthetic (PROJECT_SPEC.md 17).

### Two facts: the booking, and the seat

`appointment` is the shared resource booking — one therapist, one room, one
service, one time range — and its `status` is one of four: `SCHEDULED`,
`COMPLETED`, `CANCELLED_BY_FAMILY`, `CANCELLED_BY_CLINIC`.
`appointment_participant` is a child's seat in it, and its `attendance` is
`PENDING`, `ATTENDED` or `NO_SHOW`.

**A no-show is a seat's outcome, not a booking's status.** The room was held and
the therapist waited. Neither fact is derived from the other: completing a session
does not resolve an outcome, and recording an outcome does not complete a session.
Milestone 5's rule — only an attended participant in a completed appointment may
be charged — needs both.

`SCHEDULED` and `COMPLETED` occupy the therapist, the room and the child; both
cancellations release all three, which is what makes a cancelled slot re-bookable.

### Time, dates and the week

`starts_at` and `ends_at` are `timestamptz`, and every calendar question about
them is answered by PostgreSQL — `clinic_date`, `clinic_clock_time`,
`clinic_day_start`, `clinic_moment` — so `Asia/Tehran` stays written once.

The week is **Saturday-first**: weekday 0 is Saturday and 6 is Friday, in the
contract, the database and every screen. PostgreSQL's `EXTRACT(DOW)` is
Sunday-first and is translated at the boundary; the native numbering is never
stored or returned.

A start carrying seconds is refused, and so is a session whose clinic start and
end days differ — the latter before the availability override is even considered,
because an overnight session is not a shape the model can express.

### Availability

Recurring weekly windows plus dated exceptions, and **no effective dating**: a
window applies whenever it is asked about, the set is replaced wholesale, and the
set that was replaced is preserved in `audit_log` as values.

One precedence rule, stated in exactly one place: a **closed-day** exception
suspends the recurring week for that date and leaves any **extra window** dated to
it standing. "Not my usual Saturday, but I will come in for 15:00–18:00" is the
arrangement that needs both.

Removing a dated exception is the only `DELETE` in the application, and it is
audited before the row goes.

### Conflicts, and the one override

| Rule                    | Mechanism                                                                     | Overridable                     |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------- |
| Therapist overlap       | `appointment_no_therapist_overlap_excl` — partial GiST exclusion, `[)` bounds | **No**                          |
| Room overlap            | `appointment_no_room_overlap_excl` — partial GiST exclusion, `[)` bounds      | **No**                          |
| Child overlap           | SQL recomputation under a transaction-scoped advisory lock on the child       | **No**                          |
| Outside therapist hours | `AvailabilityService.resolve` inside the booking transaction                  | Yes, with permission and reason |

The two exclusion constraints mean nothing reads before writing: two simultaneous
bookings for one room cannot both pass, whatever an application check saw first,
and the constraint that fired decides which resource the receptionist is told is
busy. Back-to-back sessions do not clash — `[)` bounds are the normal shape of a
clinic day.

The child's overlap cannot be a constraint (the child is on one table and the time
on another), so it is recomputed in SQL while an advisory lock is held on that
child — the mechanism the Milestone 3 duplicate rules use, for the same reason.

Booking outside a therapist's hours requires `appointment.override_availability`
**and** a stated reason, and is recorded twice over: on the appointment row for
operational visibility, and in the audit row's `metadata` with the hours it fell
outside, as values. Nothing else may be overridden.

Hard failures with no override at all: an inactive service, therapist, room, child
or family; a therapist who does not provide the service; a room not allowed to
host it; a duration the service does not offer; an invalid or overnight time.

### Recurrence

A series is a first booking plus a weekly rule: one weekday, one time of day,
every week or every n-th week, bounded by an occurrence count or a last date. The
first occurrence _is_ the pattern.

Two bounds, and a series must satisfy both: **at most 52 occurrences**, and **no
occurrence more than 12 months** after the first. Breaking either is
`RECURRENCE_RULE_INVALID` — never a silently truncated series.

**Preview writes nothing** and reports, per occurrence, whether it is outside the
therapist's hours and what would block it. It is advisory: the create re-decides
everything under its own locks. **Creation is all or nothing** — twelve
occurrences or none.

Every occurrence is an ordinary appointment with its own id, status, audit history
and seat. Moving or cancelling one week is the ordinary single-appointment
lifecycle; `cancel-from` and `update-from` act on the still-`SCHEDULED`
occurrences from a named pivot onwards, leaving completed and already-cancelled
weeks exactly as they are.

### Tariff suggestion

The day view and the appointment view resolve the current tariff live, against the
appointment's own clinic date, therapist, service and duration, through the same
SQL `/catalog/tariff-resolution` uses. It is **read-only, stored nowhere, and
non-blocking**: a service with no tariff shows `MISSING` rather than failing the
screen (PROJECT_SPEC.md 5).

The class that reads it holds no transaction and writes no row; the class that
books, moves, completes and cancels never looks at a tariff.

### Permissions

Eleven new grants for the receptionist: `therapist.read`, `service.read`,
`room.read`, `tariff.read`, `availability.read`, and
`appointment.read|create|update|cancel|complete|override_availability`.

Manager-only: `appointment.reopen` and `availability.manage`, plus every catalog
write as before. `permissions.spec.ts` asserts both halves.

### Endpoints

```text
GET    /availability/therapists/:therapistId/windows
PUT    /availability/therapists/:therapistId/windows
GET    /availability/therapists/:therapistId/exceptions
POST   /availability/therapists/:therapistId/exceptions
DELETE /availability/therapists/:therapistId/exceptions/:id
GET    /availability/resolution

POST   /appointments                     GET  /appointment-day
GET    /appointments/:id                 POST /appointment-series/preview
GET    /appointments/:id/view            POST /appointment-series
PATCH  /appointments/:id                 GET  /appointment-series/:id
POST   /appointments/:id/cancel          POST /appointment-series/:id/cancel-from
POST   /appointments/:id/complete        PATCH /appointment-series/:id/update-from
POST   /appointments/:id/reopen
PUT    /appointments/:id/participants/:participantId/attendance
```

`/appointment-day`, `/appointment-series` and `/availability/resolution` are paths
of their own rather than `/appointments/day` and the like: a literal segment
beside `:id` makes which route answers depend on declaration order.

`GET /appointments/:id` returns the plain booking and its seats — the shape every
write returns and what a caller re-reads to confirm a transition. `GET
/appointments/:id/view` is the screen-ready reading, with names and the price
suggestion. They are separate because a write must not carry a price, and a screen
must.

### Persian pages

`/availability`, `/therapists/[id]/availability`, `/appointments`,
`/appointments/new`, `/appointments/[id]`, `/appointments/[id]/edit`,
`/appointment-series/[id]`.

Every one is `force-dynamic` and `noindex`. The appointment and series pages carry
`Cache-Control: no-store` and `Referrer-Policy: same-origin` from
`next.config.ts`, for the reason the family pages do — a cached page on a shared
reception machine is readable by whoever sits down next.

The booking screen's **child search is a Server Action**, exactly as family search
is: the term is a child's or a guardian's name, and it must never reach a URL, a
redirect or a cookie. `app/appointments/new/booking-workflow.tsx` is the third and
final entry in `CLIENT_COMPONENT_ALLOWLIST`, alongside the weekly-availability
editor, which owns only local row state before its one wholesale `PUT`.

Every state-changing page action posts to a named Route Handler under `/api`,
which verifies strict Origin and the CSRF token before calling NestJS.
`handler-coverage.test.ts` enumerates all of them and fails the build for one that
does not.

### Database objects

Five tables — `appointment`, `appointment_participant`, `appointment_series`,
`therapist_availability`, `therapist_availability_exception` — with three enums
(`appointment_status`, `attendance_outcome`, `recurrence_end`) and a `timerange`
range type.

The five reviewed migrations hand-write the two GiST exclusion constraints on
`appointment`, one on `therapist_availability` and one on
`therapist_availability_exception`; a partial unique index for one closure per
date; the CHECK constraints that keep `ends_at`, the completion and cancellation
timestamps, the attendance timestamp, the override triple and the series bounds
internally consistent; no-delete and no-truncate triggers on the three appointment
tables; identity-immutability triggers on `appointment` and
`appointment_participant`; and three functions — `clinic_clock_time`,
`clinic_day_start` and `clinic_moment` — beside Milestone 2's `clinic_date`.

Every object is pinned by name in `appointments-schema.int-spec.ts` and
`availability.int-spec.ts`, because `prisma migrate diff` sees neither CHECK
constraints nor triggers and would let one disappear silently.

The two availability tables deliberately carry **no** delete trigger: they are
current configuration recorded in `audit_log` as values, like `guardian` and
`therapist_service`.

As in every earlier migration, a table owner can still
`ALTER TABLE ... DISABLE TRIGGER`. Closing that needs a runtime database role that
does not own these tables, and remains a production hardening item.

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
