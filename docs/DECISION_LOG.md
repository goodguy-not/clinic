# Decision Log

Keep entries concise. Store final decisions, not chat transcripts.

## Template

**Date:** YYYY-MM-DD  
**Status:** Proposed | Accepted | Rejected | Superseded  
**Topic:**

- **Decision:**
- **Alternatives:**
- **Reason:**
- **Trade-off:**
- **Assumptions:**
- **Revisit when:**

## Accepted baseline

### Manual facts, automatic calculations

Receptionist records facts; the system derives sessions, charges, payments, credit/balance, and overdue promises.

### Family-level account

Balance belongs to the family; charge detail identifies the child.

### No online payment or native app initially

Initial value is reliable internal tracking. Parent-facing/native features are reconsidered after workflow and usage evidence.

### Next.js + NestJS direction

Next.js owns public/internal presentation and a selective BFF. NestJS owns PostgreSQL, domain rules, authorization, transactions, and audit. Implementation details remain open to reasoned refinement.

## 2026-08-02 — Group-session charge invariant

**Status:** Accepted

Each appointment participant may have at most one valid primary session charge.
An individual appointment has exactly one participant.

---

## 2026-08-02 — Therapist settlement basis

**Status:** Accepted

Therapist settlement is based on completed-session value and is independent of
whether or when the family pays.

Payment-to-charge allocation is therefore not required for therapist settlement.

Revisit payment allocation only if future requirements introduce insurance,
third-party payers, per-invoice payment, or another need to identify which
payment settled which charge.

---

## 2026-08-02 — Therapist share and discount allocation

**Status:** Accepted

Therapist settlement is based on completed-session value and is independent of
whether or when the family pays.

Therapist share percentages may differ by therapist and may change over time.
The percentage applied to a completed participant/session must be preserved as
a historical snapshot.

A family discount is split explicitly between the therapist and the clinic:

- therapist discount amount + clinic discount amount = total family discount;
- therapist net share = therapist gross share - therapist discount amount;
- clinic net share = clinic gross share - clinic discount amount;
- therapist net share must never be negative;
- the family's effective session charge must never be negative;
- clinic net share may be negative when the clinic explicitly bears a discount
  greater than its gross share.

For therapists who do not participate in discounts, therapist discount amount
is zero and the clinic bears the entire family discount, even when this produces
a negative clinic net.

A negative clinic net represents an explicit clinic subsidy or loss. It must be
visible in reports and preserve the applied split, actor, time, and reason.

Defaults may be defined per therapist. Any participant/session-level override
must be explicit, reasoned, and audited.

This decision supersedes any earlier wording that prohibited a negative clinic
net.

---

## 2026-08-02 — Money unit

**Status:** Accepted

Money is stored as integer **toman**, with no sub-unit, in `BIGINT` columns.

- **Alternatives:** rial.
- **Reason:** what the receptionist types equals what is stored and printed,
  removing a recurring order-of-magnitude entry error. Online payment is out of
  scope, so no gateway conversion is needed yet.
- **Trade-off:** a future payment gateway settles in rial and needs a documented
  conversion at that boundary.
- **Revisit when:** online payment enters scope.

---

## 2026-08-02 — Two-level appointment model

**Status:** Accepted

An appointment is the shared resource booking: one therapist, one room, one
service, one time range. An appointment participant is a child/family seat with
its own attendance outcome and price snapshot. An individual appointment has
exactly one participant; a group session has several.

- **Alternatives:** one appointment row per child with a shared group identifier.
- **Reason:** therapist and room overlap become plain exclusion constraints on a
  single booking row, and a group's time cannot drift across rows. Restructuring
  the appointment/charge spine after real financial history exists would be the
  most expensive migration in the project.
- **Trade-off:** one extra table and one join, paid from the first appointment
  milestone onward.
- **Revisit when:** group billing rules are approved and the group feature is
  built. The structure itself is settled.

Milestone 4 implements the structure; multi-participant booking UI and
group-specific features are deferred until explicitly approved.

---

## 2026-08-02 — ORM: Prisma

**Status:** Accepted

NestJS accesses PostgreSQL through Prisma. PostgreSQL-native constraints that
Prisma cannot express — partial unique indexes, `CHECK`, `EXCLUDE`, triggers —
are hand-written inside generated migration SQL and pinned by a test asserting
each constraint exists by name.

- **Alternatives:** TypeORM; a SQL-first query builder such as Kysely.
- **Reason:** migrations are plain, reviewable, checksummed SQL, which suits the
  review-before-apply workflow; generated types make omitted fields a compile
  error. TypeORM's advantages — declarative `CHECK`/`EXCLUDE`, locking helpers —
  are each a few lines of SQL, whereas its migration-generation weaknesses are
  not cheaply fixable.
- **Trade-off:** raw SQL for row locks and advanced constraints; the client is a
  single shared object, so module ownership of tables is a review convention.
- **Revisit when:** Prisma blocks a required PostgreSQL feature, or query
  overhead appears in reports.

Pinned to Prisma 6 rather than 7: Prisma 7 deprecates the `prisma-client-js`
generator in favour of an ESM-first generator, while NestJS compiles to
CommonJS, and the v7 CLI bundles Prisma Studio and an embedded database engine
that this project does not need. Revisit when the API moves to ESM or Prisma 6
leaves support.

---

## 2026-08-02 — Foundation stack and mechanical architecture boundary

**Status:** Accepted

pnpm workspace on Node 24; Next.js App Router and NestJS as the two
applications; PostgreSQL 17 via Docker Compose for development; Zod-validated
fail-fast environment configuration in both applications; ESLint flat config
with Prettier; Jest for the API and Vitest for the web application; GitHub
Actions CI running format, lint, boundary, typecheck, test, and build.

