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

---

## 2026-08-06 — Milestone 2 scope: reference data without availability

**Status:** Accepted

PROJECT_SPEC.md 16 names "therapists, services, rooms, availability, tariffs"
for Milestone 2. Availability is deferred to Milestone 4; the other four are
implemented.

- **Alternatives:** build the recurring-window and dated-exception model now.
- **Reason:** nothing consumes availability until appointment booking exists, so
  it would be built against imagined conflict rules rather than real ones. The
  four entities that later milestones genuinely depend on are complete.
- **Trade-off:** Milestone 4 begins with one more data model to design.
- **Revisit when:** Milestone 4 starts.

---

## 2026-08-06 — Receptionist holds no catalog permission in Milestone 2

**Status:** Accepted

All fifteen catalog permissions belong to `MANAGER`. `RECEPTIONIST` stays empty,
as in Milestone 1, and receives 403 on every catalog route and page.

- **Alternatives:** grant read-only catalog access now.
- **Reason:** no receptionist workflow reads this data yet. PROJECT_SPEC.md 4
  bars them from global tariff changes and grants them nothing here.
- **Trade-off:** a receptionist cannot look up a price before Milestone 4.
- **Revisit when:** Milestone 4 — grant the specific `.read` permissions the
  booking screen needs, a one-line change to `ROLE_PERMISSIONS`.

---

## 2026-08-06 — Therapist is reference data, not an account

**Status:** Accepted

The `therapist` table carries name, specialty, status and supported services.
There is no username, password, session or relation to `AppUser`, and no
settlement percentage.

- **Reason:** therapist login is separately approved and has not been
  (PROJECT_SPEC.md 4). Settlement percentages must be effective-dated and
  snapshotted per completed session, so a column here would be the wrong shape
  and would invite writing one.
- **Trade-off:** `createdBy` names the manager who entered the record, which
  reads like an account link and is not one.
- **Revisit when:** therapist access is approved, or Milestone 8 defines
  settlement.

Therapist names are deliberately not unique: two real people may share a name
and a specialty. No duplicate-warning workflow exists — that is approved for
families (Milestone 3), not for catalog entities.

---

## 2026-08-06 — Explicit PAID and FREE tariff modes

**Status:** Accepted

`priceMode` is stored explicitly and is never inferred from `price_toman = 0`.
`PAID` requires a price above zero and no reason; `FREE` requires exactly zero,
a stated reason, and a request-only `confirmFreePrice: true` that is never
persisted or audited.

- **Alternatives:** treat a zero price as free.
- **Reason:** the clinic runs genuinely free programmes, and that is a different
  fact from an ordinarily paid service discounted to nothing for one family. The
  first is a `FREE` tariff; the second stays `PAID` and belongs to the later
  discount model, which preserves the original price. Inferring from the amount
  would merge two facts that must stay distinct in reports and in history.
- **Trade-off:** one more column and a confirmation step in the form.
- **Revisit when:** never expected; the distinction is the point.

**A FREE tariff does not determine therapist compensation.** It states what the
family pays. Whether a therapist is paid for a complimentary session, and
whether the clinic absorbs the cost, is an independent decision and must not be
inferred from this column. Resolve it in Milestone 8.

---

## 2026-08-06 — Tariffs are corrected by void-and-replace, enforced in PostgreSQL

**Status:** Accepted

A tariff is immutable once written. The `tariff_enforce_immutability` trigger
permits exactly one transition — active to voided — and refuses every other
change, including unvoiding and rewriting a void reason. There is no update or
delete endpoint. A correction voids the row and inserts a replacement in one
transaction, writing `tariff.voided` and `tariff.created` as two audit rows.

Overlap is prevented by two partial `EXCLUDE USING GIST` constraints rather than
by reading before writing, so two simultaneous requests cannot both succeed. A
general and a therapist-specific tariff may share a date range, which is what
makes resolution precedence possible.

- **Alternatives:** in-place update with an audit row.
- **Reason:** PROJECT_SPEC.md 5 requires that changing a tariff never changes
  historical charges and that corrections are auditable adjustments rather than
  silent overwrites. Enforcing it in the database means a future endpoint, a
  data-fix script or a psql session cannot rewrite a price that was already
  applied.
- **Trade-off:** more rows over time; every read filters `voided_at IS NULL`.
- **Revisit when:** never expected.

Requires the `btree_gist` extension, created by the migration. Confirm
extension-creation privilege on any managed production host.

---

## 2026-08-06 — Service durations and catalog associations preserve history

**Status:** Accepted

A duration any tariff has ever priced cannot be withdrawn, including one priced
by a voided tariff; the attempt surfaces as `SERVICE_DURATION_IN_USE`. Room
service restrictions and therapist supported-service associations are never
silently removed when a service is deactivated, and inactive services stay
listed and selected in the editing forms.

- **Reason:** a price that applied on a past date must stay readable, and
  configuration somebody entered is a decision — dropping it silently would mean
  reactivating a service does not restore a choice nobody reversed.
- **Trade-off:** a service cannot be tidied up once priced; deactivation is the
  route.
- **Revisit when:** never expected.

---

## 2026-08-06 — Date-only Gregorian storage, Jalali display, Asia/Tehran business date

**Status:** Accepted

Effective dates are PostgreSQL `DATE` and cross every contract as strict
`YYYY-MM-DD` Gregorian strings, never JavaScript timestamps. The web tier
converts to and from Jalali at its own edge, using a server-rendered
year/month/day control rather than `input type=date`, which is Gregorian in
every browser.

The clinic business timezone is **`Asia/Tehran`**, a constant in
`apps/web/src/server/clinic-time.ts`.

- **Alternatives:** UTC as the business date; a required environment variable
  for the timezone.
- **Reason:** Tehran is UTC+03:30 with no DST, so its calendar date rolls over
  at 20:30 UTC — using UTC would mislabel a tariff as current, future or expired
  for three and a half hours of every day. A constant beats a variable for a
  single-clinic product: one less thing to get wrong in a deployment, and the
  correct value is already known.
- **Trade-off:** multi-clinic operation would need the value to become
  configuration.
- **Revisit when:** multi-clinic or multi-timezone support is approved.

This helper classifies tariffs for display only. Tariff resolution uses the
caller-supplied service date and never "today": a session is priced by the day
it happened.

---

## 2026-08-06 — Tailwind CSS v4, CSS-first, no component toolkit

**Status:** Accepted

`apps/web` uses Tailwind CSS v4 via `@tailwindcss/postcss` and a
`@import "tailwindcss"` line in `globals.css`. There is deliberately **no
`tailwind.config.ts`**: v4 configures in CSS, and a JavaScript config file is the
legacy path.

No component library, no headless primitives, and no Client Components. A small
set of hand-written pieces in `apps/web/src/components/ui.tsx` covers the shapes
used across four or more screens.

- **Alternatives:** continue hand-written CSS; adopt a fuller toolkit.
- **Reason:** four entities of CRUD needed consistent responsive and accessible
  layout, and utilities solve that at build time without a client runtime. A
  component toolkit would be a larger dependency surface and would arrive before
  the public-site milestone sets the real visual language.
- **Trade-off:** one dev dependency; the first departure from Milestone 1's
  zero-framework baseline.
- **Revisit when:** Milestone 4 needs genuinely interactive widgets, or
  owner-approved brand assets arrive.

---

## 2026-08-06 — Accepted implementation deviations from the Milestone 2 plan

**Status:** Accepted

Four deviations were found during implementation and are kept deliberately.

**The `ServiceDuration` composite key is a declared Prisma relation, not
hand-written SQL.** The plan expected hand-written SQL. Written that way,
`prisma migrate diff --exit-code` returned 2 on every run: unlike CHECK
constraints and triggers, Prisma _does_ see foreign keys, so a hand-written one
reads as permanent schema drift and fails CI. `serviceId` participates in two
relations at once and Prisma accepts it, so the key lives in the datamodel and
drift is zero.

**Service and therapist rows are locked `FOR SHARE`, not `FOR UPDATE`, during
tariff creation.** A share lock still conflicts with the `UPDATE` a deactivation
performs — which is the requirement — while letting two unrelated tariff
creations for the same service proceed together. `FOR UPDATE` would serialise
all pricing work per service for no additional safety. Lock order is documented
and consistent: service, then therapist, then tariff.

**Three error codes are web-local rather than shared contract codes.**
`API_UNREACHABLE`, `TARIFF_BRANCH_CONTRADICTORY` and `TARIFF_DATE_INVALID` live
in `apps/web/src/server/errors-fa.ts`. NestJS cannot raise any of them: it never
sees an unbuilt payload or a Jalali date, and it cannot report its own absence.
They are covered by the same translation-coverage test as contract codes.

**An inverted effective range is caught by the contract, not the database.**
Both dates are individually valid, so nothing else would catch an end before its
start; it reached PostgreSQL, failed `tariff_effective_range_chk` and surfaced
as an internal error. A refinement mirroring that CHECK makes it an ordinary
validation failure.

---

## 2026-08-06 — Integration fixtures read the database clock

**Status:** Accepted

`seedUser` writes `password_updated_at`, `created_at` and `disabled_at` with
`transaction_timestamp()` in raw SQL, rather than relying on Prisma's
`@default(now())`.

- **Reason:** Prisma fills `@default(now())` in the query engine, on the client,
  while `UsersService` and `AuthService` write those columns with
  `transaction_timestamp()` in PostgreSQL. A fixture seeded through the client
  and compared against a server-written value is comparing two clocks, and any
  skew between the Node host and the database — which a Docker suspend and
  resume reliably produces — fails the password-reset assertion for a reason
  unrelated to the code under test.
- **Alternatives:** widen the assertion; add a tolerance; sleep.
- **Trade-off:** the fixture is raw SQL rather than a Prisma call, so a schema
  change touches it.
- **Revisit when:** never expected.

No production behaviour changed. PostgreSQL was always the authority for expiry
and security timestamps; the fixture now agrees with it.
`harness-clock.int-spec.ts` asserts the property directly rather than waiting
for a clock to drift on somebody's machine.