The rule that the web application never accesses PostgreSQL is enforced
mechanically rather than by convention:

- `apps/web` declares no database dependency and ESLint blocks importing one;
- the web environment schema declares no database connection string;
- the two applications have separate environment files. The root `.env` belongs
  to the API and holds the database connection string; `apps/web/.env.local`
  holds only `API_BASE_URL`. Nothing loads the root file into Next.js, so the
  connection string never enters the web process;
- CI scopes the database connection string to the single step that needs it,
  rather than defining it for the whole job;
- no catch-all API route may exist, so the BFF cannot become a generic proxy.

`pnpm check:boundary` verifies these in CI. It scans every hand-written file
under `apps/web` — source, build configuration and environment files, across all
module extensions — with no per-file exemptions, so the rule cannot be
documented or tested away.

- **Alternatives:** Turborepo for task orchestration; a single test runner; a
  generic proxy route for API access.
- **Reason:** two applications do not justify orchestration or caching
  infrastructure; Jest is the low-risk path for NestJS decorators and dependency
  injection, Vitest the natural fit for the web application; a boundary that is
  only documented eventually gets crossed.
- **Trade-off:** two test runners in one repository; CI reruns everything on
  every push.
- **Revisit when:** CI exceeds roughly five minutes, a third deployable appears,
  or maintaining two runners causes real friction.

---

## 2026-08-04 — Product and usability priorities for internal surfaces

**Status:** Accepted

This product serves a pediatric rehabilitation clinic in Iran. Security and
accounting correctness stay non-negotiable, and within that constraint
implementation decisions must also prioritise real clinic usability.

Internal manager and receptionist surfaces prioritise: fast, low-friction daily
workflows; minimal clicks with a clear next action; readable Persian RTL
layouts; responsive behaviour on desktop, tablet and mobile; accessible controls
and useful keyboard navigation; clear prevention of and recovery from human
error; correct Iranian date, time, number and toman presentation; calm,
professional, uncluttered visuals; and predictable loading, empty, success and
error states.

Internal authentication and administration pages are **not** optimised for
search engines and remain `noindex`.

The future public website prioritises a different set: polished, trustworthy
design for children and families; mobile-first responsive behaviour; performance
and Core Web Vitals; technical and local SEO; unique titles, descriptions and
structured data; clear service, clinic, therapist, contact and location
information; and accessible content with obvious contact paths.

- **Decision:** record these as governing principles for Milestone 2 onward, and
  deliberately **do not** retrofit them onto the Milestone 1 pages.
- **Alternatives:** redesign the Milestone 1 authentication and staff surfaces
  now to meet them.
- **Reason:** the Milestone 1 pages exist to prove an authentication and audit
  boundary. They are reached rarely — sign in once a shift, change a password
  twice a year, administer staff occasionally — so their usability ceiling is
  low and the work would compete with milestones that carry daily traffic.
  Recording the principles now means the surfaces that do carry that traffic are
  designed against them from the first line rather than corrected later.
- **Trade-off:** the current pages stay visibly plain, and someone reviewing
  them may reasonably read that as neglect rather than scope.
- **Assumptions:** no design system, brand assets or approved visual language
  exists yet; all of it is owner-provided and arrives with the public-site
  milestone.
- **Revisit when:** the first surface with genuine daily traffic is specified —
  appointments or the receptionist dashboard — or when owner-approved brand
  assets arrive.

---

## 2026-08-04 — Endpoint access needs four kinds, not three

**Status:** Accepted

Authorization is deny-by-default: every route carries exactly one access
classification, an unclassified route is rejected by the first guard, and a
coverage test fails the build for any route that carries none.

The approved design named three decorators — `PublicEndpoint`,
`AuthenticatedOnly`, `RequirePermissions` — plus the rule that `/health` is the
only route exempt from the internal key. Those cannot express `POST /auth/login`,
which must be reachable without a session while still requiring the internal
key, or `GET /health/db`, which reveals database state and should not be public.

- **Decision:** add a fourth classification, `InternalOnly`: internal key
  required, no session. It carries `/health/db` and `/auth/login`.
- **Alternatives:** treat login as `PublicEndpoint` and exempt it from the key;
  special-case the two paths inside the guard.
- **Reason:** making login public would widen the internal-key exemption from
  one route to two and put the authentication endpoint outside the private
  network boundary. A path special-case inside a guard is invisible at the
  route and cannot be enumerated by the coverage test.
- **Trade-off:** four decorators to learn instead of three.
- **Revisit when:** a route needs an access shape none of the four expresses.

---

## 2026-08-04 — Argon2 parameters are provisional until a pilot benchmark

**Status:** Accepted

Argon2id runs at `m = 19456 KiB, t = 2, p = 1` — the OWASP minimum — behind a
four-way semaphore that bounds peak hashing memory at roughly 76 MiB.

Measured at **~23 ms per verification** on the development machine, against the
50–100 ms the approved plan assumed. That is not a defect: the parameters are
the approved ones and the figure reflects fast hardware. It does mean the real
cost on pilot hardware is unknown, and cost is the entire point of the algorithm.

- **Decision:** keep the approved parameters; benchmark on the actual pilot host
  and raise `t` if a verification lands materially under the intended cost.
- **Alternatives:** raise `t` now on the strength of one measurement.
- **Reason:** tuning against a development laptop optimises for the wrong
  machine, and the encoded hash carries its own parameters, so raising them later
  costs nothing — `needsRehash` upgrades each password transparently at its
  owner's next successful sign-in.
- **Trade-off:** until the benchmark runs, the deployed cost is a guess.
- **Revisit when:** pilot hardware is chosen (Milestone 10), or the clinic moves
  hosts.
