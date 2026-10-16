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

---

## 2026-08-09 — Duplicate detection blocks on two rules and warns on three

**Status:** Accepted

Five duplicate rules exist. `FAMILY_DUPLICATE_MOBILE` and
`CHILD_DUPLICATE_IN_FAMILY` refuse a write until a member of staff explicitly
acknowledges the named candidate. `SIMILAR_FAMILY_NAME_AND_GUARDIAN`,
`SIMILAR_CHILD_IN_OTHER_FAMILY` and `SHARED_LANDLINE` are informational: the
write proceeds and the interface shows a notice.

- **Alternatives:** block on every similarity; warn on everything and block on
  nothing; make severity configurable per clinic.
- **Reason:** two real families sharing a surname is ordinary in Iran, and
  refusing them would be the exact failure this milestone exists to avoid —
  staff work around a system that blocks legitimate work, and the workaround is
  a worse record than the duplicate. A shared mobile number, by contrast, is
  almost always the same family called twice. Severity is a property of the
  rule, so both kinds live in one `DUPLICATE_RULES` list rather than being
  implied by which code path evaluated them.
- **Trade-off:** an informational rule can be ignored, so some duplicates will
  be created. Search and the acknowledgement trail are how they are found later.
- **Assumptions:** no merge operation exists yet, so a duplicate created today
  is repaired by hand until the milestone that owns financial history.
- **Revisit when:** pilot data shows either kind firing at a rate staff ignore,
  or a merge operation makes blocking cheaper to recover from.

---

## 2026-08-09 — Blocking duplicate rules are recomputed under an advisory lock

**Status:** Accepted

Every blocking rule is recomputed in SQL while a transaction-scoped advisory
lock is held on the value being compared, keyed by PostgreSQL's own
`hashtextextended`. One global lock order applies with no exceptions:
`registration_draft` → `family` → `child` → advisory keys, and within one
advisory class keys are taken in ascending numeric order.

- **Alternatives:** a unique index on mobile; read-then-write without a lock;
  `SERIALIZABLE` isolation for these transactions.
- **Reason:** a check that reads before it writes is not a check under
  concurrency — two receptionists registering the same family at the same moment
  both read "no duplicate" and both insert. A unique index cannot express the
  rule, because the duplicate is only blocking against _active_ families and is
  acknowledgeable. Sorting by derived key rather than by submitted value or
  submission order is what makes deadlock impossible.
- **Trade-off:** the 64-bit key space admits collisions, which cost unnecessary
  serialisation between two unrelated writes. Never a wrong answer: the lock is
  purely mutual exclusion and the authoritative decision is the SQL recomputation
  performed under it.
- **Assumptions:** key derivation stays in PostgreSQL. A second implementation
  in Node would have to agree bit for bit forever, and the day it stopped
  agreeing two writers would take different locks and the mechanism would fail
  open silently.
- **Revisit when:** a rule needs to compare something that is not a short text
  value, or lock contention becomes measurable at clinic scale.

---

## 2026-08-09 — Interrupted registrations are held in a database row, not a cookie

**Status:** Accepted

`registration_draft` holds a submitted payload for ten minutes between a blocked
write and its confirmation screen. The token is returned once in the `409` body
and lives in the browser only as an HttpOnly cookie.

- **Alternatives:** a signed cookie carrying the payload; re-posting the whole
  form from a hidden field; server session memory.
- **Reason:** a signed cookie gives integrity, not confidentiality, and a family
  with an address, a note and six guardians can exceed practical cookie size
  limits — failing intermittently, and only for the largest records. A row also
  survives a second web process with nothing that process had to have seen.
- **Trade-off:** a fourth table, and rows that must expire. Expiry is measured by
  PostgreSQL, never by Node.
- **Assumptions:** a draft is transient workflow state, not a domain record: it
  is never audited (a permanent record of a submission never made), it carries no
  no-delete trigger because deletion is how it ends, and neither payload nor
  token is logged.
- **Revisit when:** a workflow needs a draft to outlive one sitting, which would
  make it a domain record and change every one of these properties.

Every failure mode — missing, expired, consumed, wrong user, wrong session, wrong
purpose — answers `DRAFT_NOT_FOUND`. A draft token is a bearer credential, and
distinguishing them would tell its holder which condition they tripped.

---

## 2026-08-09 — Identifiers are masked in audit; names are not

**Status:** Accepted

National identifiers and phone numbers are reduced to their last four digits in
every `audit_log` payload and every duplicate-candidate response. Names, notes
and addresses are written in full.

- **Alternatives:** mask everything; mask nothing; encrypt audit payloads.
- **Reason:** `audit_log` is append-only and permanent, so a value copied into it
  is a second, unbounded, undeletable store of that identifier — held to answer
  "what changed, and who changed it?", which does not require the value itself.
  A change to a name, by contrast, _is_ the fact being recorded, and masking it
  would make the trail useless for the corrections it exists to explain.
- **Trade-off:** an auditor cannot reconstruct a previous phone number from the
  log alone. Four digits is enough to confirm a row refers to the number in front
  of them.
- **Assumptions:** the masked shapes stay exact rather than prefixed — six
  asterisks and four digits is unsatisfiable by a ten-digit value — so a full
  identifier can never masquerade as a masked one, which a "starts with an
  asterisk" rule would have permitted.
- **Revisit when:** a legal or regulatory requirement demands full identifiers in
  the audit trail, which would need a retention and access decision first.

Three independent layers enforce it: `audit-safe.ts` is the only place these
payloads are built, `assertAuditPayloadSafe` throws on a malformed one, and
`audit_log_masked_identifiers_chk` makes PostgreSQL refuse the row.

---

## 2026-08-09 — Family search is a POST, and a Server Action rather than a Route Handler

**Status:** Accepted

`POST /families/search` at the API boundary. In the web tier, search is a Server
Action (`app/families/search-action.ts`), not a Route Handler.

- **Alternatives:** `GET /families?q=`; a Route Handler that redirects with the
  term in the query string; a Route Handler that stores the term in a cookie.
- **Reason:** the term is a guardian's name, a child's name or a phone number.
  A URL reaches browser history, a `Referer` header, and every access and proxy
  log on the path. An action posts the term in a request body and answers in the
  response to that same request — there is no redirect to carry state across, so
  there is nothing to put in a query string and nothing to put in a cookie. The
  term exists for one request and is then gone.
- **Trade-off:** a search result cannot be linked to or bookmarked, and the back
  button re-submits rather than replays. Both are acceptable for a screen whose
  purpose is to find one family and open it.
- **Revisit when:** a reporting surface needs shareable filtered views, which
  would be non-personal filters and could use a URL.

A Server Action is a browser-reachable endpoint no Route Handler guard covers,
so it resolves its own session, names its own permission, and applies the same
strict Origin allow-list on top of the Origin/Host equality Next.js already
enforces. `handler-coverage.test.ts` enumerates every `'use server'` module and
fails the build for one that does not.

---

## 2026-08-09 — One allow-listed Client Component, superseding the Milestone 2 "none"

**Status:** Accepted — supersedes the "no Client Components" clause of
2026-08-06 — Tailwind CSS v4, CSS-first, no component toolkit

`apps/web/src/app/families/family-search.tsx` is the product's only Client
Component. It is named in `CLIENT_COMPONENT_ALLOWLIST` in
`scripts/check-web-boundary.mjs`, which fails the check for any file carrying
`'use client'` that is not listed.

- **Alternatives:** keep the zero-Client-Component rule and put the search term
  in a URL; render search results on a separate page reached by redirect.
- **Reason:** the term must not reach a URL (previous entry), which forces a
  Server Action, and reading an action's return value requires `useActionState`,
  which is a client hook. The component owns the hook and nothing else.
- **Trade-off:** the presentational panel, the family list and their Persian
  strings enter the client bundle. Accepted: they are UI text and markup. No
  secret can follow them — every module holding one declares `server-only` and
  would fail the build if it were reachable from a Client Component, and the
  import bans in the boundary script are the second, legible line of that same
  defence.
- **Assumptions:** the state `useActionState` carries stays plain and
  serialisable. A React element in it makes React silently drop progressive
  enhancement and emit an inert `action="javascript:throw ..."` form — observed
  against Next 16.2.12 before the shape was settled.
- **Revisit when:** a second component wants the exemption. The allow-list makes
  that a visible diff in review rather than quiet drift back towards a
  client-rendered application.

---

## 2026-08-09 — Accepted implementation deviations from the Milestone 3 plan

**Status:** Accepted

Found during Checkpoint G and kept deliberately.

**`Referrer-Policy` on family and child pages is `same-origin`, not
`no-referrer`.** The intent was `no-referrer`. Per the Fetch standard, a document
served under `no-referrer` makes the browser send `Origin: null` on a _same-origin_
form POST — not merely an absent `Referer`. The strict Origin check then correctly
refuses it, because `null` matches no configured origin. Verified against a real
browser: with `no-referrer`, every write on these pages failed
`AUTH_ORIGIN_REJECTED`. `same-origin` still sends nothing to any other origin and
is what a same-origin form needs to reach its own Route Handler at all. Route
Handler _responses_ keep `no-referrer`, where no form is being rendered.

**`dynamic = 'force-dynamic'` was not sufficient for the privacy requirement.**
It governs whether Next re-renders a page, which is a different question from
whether a browser or proxy may keep a copy of the bytes. The `no-store` headers
in `next.config.ts` are what actually answer it, and `next-config-headers.test.ts`
now asserts both the header rules and that every family and child page is
`force-dynamic` and `noindex`.

**A `'use server'` module may export only async functions, and React enforces it
at call time rather than build time.** A constant sitting beside an action renders
fine, builds fine, and fails on the first form submission. `FamilySearchState`
therefore lives in a sibling `search-state.ts`, and both
`check-web-boundary.mjs` and `handler-coverage.test.ts` check the property
repository-wide.

**The application header resolves its own session rather than receiving it as a
prop.** Pages render `AppHeader` beside `PageShell`, never inside it, so the
presentational list and form components stay synchronously renderable for the
markup tests. Navigation is rendered from the permission list NestJS resolved for
that request, and sign-out is a form post rather than a link.

---

## 2026-08-13 — A booking's lifecycle and a seat's attendance are two facts

**Status:** Accepted

`appointment.status` has exactly four values — `SCHEDULED`, `COMPLETED`,
`CANCELLED_BY_FAMILY`, `CANCELLED_BY_CLINIC` — and describes the shared booking:
one therapist, one room, one service, one time range.
`appointment_participant.attendance` has three — `PENDING`, `ATTENDED`,
`NO_SHOW` — and describes what one child did with their seat. Neither is derived
from the other, and no constraint relates them.

- **Alternatives:** the six statuses PROJECT_SPEC.md 6 lists, with `NO_SHOW`,
  `RESCHEDULED` and `VOIDED` on the booking.
- **Reason:** a no-show is not a state of the booking. The room was held and the
  therapist waited, so the fact that somebody did not arrive belongs to the seat
  that was empty — and in a group session two children can differ. Milestone 5's
  rule is that only an _attended_ participant in a _completed_ appointment may be
  charged; that needs both facts, and it gets them because neither was invented
  from the other.
- **`RESCHEDULED` is omitted** because a move is an audited in-place update of a
  `SCHEDULED` row. The appointment that moved is the same appointment; a status
  saying otherwise would make one session look like two in every report that
  counts them, and the before/after is already in `audit_log`.
- **`VOIDED` is omitted** because reversing a completion returns the booking to
  `SCHEDULED`, and voiding a _financial_ record is a Milestone 5 operation on a
  financial record. There is nothing financial in Milestone 4 to void.
- **Trade-off:** the shipped status list is narrower than PROJECT_SPEC.md 6's
  "recommended" list, so a reader comparing them must read this entry.
- **Revisit when:** group billing is approved, or Milestone 5 finds a charge rule
  the two-fact model cannot express.

Which statuses OCCUPY a resource is the property every conflict rule is written
against: `SCHEDULED` and `COMPLETED` hold the therapist, the room and the child;
both cancellations release all three. Reopening therefore cannot conflict with
anything, because it moves between two statuses that occupy identically.

---

## 2026-08-13 — Appointments are wall-clock sessions in `Asia/Tehran`

**Status:** Accepted

`starts_at` and `ends_at` are `timestamptz`, but every question asked of them —
which clinic day is this, what time of day is it, does it fall inside a working
window — is answered by PostgreSQL, through `clinic_date`, `clinic_clock_time`,
`clinic_day_start` and `clinic_moment`. `Asia/Tehran` is written once, in the
database, beside the Milestone 2 `clinic_date` these extend.

- **Alternatives:** store a local date and a local time; convert in Node.
- **Reason:** a session is an instant — two people cannot be in one room at one
  moment however the moment is spelled — so the exclusion constraints need
  `timestamptz`. But availability is a weekday and two wall-clock times, and
  recurrence repeats a wall-clock time on a calendar rhythm. Converting in Node
  would put the zone in two places, and the day they disagreed a booking would be
  written against a different day than it was checked against.
- **Trade-off:** placement logic is raw SQL rather than Prisma calls.
- **Revisit when:** multi-clinic or multi-timezone operation is approved — the
  same trigger as the Milestone 2 timezone entry.

Two consequences are enforced rather than assumed. A start carrying seconds is
refused (`appointment_starts_at_precision_chk`): a diary is entered, read and
printed in minutes. A session whose clinic start date differs from its clinic end
date is refused as `APPOINTMENT_TIME_INVALID` **before** the availability
override is considered — an overnight appointment is a shape the approved model
cannot express, not an hour a therapist may agree to work.

The Saturday-first weekday convention (0 = Saturday, 6 = Friday) is the product
contract across every tier. PostgreSQL's `EXTRACT(DOW)` is Sunday-first and is
translated at the database boundary with `(EXTRACT(DOW ...)::int + 1) % 7`; the
native numbering is never stored and never returned.

---

## 2026-08-13 — Availability is current configuration, with no effective dating

**Status:** Accepted

A recurring window is a therapist, a weekday and two wall-clock times. It carries
no dates and applies whenever it is asked about. The way a therapist's hours
change is that somebody edits the set; the set that was replaced is history in
`audit_log`, not a row still sitting in the table waiting to apply.
`therapist_availability` was created with `effective_from`/`effective_to` and the
availability migration drops both.

Dated exceptions carry the single-day facts: a closed day, or an extra window.
One precedence rule, and it lives in `AvailabilityService.resolve` alone: **a
closure suspends the recurring week for that date and leaves dated windows
standing.** "Not my usual Saturday, but I will come in for 15:00–18:00" is a real
arrangement, and a closure plus an extra window is the only way to state it.

- **Alternatives:** effective-dated windows, as tariffs have.
- **Reason:** a tariff must be dated because a past session is priced by the day
  it happened. Availability is never asked about the past: a booking that already
  exists is a fact, and no later reading of the schedule changes it. Dating the
  rows would add a second, silent way for two windows to describe one hour.
- **Trade-off:** "what were her hours in March?" is answerable only from
  `audit_log`, not by querying the table.
- **Revisit when:** a reporting or settlement rule needs to reconstruct a past
  week from live rows rather than from the audit trail.

The whole recurring set is replaced by one `PUT` under a `FOR UPDATE` lock on the
therapist — stronger than the `FOR SHARE` the booking paths take, because a
replacement is a delete followed by inserts and two share-locked replacements
would interleave into a union neither manager asked for. Removing an exception is
the only `DELETE` in the application: it is configuration about a day, nothing
names it, and a day off entered against the wrong therapist has to be removable.
What it said is written to `audit_log` in the same transaction that removes it.

---

## 2026-08-13 — Availability is the only overridable scheduling rule

**Status:** Accepted

Booking outside a therapist's working hours is permitted to a caller who holds
`appointment.override_availability` **and** states a reason (PROJECT_SPEC.md 5,
"blocked or requires an authorized, recorded override"). Therapist overlap, room
overlap and child overlap are never overridable — there is no flag, no permission
and no request field that books over any of them.

- **Reason:** a double-booked room is not a policy the clinic may set aside, it is
  two sessions that cannot both happen. A therapist agreeing to come in outside
  her usual hours is exactly a policy the clinic may set aside, and the person
  running the diary is the person she tells.
- **The permission is held by the receptionist as well as the manager,** granted
  separately from `appointment.create` so it stays visible in the role map and
  revocable on its own.
- **It is recorded twice over:** the reason, the actor and the instant on the
  appointment row for operational visibility, and the whole decision — reason,
  the session's hours, and the windows it fell outside, as values — in the
  `metadata` of the state change's own audit row. There is deliberately no
  separate "override" action: an override qualifies the change that carried it
  rather than being a second change.
- **The order of refusal matters.** "Not available" is decided first, so a caller
  who supplies a reason for a booking that needs none is never told they lack a
  permission; the authority is only in question once the rule has actually been
  broken. A reason supplied for a booking inside availability is not an error and
  is not recorded — nothing was overridden.
- **Trade-off:** an otherwise unchanged move submitted without restating the
  reason the row carries is refused rather than treated as a no-op. Deliberate:
  the authority is granted per write, and inheriting it from the row would let it
  be re-used by somebody who never held it.
- **Revisit when:** the pilot shows the override being used routinely, which would
  mean the recorded hours are wrong rather than the bookings.

`appointment_availability_override_chk` requires the reason, the actor and the
instant to be all present or all absent, so a half-recorded override cannot exist.

---

## 2026-08-13 — Child overlap is an advisory-locked SQL recomputation

**Status:** Accepted

Therapist and room overlap are two partial `EXCLUDE USING GIST` constraints on
`appointment`, conditional on the two occupying statuses and using `[)` bounds so
back-to-back sessions do not clash. Nothing reads before writing: the INSERT is
the check, and the constraint that fired decides which resource the receptionist
is told is busy.

A child's overlap cannot be a constraint — the child is on
`appointment_participant` and the window is on `appointment`, so no single-row
exclusion constraint can compare them. It is recomputed in SQL while a
transaction-scoped advisory lock is held on the child, keyed by PostgreSQL's own
`hashtextextended`: the mechanism the 2026-08-09 duplicate-rule entry approved,
for the same reason and with the same properties.

- **Alternatives:** denormalise the window onto the seat to make an exclusion
  constraint possible.
- **Reason:** that is a different architecture, not a smaller one, and it creates
  a second copy of the time that can drift from the booking's own.
- **Trade-off:** one rule is enforced by application code under a lock rather than
  by a constraint. It is the only one.
- **Revisit when:** group bookings make the seat table hot enough for the
  serialisation to matter.

A series takes that lock once and re-asks per occurrence: the key is the child's,
`pg_advisory_xact_lock` is re-entrant within a transaction, and every occurrence
inserted earlier in the transaction is visible to the recomputation of the next —
so a rule that would book a child against themselves is caught by the same
statement that catches a clash with somebody else's appointment.

Lock order, extending the two that already exist and forming no cycle with them:

```text
appointment_series -> appointment -> service -> therapist -> room
  -> family -> child -> advisory keys
```

A single-appointment operation takes at most one appointment row and never a
series row; a series operation takes its occurrences in `starts_at` order behind
the series row it holds `FOR UPDATE`.

---

## 2026-08-13 — The tariff is a read-only suggestion; there is no price snapshot

**Status:** Accepted

No appointment table carries a tariff reference, a price, a tariff source or any
amount. PROJECT_SPEC.md 6 lists "price snapshot" among the minimum appointment
data; it is deferred to Milestone 5 with the charge it belongs to.

- **Alternatives:** snapshot the resolved price at booking, as PROJECT_SPEC.md 6
  lists.
- **Reason:** the snapshot exists so a completed session is charged the price that
  applied on the day it happened. Booking is not that day. A price captured at
  booking and a session completed eleven weeks later — the ordinary shape of a
  recurring term — is a snapshot of the wrong moment, and one nobody would notice
  was wrong. Milestone 5 owns the transition that creates money and is where the
  snapshot belongs.
- **Trade-off:** an appointment carries no price, so any interim report of
  expected revenue must resolve one live.
- **Revisit when:** Milestone 5 designs the session charge. The column arrives
  there, on the charge or the participant, not here.

The screen-ready reads (`GET /appointments/:id/view`, `GET /appointment-day`)
resolve the current tariff live through the same SQL `/catalog/tariff-resolution`
uses, and a missing tariff is reported as `status: 'MISSING'` rather than raised —
PROJECT_SPEC.md 5 requires it to be visible, and a day view that failed because
one service has no price would take the whole diary down with it. The class that
reads tariffs (`AppointmentReadService`) holds no transaction and writes no row,
not even an audit row; the class that writes (`AppointmentsService`) never looks
at a tariff. Neither can become the other by accident.

---

## 2026-08-13 — One weekday per series, and creation is all or nothing

**Status:** Accepted

A series is a first booking plus a rule: one weekday, one placement, one time of
day, every week or every n-th week, bounded by an occurrence count or a last
date. The first occurrence _is_ the pattern — its clinic weekday and wall-clock
time are read from `startsAt` rather than submitted separately, because two
fields stating one fact are two fields that can disagree about which day a family
is expected on.

**A child seen twice a week is two series.** That is not a limitation being worked
around: it is what keeps "this and all future occurrences" a question with one
answer. Nothing in the contract expresses a multi-weekday rule, a monthly rule, a
per-occurrence override or an exception list.

**Two bounds, and a series must satisfy both:** at most 52 occurrences, and no
occurrence more than 12 months after the first. Neither implies the other — 52
fortnightly sessions run for two years, and one session every twelfth week for a
year is five sessions. A rule that breaks either is refused with
`RECURRENCE_RULE_INVALID` and never silently truncated: a receptionist who asked
for two years and was quietly given one would find out when a family arrived to a
session nobody had booked. `appointment_series_occurrence_count_chk` permits 260
and is deliberately looser — it guards against a mistyped run of digits, not
policy.

**Creation is all or nothing.** One transaction generates every occurrence or
none. There is no `skipConflicting` and no partial success: a family told "your
term is booked" and given eleven of twelve weeks is worse off than one told "week
four clashes, choose another hour", because the first failure is invisible until
somebody arrives to a locked room. `cancel-from` and `update-from` are
all-or-nothing for the same reason.

**The preview writes nothing and is advisory.** It exists so the receptionist sees
all twelve findings _before_ the request that would refuse the lot. It cannot be a
rehearsal of the write — an aborted INSERT would report the first conflict and
lose the other eleven — so it asks the same questions as a read, against the same
occupancy predicate the constraints use, and the create re-decides everything
under its own locks rather than trusting anything from it.

- **Alternatives:** a multi-weekday rule; partial creation with a conflict report.
- **Trade-off:** a twice-weekly arrangement is two objects to manage.
- **Revisit when:** the pilot shows staff maintaining paired series often enough
  that the pairing itself needs to be a record.

**The series is an identity and a termination rule, not a template.** Every
occurrence is an ordinary appointment with its own id, status, audit history and
seat, and stays independently movable, cancellable and completable through the
one appointment lifecycle. `cancel-from` and `update-from` act only on
occurrences still `SCHEDULED` from the pivot onwards, ordered by when they happen:
a completed session is a record of something that happened and a cancelled one has
been communicated to a family, so neither is rewritten by a decision about the
weeks ahead. `update-from` moves the hour, the length, the therapist or the room —
never the weekday, the service or the child.

---

## 2026-08-13 — Receptionist permissions for Milestone 4

**Status:** Accepted — supersedes the "revisit at Milestone 4" clause of
2026-08-06 — Receptionist holds no catalog permission in Milestone 2

The receptionist gains eleven permissions: `therapist.read`, `service.read`,
`room.read`, `tariff.read`, `availability.read`, and the six appointment verbs
`appointment.read|create|update|cancel|complete|override_availability`.

They do **not** gain `appointment.reopen` — reversing a completion voids or
offsets a financial record, which PROJECT_SPEC.md 4 keeps away from this role —
nor `availability.manage`, nor any catalog write. `tariff.create` and
`tariff.void` stay with the manager.

- **Reason:** the catalog grants are reads. PROJECT_SPEC.md 4 bars the
  receptionist from global tariff _changes_; it does not bar them from seeing
  which services exist and what a session costs, both of which somebody running
  the diary has to look up. `availability.read` without `availability.manage` is
  the same distinction: a booking screen must show when a therapist works, and
  maintaining that schedule is a different authority.
- **Trade-off:** seven appointment verbs rather than one `appointment.write`,
  which is more vocabulary to hold. It is what makes the reopen boundary
  expressible at all.
- **Revisit when:** Milestone 5 decides whether a receptionist may correct a
  charge on the same day (PROJECT_SPEC.md 15, item 3).

`permissions.spec.ts` asserts both halves — the exact list they have, and the
list they still do not.

---

## 2026-08-14 — A session is discounted by append-only adjustment, never by rewriting history

**Status:** Accepted

Milestone 5 supports discounting, waiving and fully freeing a **PAID** session by
inserting a row in `charge_adjustment` against the `session_charge`. The charge is
never edited, the tariff is never touched, and no historical session is
recalculated. The family's effective amount for a session is the charge less the
adjustments still active against it.

`FREE` and `PAID` stay structurally distinct, in the ledger as in the catalogue
(2026-08-06 — Explicit PAID and FREE tariff modes). A `FREE` charge came from a
genuinely complimentary programme and is zero; a session that was priced and then
wholly waived stays a `PAID` charge carrying an adjustment. `session_charge_price_mode_chk`
makes neither shape reachable from the other, and because an adjustment must be
positive and may not take a charge below zero, a `FREE` charge cannot be adjusted
at all — there is no concession to record on a session that was never priced.

- **Alternatives:** editing the charge amount in place; re-resolving the tariff at
  report time.
- **Reason:** PROJECT_SPEC.md 9 requires actor, time, reason and before/after
  effect to stay inspectable, and CLAUDE.md forbids rewriting historical charges.
  An in-place edit destroys the "before" and leaves the reason unattached to the
  amount it explains.
- **Trade-off:** every family-facing amount is a charge minus a sum, so no single
  column holds "what they owe for this session".
- **Enforced by:** `charge_adjustment` with `charge_adjustment_split_identity_chk`
  and `charge_adjustment_amount_bounds_chk`; the cumulative bound in
  `enforce_charge_adjustment_bounds`, which locks the parent charge row `FOR
UPDATE` so two concurrent adjustments cannot both pass against a stale sum; and
  `enforce_session_charge_immutability` / `enforce_charge_adjustment_immutability`,
  which permit exactly one active → voided transition and refuse every other
  update, including unvoiding. Both tables refuse `DELETE` and `TRUNCATE`
  outright.
- **Revisit when:** never for the append-only shape. The reduction vocabulary is
  revisited when Milestone 6 adds payments and credits.

A correction to a charge itself is void-and-re-post, not an edit, exactly as a
tariff correction is (2026-08-06). `session_charge_one_valid_per_participant_uq`
is partial on `voided_at IS NULL`, so the voided row leaves the index and the
replacement takes its place while both rows survive in the table.

**Financial history records what happened and never constrains what happens
next.** A charge's snapshotted service, therapist and session length are keyed to
`service`, `therapist` and `service_duration` — permanent, deactivate-only
records — and deliberately **not** to the appointment's current placement. The
lifecycle requires this: a charge is voided, the completed appointment is
reopened, and the reopened `SCHEDULED` booking is then legitimately movable to
another therapist or another length under the Milestone 4 move workflow. A
foreign key from the snapshot into `appointment` would let a withdrawn charge
veto that move for the rest of the booking's life. `appointment_id` stays
traceable through `(appointment_participant_id, appointment_id)`, and the
snapshot stays immutable by trigger, so nothing is given up.

---

## 2026-08-14 — Every Milestone 5 discount is genuinely clinic-borne

**Status:** Accepted

`therapist_discount_toman` must be `0` and `clinic_discount_toman` must equal
`amount_toman` on every `charge_adjustment` row, enforced by
`charge_adjustment_clinic_borne_chk` in PostgreSQL. A shared or therapist-borne
concession is **not representable** in Milestone 5.

The three columns exist in their final shape because the split identity —
therapist discount + clinic discount = total family discount — is an approved
domain rule (2026-08-02 — Therapist share and discount allocation), and a
two-column table would have to be reshaped to honour it later. What is deferred
is the ability to record a non-zero therapist share, not the vocabulary for it.

- **Alternatives:** accept a therapist share now and reconcile it at settlement;
  omit the two allocation columns until Milestone 8.
- **Reason:** therapist settlement — effective-dated share percentages and their
  snapshot onto a completed session — is Milestone 8 and is not approved. Without
  it there is no basis on which a therapist can be said to have agreed to bear
  part of a concession, and a row claiming they had would record an unfunded
  liability as a fact. CLAUDE.md is explicit that any settlement rule not
  explicitly approved remains unresolved and must not be inferred.
- **Trade-off:** a clinic that wants to split a discount with a therapist before
  Milestone 8 cannot record it, and must wait rather than record it wrongly. That
  is the intended answer: refusing the concession is honest, and mis-recording it
  as clinic-borne is not.
- **Assumptions:** the clinic bearing 100% of a Milestone 5 discount is
  acceptable, which is already the approved default for therapists who do not
  participate in discounts (2026-08-02).
- **Revisit when:** Milestone 8 approves settlement. The constraint is dropped
  there, the split identity stays, and no historical row is rewritten — every
  Milestone 5 adjustment was and remains genuinely clinic-borne.

Nothing in this milestone stores a share percentage, a settlement period or a
therapist net. A negative clinic net is not yet computable and is not claimed to
be.

---

## 2026-08-14 — Charge adjustment and void authority is manager-only

**Status:** Accepted — resolves the "revisit at Milestone 5" clause of
2026-08-13 — Receptionist permissions for Milestone 4

Adjusting a session charge and voiding one are **manager** authorities. A
receptionist may not perform either, including on the same day the charge was
raised.

- **Alternatives:** a same-day receptionist correction window, which
  PROJECT_SPEC.md 15 item 3 leaves open.
- **Reason:** PROJECT_SPEC.md 4 keeps financial corrections away from the
  receptionist, and 2026-08-13 already withheld `appointment.reopen` from them for
  the same reason — reversing a completion voids or offsets a financial record.
  Granting the charge-level authority they were denied at the appointment level
  would reopen by the back door what that decision closed. A same-day window is
  also the hardest version of the rule to reason about: it is authority that
  expires, and the day it expires is the day a mistake becomes unfixable by the
  person who made it.
- **Trade-off:** a receptionist who mis-posts a charge must ask a manager, which
  is slower. Posting itself is not affected — that is the completion they already
  own.
- **Revisit when:** the pilot shows managers acting as a bottleneck on same-day
  corrections often enough to measure.

The permission vocabulary that expresses this is checkpoint A2's; this entry
fixes the decision it must implement.

---

## 2026-08-14 — One posting routine, called by whichever fact lands second

**Status:** Accepted

A primary session charge is created by exactly one runtime routine,
`ChargePostingService.post`. Nothing else in the system may insert a
`session_charge` row. Three callers reach it: completing an appointment,
recording an attendance, and the explicit re-post endpoint.

It runs inside the caller's transaction, re-reads both eligibility facts under
the appointment's `FOR UPDATE` lock, returns the existing valid charge on a
retry, resolves the tariff with the catalog's `resolveTariffSql`, snapshots the
delivered facts, inserts, and writes `session_charge.posted` — all or nothing.

**Both orders are first-class.** `appointment.status = COMPLETED` and the seat's
`attendance = ATTENDED` are recorded separately, neither implies the other, and
the charge is raised by whichever becomes true LAST. Completion offers every seat
to the ledger and an attendance record offers its own, unconditionally; the
routine declines what is not eligible. A cancellation and a `NO_SHOW` therefore
create nothing without either needing a rule of its own, which is how CLAUDE.md's
two "creates no charge" defaults are enforced — by a conjunction that cannot be
satisfied, not by a caller remembering a condition.

- **Alternatives:** posting only on completion and requiring a manual re-post for
  late attendance; a trigger on the two tables; an eligibility filter in each
  lifecycle caller.
- **Reason:** the clinic produces both orders — a child marked in on arrival and
  completed afterwards, or a day completed in a batch with attendance resolved
  later — and an implementation that charges only on completion silently bills
  nobody whose attendance is entered late. A database trigger cannot write the
  audit row or resolve the actor. A filter in each caller is a second copy of the
  eligibility rule, and the copy is what drifts.
- **Trade-off:** completing an appointment now issues a small number of extra
  statements per seat, inside the transaction it already held.
- **Enforced by:** `session_charge_one_valid_per_participant_uq` as the final
  authority (checkpoint A1), the appointment row lock as the serialisation point
  above it, and `LedgerModule` exporting the posting routine and nothing else, so
  no caller can open its own transaction around a charge.
- **Revisit when:** group appointments are approved, which multiplies seats per
  completion but changes nothing about the rule.

## 2026-08-14 — A missing tariff never invents a zero charge, and never rolls back an outcome

**Status:** Accepted

When no tariff applies to a completed, attended session, AUTOMATIC posting writes
nothing and the completion or attendance record still succeeds. The session
stands as completed, attended and unpriced, and `AppointmentView.tariffSuggestion`
already reports `MISSING` for exactly that session.

The EXPLICIT re-post answers the same condition with `TARIFF_MISSING` (404). A
person asking for the charge to be raised now is told why it was not.

A `FREE` tariff is a different fact and produces a real charge of zero with
`priceMode = FREE`.

- **Alternatives:** rolling back the completion; storing a zero charge and
  correcting it later; blocking completion until a tariff exists.
- **Reason:** the session happening and the child attending are clinical facts
  that have already occurred, and refusing to record them because nobody entered
  a price loses the fact to protect the invoice. A zero charge is worse: it is
  indistinguishable in every total from a genuinely free session, and
  PROJECT_SPEC.md 5 requires a pricing gap to be visible rather than silently
  priced at nothing.
- **Trade-off:** an unpriced completed session is recoverable but not
  self-healing — somebody has to record the tariff and re-post.
- **Revisit when:** the pilot shows unpriced sessions accumulating unnoticed, at
  which point the answer is a dashboard count, not an automatic zero.

## 2026-08-14 — F2: the charge posting result vocabulary is frozen

**Status:** Accepted

`chargePostResult` has exactly two runtime values, both carrying the charge:

- `POSTED` — a charge was created by this request;
- `ALREADY_POSTED` — a valid charge already existed and is returned unchanged.

Both are HTTP 200. Everything else is a normal error envelope:
`CHARGE_NOT_ELIGIBLE` (422), `TARIFF_MISSING` (404),
`APPOINTMENT_PARTICIPANT_NOT_FOUND` (404), `VALIDATION_FAILED` (400).
`CHARGE_EXISTS_FOR_PARTICIPANT` is never raised by an explicit re-post; it
remains reserved for a path where a SECOND charge would otherwise be created.

The route is `POST /session-charges/participants/:participantId` with an empty
body. The seat is named by the path because a charge is not a document a caller
composes — it is what one seat costs — and F1 already states that the body
carries no financial value.

- **Revisit when:** never for the two outcomes. A third would mean a post can
  succeed in a way that is neither of these, which no approved rule produces.

## 2026-08-14 — Adjustments are addressed under their charge, and voiding one is the same authority as granting it

**Status:** Accepted

The two runtime adjustment operations are:

- `POST /session-charges/:chargeId/adjustments` — grant a concession;
- `POST /session-charges/:chargeId/adjustments/:adjustmentId/void` — withdraw one.

Both require `charge.adjust`, both answer HTTP 200 with the frozen
`sessionChargeResponse` — the charge as it now stands, with its whole adjustment
history and the two server-computed totals — and the void names both ids, so an
adjustment belonging to a different charge is `ADJUSTMENT_NOT_FOUND` rather than
a mismatch discovered after the fact.

- **Alternatives:** a top-level `/charge-adjustments/:id` resource; a separate
  `charge.adjust_void` permission; 201 on the create with the adjustment as the
  body.
- **Reason:** an adjustment exists only to reduce one specific charge and its
  bound is that charge's amount, so it has no meaning addressed on its own. The
  response is the charge rather than the created row because the caller's next
  question is always "what does the family owe now", and CLAUDE.md forbids the
  web tier from computing that — 201 with the adjustment would force a second
  request to answer it. A person who may not grant a concession may not undo
  somebody else's either, so splitting the permission would create an authority
  nobody was given.
- **Trade-off:** the web tier must hold the charge id to address an adjustment,
  which it always does — it read the adjustment from that charge's detail.
- **Revisit when:** Milestone 8 introduces a therapist-borne portion, which
  changes what the request carries and nothing about where it is addressed.

---

## 2026-08-15 — A payment is a family fact, and Milestone 6 allocates nothing

**Status:** Accepted — refines 2026-08-02 — Therapist settlement basis

A payment belongs to the **family**, not to a child, a session or a charge.
Charges stay child-specific and session-specific; a payment moves the family's
financial position as a whole. Milestone 6 introduces **no `payment_allocation`
table** and no rule that decides which payment settled which charge.

- **Alternatives:** allocate each payment across open charges, oldest first; let
  the receptionist pick the charges a payment pays.
- **Reason:** 2026-08-02 already established that therapist settlement is
  completed-session value and is independent of payment, which removed the only
  domain need for allocation. Nothing in Milestone 6 reintroduces it: the family
  balance is a sum either way, and an allocation table would be a second,
  editable account of the same money that can disagree with the first.
- **Trade-off:** no statement line can say "this payment cleared that session".
  A family asking "what is this payment for?" is answered by its date, amount and
  note, not by a link.
- **Revisit when:** the trigger recorded in 2026-08-02 fires — insurance, a
  third-party payer, or per-invoice payment.

---

## 2026-08-15 — A payment is confirmed or voided, and nothing else

**Status:** Accepted

The stored payment lifecycle has exactly two states: `CONFIRMED` and `VOIDED`. A
recorded payment is confirmed the moment it is recorded. **There is no stored
`PENDING`.**

- **Alternatives:** carry `PENDING` now so the column never changes; model a
  cheque-clearing window.
- **Reason:** `PENDING` describes money whose arrival somebody else confirms —
  a gateway, a bank callback. In Milestone 6 the receptionist records money they
  are holding or have already seen land, so a pending state would have no event
  that ever resolves it, and a balance that quietly excludes pending money is a
  balance nobody can explain. A wrong record is corrected by void, which is the
  same shape Milestone 5 uses for charges.
- **Trade-off:** a real external payment workflow will add a state to a live enum
  and must decide then whether pending money counts toward the balance.
- **Revisit when:** an online or gateway-backed payment workflow enters scope.

---

## 2026-08-15 — The payment method vocabulary is `CASH`, `CARD`, `TRANSFER`

**Status:** Accepted

Those three values, and no others. **No `CHEQUE`. No `OTHER`.** Milestone 6 does
not support cheque as a payment method, and defines no substitute representation
for one.

- **Alternatives:** add `CHEQUE`; add `OTHER` as an escape hatch.
- **Reason:** a cheque is an instrument whose lifecycle — presentation, clearing,
  dishonour — is not modelled by anything in this milestone, and admitting the
  value without that lifecycle would record as received money that may never
  arrive. `OTHER` is the value that absorbs every case nobody thought about and
  then cannot be reported on; refusing it means an unforeseen method is a
  decision, not a silent bucket.
- **Trade-off:** a clinic that takes a cheque has nothing in this system to record
  it with.
- **Revisit when:** the clinic needs to accept or track cheques, or the pilot
  produces a real payment that is none of the three. The payment-method vocabulary
  **and** the payment lifecycle policy must both be revisited explicitly before
  any such workflow is implemented.

---

## 2026-08-15 — Credit is derived, and a prepayment is just a payment

**Status:** Accepted

A family may pay while owing nothing. **Intentional prepayment and accidental
overpayment are the same fact** and carry no distinguishing flag: there is no
`isPrepayment`. Credit and amount due are **derived** from confirmed payments and
valid charges, never stored. A **receptionist** may record ordinary payments,
including prepayments, and no approval threshold is invented.

- **Alternatives:** an `isPrepayment` flag; a stored `credit_toman` column on the
  family; an approval threshold above some amount.
- **Reason:** intent is not observable at the counter and would be a guess
  recorded as data; the money and its effect are identical either way. A stored
  credit is a cached sum that can drift from the rows that produce it, and the
  baseline decision "manual facts, automatic calculations" puts the derivation on
  the system. A threshold would be an invented number — no approved rule names
  one, and CLAUDE.md forbids inferring an unapproved rule.
- **Trade-off:** a report cannot separate deliberate prepayment from overpayment,
  and every read of a family's position sums rows rather than reading a column.
- **Revisit when:** a real approval rule is agreed, or measured read volume makes
  the derivation too slow — which is a materialisation question, not a change to
  the source of truth.

---

## 2026-08-15 — Payment void is manager-only

**Status:** Accepted — extends 2026-08-14 — Charge adjustment and void authority
is manager-only

A receptionist may **record** a payment and may not **reverse** one. Voiding a
payment requires **manager** authority. There is no same-day receptionist
exception in Milestone 6.

- **Alternatives:** a same-day correction window for the person who entered it.
- **Reason:** the reasoning of 2026-08-14 transfers unchanged — reversing a
  financial record is the authority PROJECT_SPEC.md 4 keeps away from the
  receptionist, and an expiring authority is hardest to reason about precisely
  when it is needed. Recording is unaffected: money arriving is a fact the
  receptionist owns.
- **Trade-off:** a mistyped payment needs a manager, which is slower.
- **Revisit when:** the trigger recorded in 2026-08-14 fires — managers measurably
  becoming a bottleneck on same-day corrections.

---

## 2026-08-15 — A promise is a calendar fact with no financial effect

**Status:** Accepted

Stored lifecycle: `OPEN → FULFILLED | RESCHEDULED | CANCELLED`. **`MISSED` is
derived** — an `OPEN` promise whose due date has passed — and is never stored. A
promise **never changes the family's financial position** in any state.

Fulfilment requires an **explicitly linked payment**, which must be `CONFIRMED`,
must belong to the **same family**, and must satisfy
`payment.amount_toman >= promise.amount_toman`. There is **no partial fulfilment
model** and **no promise-payment allocation rows**; one payment fulfils **at most
one** promise. Rescheduling **preserves** the old promise as `RESCHEDULED` and
creates a **successor**.

- **Alternatives:** store `MISSED` by a nightly job; let a promise reduce the
  balance; fulfil a promise by any payment landing near its date; allow partial
  fulfilment across several payments.
- **Reason:** `MISSED` is a fact about the clock, not an event anybody performs —
  storing it means a row whose truth depends on a job having run, and a promise
  that reads correctly only after a job reads wrongly before it. A promise is an
  intention, and CLAUDE.md states it does not reduce the balance, so the linked
  payment is what moves money and the link is only evidence. Requiring the link to
  be explicit keeps "was this kept?" a recorded human judgement rather than an
  inference from proximity, and the one-payment rule keeps that evidence
  unambiguous without the allocation table the entry above refused.
- **Trade-off:** a family who pays a promised amount in two instalments cannot
  mark the promise fulfilled until one payment covers it, and must cancel or
  reschedule instead. A payment larger than the promise fulfils it in full with no
  record of the surplus against that promise — the surplus is visible as credit.
- **Revisit when:** the pilot shows instalment-settled promises are common.

---

## 2026-08-15 — A promise may be born late, but may not be rescheduled into the past

**Status:** Accepted

Creating a promise **may** use a past due date; such a promise is `OPEN` and reads
immediately as derived `MISSED`. A **rescheduled successor** must be due **today
or later**. There is no arbitrary limit on how old an initial due date may be.

- **Alternatives:** forbid past due dates entirely; cap backdating at some number
  of days.
- **Reason:** a promise made last week and entered today is a real fact, and
  refusing it would push the clinic to enter a false date. Rescheduling is the
  opposite act — a new intention agreed now — and an intention already overdue at
  the moment it is agreed records nothing. Any fixed age cap would be an invented
  number.
- **Trade-off:** a mistyped year in the past is accepted and shows as missed.
- **Revisit when:** backdated entry is observed being used to fabricate history.

---

## 2026-08-15 — `follow_up_date` is removed from Milestone 6

**Status:** Accepted

Milestone 6 stores no `follow_up_date`, on a promise or anywhere else.

- **Reason:** its semantics were never approved — whether it drives a work queue,
  who owns it, what closes it, and how it differs from the due date are all
  undecided. CLAUDE.md forbids inferring an unapproved rule, and a date column with
  no workflow behind it becomes a field people fill in and nobody reads.
- **Trade-off:** chasing an overdue promise is done from the derived `MISSED` list
  rather than from a per-promise reminder date.
- **Revisit when:** a milestone designs the actual follow-up workflow, which may add
  it with defined semantics. **Milestone 7 did not.** Its promise report and
  dashboard chase overdue promises from the derived `MISSED` reading and introduce
  no reminder date, no work queue and no automated follow-up, so the semantics
  remain unapproved and the field remains out of scope.

---

## 2026-08-15 — A payment may be back-dated but never post-dated

**Status:** Accepted

`received_on` is the day the money arrived. It **may be back-dated** with no
arbitrary age limit. A **future `received_on` is refused.** The entry time and the
entering actor are recorded separately and stay independently auditable.

- **Alternatives:** cap backdating at N days; allow a future date for an expected
  payment.
- **Reason:** this follows the shape 2026-08-06 already set for business dates —
  what happened is what is recorded, and a charge posted late belongs to the
  session it priced. Money that arrived on Thursday and is entered on Saturday
  arrived on Thursday. A future date, by contrast, records money that does not
  exist yet — that is a promise, and the promise record already models it. Because
  entry time and actor are kept alongside, a suspicious back-date is always
  visible as a back-date.
- **Trade-off:** a wrong past date is accepted at entry and is corrected by void
  and re-record, not by edit.
- **Revisit when:** never for the future-date refusal.

---

## 2026-08-15 — Payment and promise audit carries no bank reference and no new identifiers

**Status:** Accepted — refines 2026-08-09 — Identifiers are masked in audit; names
are not

A payment's bank or reference value is stored **on the payment** and is **not
copied into audit payloads**; where the fact matters, audit records only **that a
reference exists**. Payment and promise **notes** follow the existing policy and
are written **in full**. No name, phone number or file number is copied into a
payment or promise audit payload beyond the ids the entry already needs.

- **Alternatives:** mask the reference to its last four digits; write it in full,
  as the note is.
- **Reason:** the reasoning of 2026-08-09 applies directly — `audit_log` is
  append-only and permanent, so a value copied into it is a second undeletable
  store of that value. A bank reference is a banking identifier, not the fact being
  changed, and "what changed, and who changed it?" is answered by the payment id
  and the actor. A note, by contrast, _is_ the fact, so masking it would make the
  trail useless. Masking the reference was rejected because, unlike a phone number,
  there is no operational question four digits answers — the payment row itself is
  where an operator looks it up.
- **Trade-off:** reconstructing a voided payment's reference requires the payment
  row, not the log alone.
- **Revisit when:** a reconciliation or regulatory need requires the reference in
  the trail, which needs a retention and access decision first.

---

## 2026-08-15 — Milestone 6 knows only its own records, and produces no statements

**Status:** Accepted

The family financial position covers **only records held in this system**.
Pre-Milestone-5 paper debt and opening balances are **out of scope** and are not
entered, imported or approximated. The interface must **say so plainly** wherever
a balance is shown. **Statements, receipts and exports remain outside Milestone 6.**

- **Alternatives:** an opening-balance adjustment per family; a printable
  statement in this milestone.
- **Reason:** an opening balance is a number nobody can source or audit, and
  carrying it would make every derived balance partly an assertion. Saying the
  scope out loud is honest and cheap; a silently partial balance is the failure
  mode that costs trust. A statement or receipt is a document with content and
  legal requirements that have not been decided, and CLAUDE.md forbids inventing
  such content.
- **Trade-off:** during transition the balance on screen is not the family's whole
  historical debt, and the clinic keeps issuing receipts by its existing means.
- **Revisit when:** Milestone 7, for statements, receipts and exports, and for any
  opening-balance migration agreed with the clinic.

---

## 2026-08-15 — Money on the wire is the canonical decimal string

**Status:** Accepted — documents an already-enforced rule; refines 2026-08-02 —
Money unit

Money is stored as integer toman. Its **API wire representation is the canonical
decimal string** defined by `tomanAmountSchema` in
`packages/contracts/src/money.ts`: digits only, no sign, no separator, no decimal
point, no leading zero — one spelling per amount. **No other money representation
exists** in requests, responses or contracts, and Milestone 6 does not invent one
for payments or promises.

- **Alternatives:** a JSON number; an object carrying amount and unit.
- **Reason:** JSON has no integer type, so an amount above 2^53 loses precision
  silently on `JSON.parse`, and `BigInt` does not serialise at all. A single
  canonical spelling makes two equal amounts equal strings, so responses compare
  and snapshot without normalising first. This has been enforced since the first
  money-carrying contract and was never written down; the milestone that adds two
  new money-carrying records is the wrong place to discover it.
- **Trade-off:** every consumer parses before arithmetic — and the web tier does no
  money arithmetic anyway.
- **Revisit when:** a payment gateway settles in rial, which is the conversion
  boundary 2026-08-02 already flagged.

## 2026-08-16 — Milestone 6 outcome: the fulfil picker proves only what the list states

**Status:** Accepted — outcome note recorded at the integrated Milestone 6 review;
adds no rule and changes no frozen contract

The frozen payment list carries no "already fulfils a promise" flag, so the web
fulfil picker filters on the **two facts it can prove from the list itself** —
`status = CONFIRMED` and `amountToman >= promise.amountToman` — and claims nothing
about whether a candidate is unused. `PAYMENT_ALREADY_FULFILS_PROMISE`,
`PAYMENT_FAMILY_MISMATCH`, `PROMISE_PAYMENT_TOO_SMALL` and `PAYMENT_VOIDED` stay
the server's alone, and the picker's Persian help text says so.

- **Alternatives:** add an `unusedByPromise` field to the payment list; add a
  dedicated "candidate payments for this promise" endpoint.
- **Reason:** a flag or an endpoint would be a post-freeze contract change bought
  for a refusal the server already states clearly and in Persian, and a browser
  that pre-judged eligibility would be a second answer that can disagree with the
  only authoritative one.
- **Trade-off:** an operator can pick a payment that is refused on submit. The
  refusal is one click, names the reason, and preserves the page.
- **Revisit when:** pilot use shows the refusal happening often enough to be
  friction — which is also when it becomes clear whether the right answer is a
  list field or a candidate endpoint.

## 2026-08-16 — Milestone 6 outcome: promise workflows are bounded by one page of history

**Status:** Accepted — outcome note recorded at the integrated Milestone 6 review;
adds no rule and changes no frozen contract

Two web-only consequences of offset paging are recorded rather than engineered
around. The promises page offers fulfilment candidates from the **first 100
payments** (`LEDGER_PAGE_SIZE_MAX`), so a legitimate older payment can fall out of
the picker; and a promise's predecessor/successor links are in-page anchors, so a
reschedule chain split across two pages links to a row the reader has to page to.

- **Alternatives:** a candidate-payment endpoint; server-side deep links that
  resolve a promise to its page.
- **Reason:** at pilot scale a family has tens of payments and single-digit promise
  chains, so both limits are theoretical today; nothing is lost or unreachable —
  every row is in the paginated history, and the position totals are whole-family
  and never paged.
- **Trade-off:** a very long-running family could need a second page to complete a
  fulfilment or follow a chain.
- **Revisit when:** any pilot family exceeds one page of payments, or a reschedule
  chain crosses a page boundary in real use.

## 2026-08-18 — Milestone 7 keys each read on a named business date, and says which

**Status:** Accepted — Milestone 7, checkpoint C1

Every Milestone 7 read states the business day it is keyed on, from a closed
vocabulary of four (`REPORT_DATE_BASES`): `SESSION_DATE`, `PAYMENT_RECEIVED_ON`,
`PAYMENT_RECORDED_AT` and `PROMISE_DUE_ON`. Ranged responses echo the basis
beside the period. The consequence that matters: the dashboard's **daily
reconciliation is keyed on `PAYMENT_RECORDED_AT`** — what this caller entered
today, which is what a till is balanced against — while the **payments report is
keyed on `PAYMENT_RECEIVED_ON`**, the business day the money arrived. Money taken
last Thursday and entered this morning appears in both, under different days.

- **Alternatives:** one basis for all payment reads; leaving the basis implicit in
  the route name.
- **Reason:** a single basis makes one of the two readings wrong, and the wrong one
  is discovered by a receptionist whose till does not balance. Stating the basis on
  the wire means a screen, a print header and a later export cannot disagree about
  what was measured.
- **Trade-off:** two payment figures for one day that are both correct and are not
  equal, which the interface has to label clearly.
- **Revisit when:** a settlement period or a bank reconciliation needs a third
  basis.

## 2026-08-18 — Reporting adds two permissions, and none for the operational reads

**Status:** Accepted — Milestone 7, checkpoint C1

`report.read_financial` and `report.export` are the only new permission names.
The dashboard, the session report, the therapist activity report and the promise
report are read under the authorities that already describe the data —
`appointment.read`, `payment.read`, `promise.read` — and both roles hold them.
The clinic-wide payments report and the family-accounts report require
`report.read_financial`, held by the manager alone, as does the dashboard's
clinic-wide financial block, which reads `null` for anybody without it. Export
is separate from reading and is manager-only; no export behaviour exists yet.

- **Alternatives:** a `report.*` name per report; folding export into the read.
- **Reason:** `report.read_sessions` beside `appointment.read` would be a second
  name for one authority that the role map must keep in step forever. What is
  genuinely new is the clinic-wide financial read and the per-user attribution that
  comes with it: `payment.read` is what a receptionist records money with, and it
  must not silently become every family's money and every colleague's takings.
  Extracting a file leaves the system and outlives the session, so it is a
  different act from looking at a screen.
- **Trade-off:** a future role that should read sessions but not the diary cannot be
  expressed without splitting `appointment.read`.
- **Revisit when:** a therapist login exists, which is the first role that plausibly
  reads its own activity without holding the diary.

## 2026-08-18 — A report range is mandatory and ordered, and is never capped

**Status:** Accepted — Milestone 7, checkpoint C1 (supersedes the same day's
proposal of a 366-day maximum span, which conflicted with the accepted M7 plan and
was removed before the checkpoint closed)

Every ranged report requires `from` and `to`, inclusive at both ends, and refuses
only a range that ends before it starts, as `VALIDATION_FAILED`. **There is no
maximum span and no `REPORT_RANGE_MAX_DAYS` constant.** A default opening window
— last month, this week — belongs to the Web surface that renders the report. No
new error code is introduced, and an empty result is a successful read; there is
no `REPORT_NOT_FOUND` anywhere in `ERROR_CODES`.

- **Alternatives:** a numeric maximum span (proposed and rejected); an optional
  range defaulting to the current month.
- **Reason:** the accepted M7 plan explicitly rejected a server-side maximum span.
  A clinic asking for a year, or for three, is asking a real question, and a
  refusal built on an unmeasured number becomes the limit the manager hits on the
  one day they need the widest report. A default is something a reader can widen;
  a refusal is not. The range stays mandatory because a clinic-wide read with no
  period is every row ever written, which is a different argument.
- **Trade-off:** a deliberately enormous range is answerable and therefore
  expensive; nothing in the contract stops it.
- **Revisit when:** measured evidence at pilot volumes shows a range wide enough to
  hurt — at which point any numeric bound is a cost bound argued from a query plan,
  and needs owner approval.

## 2026-08-18 — Reporting stores nothing: three indexes and no second source of truth

**Status:** Accepted — Milestone 7, checkpoint C1

The milestone adds no table, column, constraint or trigger. Clinic-wide
date-keyed reading is a new ACCESS PATTERN over existing rows, so it adds exactly
three B-tree indexes — `session_charge(service_date)`, `payment(received_on)` and
`payment(created_at)` — and nothing else. No stored balance, no reporting
aggregate, no materialised view, no cache. Every figure is derived on the request
that asks for it.

- **Alternatives:** a nightly rollup table; a materialised daily summary; a partial
  index over non-voided rows.
- **Reason:** every existing index on the financial tables leads with a family, a
  child or a seat, so a date-only predicate cannot use them at all. A stored
  aggregate would be a second source of financial truth that can disagree with the
  family account beside it, and a partial index over non-voided rows would be wrong
  because reports show voided rows by default.
- **Trade-off:** three more indexes to maintain on write, on tables whose write rate
  is a receptionist typing.
- **Revisit when:** a report's plan shows a sort or a join dominating at pilot data
  volumes.

## 2026-08-18 — The synthetic clinic is seeded through the real services, and deletes nothing

**Status:** Accepted — Milestone 7, checkpoint C1

`node dist/dev/main.js --confirm` populates a synthetic multi-week clinic for
local review. It writes through the same domain services the application uses,
parses every request with the same contract schema the controller would, performs
every act under a real manager account it refuses to create, and is additive: it
never truncates, deletes or disables a trigger. It refuses to run unless
`NODE_ENV` is not production AND the database name ends in `_dev`, `_test`, `_ci`
or `_demo`, and it is a separate binary from the operator CLI.

- **Alternatives:** raw SQL fixtures; a `--reset` flag; a subcommand of the operator
  CLI.
- **Reason:** a seeder with its own INSERTs is a second implementation of the domain,
  and the first place the two disagree is a dashboard number nobody can reproduce
  through the interface. Financial rows cannot be deleted by design, so a reset flag
  would be a data-destroying path living one typo away from a database that matters.
- **Trade-off:** every seeded payment carries the run's own `created_at`, so the
  daily reconciliation is rich for the day of the run and empty for earlier days.
  Back-dated `receivedOn` still exercises the two payment bases against each other.
- **Revisit when:** a pilot rehearsal needs a reviewable clinic whose entry days are
  spread across weeks, which would need a mechanism that can state an entry instant
  without bypassing the payment's immutability rule.

## 2026-08-18 — An unauthorised dashboard has no clinic-wide financial content at all

**Status:** Accepted — Milestone 7, checkpoint C1 (supersedes the same day's
`clinicFinancial: null` shape, corrected before the checkpoint closed)

`GET /dashboard` returns a **discriminated union** on a server-stated
`financialScope`. A caller without `report.read_financial` receives
`OWN_ENTRIES_ONLY`, a strict object with **no clinic-wide financial key at all**;
a caller holding it receives `CLINIC_WIDE`, where `clinicFinancial` is required
and non-nullable. `reconciliation` is in both variants and is always the
authenticated actor's own recorded payments — never a user id the request states.

- **Alternatives:** a nullable `clinicFinancial` block (the earlier shape); two
  routes; one route returning a zeroed block to unauthorised callers.
- **Reason:** the accepted authority boundary is that unauthorised clinic-wide
  financial content is not delivered, not that it is delivered empty. A nullable
  field puts the boundary in every consumer's null check and leaves a shape in
  which a serialisation mistake can carry another user's takings to a
  receptionist; an absent key makes that a parse failure in both tiers. Two routes
  would be two aggregations of one screen and a second place for the rule to drift.
- **Trade-off:** consumers branch on a word instead of reading one optional field,
  and the two variants must stay in step as the dashboard grows.
- **Revisit when:** a third financial visibility level exists — a therapist reading
  their own activity is the plausible one.

## 2026-08-18 — The dashboard states two data conditions, because they are not one

**Status:** Accepted — Milestone 7, checkpoint C1

`dataIssues` carries `missingTariffCount` **and**
`unchargedCompletedSessionCount`, both scoped to the dashboard's clinic day. The
two were checked against the repository and are not equivalent in either
direction:

- completing a session no tariff covers writes no charge and does not fail —
  `ChargePostingService.post` returns `TARIFF_MISSING` — so recording the tariff
  afterwards clears the `MISSING` reading and leaves the seat uncharged, because
  nothing re-posts retrospectively;
- voiding a charge (`charge.void`) leaves a completed, attended seat with no valid
  charge while the price list resolves perfectly —
  `findValidChargeForParticipant` ignores voided rows, which is what makes the
  re-post idempotent;
- a scheduled session with no price is a warning to fix before it is completed,
  and is not an uncharged completed session.

- **Alternatives:** the missing-tariff count alone; a general data-quality issue
  list with severities and categories.
- **Reason:** the first hides the backlog that actually costs the clinic money; the
  second is a subsystem nobody approved. Two counts over facts the system already
  holds is the smallest correct answer.
- **Trade-off:** the two counts overlap for a session that is both unpriced and
  completed, so they must not be added together; the contract says so.
- **Revisit when:** a no-show charging policy is approved, which would add a third
  actionable condition.

## 2026-08-18 — The dashboard is derived on one snapshot and reuses every existing read

**Status:** Accepted — Milestone 7, checkpoint C2

`GET /dashboard` is implemented as a single aggregation inside one
`REPEATABLE READ` transaction, and holds no reading of its own. The appointment
counts and the `MISSING` tariff verdict are `AppointmentReadService.day`; "does
this seat carry money?" is the ledger's `voided_at IS NULL` predicate; "what is a
day of charges worth?" is the same SQL the family account's totals and position
use, lifted into `charge-detail.ts` as `readChargeTotals`; a payment on the wire
is `toPaymentSummary`; derived `MISSED` is
`status = 'OPEN' AND due_on < clinic_date()`. `AppointmentReadService.day` gained
an optional client parameter so the dashboard's day is read on its snapshot;
`GET /appointment-day` is unchanged.

- **Alternatives:** dashboard-owned SQL for each block; separate read-committed
  statements; a stored or cached daily aggregate.
- **Reason:** a second statement of "which sessions are unresolved" or "which
  charges count" is a second answer, and the disagreement surfaces as a badge that
  contradicts the list beneath it or a total that contradicts the family account.
  Under `READ COMMITTED` each statement takes its own snapshot, so a void
  committing mid-response yields sums describing one database and rows describing
  another — a till that cannot be balanced against the screen that produced it.
- **Trade-off:** the dashboard reads the day's full appointment rows to state six
  counts and one tariff verdict, which is more data than a bespoke aggregate would
  move; and one more caller now depends on the day read's signature.
- **Revisit when:** a clinic day is large enough that moving the day's rows to
  count them shows up in the response time, which would argue for a counting form
  of the day read rather than for a second definition of the counts.

## 2026-08-18 — The dashboard's financial authority selects a variant, not access

**Status:** Accepted — Milestone 7, checkpoint C2

The route requires `DASHBOARD_READ_PERMISSIONS` — `appointment.read`,
`payment.read`, `promise.read` — and no new authority. `report.read_financial` is
checked in the SERVICE, where it decides which variant is returned: for a caller
without it the clinic-wide statements are never executed, so the totals and the
per-user attribution do not exist in the process to be serialised by mistake. The
reconciliation scope is the session's `userId`; `dashboardQuerySchema` is strict
and carries no user parameter.

- **Alternatives:** `report.read_financial` on the route decorator; a second
  manager-only dashboard route; querying the clinic totals always and stripping
  them during serialisation.
- **Reason:** a route-level requirement would refuse the receptionist the screen
  entirely, and two routes would be two aggregations of one screen with the
  authority rule stated twice. Querying and then stripping leaves a shape in which
  one serialisation mistake carries the clinic's takings to a receptionist.
- **Trade-off:** the authority rule is enforced in a service rather than declared
  on the handler, so it is proved by an integration test rather than by a
  decorator anybody can read.
- **Revisit when:** a third financial visibility level exists — a therapist reading
  their own activity is the plausible one.

## 2026-08-18 — The dashboard counts authorised availability overrides

**Status:** Accepted — Milestone 7, checkpoint C2 (a narrow correction of a C1
omission, not a new owner decision)

`dashboardResponseSchema` gains one server-stated count, `availabilityOverrideCount`,
present in BOTH authority variants: appointments on the dashboard's clinic day,
not cancelled, carrying the recorded appointment availability-override fact.

The accepted M7 plan resolved PROJECT_SPEC.md 10's "conflicts" dashboard item as
AUTHORISED, RECORDED AVAILABILITY OVERRIDES — hard therapist, room and child
conflicts are refused by exclusion constraints at booking time and have no
backlog to list. The frozen C1 contract carried no field for that reading; its
comment dismissed "booking conflicts" on the hard-conflict ground alone. C2
implemented the contract as frozen, raised the omission rather than inventing a
field, and the coordinator accepted the minimal correction.

The count costs no query. `appointment.availability_override_reason` /
`_by_user_id` / `_at` move as one CHECK-enforced fact, are written only by a
caller holding `appointment.override_availability`, and are already on the rows
the dashboard reads for its appointment counts.

- **Alternatives:** a field inside `dataIssues`; a field on
  `appointmentDaySummarySchema`; a count over `therapist_availability_exception`;
  a list of the overridden appointments.
- **Reason:** an override is a decision somebody was authorised to make and
  recorded a reason for, so putting it in `dataIssues` would tell a manager to fix
  something the clinic approved and would break the frozen promise that
  `dataIssues` states exactly two conditions. `appointmentDaySummary` belongs to
  `GET /appointment-day` and to Milestone 4; widening an operational read to carry
  a figure the dashboard wanted is how one screen's requirement becomes another's
  contract. A dated closed day or extra window is schedule CONFIGURATION — most
  are never booked against, and a booking inside a dated extra window needed no
  authority at all — so counting exceptions would put a configuration fact on a
  screen whose purpose is work requiring attention. A list is the day view's job.
- **Trade-off:** a cancelled session drops out of the count while keeping its
  recorded override, so the number answers "what is still to review this morning?"
  rather than "how many overrides were ever exercised on this day"; the second
  question belongs to a report, not to this screen.
- **Revisit when:** the pilot shows the override being used routinely, which is
  already the revisit trigger on the override authority itself — a count that is
  never zero is a count nobody reads.

## 2026-08-18 — Reading the dashboard requires `charge.read`

**Status:** Accepted — Milestone 7, checkpoint C2 (corrects the C1
`DASHBOARD_READ_PERMISSIONS` list, which named three of the four)

`DASHBOARD_READ_PERMISSIONS` is `appointment.read`, `charge.read`, `payment.read`
and `promise.read`, AND not OR, as the accepted M7 plan stated. No report
permission gates the route; `report.read_financial` remains a separate optional
authority that selects the clinic-wide RESPONSE VARIANT rather than access.

- **Alternatives:** leaving the three-name list; adding a `report.read_operational`
  permission; gating the route on `report.read_financial`.
- **Reason:** `unchargedCompletedSessionCount` is `session_charge` read through the
  ledger's own `voided_at IS NULL` predicate, so the dashboard states a ledger fact.
  A route that stated it without naming the authority to read a charge would be a
  side channel: a future role holding the diary and the promise workflow but not
  the ledger would learn, seat by seat, which of the clinic's sessions are
  unbilled. The permission model has to be an accurate description of what a route
  reads, or withholding an authority stops meaning anything. A new report
  permission would be new access for a screen that aggregates reads both internal
  roles already hold.
- **Trade-off:** the dashboard now names four authorities and would be refused to a
  future role lacking any one of them, which is the intended behaviour and is a
  refusal rather than a partial screen.
- **Revisit when:** a role exists that should see the diary and the promises but
  not the ledger — which would be an argument for splitting the dashboard, not for
  loosening this list.

## 2026-08-18 — Therapist activity stays non-financial, and its only duration is attended

**Status:** Accepted — Milestone 7, checkpoint C3

`GET /reports/therapist-activity` states counts and durations and reads no money
of any kind: no share, no percentage, no rate, no session value, no settlement
figure, on the screen or in the file. `attendedDurationMinutes` is the ONLY
duration and it counts attended seats alone; the cancelled and no-show counts sit
beside it, unsummed.

- **Alternatives:** a session-value column "for the accountant"; one
  `bookedMinutes` total spanning attended, cancelled and no-show seats.
- **Reason:** the settlement basis, the discount effect and the percentages are
  unapproved, and CLAUDE.md forbids inferring a settlement rule. A single
  "hours" figure that included a released slot reads as time delivered, is not,
  and is the number somebody eventually multiplies by a rate — which is how an
  unapproved settlement arrives through a report rather than through a decision.
  Keeping the report free of money is also what lets it be read under
  `appointment.read`, which both roles hold.
- **Trade-off:** a manager comparing therapists cannot see value per therapist
  anywhere in Milestone 7, which is the intended state until the policy exists.
- **Revisit when:** Milestone 8 approves the settlement basis — at which point the
  share belongs to a settlement surface with its own authority, not to this report.

## 2026-08-18 — A financial report is refused whole, never served with the money removed

**Status:** Accepted — Milestone 7, checkpoint C4

`GET /reports/payments` and `GET /reports/family-accounts` are manager-only and
live in a controller of their own. A caller without `report.read_financial` is
refused by `PermissionsGuard` on the route, before any service runs. The
dashboard's discriminated-union design — one screen, two shapes — is deliberately
NOT copied here.

Each route names `report.read_financial` AND the ordinary read authorities its
facts require: `payment.read` for payments, and `charge.read`, `payment.read` and
`promise.read` for a position, which is made of all three.

- **Alternatives:** one route per surface returning a money-free variant; the
  financial name alone on the decorator; a page-level check in Next.
- **Reason:** the dashboard is a shared screen with a manager-only BLOCK, so a
  variant is the whole answer there. These two are financial in their entirety, so
  there is no useful response to give somebody who may not read them, and a
  stripped variant would be a shape in which one serialisation mistake carries
  every family's balance to a receptionist. Requiring the ordinary reads as well
  keeps the permission model an accurate description of what the route touches:
  revoking `payment.read` has to take payment REPORTS with it.
- **Trade-off:** a future role that should read clinic-wide money without holding
  one of the underlying reads cannot be expressed without splitting a list.
- **Revisit when:** a third financial visibility level exists — a therapist reading
  their own activity is the plausible one.

## 2026-08-18 — The family-accounts report is the family account, read many at a time

**Status:** Accepted — Milestone 7, checkpoint C4

Every row's `position` in `GET /reports/family-accounts`, on the screen and in the
CSV, comes from `ledger/family-position.ts` — the same SQL and the same mapping
`GET /families/:id/account` answers with. Not one charge predicate, payment
predicate, promise predicate or subtraction is written in the report service. The
two reads therefore reconcile BY CONSTRUCTION rather than by agreement, and this
equality is a correctness invariant an integration test asserts family by family
against a whole synthetic clinic.

Three consequences are part of the decision:

- **it takes no date range, and the strict schema refuses one.** A position is not
  a period; "the balance as at last month" is a concept nobody has approved;
- **`standing` and `includeInactive` select FAMILIES and narrow no figure.** No
  filter on this route can produce a narrowed balance, on either surface;
- **`totalAmountDue` and `totalCredit` are never netted, and there is no clinic
  balance.** One family's credit does not reduce another family's debt.

- **Alternatives:** a reporting statement of charges-minus-payments; a stored or
  nightly balance; one signed clinic-wide figure.
- **Reason:** a second definition of "what does this family owe?" agrees on the day
  it is written and drifts the first time either side is corrected — and the drift
  is discovered by a family quoted two different balances by two screens of one
  system. A stored aggregate would be a second source of financial truth beside the
  account it contradicts.
- **Trade-off:** the report derives every position on the request that asks for it,
  so a wide clinic costs a wide read; nothing is cached.
- **Revisit when:** measured evidence at pilot volumes shows the derivation
  dominating the response, which argues for a query plan, not for a stored balance.

## 2026-08-18 — Export is manager-only for all five surfaces, and the dashboard is not one of them

**Status:** Accepted — Milestone 7, checkpoint C5

Five reports are exportable as CSV — sessions, promises, therapist activity,
payments and family accounts — and each route names its report's READ authorities
PLUS `report.export`, which the receptionist has never held. That includes the
three operational reports a receptionist reads all day: they may read them and may
not extract them. The refusal is `PermissionsGuard`'s, in NestJS, on a direct
call, and the web tier's hidden button is a convenience rather than the boundary.
The export schemas are the read filters with `page` and `pageSize` refused: a file
is the whole filtered result. Every row comes from the owning report service's
`exportRows`, which is the screen's statement with the paging window removed, so
there is no second reporting implementation behind a download.

**The dashboard is deliberately not exportable.** It is a screen of blocks rather
than a table of rows, so a "CSV of the dashboard" would have to invent a shape
nobody approved; what a manager would export from it is one of the five reports
underneath it, filtered.

- **Alternatives:** folding export into each report's read authority; allowing the
  operational exports under the diary authority; a dashboard export.
- **Reason:** extracting a file leaves the system and outlives the session, so it
  is a different act from looking at a screen — a printed session list stays on a
  desk, a spreadsheet of it travels. Naming the read authorities as well means
  revoking a read takes its export with it, and `report.export` alone opens
  nothing.
- **Trade-off:** a receptionist who legitimately needs an operational list in a
  spreadsheet has to ask a manager, and prints in the meantime.
- **Revisit when:** pilot use shows a receptionist workflow that genuinely needs a
  file, which is an owner decision about `report.export` and not a route change.

## 2026-08-18 — One successful export writes exactly one audit row, and it records the act

**Status:** Accepted — Milestone 7, checkpoint C5

A report READ writes no audit row anywhere in Milestone 7. A successful export
writes exactly one `report.exported` row, inside the same `REPEATABLE READ`
transaction that read the rows — so `rowCount` is provably the count the caller
received, and a failure between the two leaves neither. A refused export writes
nothing, because the guard rejects the caller before the service runs. One action
covers all five surfaces, with the surface in the payload.

The payload is assembled from the REQUEST plus one number the server counted:
surface, `format: 'CSV'`, the range and its date basis (explicitly `null` for
family accounts, which has none), the filters the caller supplied, and
`rowCount`. It is deliberately impossible to pass a row to the payload builder,
which rules out by construction — not by review — every amount, total, balance,
resolved name, personal identifier, bank reference and free-text value. There is
no `truncated` flag, because nothing truncates.

- **Alternatives:** auditing report reads too; five actions, one per surface; a
  payload carrying the exported dataset or its totals.
- **Reason:** `audit_log` is append-only and permanent, so a value copied into it
  becomes a second undeletable store of exactly the data the clinic was careful
  about — and a read copied into it would grow that store with every refresh, to
  answer a question that never needed the values. "Did somebody take this data
  out, and what was it about?" is answerable from ids, closed enums, dates and a
  count. Recording the filters is safe precisely because every Milestone 7 filter
  is an opaque id, a calendar date or a closed enum: reporting has no name search
  anywhere, for the reason family search is a POST.
- **Trade-off:** the trail cannot reproduce what a given file contained, only what
  it was about and how large it was.
- **Revisit when:** a legal or regulatory requirement demands the contents of an
  export be reconstructable, which would be a different store than `audit_log`.

## 2026-08-18 — The CSV bytes are RFC 4180 with a BOM, and the reader's list separator is the accepted cost

**Status:** Accepted — Milestone 7, checkpoint C5

One formatter writes every export: a UTF-8 byte order mark, CRLF terminators,
every field unconditionally quoted with embedded quotes doubled, a comma
delimiter, and ASCII digits everywhere — money exactly as the wire carries it, a
plain integer string of whole toman. Formula injection is neutralised per column,
on `freeText` columns only, by an apostrophe prefix; the server's own amounts,
counts, dates, enums and uuids are left machine-parseable. The download filename
is ASCII and server-built. Nothing truncates and there is no row cap.

**Excel splits a `.csv` on the reader's Windows list separator, not on the comma**,
so a machine configured with a semicolon separator opens these files in a single
column until the reader imports them or changes the setting.

- **Alternatives:** a `sep=,` preamble; a semicolon delimiter; Persian digits in
  the file; a global formula guard on every column.
- **Reason:** the BOM is what stops Persian headings and family names opening as
  mojibake, and it costs three bytes. `sep=,` is a Microsoft extension every other
  parser reads as a data row, and choosing the semicolon would break
  standard-conforming consumers to please one configuration of one product.
  Persian digits are text in every cell a spreadsheet parses. Guarding the
  server's own numbers against a risk they cannot carry would corrupt the figures
  the file exists to deliver.
- **Trade-off:** one Windows locale needs an import step or a settings change.
- **Revisit when:** pilot reviewers actually hit the single-column behaviour often
  enough that a documented import step is not enough, which is a packaging
  decision rather than a format one.

## 2026-08-18 — The family-accounts CSV carries its system-record-only scope in the file

**Status:** Accepted — Milestone 7, checkpoint C5

`FAMILY_ACCOUNT_SCOPE` is a constant first column, `SYSTEM_RECORDS_ONLY`, under a
Persian heading that states the qualification in the language of the product:
these figures are only the records this system holds, with no opening balance and
no pre-system paper debt. It is a column rather than a preamble or a note row, and
it appears on this one export alone. The interface prints the same qualification
beside the report.

- **Alternatives:** a `sep`-style preamble line; a trailing note row; relying on
  the screen's disclosure alone.
- **Reason:** a CSV is read months later beside no screen, and an amount due read
  without that qualification looks like a complete statement of what a family
  owes. A preamble or a note row is a line every parser has to be told to skip; a
  constant column survives sorting, filtering and a copy into another sheet. It is
  on this file alone because it is the only export that states a financial
  position.
- **Trade-off:** one repeated column in every row of one file.
- **Revisit when:** opening balances or pre-system debt enter scope, at which point
  the qualification is no longer true and the column has to change with it.

## 2026-08-18 — Print is a stylesheet, and no document is generated

**Status:** Accepted — Milestone 7, checkpoint C5

The readable print treatment PROJECT_SPEC.md 10 requires is one `@media print`
block plus a `ReportActions` control that calls `window.print()`, offered on the
dashboard, all five reports and the family account. It hides the application
chrome, filter forms and controls, repeats table headings across pages, avoids
breaking a row, prints A4 landscape, and keeps the page RTL with Persian
numerals, Jalali dates and toman as the screen does. Where a financial position
appears, the system-record-only disclosure prints with it.

**No PDF is generated, and nothing is framed as a receipt or a formal statement.**
There is no receipt number, no "official statement" wording and no signature
block anywhere in the print output.

- **Alternatives:** server-side PDF rendering; a dedicated print route per report;
  a formal statement layout.
- **Reason:** PROJECT_SPEC.md 10 says PDF is not initially required, and a
  document that looks like a receipt is a financial instrument the clinic has not
  approved issuing — the first person to hand one to a family has created an
  expectation the system cannot honour. A stylesheet over the page the reader is
  already looking at also cannot disagree with it.
- **Trade-off:** the output is the browser's, so pagination and margins vary a
  little between browsers, and there is no archived artefact of what was printed.
- **Revisit when:** the clinic approves issuing a formal receipt or statement,
  which is a product decision with its own audit and numbering requirements.

## 2026-08-18 — An audited entity type may name no table, and `report` is the only one

**Status:** Accepted — Milestone 7, checkpoint C6 (a narrow correction of a C5
omission found by the integrated gate, not a new owner decision)

`AUDIT_ENTITY_TYPES` had been every table name in the schema, and
`catalog-schema.int-spec.ts` asserted exactly that. C5 added `report` — which names
no table, because an export changes no row and carries a null `entity_id` — and
reconciled neither the assertion nor the list's own doc comment, so the full
integration suite failed at closure.

The invariant is now stated as it is actually meant: **every audited entity type is
a real table, except the declared non-row subjects, which must NOT be tables.** The
exception is an allow-list of one, and the second half is what keeps it honest — if
a `report` table is ever created, the test fails and the decision has to be made
again deliberately.

- **Alternatives:** dropping the assertion; skipping `report`; inventing an `export`
  table so the original rule held.
- **Reason:** the original rule existed because `entity_id` has no foreign key, so
  the entity type is the only thing tying an audit row to what it describes — and
  that rule is still right for every row that names one. Weakening it to a skip
  would lose the check for the next entity type somebody adds; an `export` table
  would be the stored export C5 is forbidden to create.
- **Trade-off:** one allow-list to maintain, and a reviewer must read two assertions
  instead of one to know what the rule is.
- **Revisit when:** a second non-row audit subject is proposed — at which point the
  question is whether "an act with no row" is becoming a category rather than an
  exception.

## 2026-08-18 — Milestone 7 outcome: reporting cost is unbounded by design, and measured later

**Status:** Accepted — outcome note recorded at the integrated Milestone 7 review;
adds no rule and changes no frozen contract

Three related pilot-scale costs are accepted rather than engineered around, and
they share one revisit trigger — measured evidence from real data volumes:

- **no server-side maximum report span** (the C1 range decision), so a
  deliberately enormous range is answerable and therefore expensive;
- **every figure is derived on the request that asks for it**, over three B-tree
  indexes and no stored aggregate, so a wide clinic-wide read costs a wide read;
- **a CSV export materialises the whole file in memory**, because nothing pages and
  nothing truncates.

- **Alternatives:** a numeric span cap; a nightly rollup; streaming an export out
  of a cursor now.
- **Reason:** at pilot volumes — a clinic whose write rate is a receptionist
  typing — none of the three is measurable, and each mitigation trades a real
  correctness property for an unmeasured performance one. A silently shortened
  financial file is a far worse failure than a slow one, and a refusal built on an
  invented number becomes the limit the manager hits on the day they need the
  widest report.
- **Trade-off:** the first genuinely large report is discovered in use rather than
  refused in advance.
- **Revisit when:** a report's plan shows a sort or a join dominating at real data
  volumes, or an export is large enough to strain the process — at which point
  streaming from a cursor is the change to make, and any numeric bound is a cost
  bound argued from a query plan and needs owner approval.

## 2026-08-19 — A share rule is scoped to the therapist and to nothing else

**Status:** Accepted — Milestone 8, checkpoint C2

`therapist_share_rule` carries a therapist, a percentage in basis points and an
effective range. It carries no service, no duration, no family and no appointment
type, so "what does this therapist take?" has one answer per date rather than one
per service.

- **Alternatives:** mirroring `tariff`'s (service, duration, therapist) scope with
  a general fallback; adding a nullable `service_id` now so the column exists.
- **Reason:** CLAUDE.md approves percentages that differ BY THERAPIST and change
  OVER TIME, and nothing else. A second scope dimension is a settlement rule
  inferred rather than approved, which CLAUDE.md forbids outright — and it is not
  free: a nullable scope column would need the `tariff` pair of exclusion
  constraints (because `=` does not treat NULL as equal to NULL) and a precedence
  rule deciding which of two matching rules wins, both of which are answers to a
  question nobody has asked.
- **Trade-off:** a clinic that later agrees a different percentage per service
  needs a migration, not a configuration change.
- **Revisit when:** an owner approves per-service or per-programme share rates. The
  change is additive — a scope column, a second exclusion constraint and a stated
  precedence rule — and existing rows stay correct as the unscoped case.

## 2026-08-19 — A share rule may be written for an inactive therapist

**Status:** Accepted — Milestone 8, checkpoint C2 — deliberately departs from the
`tariff` precedent

Creating a share rule requires the therapist to EXIST and does not require them to
be ACTIVE. `TariffsService` refuses an inactive therapist; `ShareRulesService`
does not.

- **Alternatives:** refusing on `INACTIVE`, as the tariff does; refusing a first
  rule but allowing a correction.
- **Reason:** the two records answer different questions. A tariff prices FUTURE
  bookings, so an inactive therapist has nothing to price. A share rule records an
  agreement about work that may already have happened, and a therapist who has
  left is exactly the case where a wrong historical percentage most needs
  correcting — settlement of their past sessions still has to be possible.
  Refusing on status would make a departed therapist's configuration permanently
  uncorrectable, which contradicts the frozen C2 rule that a rule must be
  correctable with its history preserved. The asymmetric variant was rejected as
  an arbitrary rule nobody could predict from either half.
- **Trade-off:** a manager can record an agreement for somebody who has left, and
  nothing warns them. The row is audited and voidable, so the mistake is visible
  and reversible.
- **Revisit when:** a therapist lifecycle beyond ACTIVE/INACTIVE is introduced, or
  share rules acquire a creator-facing screen that could warn instead of refuse.

## 2026-08-19 — `SHARE_RULE_NOT_FOUND`: a C1 omission corrected, not a new rule

**Status:** Accepted — Milestone 8, checkpoint C2 (a narrow correction of a C1
omission found while implementing the lifecycle C1 froze, not a new owner
decision)

C1 froze twelve settlement error codes, four of them the share rule's, alongside a
lifecycle whose read and void routes are addressed BY ID. An unknown id therefore
had no answer. C2 adds a thirteenth code, `SHARE_RULE_NOT_FOUND` (404).

- **Alternatives:** reusing `SHARE_RULE_MISSING`; returning a bare 404 with no
  code; adding a generic `NOT_FOUND`.
- **Reason:** `SHARE_RULE_MISSING` is 422 and means "no rule covers this SERVICE
  DATE" — the state that must never be read as a zero — so answering a mistyped id
  with it would report the frozen missing-rule condition for a request that named
  nothing, and would give the web tier one Persian message for two unrelated
  situations. Every other addressable record in `@clinic/contracts` carries its own
  `*_NOT_FOUND`; this is that pattern rather than an extension of the settlement
  vocabulary, and it states no rule about money.
- **Trade-off:** the "exactly twelve settlement codes" assertion frozen in C1 is
  restated as twelve plus one named addressability code, and a reviewer has to
  read why.
- **Revisit when:** a later checkpoint proposes a fourteenth. The bar is unchanged:
  a code that states a domain rule needs owner approval, and only a code the frozen
  lifecycle cannot express without it earns this treatment.

## 2026-08-19 — The Milestone 7 "no share column anywhere" tripwire is narrowed, not dropped

**Status:** Accepted — Milestone 8, checkpoint C2

`reporting-schema.int-spec.ts` asserted that NO column anywhere matched
`(share|percent|settlement)`, explicitly leaving the decision to Milestone 8. C2
makes that decision, so the assertion now names the exact two columns on
`therapist_share_rule` and still refuses every other one.

- **Alternatives:** deleting the assertion; excluding the new table from it.
- **Reason:** the original rule existed because a share column recorded outside an
  approved settlement model is an unfunded liability recorded as a fact, and that
  reasoning is unchanged for every table except the one whose whole purpose is the
  agreement. A share column appearing on `session_charge` or `charge_adjustment`
  would be a settlement FACT written outside the checkpoint that owns it, and it
  still fails here. Excluding the table by name would lose the check for the
  columns C3 will add to it.
- **Trade-off:** the assertion must be updated deliberately in each checkpoint that
  adds a settlement column, which is the intent.
- **Revisit when:** C3 adds the per-session snapshot — at which point its columns
  are listed here for the same reason these are.

## 2026-08-19 — A submitted therapist portion is refused until the split runtime exists

**Status:** Accepted — Milestone 8, checkpoint C2 revision (implements what the C1
contract already promised; not a new rule and not a contract change)

`POST /session-charges/:id/adjustments` refuses a **non-zero**
`therapistDiscountToman` with `ADJUSTMENT_SPLIT_INVALID` (422). An explicit `'0'`
and an omitted field are both accepted and record the clinic-borne concession they
state. No split arithmetic is computed, nothing new is persisted, and
`charge_adjustment_clinic_borne_chk` is untouched.

C1 made the field submittable ahead of the runtime that honours it and wrote the
interim rule into the contract itself — "until then a request carrying a non-zero
portion is refused by the server rather than silently written"
(`ledger/charges.ts`) — but no code implemented it. The gap was live: a manager
could state a shared concession, receive a success, and have the clinic recorded
as bearing all of it. C1 did not run the integration gate, so the Milestone 5
regression test that had guarded exactly this went red unnoticed.

- **Alternatives:** reverting the C1 contract so the schema refuses the field
  again; accepting the portion and storing it (the later checkpoint's work);
  leaving it and documenting the gap.
- **Reason:** silent success with a different financial fact than the one
  submitted is the worst of the three failure modes — it is discovered at
  settlement, by the therapist who is short, and by then the concession is
  history. Reverting the frozen contract would break a cross-lane agreement the
  web lane is already building against, for a condition that is genuinely
  temporary. `ADJUSTMENT_SPLIT_INVALID` needs no new code and fits without
  stretching: it means the portion cannot be honoured because the session carries
  no rating to bear it against, and today NO session carries one, because the
  table that would hold it does not exist. The same code stays correct when
  ratings arrive and only some sessions have one.
- **Trade-off:** for one checkpoint the API advertises a field it always refuses
  above zero. The refusal is explicit, coded and translated, which is the
  behaviour the contract already described.
- **Revisit when:** the approved concession-split checkpoint implements
  therapist-borne allocation. It replaces this guard with the real split and the
  matching database constraint change — the guard is deleted by that work, not
  before it.

## 2026-08-19 — A share rule's percentage is written to audit in full

**Status:** Accepted — Milestone 8, checkpoint C2 — applies 2026-08-09 rather than
refining it

`therapist_share_rule.created` and `.voided` record the percentage, the therapist
id and the effective range in `before`/`after`. `metadata` carries only the
correction linkage and never a value.

- **Alternatives:** recording only the rule id and the reason, and leaving the
  percentage to be looked up on the row; masking or bucketing the rate.
- **Reason:** 2026-08-09 already draws this line. A value copied into the
  permanent `audit_log` is a second undeletable store, so an identifier that is
  NOT the fact being changed is masked or omitted — a national id, a phone number,
  a bank reference (2026-08-15) — while the fact being changed is written in full,
  because masking it "would make the trail useless for the corrections it exists
  to explain". A share percentage is not an attribute attached to the change; it
  IS the change. C1's frozen vocabulary depends on it too: there is deliberately
  no `therapist_share_rule.updated`, because a rate change is recorded as the
  share that stopped applying and the one that replaced it, and an entry without
  the value cannot say either. And it adds no exposure surface — the table is
  immutable and carries no-delete and no-truncate triggers, so the primary store
  is exactly as permanent as the audit copy, which is not true of a phone number
  whose source row can be corrected.
- **Trade-off:** the agreed rate for a therapist appears in a second permanent
  table. Access to `audit_log` is already manager-level and the rate is already
  manager-only on its own row, so no reader gains anything they could not read
  already.
- **Revisit when:** audit retention or export gives a wider audience than the
  share-rule table itself — at which point the question is about `audit_log`
  access, not about this payload.

## 2026-08-19 — A rating names its charge through five snapshot facts, not one id

**Status:** Accepted — Milestone 8, checkpoint C3

`session_settlement` carries `session_charge_id`, `appointment_participant_id`,
`therapist_id`, `service_date` and `base_amount_toman`, and all five are one
composite foreign key into `session_charge` (`session_settlement_charge_snapshot_
fkey`), supported by `session_charge_settlement_snapshot_uq`. The half-up split
is re-derived by `session_settlement_split_chk` in SQL as well as computed by
`share-split.ts` in `BigInt`.

- **Alternatives:** a plain `session_charge_id` foreign key with the other four
  columns unconstrained; storing only the charge id and joining for every figure;
  a trigger comparing the copy with the charge on insert.
- **Reason:** a rating is the row a settlement statement reads, so a copy that can
  disagree with its source is worse than no copy — the disagreement surfaces as a
  therapist's month, not as an error. The composite key makes the disagreement
  UNREPRESENTABLE rather than merely checked, for every writer including a repair
  script and a psql prompt, which is the same device
  `session_charge_child_id_family_id_fkey` already uses to stop a charge naming a
  child of another family. Joining instead would make last month's earnings a
  function of a table that a later correction can change. The duplicated split
  arithmetic is deliberate for the same reason
  `enforce_charge_adjustment_bounds` duplicates the service's affordability check:
  the service produces the named refusal a person can act on, the database makes
  the rule true of everybody.
- **Trade-off:** one extra unique index on `session_charge`, and four columns that
  look redundant to a reader who has not read this entry. The index leads with the
  primary key, so it can never refuse a charge the primary key would accept.
- **Revisit when:** a settlement fact ever needs to attach to something that is
  not a session charge.

## 2026-08-19 — A charge void leaves the applied share snapshot standing

**Status:** Accepted — Milestone 8, checkpoint C3 revision — **corrects and
replaces an unauthorized deviation introduced earlier in C3**

`POST /session-charges/:id/void` writes the three void columns on the charge and
touches nothing else. The `session_settlement` row is not withdrawn, not edited
and not deleted, and no `session_settlement.voided` audit fact is produced by a
charge void. `GET /settlement/session-charges/:id/rating` answers `CHARGE_VOIDED`
for a withdrawn charge, and every settlement figure a later checkpoint computes
must join the charge and apply `voided_at IS NULL`.

**What this replaces.** The first C3 implementation withdrew the rating inside
the charge-void transaction. That was not in the accepted plan and it was wrong:
it is recorded here rather than deleted, because the reasoning is what stops it
being reintroduced.

- **Alternatives:** withdrawing the rating with the charge (what C3 did, now
  reverted); refusing to void a charge that carries a rating.
- **Reason:** a rating records what percentage WAS APPLIED to that charge while
  it stood. A void is a later fact about the charge; it does not travel backwards
  and make the percentage never have been applied. Withdrawing the rating as a
  side effect wrote a settlement fact — with an actor and a reason — that nobody
  decided, which is exactly what CLAUDE.md's "explicit, reasoned, auditable"
  rules exist to prevent, and it destroyed the history a closed period will later
  have to stand on: C6 must be able to see that a closed `PRIMARY` line's rating
  is still there. The invariant the earlier version was reaching for — a voided
  charge must contribute nothing — is already satisfied by the predicate every
  other total in this system uses, applied one join further out. Refusing the
  void would make the approved correction sequence unreachable whenever a share
  rule happened to exist.
- **Trade-off:** a standing rating can point at a withdrawn charge, so no reader
  of `session_settlement` may total it without joining `session_charge`. That is
  stated here, in the service, in the schema comment and in a test; it is the
  same discipline `charge_adjustment` already requires.
- **Revisit when:** never for this rule. A later checkpoint that reads ratings in
  bulk inherits the join requirement, and the C3 read already demonstrates it.

## 2026-08-19 — The closed-period refusal is deferred to C6 rather than approximated

**Status:** Accepted — Milestone 8, checkpoint C3 — a deliberate, reported gap

C3 implements the atomic rating correction in full (`POST
/settlement/rating-corrections` — withdraw and replace in one transaction) but
never raises `RATING_REPLACEMENT_REQUIRED`. A plain withdrawal of a standing
rating therefore always succeeds at this checkpoint.

- **Alternatives:** inventing a provisional notion of a settled rating in C3 so
  the refusal could exist; leaving the correction endpoint out until C6 and
  adding both together.
- **Reason:** the refusal's condition is "a closed `PRIMARY` settlement line
  depends on this rating", and there is no `settlement_period` and no
  `settlement_line` to ask. Any stand-in would be a settlement-period concept
  inferred rather than approved, which CLAUDE.md forbids outright, and it would
  have to be unpicked by the checkpoint that brings the real one. Shipping the
  correction NOW is what makes C6 additive: it adds a refusal to the withdrawal
  path and a `CORRECTION` line carrying the delta, rather than a capability.
  Withholding it would leave C3 with no way to change a wrong percentage without
  an observable unrated moment.
- **Trade-off:** for one checkpoint a rating can be withdrawn with nothing
  standing behind it. Nothing reads a rating yet — no statement, no period, no
  export — so the state is unobservable outside the rating endpoints themselves.
- **Revisit when:** C6 creates `settlement_period` and `settlement_line`. It owns
  the refusal, the closed-line invariant and the correction carry-in.
  `RATING_HAS_THERAPIST_ALLOCATIONS` is unreachable for the same kind of reason —
  no therapist-borne allocation can exist while the C2 guard refuses one — and
  belongs to the concession-split checkpoint.

## 2026-08-19 — A share rule is the only source of settlement policy

**Status:** Accepted — Milestone 8, checkpoint C3 revision — **corrects a C1
contract ambiguity and the C3 code that implemented it**

`POST /settlement/session-charges/:id/rating` takes a REASON AND NOTHING ELSE.
The applied percentage is resolved by the server from the therapist's
effective-dated share rule covering the charge's `service_date`, by the same
statement the charge-posting path uses. `session_settlement.applied_share_rule_id`
is NOT NULL, on every row. `ratedVia` records whether the server rated the
session while charging it (`AUTOMATIC`) or a manager rated it afterwards
(`EXPLICIT`), and is not submittable in either direction.

**The C1 contract is corrected, not preserved.** `rateSessionRequestSchema` was
a discriminated union whose `EXPLICIT` member carried `shareBasisPoints`, and
`sessionSettlementSchema.appliedShareRuleId` was nullable to accommodate it. Read
literally, that made `ratedVia` a _policy source_ discriminator and created a
second, unversioned place to state what a therapist earns. The accepted M8 rule
is that it describes how the rating ACT happened. C1's own prose already leaned
the other way in places; the shapes are now unambiguous.

- **Alternatives:** keeping the free-typed percentage as a manager override;
  keeping the union but dropping only `shareBasisPoints` from the `EXPLICIT`
  member; leaving the contract and constraining it in the service.
- **Reason:** a percentage typed onto one session is settlement policy stated
  somewhere with no effective date, no supersession history and no void trail —
  the three properties C2 built `therapist_share_rule` to have. Two sessions on
  the same day for the same therapist could then settle differently with nothing
  in the record explaining why, and next month's figure would depend on which
  screen somebody used. Dropping only the percentage would have left two ways to
  do the same thing differing only in whether a reason was recorded, which would
  have let a manager rate a historical session with NO reason — the opposite of
  what the accepted rule requires. Constraining it in the service alone would
  leave the wrong semantic frozen in the contract the web lane builds against.
- **How a wrong percentage is corrected, since it can no longer be typed:** in
  two audited acts that already exist. Correct the RULE — which voids it and
  writes a replacement naming it, with a reason — and then correct the RATING,
  whose replacement re-resolves against the corrected agreement. Neither rewrites
  history, and both say who and why.
- **Trade-off:** a genuinely one-off percentage for a single session cannot be
  expressed. That is deliberate: no such product concept is approved, and
  CLAUDE.md forbids inferring a settlement rule that has not been. If one is ever
  approved it arrives as a scoped share RULE, which stays effective-dated and
  auditable.
- **Revisit when:** a per-session commercial arrangement is explicitly approved
  as a product concept — at which point the question is what shape of RULE
  expresses it, not whether a percentage may be typed onto a settlement fact.

## 2026-08-19 — A concession's therapist/clinic allocation, and where its floor lives

**Status:** Accepted — Milestone 8, checkpoint C4

A family concession may be borne entirely by the clinic, entirely by the
therapist, or split (CLAUDE.md). The request carries the TOTAL and the
THERAPIST'S SHARE OF IT; the server writes the clinic's as the exact residual.
Omitting the portion, or stating it as zero, is the unchanged clinic-borne
default. A positive portion requires a STANDING `session_settlement` row on the
same charge and is bounded, cumulatively, by that row's
`therapist_gross_toman` — the C3 snapshot, never a percentage re-resolved today.
`charge_adjustment_clinic_borne_chk` is dropped; nothing is back-filled.

**No `session_settlement_id` column is added to `charge_adjustment`.** At most
one rating of a charge ever stands, so "which share does this portion bear
against" already has exactly one answer, derived by the join.

- **Alternatives:** storing the settlement id on the adjustment as explicit
  provenance; enforcing the floor only in the service; a separate trigger with
  its own lock.
- **Reason:** a stored copy is a second answer that can disagree with the first,
  and it would point at a row a correction withdraws —
  `enforce_charge_adjustment_immutability` forbids re-pointing it, so the copy
  would rot by design. The floor is a statement about a SUM, so no CHECK can
  express it; it lives in `enforce_charge_adjustment_bounds` beside the
  family-side floor, which already takes `session_charge FOR UPDATE` before
  deciding anything. One lock covers both inequalities because every write that
  can move either side — a concession, and every rating write, which locks the
  charge first — takes that same row. A second trigger with a second lock would
  have been a second lock order and therefore a deadlock.
- **Trade-off:** the ledger reads a settlement table on the therapist-borne
  path, which the clinic-borne path never does. The module dependency already
  pointed that way (`LedgerModule` imports `SettlementModule`).
- **Revisit when:** a concession is ever allowed to span more than one charge, or
  a session can carry more than one standing rating. Either would break the
  one-answer derivation and make stored provenance the right shape.

**A rating bearing a standing therapist-borne allocation cannot be withdrawn OR
corrected.** `RATING_HAS_THERAPIST_ALLOCATIONS`, frozen in C1 and unreachable
until now, is refused by `SessionRatingService.voidRow` and by
`session_settlement_enforce_allocation_guard`.

- **Alternatives:** permitting a correction whose replacement gross still covers
  the allocation; re-pointing the allocation onto the replacement.
- **Reason:** re-pointing is impossible — the adjustment row is immutable — so a
  permitted correction would leave the allocation measured against a percentage
  the manager never saw. The approved sequence is three explicit reasoned acts:
  withdraw the concession, correct the rating, re-grant the concession against
  the share that now applies.
- **Trade-off:** correcting a percentage on a session with a therapist-borne
  concession takes three requests instead of one.
- **Revisit when:** C6 introduces settlement periods. A correction inside a
  closed period must already carry a delta forward; whether that mechanism
  should also carry an allocation forward is a question that only becomes
  answerable then.

## 2026-08-19 — The settlement statement reads snapshots, and says nothing it cannot yet know

**Status:** Accepted — Milestone 8, checkpoint C5

`GET /settlement/statement` answers, for one therapist and one explicit
inclusive range keyed on `SESSION_DATE`, what the CURRENTLY VALID recorded facts
say that therapist earned. It is a read: no row, no aggregate, no audit entry, no
cached total, no lock. A line exists for every session whose RATING stands
(`session_settlement.voided_at IS NULL`) and whose CHARGE stands
(`session_charge.voided_at IS NULL`), and the money on it is
`therapistNet = therapistGross − therapistDiscount` and
`clinicNet = clinicGross − clinicDiscount`, where the two gross figures are read
verbatim from the C3 snapshot and the two borne portions are the sums of ACTIVE
`charge_adjustment` rows.

**`therapist_share_rule` is not joined, and `resolveShareRuleRow` is not
imported.** The applied percentage is read off the session's own row.

- **Alternatives:** resolving the therapist's effective rule for each session's
  service date at read time; recomputing `base × bp` rather than reading the
  stored gross.
- **Reason:** both would make a statement restate itself the first time a rule
  was corrected, or the first time the rounding rule was touched — which is the
  single failure the whole milestone was built to make impossible. The stored
  gross is already re-checked in SQL by `session_settlement_split_chk`, so
  reading it is reading a figure the database has verified, while recomputing it
  is applying today's arithmetic to a session somebody has already been shown.
- **Trade-off:** none identified. The snapshot is the authoritative fact.
- **Revisit when:** never for this read. A future report that asks "what WOULD
  this session earn under today's agreement" is a different question and needs a
  different name.

**Pre-C6 fields are answered with the truth about a system that has never closed
anything.** `lineType` is `PRIMARY` and `correctsSessionSettlementId` is null on
every line; `correctionCount` and `settledToman` are zero;
`earnedUnsettledToman` and `netSettlementToman` are both the range's
`therapistNetToman`.

- **Alternatives:** synthesising a `CORRECTION` line from
  `supersedes_session_settlement_id`; creating placeholder period rows so the
  future-facing fields have something to point at.
- **Reason:** a `CORRECTION` line is defined as the delta of a rating corrected
  AFTER its period was CLOSED. No period exists, so no such line can. A rating
  corrected before any close is simply the standing rating of its own session on
  its own day, and reporting it twice would double-count it. Placeholder
  financial records to fill a future contract are exactly the invention CLAUDE.md
  forbids.
- **Trade-off:** three fields are constants until C6. They are constants that are
  TRUE, and C6 changes their computation without changing their meaning.
- **Revisit when:** C6 introduces `settlement_period`.

**A `FREE` session is a line worth zero AND a separate count; an unrated session
is neither.** `freeSessionCount` explains zero-valued lines the statement DOES
carry; `unratedSessionCount` and `unchargedCompletedSessionCount` name sessions
it carries no line for, for two different reasons. The three are never summed,
never combined into a "problem count", and a session falls in at most one.

- **Alternatives:** excluding free sessions from `lines` entirely; folding an
  unrated session in as a zero line.
- **Reason:** the frozen contract counts free sessions so a reader "can see why
  the session count and the money do not track", which presumes they are IN the
  session count. An unrated session is the opposite case: nobody has decided the
  share, and a zero is indistinguishable from a decision that the session was
  worth nothing — the one confusion that quietly under-pays somebody.
- **Trade-off:** `sessionCount` counts sessions that moved no money.
  `freeSessionCount` is the field that explains it.
- **Revisit when:** group sessions make one appointment carry several seats with
  different price modes.

**One `REPEATABLE READ` transaction covers the lines and both exception counts.**

- **Alternatives:** four statements under `READ COMMITTED`; one statement with
  the exceptions as correlated aggregates.
- **Reason:** a charge voided between two statements would produce lines
  describing one database and counts describing another — a statement that does
  not add up, produced from a database that always did. It is the isolation the
  session report and the family account already take, it locks nothing and it
  blocks no writer. The totals are the column sum of the returned lines rather
  than a second aggregate, so "the total is the sum of the lines" is true by
  construction.
- **Trade-off:** a snapshot slightly older than the instant the response is
  serialised. That is what a dated document is.
- **Revisit when:** the statement gains a figure that cannot be derived from the
  rows it returns.

**Manager-only, refused whole, and unaudited.** `settlement.read` alone; a
receptionist is refused by `PermissionsGuard` before any statement runs, with no
thinner variant of the response. No audit row is written for a read, which is the
Milestone 7 financial-read policy (`FinancialReportsController`) applied
unchanged.

- **Alternatives:** a redacted receptionist shape; auditing every statement view.
- **Reason:** the response is financial in its entirety, so there is nothing
  useful to show somebody who may not read it; and `audit_log` is append-only and
  permanent, so recording views would build a second undeletable store of who
  looked at whose earnings, growing with every refresh. Audit records financial
  ACTS, and this performs none.
- **Trade-off:** no record of who read a statement. The EXPORT, when it arrives,
  audits — taking the file out of the building is an act.
- **Revisit when:** the clinic asks for access logging of financial reads as a
  policy, at which point it belongs to infrastructure logging rather than to
  `audit_log`.

**No index and no migration were added.** The lines are answered by
`session_settlement_therapist_id_service_date_idx`, which is exactly the pair
the range filters on; the unrated count rides
`session_charge_service_date_idx` and the uncharged count the appointment range
index the operational reports already use.

- **Alternatives:** adding `session_charge(therapist_id, service_date)`
  pre-emptively.
- **Reason:** no measured evidence asks for it, and an index added on a guess is
  a write cost paid forever for a read nobody has timed.
- **Revisit when:** a query plan on realistic volumes shows the unrated-count
  scan dominating.

## 2026-08-19 — A closed settlement period materialises what a close made final, and nothing rewrites it

**Status:** Accepted — Milestone 8, checkpoint C6

`POST /settlement/periods` closes one therapist's earnings over one explicit
inclusive range of clinic days, keyed on `SESSION_DATE`. It writes a
`settlement_period` row and one immutable `settlement_line` per session it
settled or corrected, plus one `settlement_period.closed` audit fact, all in one
transaction. `GET /settlement/periods` reads them back. **There is no update,
delete or reopen route, no un-close request in the contract, no method on the
service, and no permitted UPDATE on either table** —
`enforce_settlement_close_immutability` refuses every one outright, which is
where C6 departs from every other financial table in this schema: those permit
one transition, standing to withdrawn, and a closed period cannot be taken back
at all.

**Two tables rather than one, and the figures are COPIED rather than derived.**

- **Alternatives:** a period row carrying only totals, with the detail re-derived
  on read; storing nothing and treating "closed" as a date range the reads
  respect.
- **Reason:** a close is the one act in this milestone that makes a figure FINAL.
  Every C5 figure is derived and legitimately changes when a concession is
  granted the next day; a closed figure must keep saying what it said, which
  means it has to stop being derived. Totals without lines would be a number
  nobody could reconcile against the diary, and it is the LINE — not the total —
  that carries "this session has been settled, once", which is the guarantee the
  whole checkpoint rests on.
- **Trade-off:** the same money exists in two places, live and materialised, and
  they can in principle drift. That is why they are reconciled by construction
  (below) and why the reconciliation is asserted against raw SQL over the
  authoritative rows in `settlement-close-reconciliation.int-spec.ts`.
- **Revisit when:** never for the materialisation itself. A therapist payout, if
  it is ever approved, is a further record naming a period — not a column on one.

**One derivation for the close and the statement, in `settlement-facts.ts`.**

- **Alternatives:** a query in each service; the close calling the statement
  service.
- **Reason:** two derivations of "what is this session worth now" are two answers
  to one question, and the day they disagree is the day a correction is written
  for an amount nobody can account for. The shared statement also carries the
  settled sums, so a correction is a SUBTRACTION on one row rather than a
  reconciliation across two reads.
- **Trade-off:** the statement now reads `settlement_line` on every request, one
  extra lateral per session.
- **Revisit when:** a plan on realistic volumes shows that lateral dominating.

**The correction is a signed residual, derived and never inferred from
configuration.** For a session a closed `PRIMARY` already carries, a later close
writes the column-by-column difference between what the session is worth now and
what its existing lines already carry — or nothing, when they agree.

- **Alternatives:** enumerating the categories that may produce a correction
  (charge void, concession change, rating correction) and handling each; deriving
  a correction from `supersedes_session_settlement_id`.
- **Reason:** the close must not ask WHY a figure moved, only WHETHER it moved,
  which is a question with exactly one answer and which cannot omit a category
  somebody forgets to enumerate. It also makes the central invariant true by
  construction: PRIMARY plus every CORRECTION equals the session's current
  figures, because a correction is DEFINED as the residual. And because the
  applied percentage lives on the rating as a number that is never re-resolved, a
  later share-rule change moves nothing and therefore produces no correction —
  proved directly by a test that voids and replaces the agreement at a different
  percentage and asserts the next close carries nothing.
- **Trade-off:** a correction line does not record which ACT caused it. The
  audit trail of the charge void, the concession or the rating correction does,
  and the line names the `PRIMARY` it reconciles and the rating standing when it
  was written.
- **Revisit when:** a report is approved that has to group corrections by cause.

**Idempotence is exact-match; overlap is refused whole.** The identical request
answers `ALREADY_CLOSED` with the existing period and writes no row and no second
audit event. A partially overlapping range is `SETTLEMENT_PERIOD_OVERLAP`, never
trimmed, merged or reinterpreted. Gaps are permitted.

- **Alternatives:** trimming an overlapping request to the free days; treating any
  intersecting request as idempotent.
- **Reason:** overlapping coverage settles some sessions twice, which is how
  somebody is paid for one session in two months, and a silently trimmed range is
  a period whose boundaries the requester never saw. Concurrency is held by three
  layers: `pg_advisory_xact_lock` on the therapist (so the retry SEES the first
  close rather than racing it), `FOR UPDATE` on every candidate charge in id
  order (this project's one lock order, so a concession or charge void lands
  wholly before or wholly after), and `settlement_period_no_overlap_excl` as the
  final authority.
- **Trade-off:** two closes for one therapist serialise. Closes for different
  therapists do not, because the advisory key includes the therapist.
- **Revisit when:** never for the overlap rule.

**A historical carry-in is a `PRIMARY` settlement, and only from a range already
closed.** A session excluded from an earlier close as unrated, and rated
afterwards, is settled by a later close as the `PRIMARY` it always should have
had, keeping its ORIGINAL service date. A session sitting in a range nobody has
closed is left where it is.

- **Alternatives:** carrying it in as a `CORRECTION`; sweeping in every unsettled
  session before the range's end.
- **Reason:** it has never been settled, so it is not a correction of anything —
  and `settlement_line_one_primary_per_charge_uq` is what makes "exactly once"
  structural. Restricting carry-ins to already-closed ranges is what keeps gaps
  meaningful: sweeping work out of a gap would settle days the manager never
  reviewed. The original date is what identifies it as a carry-in and what stops
  it being misrepresented as work performed in the later period.
- **Trade-off:** no boolean flag says "carry-in"; it is the disagreement between
  the line's service date and its period's range. A stored flag would be a second
  answer that can disagree with the dates.
- **Revisit when:** a read surface is approved that has to filter carry-ins
  directly.

**`excludedUnratedSessionCount` is stored, and a close never fails for unrated
sessions.** (The frozen Option A.) It counts charged sessions inside the RANGE
with no standing rating at the instant of closing, scoped to the range and not to
the carry-ins, so one omission is never counted twice across a year.

- **Alternatives:** refusing the close; recomputing the count on read.
- **Reason:** a clinic that cannot close a month until every session is decided
  stops paying people over one forgotten appointment. Recomputing answers zero
  the moment somebody rates one, and the answer that matters is the one that was
  true when the manager closed — that is what says what the closed figure did NOT
  include.
- **Trade-off:** none identified.
- **Revisit when:** never; the rule is frozen.

**Every session represented by a closed `PRIMARY` line keeps a valid applied
rating at all times.** `SessionRatingService.void` refuses a bare withdrawal with
`RATING_REPLACEMENT_REQUIRED`, and the database enforces the same condition at
COMMIT through the DEFERRED constraint trigger
`settlement_line_requires_valid_rating`, fired from both `session_settlement` and
`settlement_line`.

- **Alternatives:** an ordinary row trigger; enforcing it only in the service.
- **Reason:** the atomic correction withdraws and re-inserts in one transaction,
  so a row trigger would refuse the very operation the rule exists to require. A
  deferred constraint trigger asks the question exactly where "at all times" is
  observable from outside — at commit — so no other transaction can ever see a
  closed `PRIMARY` with no rating, and no zero is inferred anywhere. The refusal
  is keyed on the CHARGE rather than on the rating row, because after an earlier
  correction the closed line names a rating that has since been withdrawn.
  This is the refusal C3 deliberately deferred; C3's decision recorded that C6
  would add a refusal rather than a capability, and that is what happened.
- **Trade-off:** none identified. C4's `RATING_HAS_THERAPIST_ALLOCATIONS` is
  unchanged and still refuses both the withdrawal and the correction.
- **Revisit when:** never for this rule.

**The statement keys on `SESSION_DATE`, so it carries no `CORRECTION` lines, and
states the settled portion on each line instead.** `lineType` stays `PRIMARY` and
`correctsSessionSettlementId` stays null on every statement line; each line
carries the session's CURRENT authoritative position plus a new signed
`settledToman`, and `totals` gains a signed `pendingCorrectionToman` breaking
down `earnedUnsettledToman`. A session appears if it currently earns something OR
has ever been settled, so a charge withdrawn after its period closed keeps its
line — zeroed, with a non-zero settled figure.

**This is a departure from what the C1 contract comment anticipated, and it is
recorded as one.** That comment describes a statement carrying `CORRECTION`
lines. Two things make that unreachable on this read surface. First, the line
money fields are UNSIGNED (`tomanAmountSchema`) while the most important
correction — a charge voided after close — is per-line negative on the therapist
net, so the frozen line shape cannot represent it. Second, a `CORRECTION` lands
in a later PERIOD while the statement is keyed on the SESSION's day: a correction
to a session in this range is a change to THIS session, not work belonging to
another range of days, so listing it beside its own primary would state one
session twice in one column and break the totals.

- **Alternatives:** widening every line money field to signed and emitting
  correction lines; leaving the settled/unsettled split in the totals alone.
- **Reason:** widening `therapistNetToman` would delete from the type system the
  rule that a therapist net is never negative — the one CLAUDE.md states outright
  — to accommodate a delta that is not a session's worth. Leaving the totals
  alone would fail the requirement that the read surface distinguish earned,
  settled and pending. The chosen shape keeps every existing per-line guarantee,
  adds two signed fields, and makes the reconciliation checkable per line:
  `therapistNetToman − settledToman` is the pending movement. The materialised
  `CORRECTION` rows remain first-class facts of the PERIOD that carried them and
  are summarised on the closed period record by the frozen, already-signed
  `carriedInCorrectionCount` and `carriedInCorrectionToman`, which is the
  period-keyed surface a period-keyed fact belongs on.
- **Trade-off:** `lineType` and `correctsSessionSettlementId` are constants on
  this read. They are constants that are TRUE, and both remain meaningful on the
  `settlement_line` rows themselves.
- **Revisit when:** a period-keyed settlement read is approved — a "what did this
  closed period contain?" line listing — which is where `CORRECTION` lines have a
  column of their own and a signed line shape can be designed for them.

**No entity type is added for `settlement_line`, and no line is audited
individually.** `settlement_period` joins `AUDIT_ENTITY_TYPES` with its table;
`settlement_line` deliberately does not.

- **Alternatives:** an audit row per line.
- **Reason:** a line is not independently decided — it exists because a close
  materialised it, it can never be edited or withdrawn, and it is permanent in a
  table with its own no-delete trigger. A row per line would multiply an
  append-only table by the size of a therapist's month to record facts already
  permanently readable at source. An entity type nothing writes would advertise
  an act that does not exist.
- **Trade-off:** none identified.
- **Revisit when:** a line ever becomes independently decidable, which would mean
  the immutability rule had changed.

## 2026-08-20 — The settlement statement's CSV is the statement's own read, on the statement's own path

**Status:** Accepted — Milestone 8, checkpoint C8

`GET /settlement/statement/export` is the sixth exportable surface in the product
and the first whose read model lives outside `ReportsModule`. It takes the
statement's own query schema (`settlementStatementExportQuerySchema`, frozen C1),
demands `SETTLEMENT_EXPORT_PERMISSIONS` — `settlement.read` AND `report.export` —
and reads every row through `SettlementStatementService.exportRows`, which is the
screen's read with nothing removed, because the statement is not paged. The
export computes NOTHING: no predicate, no sum, no percentage, no subtraction, no
second settlement derivation. Its column list is a projection of the frozen
statement line and no more.

**It sits on `/settlement/statement/export` rather than under `/reports/`,** which
is the Milestone 7 rule (`/export` as a suffix on the report's own path) holding
rather than breaking. To reuse the audited export machinery without a module
cycle — `ReportsModule` already reaches `SettlementModule` transitively through
appointments and the ledger — the transaction, its audit row, the filename and
the download headers were extracted from `ReportExportService` into
`reports/csv-export.ts` as plain functions. Nothing about the five existing
exports changed: the same runner, the same isolation level, the same single
`report.exported` row.

**Signed values keep their signs and nothing is clamped.** A clinic net the clinic
explicitly subsidised is exported as the negative number CLAUDE.md requires it to
be, and it is deliberately NOT guarded against spreadsheet formula execution: a
leading `-` on a server-produced number is a number to every spreadsheet, and an
apostrophe would turn the figure a manager must sum into text. The formula guard
stays on free text alone.

**The file carries no totals row, and it carries its exclusions as two rows of
their own kind.** A CSV is opened months later beside no screen, and the screen is
where the excluded sessions are stated — so a file of settlement lines alone would
be read as COMPLETE by a manager whose month contains sessions nobody has rated.
Every row therefore declares its kind in the first column: `SETTLEMENT_LINE`, or
`EXCLUDED_UNRATED` / `EXCLUDED_UNCHARGED_COMPLETED` carrying the statement's own
count. Both exception rows are always written, including when they count zero, so
"this range excluded nothing" cannot be confused with "this export does not report
exclusions" — and an empty range is a file that says it is empty. An exception row
carries a COUNT and not one unit of money: every money cell on it is EMPTY, never
`0`, because an unrated session is the absence of a decision and not a session
worth nothing. A FREE session is not an exception and gets no such row: it is a
real `SETTLEMENT_LINE` of zeroes, because it is rated and settled at zero.
`rowCount` in the audit row keeps its meaning — the count of lines the caller
received — and the payload gains no key. The therapist is carried on every row of
both kinds, because a flat file has no header in which to say whose statement it
is and the ASCII filename carries only the period.

- **Alternatives:** a sixth route under `/reports/`; a settlement-specific export
  service duplicating the M7 transaction and audit row; a `settlement.export`
  permission; the exclusions as constant columns on every row (which say nothing
  when a range has no settlement rows at all), as a preamble line above the header
  (which makes the file unparseable) or as a trailing note row without a kind
  column (stranded the moment somebody sorts the sheet); one row per excluded
  session (a read this milestone has never performed and which would name
  sessions the statement does not); clamping or omitting negative figures.
- **Reason:** an export must be another representation of authoritative facts, not
  a second financial derivation — the day the two disagreed would be the day a
  therapist's printout disagreed with the screen. One read, one runner, one audit
  action. `report.export` already means "may take facts out of this system as a
  file", so no new authority was invented.
- **Trade-off:** the file has two kinds of row, which is a shape none of the five
  Milestone 7 files has. A consumer that assumes every row is a session must
  filter on the first column — which is exactly what the column is for, and it is
  the price of a file that cannot lie by omission. The exception rows state counts
  and not identities, so a manager who wants to know WHICH sessions are unrated
  still opens the screen.
- **Revisit when:** a reader needs the excluded sessions identified rather than
  counted, which is a new read (and a new decision about what a settlement file
  may name) rather than a change to this shape.

## 2026-08-20 — The closed period gets a period-keyed read, which is where a `CORRECTION` line has a column of its own

**Status:** Accepted — Milestone 8, checkpoint C7 support — fires the revisit
trigger the C6 entry above recorded, rather than changing any C6 rule

`GET /settlement/periods/:id/lines` answers with one closed period and every
`settlement_line` beneath it. The C6 entry closed with "revisit when: a
period-keyed settlement read is approved — a 'what did this closed period
contain?' line listing — which is where `CORRECTION` lines have a column of
their own and a signed line shape can be designed for them". This is that read,
and it is recorded here so the trigger is not left dangling.

**The lines are SELECTED, never re-derived.** `readSettlementFacts` is
deliberately not called and no share rule is joined, so the detail cannot drift
from the total it explains once a later concession or re-rating moves what the
session is worth today. Every amount is signed, because a `CORRECTION` moves
money backwards; `lineType` makes a correction a labelled fact rather than an
inference from a negative sign; `correctsSettlementLineId` traces the delta to
the historical line it reconciles; and `carriedIn` — derived from the
disagreement between the line's service date and its period's range, never
stored — stops a session settled later than it was performed from being passed
off as that period's own work.

**The statement is unchanged, and the owner decision it rests on still holds.**
The main statement remains ONE ROW PER CLINICAL SESSION, keyed on
`SESSION_DATE`, with `lineType` constant at `PRIMARY`; historical `CORRECTION`
lines live here, in closed-period detail, which is the period-keyed surface a
period-keyed fact belongs on.

**`priceMode` now travels on the statement line too.** A complimentary session, a
session discounted to nothing and a session whose charge was withdrawn all render
as the same row of noughts, and testing an amount against zero on the client
would be a second and wrong source of truth. `FREE` is therefore stated by the
server as provenance. UNRATED is unaffected: it has no line at all and stays a
count.

**`SETTLEMENT_PERIOD_NOT_FOUND` is the one new code,** and it is the
addressability pattern the 2026-08-19 `SHARE_RULE_NOT_FOUND` entry already set
rather than a new settlement rule: a period became addressable by id the moment
its lines could be read one period at a time, and every addressable record in
`@clinic/contracts` carries its own `*_NOT_FOUND`.

- **Alternatives:** rendering the closed detail from the live derivation;
  inferring a correction from the sign of the money; storing a `carried_in`
  boolean on the line; letting the web tier label `FREE` by testing the base
  amount against zero.
- **Reason:** each alternative puts a second answer somewhere — the live
  derivation restates closed history the first time anything moves, a sign is
  not a kind, a stored flag can disagree with the dates it duplicates, and a
  zero test cannot tell three different facts apart.
- **Trade-off:** the milestone gains a fourth settlement read surface and one
  more error code. It writes nothing, audits nothing, and adds no reopen path.
- **Revisit when:** a reader needs corrections grouped by the ACT that caused
  them, which is the report the C6 entry already defers.

## 2026-08-20 — Milestone 8 closure: the settlement export carries `FREE` provenance

**Status:** Accepted — Milestone 8 closure — a narrow defect fix, not a new rule

The C8 export column list was frozen one commit BEFORE `priceMode` was added to
`settlementStatementLineSchema`, so the file could not distinguish a
complimentary session from one discounted to nothing: both are a row of noughts.
Closure adds the one column, and nothing else.

- **Alternatives:** leaving the file as it was; inferring `FREE` in the export
  from a zero base amount.
- **Reason:** the C8 decision defines the column list as "a projection of the
  frozen statement line and no more", and `priceMode` is now on that line. The
  same entry's own reason for carrying the exclusion counts — "a CSV is opened
  months later beside no screen" — applies unchanged to the one fact that
  separates complimentary work from a concession. Inferring it from a zero would
  be the second and wrong source of truth the screen already refuses to use.
- **Trade-off:** one more column on a file that already has sixteen. The export
  still computes nothing and still reads the statement's own rows.
- **Revisit when:** never for this column; it follows the statement line.

## 2026-08-21 — Publication is two facts on the catalog row, not a published copy of it

**Status:** Accepted — Milestone 9, checkpoint A1

A service or a therapist is published by columns on its own row: the INTENT
(`is_public`) and the PUBLIC IDENTITY (`public_slug`, and on a therapist the
approved `public_display_name`). Every public read demands all of them at once,
and a row missing any one of them is not reachable from the website through any
route.

- **Alternatives:** a `published_service` / `published_therapist` table holding a
  copy of what the site shows; a single `is_public` flag with the website reading
  the internal columns directly.
- **Reason:** a published copy drifts, and the first time it drifted the site
  would advertise something the clinic had stopped offering. A lone flag has the
  opposite problem: it makes publication a single boolean over columns that were
  never written with a visitor in mind, which is how an internal note reaches a
  public page. Intent and identity as separate facts also give the manager
  surface two separately audited acts — prepare the content, then publish — with
  the database refusing the second without the first.
- **Trade-off:** a service already flagged `is_public` from Milestone 2 gains a
  NULL slug and is therefore NOT published by this migration. That is deliberate:
  publishing rows on the strength of a flag nobody set with a website in mind is
  the unsafe direction.
- **Assumptions:** the clinic's catalogue is tens of rows, so no partial listing
  index is justified; the two unique slug indexes serve every lookup.
- **Revisit when:** a public page needs to show something the catalog row does
  not hold — a hero image, a structured "what to expect" block — which is
  content, and belongs to the content checkpoint rather than to another column
  here.

## 2026-08-21 — A public therapist is opt-in, and nothing falls back to the personnel record

**Status:** Accepted — Milestone 9, checkpoint A1

`therapist.is_public` defaults to false. An ACTIVE therapist is not a public one.
The website reads `public_display_name`, `public_title`, `public_bio` and
`public_photo_path` — separate, owner-approved content — and NEVER `full_name` or
`specialty`. A therapist with no approved display name is not published at all.

`therapist_public_profile_chk` refuses `is_public = true` without a slug and an
approved display name, and the public projection shares no field name with the
internal therapist schema, so there is no field for an internal value to fall
back INTO.

- **Alternatives:** publishing every active therapist; defaulting the public name
  to `full_name` and the title to `specialty` when the approved content is
  missing.
- **Reason:** appearing on a website with a photograph and a biography is a
  decision about a named human being, taken with their agreement. Inferring it
  from employment publishes somebody who never agreed, and a fallback publishes a
  personnel record as public copy — both are publication decisions nobody made.
- **Trade-off:** a therapist is invisible on the site until a manager writes the
  approved content, and the empty team page is the correct state until then.
- **Revisit when:** the clinic wants a colleague listed by name only, with no
  title and no biography — which this already supports, both being nullable.

## 2026-08-21 — The public reads are classified `internal`, and there is no second access architecture

**Status:** Accepted — Milestone 9, checkpoint A1

The five public reads carry `@InternalOnly()`: the internal key, no session. They
are reachable only from the Next.js server, exactly like `POST /auth/login`, and
`/health` remains the only route in the product that genuinely bypasses the key.

- **Alternatives:** a fifth route classification for website reads; marking them
  `PublicEndpoint` so a browser could call NestJS directly.
- **Reason:** "public" describes the AUDIENCE OF THE FACTS, not the reachability
  of the route, and the guard chain already has a kind that means "across the
  private boundary, without a session". A new classification would be a second
  answer to a question the four-kind model has answered since Milestone 1, and a
  genuinely public route would put NestJS on the internet for the first time.
  Deny-by-default is untouched: the route-coverage test counts these five.
- **Trade-off:** the web tier must proxy or server-render every public page, which
  is what it was going to do anyway; nothing is reachable from a visitor's
  browser without Next in front of it.
- **Revisit when:** a public surface needs to accept a WRITE from an anonymous
  visitor — the request form — which arrives with its own consent, rate-limiting
  and abuse decisions, and re-opens this question deliberately rather than by
  inheriting an answer.

## 2026-08-21 — The public contracts are purpose-built projections, and carry no internal identifier

**Status:** Accepted — Milestone 9, checkpoint A1

`packages/contracts/src/website/*` states four public shapes. They reuse no
internal schema, and they omit the internal UUID: a public record is addressed by
its SLUG and by nothing else. Also absent: status, deactivation, the visibility
flag itself, creators, timestamps, price and availability.

- **Alternatives:** reusing `serviceSchema` and `therapistSchema` and stripping
  fields in the controller; publishing the id so the web tier can key a list.
- **Reason:** stripping is a step somebody forgets, and it re-widens silently the
  next time an internal schema gains a column — which is precisely the failure
  this checkpoint has to make impossible. The id is worse than unnecessary: it is
  the key that names the same row in the tariff, appointment, charge and
  settlement tables, handed to every visitor for no public purpose. The slug is
  unique, so it keys a list perfectly well.
- **Trade-off:** four more schemas to keep in step with the tables behind them,
  and a unit test that pins each field list exactly so a widening fails a build.
- **Revisit when:** a public page genuinely needs a service and a therapist
  linked to each other, which needs a decision about what the link means before
  it needs a field.

## 2026-08-21 — The clinic's public profile is one row, created empty

**Status:** Accepted — Milestone 9, checkpoint A1

`clinic_public_profile` holds exactly one row, pinned by its primary key and a
CHECK. The migration inserts it with every column NULL, and the public read
always succeeds — an unconfigured clinic reads as thirteen nulls rather than as a
404 on its own contact page. No real name, address, telephone number, hours line
or link appears anywhere in this repository; every fixture is synthetic.

- **Alternatives:** a key/value settings table; no row until a manager saves one;
  seeding plausible-looking placeholder contact details.
- **Reason:** a key/value store makes every read a lookup with no shape and no
  constraints, and this content is exactly where constraints matter — an
  `https`-only link and a both-or-neither map pin are enforced in SQL. "No row
  until saved" makes the public read a lookup that can miss, for a page that must
  render regardless. Placeholder details are the worst option: fictional contact
  information on a real clinic's website is a defect that reaches families.
- **Trade-off:** thirteen nullable columns the web tier has to lay out
  deliberately, including the case where all of them are null.
- **Revisit when:** the owner supplies content that does not fit one line — a
  second address, a structured week of opening hours — which is a content
  decision, not a column.

## 2026-08-21 — A1 delivers the public READ side only, and the dev seeder is the only writer

**Status:** Accepted — Milestone 9, checkpoint A1

The columns this checkpoint adds are written by no service and no endpoint. The
manager surface that publishes belongs to the content checkpoint. The synthetic
clinic seeder writes them in raw SQL — publishing all but one service and all but
one therapist, and filling the profile with obviously fictional values — so the
web lane has something to render against.

Three permission names are frozen with no route yet: `therapist.publish_profile`,
`clinic_profile.read`, `clinic_profile.update`. All three are manager-only, and
the receptionist's list is unchanged for the fifth milestone running.

- **Alternatives:** adding `publicSlug` to the existing service create/update
  contract now; building the manager publishing surface inside this checkpoint;
  leaving the seeder alone and giving the web lane an empty database.
- **Reason:** extending the service write contract would change an internal form,
  its Server Action and its tests — Web work this checkpoint is explicitly not
  doing — and would half-build the publishing surface the next checkpoint owns
  whole. Freezing the permission names now is the pattern Milestone 8 checkpoint
  C1 set, and for the same reason: the surfaces built later must not each decide
  what authority they need. The seeder is dev-only and never in a request path,
  so it is the honest place to put the one write this checkpoint needs.
- **Trade-off:** for the length of one checkpoint, publishing anything requires
  the seeder or SQL, and three permission names name no route. Both close in the
  content checkpoint.
- **Revisit when:** the content checkpoint lands; if it does not, the three names
  should be withdrawn rather than left as vocabulary nobody reaches. The
  checkpoint that owns each write path is named in the amendment below, "Every
  manager public-content write path is owned by A2".

## 2026-08-21 — The cache tag vocabulary is frozen in contracts, and no caching is implemented

**Status:** Accepted — Milestone 9, checkpoint A1

`PUBLIC_CACHE_TAGS` and the two per-slug prefixes are constants in
`@clinic/contracts`. Nothing in `apps/api` reads them; the API's responses still
carry `Cache-Control: no-store` from `NoStoreInterceptor`, unchanged.

- **Alternatives:** letting the web lane choose its own tag names; exempting
  public routes from the no-store default so an intermediary could cache them.
- **Reason:** a page tagged `public-services` and a revalidation clearing
  `publicServices` is a bug nothing fails on — the site goes stale and nobody
  knows for how long — so the names have to be agreed across the lanes even
  though only one of them uses them. The no-store default stays because the web
  tier caches with its own explicit fetch options, which do not depend on the
  upstream header, and weakening a security default for a caching layer one tier
  away is the wrong trade.
- **Trade-off:** the constants name no behaviour until the web lane wires them
  up, and a per-slug tag is built by concatenation because the contracts package
  holds no functions.
- **Revisit when:** the public site is measured under real traffic and the
  round trip to NestJS turns out to matter more than the header does.

## 2026-08-21 — A published public slug is immutable, and the stamp is what decides

**Status:** Accepted — Milestone 9, checkpoint A1 (review revision)

`service` and `therapist` carry `public_first_published_at`, stamped by
`enforce_public_slug_stability()` the first time a row is `is_public` AND
carries a `public_slug`. While that stamp is set the slug may not be changed and
may not be cleared, and the stamp itself may not be rewritten. A slug that has
never been reachable may still be corrected freely.

Three consequences, all deliberate:

- **unpublishing stays allowed.** Withdrawing a page is a decision the clinic is
  entitled to make, and a 404 is honest in a way a moved URL is not.
- **the round trip is refused.** Unpublish, rename, republish is the same silent
  URL change with an extra step, and the stamp survives the round trip.
- **reachability ignores `status`.** A service retired last month still had a
  real URL last month, and somebody may still have it written down.

- **Alternatives:** making the slug write-once from the moment it is first set
  (before publication); leaving it mutable and adding a redirect, alias or
  slug-history table; enforcing stability in the A2 service layer instead of the
  database.
- **Reason:** write-once-at-first-write punishes a typo caught before anybody
  could have seen it, and this schema already separates preparing public content
  from publishing it. A redirect table is a URL-management subsystem the product
  has not asked for, and it would quietly make the slug mutable again — the
  invariant would then live in whatever code remembered to write a redirect.
  Service-layer enforcement is the weakest of the three: A1 has no write path at
  all, so the rule would be enforced by code that does not exist yet, against a
  column any later migration, data fix or psql prompt could edit.
- **Trade-off:** a genuinely wrong published slug — a misspelling that went out —
  can only be retired, not corrected: the row is unpublished and a NEW row would
  be needed to take a new address. That is the cost of the promise, and it is
  visible rather than silent.
- **Revisit when:** the owner accepts a real URL breaking, or asks for
  redirects. Either is a product decision, and the redirect version needs the
  history table this entry declines to add speculatively.

## 2026-08-21 — Every manager public-content write path is owned by A2, and none is orphaned

**Status:** Accepted — Milestone 9 checkpoint plan, amended

A1 adds persistence with no manager writer. That is acceptable only with a named
owner, so the checkpoint outcome is amended to state one. **A2 owns every
manager write path over public presentation; B2 owns the internal management UX
for it.** Specifically A2 delivers:

1. the public-facing fields on a service — public description, public slug,
   `is_public` — added to the EXISTING manager service form and its existing
   `service.update` / `service.create` authority;
2. the therapist public profile — display name, title, biography, photo path,
   display order — and the opt-in toggle, under `therapist.publish_profile`;
3. the clinic public profile, under `clinic_profile.read` /
   `clinic_profile.update`;
4. the audit rows for all three, written in the same transaction as the change,
   as every write in this application already is;
5. the `PUBLIC_SLUG_IMMUTABLE` error code and its Persian message, which is where
   the A1 trigger becomes a sentence a manager can read.

A2 keeps its own content scope (articles, testimonials, publish/unpublish of
those). Nothing here is a CMS: there is no page builder, no media library, no
template system and no arbitrary content type — five owner-supplied fields on a
person, three on a service, and thirteen on the clinic.

- **Alternatives:** doing the write paths inside A1; giving them their own
  checkpoint; leaving them to M10 deployment configuration.
- **Reason:** A1 is the parallel-work gate and its job is the contract Agent B
  builds against; adding internal forms to it would have made the gate wait on
  Web work it was defined to unblock. A checkpoint of their own would split one
  manager surface — "the public face of the clinic" — across two, and A2 already
  owns the publishing model those forms belong to. Configuration-at-deploy is
  the worst option and the one this amendment exists to forbid: normal
  manager-owned content operations must never need SQL, a seed or a deploy.
- **Trade-off:** for the length of one checkpoint the only writer of these
  columns is the dev seeder, which is dev-only and never in a request path. If
  A2 slips, that is the fact to escalate — the persistence is otherwise
  orphaned.
- **Revisit when:** A2 is scoped. If its content work is large enough to push
  these forms out, they move to their own checkpoint BEFORE M9 closes, not into
  M10.

## 2026-08-21 — The A1 permission vocabulary, reconciled against the planning sketch

**Status:** Accepted — Milestone 9, checkpoint A1

A1 names three permissions — `therapist.publish_profile`, `clinic_profile.read`,
`clinic_profile.update` — where the planning proposal sketched a broader future
vocabulary. The AUTHORITY SEMANTICS are unchanged from the accepted plan:
publishing is manager-only; a receptionist may later draft and may never
publish; visibility is opt-in and manager-controlled; the public reads
themselves hold no permission at all.

What changed is only which names exist YET. Names for content that does not
exist — articles, testimonials, their draft and publish authorities, the request
inbox and its conversion authority — are deferred to the checkpoints that create
the concepts, because a permission is a description of an act, and an act with
no route and no table is a description of nothing. The A1 three are exactly the
acts A1's own persistence makes possible.

- **Alternatives:** adding the planned vocabulary in full now so later
  checkpoints only wire it up.
- **Reason:** this repository's rule is that a name nobody reaches is vocabulary
  a reader has to interpret and a role map has to keep withholding
  (`permissions.ts`). Three names ahead of their routes is the Milestone 8 C1
  precedent and is already at the limit; a dozen would be a permission model
  describing a product that does not exist. Matching a sketch mechanically would
  also risk freezing the WRONG shape — the draft/publish split, in particular,
  is a decision A2 should take with its content model in front of it.
- **Trade-off:** A2 and A4 will each add names, so the permission list is not
  final at A1. No A1 name changes when they do, which is the property Agent B
  needs.
- **Revisit when:** A2 defines the content model. If it turns out that
  publishing an article and publishing a therapist profile are one authority,
  `therapist.publish_profile` is the name that generalises, and that would be a
  rename with a decision behind it rather than churn.

## 2026-08-27 — Public content is two tables, and neither of them is a CMS

**Status:** Accepted — Milestone 9, checkpoint A2

`public_article` and `public_testimonial` are the whole schema footprint of
public content, plus one `testimonial_status` enum. There is no page, block,
component, template, media, tag, category, revision or scheduling table, and
none is implied.

An article is four content fields (slug, title, summary, body), one publication
flag and three recorded instants. A testimonial is two content fields, a
two-value review state and a publication flag.

- **Alternatives:** a generic `content` table with a type discriminator and a
  JSON body; a block/section model; adding tags and categories now because a
  blog usually has them.
- **Reason:** PROJECT_SPEC.md 11 asks for a draft/published workflow with
  authorised publishing, readable unique URLs, and approved anonymised stories.
  A generic content table answers a question nobody asked and makes every
  constraint impossible to write — the privacy rules in this checkpoint are
  CHECK constraints precisely because the columns are typed. A block model is a
  page builder, and a page builder is a product.
- **Trade-off:** an article that wants a pull quote or an image cannot have one
  until somebody decides what those mean.
- **Revisit when:** the owner supplies real copy that does not fit a title, a
  standfirst and a body — which is a content decision, not a column.

## 2026-08-27 — An article slug is NOT NULL; a service slug is not

**Status:** Accepted — Milestone 9, checkpoint A2

`public_article.public_slug` is NOT NULL from the first draft, unlike
`service.public_slug` and `therapist.public_slug`, which A1 made nullable. The
A1 stability rule applies unchanged through the SAME trigger function
(`enforce_public_slug_stability`, now on three tables): the slug may be
corrected freely until the first publication and never afterwards.

- **Alternatives:** nullable for symmetry with the catalog; write-once from the
  first write.
- **Reason:** a service exists for internal reasons and LATER gains a public
  identity, so "prepared but not yet addressed" is a real state for it. An
  article exists only to be read; an article with no address is not a state, it
  is a missing field. Reusing the A1 function rather than copying it means the
  immutability rule is stated once for all three tables and cannot drift between
  a service, a person and an article.
- **Trade-off:** the manager surface must ask for a slug before the first save.
- **Revisit when:** never for this column.

## 2026-08-27 — A testimonial has two states and a flag, and no URL of its own

**Status:** Accepted — Milestone 9, checkpoint A2

`status` (`DRAFT` | `APPROVED`) is the privacy review; `is_public` is placement
on a page; `public_testimonial_approval_chk` refuses `is_public` on anything not
`APPROVED`. Editing the words of an APPROVED testimonial is refused
(`TESTIMONIAL_APPROVED`); withdrawing approval unpublishes in the same
transaction. A testimonial has no slug and no page of its own.

- **Alternatives:** one `APPROVED_AND_PUBLISHED` state; approval inferred from
  publication; allowing edits after approval; giving each testimonial a URL.
- **Reason:** withdrawing a quotation from the website is not the same act as
  declaring its privacy review wrong, and collapsing them would erase the fact
  that a manager had once read and accepted those exact words. Allowing edits
  after approval would let approved-and-published text be rewritten into
  something nobody reviewed, which is precisely what the approval exists to
  prevent (PROJECT_SPEC.md 11). An addressable testimonial is a page about one
  family — linkable, quotable, indexable on its own — while a list on one page
  implies nothing about anybody.
- **Trade-off:** correcting a typo in approved text costs two manager acts, and
  the quotation is off the site between them. That is the correct order.
- **Revisit when:** the owner asks for a testimonial to be individually
  shareable, which needs a decision about what that URL implies before it needs
  a column.

## 2026-08-27 — A testimonial holds no identifying or clinical fact, by absence

**Status:** Accepted — Milestone 9, checkpoint A2

`public_testimonial` has no family id, child id, service, therapist,
appointment, date of treatment, age, diagnosis or outcome column. The one
attribution field is `author_label`, an anonymised description a manager reviews
before approving it, nullable because an unattributed quotation is the safest
form there is.

- **Alternatives:** linking the testimonial to the family it came from, for
  traceability; recording the service it is about, to show it on that page.
- **Reason:** PROJECT_SPEC.md 11 forbids publishing identifying child or
  clinical data. The narrowest way to obey a rule about a category of data is
  not to hold it: a link that exists is a link a future projection can widen
  into, and a projection that cannot widen is one whose source columns do not
  exist. Traceability to consent is an owner-held document (PROJECT_SPEC.md 17),
  not a foreign key.
- **Trade-off:** the clinic cannot show "what families say about speech therapy"
  on the speech-therapy page, and cannot answer "whose testimonial is this?"
  from the database.
- **Revisit when:** the owner asks for either, which re-opens the privacy
  question deliberately rather than by inheriting an answer.

## 2026-08-27 — Public copy is plain text, and the database refuses markup

**Status:** Accepted — Milestone 9, checkpoint A2

Article titles, summaries and bodies, and testimonial labels and bodies, may not
contain a less-than sign. Enforced in the shared contract
(`PUBLIC_PLAIN_TEXT_PATTERN`) and again in a CHECK on each column.

- **Alternatives:** storing HTML and sanitising it before rendering; storing
  Markdown; trusting managers.
- **Reason:** manager-written copy rendered to strangers is the exact shape of a
  stored cross-site-scripting defect. Every other product answers it with a
  sanitiser in front of the renderer; this one answers it by refusing to STORE
  markup, so there is no sanitiser to misconfigure and no path by which a
  `<script>` reaches a column. The web tier can render these values as text with
  no `dangerouslySetInnerHTML` anywhere near them.
- **Trade-off:** a character a Persian clinical article will essentially never
  need is unavailable, and an article cannot carry a link or a heading.
- **Revisit when:** real copy genuinely needs structure — which is a deliberate
  markup decision with a renderer behind it, not a relaxation to "usually safe".

## 2026-08-27 — The receptionist drafts; only the manager publishes

**Status:** Accepted — Milestone 9, checkpoint A2

Six new permissions: `article.read`, `article.draft`, `article.publish`,
`testimonial.read`, `testimonial.draft`, `testimonial.approve`. The receptionist
gains the four read and draft names — the first change to that role's list since
Milestone 6 — and neither publication name. `therapist.publish_profile`,
`clinic_profile.read` and `clinic_profile.update` are unchanged from A1 and stay
manager-only.

`testimonial.approve` is ONE name covering four acts: approving, withdrawing
approval, publishing and unpublishing.

- **Alternatives:** keeping drafting with the manager too; splitting
  `testimonial.approve` into approve and publish as Milestone 8 split rating
  from un-rating; a single `content.*` authority over all public content.
- **Reason:** A1 froze the semantics — "draft authority does not imply publish
  authority, so the permission that publishes will never be the permission that
  writes" — and this is the checkpoint that makes them real. Somebody at the
  front desk hears what families actually ask and is the right person to write a
  first answer; nothing they write can reach a visitor. The settlement split was
  load-bearing because an atomic correction could DEMAND both names at once,
  which one name cannot express; nothing here demands a pair, no role holds one
  of the four without the others, and all four turn on the same question — has a
  manager read these words and accepted responsibility for publishing them?
- **Trade-off:** the permission list grows by six, and the receptionist's list
  is no longer the frozen thing it was for three milestones. Both halves are
  pinned by exact-list tests, in the unit suite and over HTTP.
- **Revisit when:** a clinic wants a third role — an editor who publishes
  articles but touches no testimonial — which is a role decision, and these
  names already express it.

## 2026-08-27 — Publishing a service stays one audited act; publishing a person is three

**Status:** Accepted — Milestone 9, checkpoint A2

A service's public description, slug and visibility are written by the EXISTING
manager form under the existing `service.update`, and recorded by the existing
`service.updated` action with the before and after of every public column in its
payload. No `service.published` action and no `service.publish` permission
exists.

A therapist gets three actions — `therapist.public_profile_updated`,
`.public_profile_published`, `.public_profile_unpublished` — under
`therapist.publish_profile`, on routes and in a service of their own.

- **Alternatives:** a publication action and route for services too, for
  symmetry; folding the therapist public profile into `therapist.update` and the
  personnel read.
- **Reason:** the two entities are published differently on purpose, and the
  difference is who the decision is about. Changing a service's description and
  publishing it are one form submission and one state change; a second action
  would describe one write as two facts a reader has to pair up — the
  `appointment.availability_override` reasoning. Publishing a named colleague's
  photograph and biography is a decision ABOUT THAT PERSON, taken with their
  agreement, and A1 gave it its own permission precisely so it could be granted
  and revoked alone; separating the authority buys nothing if the content leaks
  back through the personnel read a receptionist holds.
- **Trade-off:** "when did this service go public?" is answered by reading a
  `service.updated` payload rather than by filtering on an action name.
- **Revisit when:** a service's public face gains a decision of its own — a
  scheduled launch, a per-page approval — which would be a publication act worth
  naming.

## 2026-08-27 — The audit records that public prose changed, not the prose

**Status:** Accepted — Milestone 9, checkpoint A2

Article bodies and summaries, therapist biographies and testimonial texts are
recorded in `audit_log` as LENGTHS. Slugs, titles, author labels, display
orders, statuses and publication flags are recorded in full. The clinic
profile's two telephone numbers are not recorded at all; the payload carries the
other eleven fields and a `contactNumbersChanged` flag.

- **Alternatives:** recording every payload in full; relaxing
  `audit_identifiers_masked()` and the application guard for
  `clinic_public_profile`; masking the clinic's telephone numbers.
- **Reason:** `audit_log` is append-only and can never be pruned. Copying every
  draft of a twenty-thousand-character article into it would BE the content
  revision history this checkpoint declines to build, and copying a family's
  account of their child's therapy into it would build a permanent, unremovable
  store of exactly the content PROJECT_SPEC.md 11 requires a manager to review
  before anybody sees it. For the telephone numbers, the Milestone 3 masking
  rule is about a PERSON'S number and the clinic's own published number is
  genuinely not one — but relaxing that rule in both tiers would let a future
  call site mislabel family data and slip through, and masking would be lossy
  and would fail outright on a number typed in Persian digits, putting a defect
  in front of a manager over a number the website prints in the clear.
- **Trade-off:** the trail cannot reconstruct what an article said last month,
  or what the published telephone number used to be. It does say that each
  changed, when, and by whom, and the current value is on the row.
- **Revisit when:** the owner asks to recover withdrawn copy, which is a
  versioning feature and needs its own table and its own retention rule.

## 2026-08-27 — `public_revised_at` is the sitemap last-modified, not a second change history

**Status:** Accepted — Milestone 9, checkpoint A2

One nullable `TIMESTAMPTZ` on `service`, `therapist`, `public_article` and
`public_testimonial`, written by the manager write paths of this checkpoint
whenever the row is publicly reachable after the write. On an article and a
testimonial that means PUBLICATION ONLY — a draft edit changes nothing a visitor
can read, so it reports no modification. It is the only thing the
sitemap's last-modified is built from, and it is null on any row published
before those paths existed.

- **Alternatives:** deriving last-modified from `audit_log`; reusing
  `public_first_published_at`; omitting last-modified entirely; a trigger.
- **Reason:** deriving it from the audit trail would make a public read depend on
  the table of actors and internal history, which is the one coupling the public
  projection discipline exists to prevent. `public_first_published_at` is a
  different fact, and using it would tell a crawler that a page it has cached is
  older than it is. A null is honest, and a sitemap entry without a last-modified
  is a correct sitemap entry. A trigger was rejected because the rule differs per
  table — a service's public content includes its durations, which live in
  another table — so a uniform trigger would under-report exactly where it
  matters.
- **Trade-off:** four columns maintained in five write paths, and an edit that
  changes nothing still moves the stamp. Over-reporting a change is the safe
  direction; under-reporting is not.
- **Revisit when:** the sitemap is measured against real crawler behaviour.

## 2026-08-27 — The sitemap contract carries kind and slug, never a path or a host

**Status:** Accepted — Milestone 9, checkpoint A2

`GET /public/sitemap` returns `{ kind, slug, lastModified }` per data-driven
page, derived in ONE statement whose three branches repeat, word for word, the
predicates of the reads that render those pages. Static pages and testimonials
are absent.

- **Alternatives:** returning full URLs; generating the sitemap XML in the API;
  letting the web tier assemble the list from its own four fetches.
- **Reason:** the route structure belongs to the web tier, which owns its router
  and is the only tier that can be wrong about it; a path string here would be
  the API asserting a URL it cannot verify. Generating XML would be Next.js
  behaviour in the wrong tier. Assembling it in the web tier from four fetches is
  four chances to disagree with the site — the failure being a sitemap that
  advertises a 404 or hides a page, which this single derived read makes
  structurally impossible and which a test asserts as a property in both
  directions.
- **Trade-off:** the web tier must map three `kind` values onto its own paths and
  add its own static routes.
- **Revisit when:** a public page exists that is neither static nor one of these
  three kinds.

## 2026-08-27 — The cache handshake is the mutation response, not a tag inside it

**Status:** Accepted — Milestone 9, checkpoint A2

`PUBLIC_CACHE_TAGS` gains `articles`, `testimonials` and `sitemap`, plus a
`public-article:` prefix; no A1 name changes. Nothing in `apps/api` reads a tag
or returns one — a test walks the API source and asserts it. Every manager
mutation returns the row it wrote, slug and publication flag included, which is
what the web tier derives its invalidation from; the mapping from mutation to
tags is written out once, in `website/common.ts`.

- **Alternatives:** returning an `invalidatePublicCacheTags` array on every
  mutation response; a helper function in the contracts package.
- **Reason:** the A1 decision was that the API knows nothing about web caching,
  and that survives A2 giving it write paths: a tag list in the response would be
  a second, quieter answer to a question the body already answers, and would put
  a web caching concern inside the domain layer. The contracts package contains
  no functions, by the same A1 decision.
- **Trade-off:** Agent B writes the mapping by hand against a documented table
  rather than reading it off each response.
- **Revisit when:** the mapping stops being derivable from the response — which
  would mean a mutation affecting a page it does not name.

## 2026-08-27 — A2 closes every A1 write path, and the dev seeder stops being a writer

**Status:** Accepted — Milestone 9, checkpoint A2

The three write paths A1 named as A2's are delivered: the public fields on the
service form under `service.update`, the therapist public profile and opt-in
under `therapist.publish_profile`, and the clinic profile under
`clinic_profile.read` / `clinic_profile.update` — plus `PUBLIC_SLUG_IMMUTABLE`
and its Persian message, which is where the A1 trigger becomes a sentence a
manager can read. The synthetic dev seeder now writes all of them through those
services instead of in raw SQL.

- **Alternatives:** leaving the seeder's SQL in place.
- **Reason:** the A1 amendment said configuration-at-deploy is the option it
  exists to forbid, and that the seeder was acceptable only "for the length of
  one checkpoint". Putting the seeder through the real services proves the paths
  end to end on every seed run, gives a seeded clinic a genuine audit trail, and
  removes the last place in the repository that writes a public column directly.
- **Trade-off:** a defect in a manager write path now fails the seed. That is the
  point.
- **Revisit when:** never; the SQL should not come back.

## 2026-08-27 — An article holds its copy twice, because publication authority cannot be represented once

**Status:** Accepted — Milestone 9, checkpoint A2 (review revision)

`public_article` carries `title`, `summary` and `body` — the WORKING DRAFT,
writable under `article.draft` — and `published_title`, `published_summary` and
`published_body` — WHAT THE WEBSITE SAYS, written only by the manager-only
publication act. Every public projection reads the second set.
`public_article_published_copy_chk` refuses `is_public` on a row with no
published copy, so the flag alone can never put a draft on a page.

Publishing copies the draft onto the published columns in the same statement
that sets the flag. That is one act, not two: "publish" means "what the draft
now says is what the website says", whether the page was empty before or was
showing an earlier version.

**The first shape of this checkpoint was wrong, and provably so.** It kept one
set of content columns and allowed a published article to be edited, which meant
a receptionist holding only `article.draft` could rewrite a live page and a
visitor saw the new words immediately, with no manager act anywhere in the
sequence — a direct breach of the frozen rule that a manager alone controls what
becomes publicly visible. A probe against the running application confirmed it
before this revision was written.

- **Alternatives:** refusing any edit to a published article and requiring the
  manager to type the correction (one column set, authority preserved);
  requiring `article.publish` to edit a published article; a
  `public_article_version` table holding published snapshots; a status enum with
  a `PENDING_REVIEW` state.
- **Reason:** the two one-column-set options each break one half of the accepted
  product rule — the first makes an article uncorrectable by the people who
  write it, and the second is the same thing wearing a permission. A version
  table is a revision framework, which this checkpoint is explicitly forbidden
  to build, and it would hold a history nobody has asked to read. A
  `PENDING_REVIEW` status describes the situation without fixing it: the row
  still has one body, so the live page still shows whatever that body currently
  says. Two column sets on ONE row is the smallest representation that can hold
  a live version and a pending version at the same time, and it holds exactly
  one previous state — the one currently on the website — rather than a history.
- **This is not the published-copy pattern A1 rejected.** A1 refused a
  `published_service` table because a service's name IS its public name, so a
  copy could drift into advertising something the clinic had stopped offering.
  An article has no such second truth: the draft is not a fact about the world
  that the published text could contradict, it is an unfinished version of that
  text, so there is nothing for the copy to disagree with.
- **`public_slug` is not duplicated.** It is immutable from the first
  publication, so a draft slug and a published slug could never differ on a
  published article; a second copy would be a column that can only ever equal
  the first.
- **Trade-off:** three more columns, four more CHECK constraints, and a
  published article now stores its text twice. A manager must publish twice to
  get a correction onto a live page — once is not enough, and that is the point.
- **Revisit when:** the owner asks to see or restore what an article said before
  the last publication, which is version history and needs its own table, its
  own retention rule and its own decision.

## 2026-08-27 — A draft edit is not a modification of the published page

**Status:** Accepted — Milestone 9, checkpoint A2 (review revision)

Editing an article's draft moves neither `public_revised_at` nor anything the
sitemap reports. Only publication does. `articleSchema` gains one derived
boolean, `hasUnpublishedChanges`, true while the article is public and its draft
differs from its published copy.

- **Alternatives:** bumping `public_revised_at` on every draft edit, as the
  first shape did; storing the pending-change flag as a column; returning the
  published text alongside the draft so a management screen could diff them.
- **Reason:** `lastmod` is a statement to a crawler about what a visitor can
  read, and until the manager publishes, what a visitor can read has not
  changed — telling a crawler otherwise is telling it something false. The flag
  is derived in the read rather than stored because a stored one would be a
  fourth thing every write path had to keep in step, and the first time one
  forgot, a manager would be told there was nothing to publish while the live
  page showed something else. It carries no diff and names no field: a
  management screen needs to know a publication is outstanding, and inventing a
  diff format would be a decision nobody has taken — the live text is one public
  read away.
- **Trade-off:** a manager comparing versions makes two requests.
- **Revisit when:** B2 builds the review screen and finds the second request
  genuinely awkward, which is a shaping decision with a screen in front of it.

## 2026-08-27 — A testimonial needs no draft-and-published pair, and that asymmetry is deliberate

**Status:** Accepted — Milestone 9, checkpoint A2 (review revision)

Re-checked against the same authority rule as the article revision.
`public_testimonial` keeps one set of content columns, and editing an APPROVED
testimonial stays refused outright (`TESTIMONIAL_APPROVED`) for manager and
receptionist alike. No change was needed.

- **Reason:** an article is the clinic's OWN writing, so a live one has to stay
  revisable by the people who write it, and the live and pending versions have
  to be kept apart. A testimonial is somebody ELSE's words, approved as those
  exact words; the correct answer to "may this be rewritten while it is up?" is
  simply no, and the correction path — withdraw approval, which unpublishes;
  edit; approve again; publish again — already routes every step that reaches a
  visitor through the manager. Adding a second column set here would build
  machinery for a state the product refuses to have.
- **Trade-off:** correcting a published testimonial takes the quotation off the
  site while it is being corrected. That is the correct order, and it is what
  "approved" is worth.
- **Revisit when:** never on these grounds; the asymmetry follows from whose
  words they are.

## 2026-08-27 — A website request is one purgeable table, and it is the only deletable table in the schema

**Status:** SUPERSEDED — Milestone 9, checkpoint A3. Replaced the same day by "A
website request is erased in place, never deleted" (review revision). The table
footprint below stands; the DELETE half of it does not — this entry read the
accepted retention rule as "the row must be removable", and the accepted rule is
that the CONTENT is erased in place and a minimal lifecycle row remains.

`website_request` is the whole schema footprint of the public contact form. One
table, no enum, no inbox, no status, no assignment, no thread, no attachment and
no queue. It is also the ONLY table in this database with no `no_delete` and no
`no_truncate` trigger.

Every other table in this schema refuses a `DELETE` outright, because every other
table holds a fact the clinic is obliged to keep: catalog rows are deactivated,
financial rows are voided, published content is withdrawn. This row holds a
stranger's name, mobile number, child's age and a sentence they typed, gathered
under a consent notice promising the clinic will not keep it indefinitely, and
the accepted M9 retention rule is ninety days.

- **Alternatives:** giving it the usual append-only triggers and having the purge
  disable them; a soft-delete column; a separate archive table.
- **Reason:** a purge that has to disable a trigger to run is an operation nobody
  should be performing routinely against production, and a trigger that a routine
  job disables is not a protection. A soft delete does not delete: the personal
  data stays, and the promise made to the submitter would be false. An archive
  table is the same data in a second place.
- **Trade-off:** this table is genuinely deletable, so an accidental `DELETE`
  here is not caught by the mechanism that catches it everywhere else. The
  compensations are that the row is immutable while it lives
  (`website_request_immutable`), that nothing in the application deletes anything
  yet, and that the permanent audit row survives whatever happens to the content.
- **Revisit when:** A4 writes the purge. If it turns out the clinic needs a
  retained, anonymised trace of request VOLUME beyond ninety days, that is a
  derived aggregate somebody designs — not a reason to keep the intake rows.

## 2026-08-27 — The anonymous submission's audit row records the act and nothing else, including no client metadata

**Status:** Accepted — Milestone 9, checkpoint A3

`website_request.received` carries an `ANONYMOUS` actor, the request id, the
entity type and the entity id. It carries NO `before`, NO `after`, NO `metadata`,
and — the departure — NO `ip` and NO `user_agent`, which every other audited
write in this application does record. `anonymousWebsiteAuditContext` is the only
builder that may construct it, and dropping both is what it does.

This is the accepted A3 audit fallback, taken at its narrowest end. The shared
machinery CAN truthfully produce the record: `AuditContext` makes both fields
optional, so passing `null` writes SQL NULLs rather than smuggling values
through. What it cannot do alone is guarantee a future call site remembers, so
the guarantee is one function plus an integration test that reads both columns
back out of PostgreSQL.

- **Alternatives:** using `actorContext`, which forwards both; a second,
  purgeable audit table for anonymous acts; writing no audit row at all.
- **Reason:** `audit_log` is append-only and unprunable — that is its entire
  value — so a stranger's IP address written there is a permanent record of
  somebody the clinic has promised to forget within ninety days, sitting in the
  one table the purge cannot reach. It would also be a second, undeletable copy
  of intake data if any payload were carried. Two audit trails is one more than a
  reviewer can be expected to know about, and it would immediately raise "which
  one is authoritative?". Writing nothing at all was the closest alternative and
  was rejected because the act genuinely happened and leaves a purged row behind:
  "somebody wrote in on this day and we kept nothing" is the honest permanent
  record, and it is the `report.exported` shape — the ACT, never its contents.
- **Trade-off:** after the purge the `entity_id` names a row that no longer
  exists. `audit_log` has no foreign keys, so nothing breaks, and the dangling id
  is the intended residue rather than a defect. Forensic questions that need the
  submitter's address cannot be answered from the audit trail; the keyed
  fingerprint on the purgeable row and `security-log.ts` cover the operational
  need.
- **Revisit when:** a real abuse incident needs evidence the fingerprint cannot
  give. That is a retention decision for the owner, not a code change.

## 2026-08-27 — Abuse control is a rolling duplicate window and a per-submitter throttle, both keyed-hashed and database-backed

**Status:** Accepted — Milestone 9, checkpoint A3

Two controls, no CAPTCHA, no Redis, no queue and no external anti-bot service:

1. **duplicate suppression** — a resend within 24 hours of an equivalent
   submission stores nothing and returns the ordinary success. Equivalence is the
   mobile, the requested service, the child's age and the child's sex; the free
   text and the contact name are deliberately excluded. The four-field identity
   is owner-approved and frozen — see "The duplicate identity is mobile, service,
   child age and child sex" below, which records the deviation from the earlier
   mobile-plus-service shorthand.
2. **a throttle** — six submissions per submitter per hour, counted from stored
   rows. A resend is deduplicated BEFORE it is counted, so the commonest innocent
   repeat never touches the number.

Both keys are HMAC-SHA-256 digests stored in nullable columns. The submitter key
derives from the caller's IP address, which is stored nowhere. The HMAC key is
HKDF-derived from `INTERNAL_API_KEY` under a fixed, versioned info string.

- **Alternatives:** a unique index over a bucketed dedupe key; unkeyed hashes; a
  dedicated secret in a new required environment variable; an in-process counter;
  a CAPTCHA.
- **Reason:** a rolling window is not expressible as a unique constraint, and a
  calendar bucket suppresses exactly the wrong pairs — the same message twice at
  either side of midnight is kept, a genuine second message twenty-three hours
  later is swallowed. So the window is a read taken under a transaction-scoped
  advisory lock, the primitive `families/duplicate-detection.ts` already
  established for check-then-insert. Unkeyed hashes would be reversible from a
  database dump: an IPv4 address is four billion guesses and an Iranian mobile is
  fewer, so an unkeyed column would simply BE the value it claims to replace. A
  new required secret is a variable the application refuses to start without, and
  adding one in a checkpoint that ships no deployment work would break every
  existing dev and CI environment; HKDF gives real domain separation, so this is
  not secret reuse. An in-process counter is not durable, not transactional and
  not shared across instances. A CAPTCHA is a third-party dependency, a
  privacy-relevant beacon on a page that has none, and an accessibility barrier
  on the one form a distressed parent is trying to use.
- **Trade-off:** rotating `INTERNAL_API_KEY` re-derives the HMAC key and silently
  resets both windows — for a few hours after a rotation a resend would be stored
  again and a flooder would get a fresh allowance. Nothing is corrupted and
  nothing is disclosed. Excluding the note from the dedupe subject means a parent
  who resubmits with genuinely new information has that resend absorbed;
  including it would have made deduplication defeatable by a whitespace change,
  which is the same as not having it.
- **Revisit when:** a dedicated secret arrives with M10 hosting, or a real flood
  shows six per hour is the wrong number. The version string in the info
  parameter exists so old and new fingerprints stay distinguishable.

## 2026-08-27 — Nothing about a suppressed duplicate or a refused submission is observable to the caller

**Status:** Accepted — Milestone 9, checkpoint A3

`POST /public/requests` answers `202 Accepted` with `{ received: true }` on both
the stored path and the duplicate-suppressed path — same status, same body, no
identifier of any kind. There is deliberately no `PUBLIC_REQUEST_DUPLICATE` error
code. A service slug that is private, retired or fictional is
`SERVICE_NOT_FOUND`, the identical answer the public read gives.

- **Alternatives:** `201 Created` with the request id; a distinct duplicate
  response; distinguishing "this service exists but is not published" from "no
  such service".
- **Reason:** any observable difference turns this endpoint into an oracle. With a
  duplicate signal, anybody holding a mobile number could ask whether that person
  has contacted the clinic — a disclosure about a real family made to a stranger.
  With a distinguishable service refusal, anybody could enumerate the clinic's
  internal catalogue, which is the leak the A1 predicates exist to prevent. `201`
  is also simply untrue on the suppressed path: nothing was created. `202` is
  what is true of both, and it carries no `Location` because there is no resource
  an anonymous caller may read.
- **Trade-off:** a visitor gets no reference number, and the web tier cannot show
  one. The clinic telephones them; a reference number for a message nobody can
  look up is theatre.
- **Revisit when:** never on the duplicate side. If a reference number is ever
  genuinely wanted, it needs an authenticated lookup, which is a different
  product.

## 2026-08-27 — Consent is three columns and a frozen version list, not a boolean

**Status:** Accepted — Milestone 9, checkpoint A3

A stored request carries `consent_given` (which a CHECK forces to TRUE),
`consent_version`, and `consent_recorded_at` taken from the transaction rather
than from the caller. `PUBLIC_REQUEST_CONSENT_VERSIONS` in `@clinic/contracts` is
a closed list; a submission naming anything outside it is `VALIDATION_FAILED`.
The wording itself remains owner-supplied and lives in the web tier.

- **Alternatives:** a single boolean; a free-text version string; storing the full
  consent text on every row; inventing placeholder legal copy.
- **Reason:** "they consented" is not evidence unless the record says what they
  consented to, so a boolean alone records nothing usable. A free-text version
  would be whatever a caller claimed, which is worth exactly as little. Storing
  the full text per row is a duplicate store of a constant. Placeholder legal copy
  is forbidden by CLAUDE.md and would be worse than none: somebody would ship it.
  Freezing the identifier in the shared contract means a stored version is a value
  BOTH tiers agreed to before the submission happened, and new wording is a
  deliberate two-line change that leaves historical rows naming the text their
  submitter actually saw — the rule a tariff change already follows.
- **Trade-off:** the API cannot verify that the web tier showed the copy that
  identifier names. That is unavoidable across a tier boundary; what it can and
  does refuse is an identifier nobody agreed on.
- **Revisit when:** the owner supplies real wording. That adds copy behind the
  existing identifier and changes nothing here.

## 2026-08-27 — The public write is classified `internal`, and the age bound carries no eligibility policy

**Status:** Accepted — Milestone 9, checkpoint A3

Two decisions the checkpoint had to take explicitly.

**Classification.** `POST /public/requests` carries `@InternalOnly()` — the
internal key, no session — exactly like the nine public reads and like
`POST /auth/login`. The A1 entry (2026-08-21) said this question would be
re-opened when a public WRITE arrived. It is re-opened here and the answer is
unchanged: "public" describes the AUDIENCE, not the reachability, and a genuinely
public route would put NestJS on the internet for the first time to save the web
tier a proxy it already performs for every page. Deny-by-default is untouched and
the route-coverage test counts this one.

**The age bound.** `child_age_years` is bounded 0–120 in the contract and in a
CHECK. That is the bound of a human lifetime, chosen precisely because it decides
nothing.

- **Alternatives:** a fifth route classification for anonymous writes; marking the
  route `PublicEndpoint`. For the age: bounding it at 18, or 14, or 7.
- **Reason:** a new classification is a second answer to a question the four-kind
  model has answered since Milestone 1. On the age, any narrower number is this
  clinic refusing to hear from somebody on the basis of their age, written into a
  validation rule where nobody would find it and nobody approved it — an
  eligibility policy smuggled in as data hygiene. Who the clinic can help is a
  conversation a colleague has, not a 400 a stranger receives. Age and sex are
  staff-triage facts and nothing in the application decides anything from them.
- **Trade-off:** the inbox A4 builds will receive occasional requests the clinic
  cannot help. A colleague reads them and says so, which is the correct place for
  that answer.
- **Revisit when:** never on the age. On the classification, only if the product
  ever needs a browser to reach NestJS directly, which nothing in the accepted
  scope does.

## 2026-08-27 — A website request is erased in place, never deleted (supersedes the same day's entry)

**Status:** Accepted — Milestone 9, checkpoint A3 (review revision)

**This reverses the earlier A3 entry "A website request is one purgeable table,
and it is the only deletable table in the schema."** That entry read the accepted
retention rule as "the row must be removable". The accepted rule is narrower and
better: intake content is **erased in place** after ninety days, and a **minimal
lifecycle row** remains.

`website_request` therefore carries the same `no_delete` and `no_truncate`
triggers as every other historical table in this schema, reusing the Milestone 1
`raise_append_only_violation()` function. Retention is an UPDATE. To make that
possible and still keep the submission contract authoritative, every purgeable
column is nullable and a new `purged_at` marker pairs the two states in
`website_request_purge_chk`:

- `purged_at IS NULL` ⇒ the four required intake columns are NOT NULL;
- `purged_at IS NOT NULL` ⇒ every purgeable column IS NULL.

Purgeable: contact name, contact mobile, requested service, child name, child
age, child sex, preferred contact time, note, and both abuse-control digests.
Retained: the id, the arrival instant, and the three consent columns.

`enforce_website_request_immutable` now permits exactly two changes — clearing a
purgeable column to NULL, and stamping `purged_at` once — and refuses everything
else, including writing a value back into an erased row.

- **Alternatives:** the superseded no-trigger design; a soft-delete flag with the
  content left in place; an archive table.
- **Reason:** what the clinic promised the submitter is that it will not keep
  their name, their telephone number and what they wrote about their child. It
  did not promise to forget that a request arrived, and forgetting that is worse
  than useless — the lifecycle row is what lets anybody afterwards say how many
  requests came in, how many became families, and that this one was dealt with
  rather than quietly dropped. Erasing the row outright would also mean a routine
  job holding a real DELETE grant on a table full of personal data, which is the
  operation this schema refuses everywhere else and whose blast radius nobody can
  bound in advance. A soft-delete flag is not deletion at all: the personal data
  stays. An archive table is the same data in a second place.
- **Trade-off:** the intake columns are nullable, which on its own would have
  weakened "required fields are required" from a database guarantee to a
  service-layer promise. `website_request_purge_chk` is what buys it back, at the
  cost of one extra column and a constraint a reader has to parse. A4 also
  inherits a rule it must obey: it clears the whole purgeable set in one
  statement, because a half-erased row is refused.
- **Revisit when:** A4 writes the retention run. If a request must also be
  CLOSED before it is erased, that is a status column A4 adds with its workflow;
  the erasure shape here does not change.

## 2026-08-27 — The duplicate identity is mobile, service, child age and child sex

**Status:** Accepted — Milestone 9, checkpoint A3 (review revision)

Owner-approved, and frozen. Two submissions are the same request when all four
of those agree and the second arrives within 24 hours of the first.

**This is a deviation from the earlier planning shorthand, which described
duplicate suppression as mobile plus service only**, and the deviation is the
point rather than an accident. One parent with two children needs two
appointments. Mobile-and-service alone would have silently discarded the second
request — a family waiting for a call nobody was ever going to make, with no
trace anywhere that they had asked, and no way for them to tell, because a
suppressed submission is deliberately indistinguishable from a stored one. The
structured triage facts the form already collects are exactly what separates the
two children, so using them costs nothing and closes that hole.

The contact name, child name, preferred contact time and note stay OUT of the
identity.

- **Alternatives:** the shorthand (mobile + service); adding the child's name;
  adding the note; reusing the family/child duplicate-detection machinery.
- **Reason:** the free text must stay out or deduplication is defeatable by a
  whitespace change, which is the same as not having it — and a parent who
  resubmits after adding a sentence has made the same request twice, which is the
  case this exists to absorb. The child's NAME is excluded for that reason and
  one more: the mobile already identifies the caller, so a name two submissions
  might spell differently could only ever split a duplicate pair, never join one.
  Reusing the family/child machinery would be the real mistake: **this is not an
  identity system and must not become one.** That machinery answers "is this the
  same PERSON?" about clinic records a member of staff can inspect and override;
  this answers the far smaller question "is this the same MESSAGE, again, within
  a day?" about a stranger nobody has verified. No fuzzy matching, no Persian
  folding, no scoring, no candidate list, and no read of `family` or `child` on
  any anonymous path.
- **Trade-off:** two submissions differing ONLY by a corrected age — typed 6,
  noticed, resubmitted with 7 — are two rows rather than one. That is the right
  way round: a receptionist seeing a near-identical pair loses a few seconds,
  where the alternative loses a child. Callers still learn nothing either way.
- **Revisit when:** the pilot shows real duplicate volume the four facts do not
  absorb. The answer would be a longer window or a staff-side merge in the inbox,
  never fuzzier matching here.

## 2026-08-27 — Preferred contact time stays provisional, and it is the one open owner question

**Status:** CLOSED — Milestone 9, checkpoint A3. The owner answered the same day;
see "Preferred contact time is four values, and none of them is a time" below.
The finding recorded here — that the accepted plan called for a closed vocabulary
and none existed — stands as the reason the question was raised.

The accepted M9 plan describes preferred contact time as a CLOSED VOCABULARY.
**No such vocabulary exists.** PROJECT_SPEC.md 11 names the field in a list and
stops; nothing in this repository defines time-of-day buckets for anything
(`therapist_availability` stores real clock windows, not named parts of a day).

A3 therefore ships it as an OPTIONAL, bounded, plain-text column, explicitly
marked provisional in the contract, in the Prisma model and in the migration —
not silently frozen as free text.

**The owner question:** what are the choices a parent picks from? Two (morning /
afternoon)? Three (morning / afternoon / evening)? Something tied to the clinic's
own opening hours, which are owner-supplied and currently null?

- **Alternatives:** inventing three buckets now; dropping the field from A3
  entirely.
- **Reason:** inventing buckets to satisfy the planning wording would be taking a
  product decision in a schema, and it is the harder direction to undo — widening
  a frozen enum after a form has shipped is worse than narrowing free text over a
  table that will hold very few rows. Dropping the field would deviate from the
  frozen A3 request contract, which lists it.
- **Trade-off:** B3 was blocked on this ONE field while the question stood.
  Everything else in the submission contract was stable, and because the field is
  optional a form could have shipped without it.
- **Revisit when:** ANSWERED. The owner supplied the vocabulary the same day and
  the change was exactly what this entry predicted — a `z.enum` in
  `@clinic/contracts` and a PostgreSQL enum in the migration. No backfill was
  needed: no request row had been written outside a test database.

## 2026-08-27 — Preferred contact time is four values, and none of them is a time

**Status:** Accepted — Milestone 9, checkpoint A3 (owner decision; closes the
same day's OPEN entry "Preferred contact time stays provisional")

The vocabulary is `MORNING`, `AFTERNOON`, `EVENING`, `NO_PREFERENCE`. It is a
PostgreSQL enum (`website_request_contact_time`) and a matching `z.enum` in
`@clinic/contracts`, pinned against each other by an integration test in the way
`child_sex` already is. **The field stays OPTIONAL**: a short public form need not
ask, and an omitted value is valid.

What these values MEAN, frozen:

- they express only the parent's preferred time of day for a follow-up call;
- they create **no SLA** and promise nothing about when the clinic will call;
- they are **not tied to clock ranges** in M9 — `MORNING` is not 08:00–12:00,
  here or anywhere;
- **nothing may infer clinic opening hours from them**, in either direction.

Nothing in this application schedules, queues, reminds, prioritises or measures
anything from this column. The product behaves identically whatever a parent
chooses, and the submission response is byte-identical across all four.

`NO_PREFERENCE` and OMISSION are different facts and both are valid: the first is
a parent saying any time suits them, the second is a form that did not ask.

- **Alternatives:** the bounded free text the first A3 draft shipped; two buckets;
  ranges attached to each name; deriving the buckets from the clinic's opening
  hours.
- **Reason:** free text is a sentence somebody has to read and interpret, where a
  colleague scanning the inbox A4 builds needs a value they can sort and filter
  by — the same reason `child_sex` is an enum rather than a note. Attaching clock
  ranges would put a second, quieter answer to "when is the clinic open?" into the
  domain contract, one the real opening hours in `clinic_public_profile` could
  contradict, and would turn a rough parental preference into a figure somebody
  could hold the clinic to. Deriving the buckets from opening hours has the same
  defect with the arrow reversed: these say when a PARENT is free, which is not a
  fact about the clinic at all.
- **Trade-off:** a parent whose availability is genuinely narrower ("after four")
  cannot say so in this field. They can say it in the note, which is what the note
  is for, and a colleague reads it before calling.
- **Revisit when:** the pilot shows the four are too coarse to be useful, or the
  clinic later wants real callback windows. The latter is a scheduling feature
  with its own decisions, not a widening of this enum.

## 2026-08-28 — Both end states of a website request are final

**Status:** Accepted — Milestone 9, checkpoint A4 (owner decision)

The five frozen statuses are `NEW`, `CONTACTED`, `FOLLOW_UP_NEEDED`,
`CONVERTED_TO_FAMILY`, `CLOSED` (PROJECT_SPEC.md 11). What A4 had to settle is
which MOVES between them are legal, and the owner decision is:

- `NEW` is the arrival state and **nothing returns to it**;
- `CONTACTED` and `FOLLOW_UP_NEEDED` move freely in both directions;
- any open state may go to `CLOSED` or, by LINKING, to `CONVERTED_TO_FAMILY`;
- **`CLOSED` is terminal** and **`CONVERTED_TO_FAMILY` is terminal**;
- a move to the status a request is already in is refused.

`CLOSED` IS TERMINAL BECAUSE THE RETENTION CLOCK IS. The accepted rule erases a
closed, never-linked request ninety days after CLOSURE. If a closure could be
undone, `closed_at` would be a value that moves, "this has been closed for ninety
days" would stop being a fact the database can hold, and an erasure could be
deferred indefinitely by reopening.

The matrix lives in `WEBSITE_REQUEST_LEGAL_TRANSITIONS` in `@clinic/contracts` so
the screen offers exactly the legal moves; NestJS refuses the rest with
`WEBSITE_REQUEST_TRANSITION_INVALID`; and `website_request_status_transition`, a
PostgreSQL trigger, refuses them underneath both. The trigger is the guarantee.

- **Alternatives:** letting `CLOSED` be reopened to `FOLLOW_UP_NEEDED` with the
  closure instant cleared and the ninety days restarted; letting
  `CONVERTED_TO_FAMILY` be closed afterwards.
- **Reason:** the first makes the retention deadline postponable by anybody
  holding an UPDATE, which is exactly the property a retention promise cannot
  have. The second adds a status change that carries no information a reader
  could act on — a converted request is already part of a family's history.
- **Trade-off:** a request closed by mistake cannot be reopened. The colleague
  telephones the family and writes what they learn in the family record, which is
  where the clinic's own version of a conversation belongs in any case; and the
  content is still there to work from for ninety days.
- **Revisit when:** the pilot shows mistaken closures are common. Reopening would
  then need a decision about what happens to the retention clock, which is the
  decision this entry actually took.

## 2026-08-28 — Conversion is a link to a family somebody registered, never a mapping

**Status:** Accepted — Milestone 9, checkpoint A4

`POST /website-requests/:id/link` names a family that **already exists** and does
nothing else. It writes no family, no guardian and no child, and it copies no
intake field into any permanent record.

The other half of the accepted conversion path — "this is a new family" — is the
**existing registration workflow**, with its existing duplicate detection, its
existing confirmation step and its existing `family.create` authority. The
request's fields are shown beside that form for a colleague to copy from, and the
family that comes out of it is linked afterwards through the same route. The
request detail read IS the prefill contract; there is no mapping endpoint.

**No field is mapped automatically, and three in particular are not:**

- `childAgeYears` IS NOT A BIRTH DATE. It is whole years as a parent typed them
  — a staff-triage fact — and a child record carries a date somebody at the
  clinic confirmed. Deriving one from the other would write a wrong,
  authoritative-looking date onto a permanent record.
- `contactName` IS NOT `familyName`. One is the person asking to be called; the
  other is what the clinic files the family under.
- `childName` IS NOT a first name and a last name. It is one box a stranger
  typed.

A request is linked to **at most one family, ever**: one nullable column, made
write-once by a trigger, and a second link — to the same family or a different
one — is `WEBSITE_REQUEST_ALREADY_LINKED` in both cases.

- **Alternatives:** a `POST /website-requests/:id/convert` that created the
  family; a server-side prefill projection that mapped request fields onto the
  registration request shape.
- **Reason:** a conversion endpoint would be a second family-creation path with a
  second chance to skip the duplicate check, reachable from a screen whose input
  is text a stranger typed. A mapping projection would freeze the three guesses
  above into the contract, where they would look authoritative.
- **Trade-off:** somebody registering a family from a request retypes a name and
  a telephone number. That is a few seconds against a permanently wrong date of
  birth, and the person doing it is the one who has just spoken to the parent.
- **Revisit when:** the public form is changed to collect a real date of birth,
  which is a product decision about what to ask a stranger rather than a mapping
  decision.

## 2026-08-28 — The inbox needs two permissions, and the receptionist holds both

**Status:** Accepted — Milestone 9, checkpoint A4

`website_request.read` and `website_request.process`. Manager and receptionist
hold both; nobody else holds either; linking additionally demands `family.read`
(`WEBSITE_REQUEST_LINK_PERMISSIONS`).

The role map follows the WORK rather than the sensitivity of the data: answering
the clinic's contact form is front-desk work, exactly as the telephone is, and a
product in which only the manager could return a parent's call is one in which
nobody returns it. PROJECT_SPEC.md 4 keeps configuration, financial correction
and security administration from the receptionist; a message asking for a call
back is none of those.

`website_request.read` is a NEW NAME rather than a reuse of `family.read`,
because the inbox holds the messages of people who never became patients, under a
notice promising the clinic would not keep them beyond ninety days. Somebody
trusted with the clinic's own records is not automatically somebody trusted with
those.

No name is added for conversion (creating a family is `family.create`, on the
existing workflow) and none for the retention run (no signed-in user performs
it).

- **Alternatives:** one `website_request.manage`; a separate
  `website_request.link`; giving the receptionist read and withholding process.
- **Reason:** one name could not express the AND-list linking needs. A separate
  link name would be granularity with no decision behind it — no role holds
  either half without the other, and nothing demands the pair the way
  `SETTLEMENT_RATING_CORRECTION_PERMISSIONS` does. Read without process would
  leave the front desk able to see a parent waiting and unable to record that
  they had rung them.
- **Trade-off:** a receptionist can close a request, and closing starts the
  erasure clock. That is the same authority they already have to deactivate a
  family record, and it is audited.
- **Revisit when:** the clinic wants a role that reads the inbox without acting
  on it. The two names already make that expressible.

## 2026-08-28 — The dashboard's website figure is the count of untouched requests

**Status:** Accepted — Milestone 9, checkpoint A4

`newWebsiteRequestCount` on `GET /dashboard` is the number of requests in status
`NEW` — messages that have arrived and that nobody at the clinic has touched.
This closes the one PROJECT_SPEC.md 10 dashboard item Milestone 7 could not
implement.

It is **not scoped to the dashboard's day**, and it is the only count on that
screen that is not — the exception `missedCount` already is, for the same reason:
a request that arrived three weeks ago and has never been read is exactly what
the number exists to surface.

`website_request.read` JOINS `DASHBOARD_READ_PERMISSIONS`, on the `charge.read`
precedent: a route that counts a table's rows must name the authority to read
that table, or withholding an authority stops meaning anything. Both internal
roles hold it, so no access changed.

- **Alternatives:** counting every request that is not `CLOSED` or
  `CONVERTED_TO_FAMILY`; counting today's arrivals; a block of per-status counts.
- **Reason:** `NEW` is the only reading that can only FALL as the morning's work
  is done, which is the property that makes a number worth putting on a
  dashboard. An "open requests" figure including `FOLLOW_UP_NEEDED` would sit
  there all week and would be a workload metric nobody asked for; today's
  arrivals would hide a backlog behind a quiet morning. Per-status counts already
  exist — on the inbox, where the list is.
- **Trade-off:** a request marked `FOLLOW_UP_NEEDED` and then forgotten is not on
  the dashboard. The inbox's `statusCounts` says how many there are, and the
  status change instant says how long they have been there.
- **Revisit when:** the pilot shows follow-ups being dropped. That is an argument
  for a second, differently named count rather than for widening this one.

## 2026-08-28 — The ninety-day erasure is an operator command, and the deadline is a CHECK

**Status:** Accepted — Milestone 9, checkpoint A4

`node dist/cli/main.js purge-website-requests [--dry-run]`. It clears every
purgeable column of every request that is `CLOSED`, was **never linked to a
family**, and was closed **ninety days or more ago**, and stamps `purged_at`. It
never deletes a row — `website_request` keeps its `no_delete` and `no_truncate`
triggers — and it is idempotent: `purged_at IS NULL` is in the predicate and is
written by the same statement that clears the content.

**The same three conditions are also a database constraint**
(`website_request_purge_eligibility_chk`), including the ninety days. The
predicate is how the run finds its work; the constraint is what makes a mistake
in that predicate a loud failure rather than a quiet destruction, and it means
shortening the retention window is a migration somebody reviews.

One transaction per request, so a failure part-way leaves the erasures already
performed permanent — the correct outcome for an operation whose whole point is
that it eventually happens. Each row's clearing and its audit entry stay atomic
together. The audit row carries a `SYSTEM` actor and an **empty payload**: a list
of what was cleared would be a description of what was there.

- **Alternatives:** a scheduled runner inside the API; a cron entry shipped with
  the application; a nightly job framework.
- **Reason:** the accepted M9 scope has no scheduler, queue or background-job
  framework, and Milestone 10 owns deployment. An unattended process holding a
  destructive grant over a table of personal data, before anybody has decided how
  it is invoked, monitored and alerted on, is exactly the thing to defer — and a
  retention job that fails silently is indistinguishable from one nobody
  installed.
- **Trade-off:** until M10 the erasure happens when somebody runs it. The command
  is safe to run at any frequency, and `--dry-run` reports what it would do
  without writing anything.
- **Revisit when:** M10 chooses a scheduling mechanism. It calls this command;
  nothing about the erasure itself changes.

## 2026-08-28 — A purged request is a different shape on the wire, not a blank one

**Status:** Accepted — Milestone 9, checkpoint A4

Every inbox read is a discriminated union on `contentPurged`. A live request
carries the intake fields and a purged one carries only the lifecycle row; there
is no shape in `@clinic/contracts` that can express "purged, and here is the
telephone number".

That mirrors the database exactly: `website_request_purge_chk` requires all four
required intake columns while `purged_at` is NULL and forbids every purgeable one
once it is set. The discriminator is read off `purged_at` rather than off a null
name, because `purged_at` is the fact and the nulls are its consequence.

A purged request is still readable and still answers `200`. Refusing it with a
404 would be wrong twice over: the row exists, and a colleague looking at an
inbox entry is entitled to be told that the content was erased rather than left
to conclude the record has been lost.

**The inbox has no search term**, deliberately. Searching it by telephone number
would make it a way to ask "has this person contacted the clinic?" of a store the
clinic has promised to erase. It has a status filter, a page and nothing else —
no date range, no sort parameter, no free text.

- **Alternatives:** one shape with every intake field nullable; hiding purged
  requests from the list; a text search over the inbox.
- **Reason:** nullable-everything is a shape somebody eventually populates, and
  it makes the "required means required" guarantee unstateable on the wire.
  Hiding purged rows would make the lifecycle record — the entire justification
  for erasing in place rather than deleting — invisible to the only people who
  can read it.
- **Trade-off:** a consumer must branch on `contentPurged`. That is one `if`
  against a class of leak that cannot then happen.
- **Revisit when:** the inbox grows past what a status filter and a page can
  navigate. That is a volume problem with its own answer, and a mobile-number
  search is not it.

## 2026-09-08 — Milestone 9 closes on one tip, and the editorial forms it promised did not ship

**Status:** Accepted — Milestone 9 closure

The accepted backend tip `d70481a` is a strict ancestor of the accepted web tip
`a8a3e90`; `git merge-base` returns `d70481a` itself and `a8a3e90..d70481a` is
empty. There was never a second implementation to reconcile, so the two lanes are
unified by fast-forward and the accepted Milestone 9 base is `a8a3e90`. No merge
commit records work that nobody did.

**The milestone did not deliver everything it promised.** The API owns the whole
manager write side of public content — `POST/PATCH /content/articles`,
`PATCH /content/articles/:id/publication`, the six `content/testimonials` routes,
`PATCH /catalog/therapists/:id/public-profile` and its `visibility` sibling — and
the six permissions `article.read/draft/publish` and
`testimonial.read/draft/approve` are defined, role-mapped and tested. **The web
tier has no screen for any of them.** There is no internal page and no route
handler under `apps/web/src/app` that writes an article, a testimonial, a
therapist public profile or the clinic profile. The only Milestone 9 internal UI
that exists is the website-request inbox.

The practical consequence is that a manager cannot publish a word of the public
site from the product. Everything the public pages render today reaches the
database through the development seeder or through a direct API call. Nothing is
broken and nothing is unsafe — the authority model, the audit rows and the
database constraints are all in place and all exercised — but the milestone's
editorial promise is undelivered, not deferred by design.

**That gap transfers to Milestone 9.5**, which exists for it. It is not a defect
to be fixed inside Milestone 9, and Milestone 9 is not reopened to absorb it.

- **Alternatives:** merge the two tips with a merge commit; hold Milestone 9 open
  until the editorial forms exist; record the milestone as fully delivered.
- **Reason:** a fast-forward is what the history actually is. Holding the
  milestone open would misdate work that is genuinely finished, and recording it
  as complete would put a false statement in the only place a later reader looks.
- **Trade-off:** the milestone closes with a named hole in it. A closure record
  that names its own gap is worth more than a tidy one that does not.
- **Revisit when:** never for the ancestry. The gap is revisited by Milestone 9.5
  delivering the forms.

## 2026-09-08 — The public team is therapists only for the pilot

**Status:** Accepted — Milestone 9 closure (owner decision)

The public Team surface lists therapists and nobody else. Founder, manager and
receptionist public profiles are explicitly deferred, not forgotten.

No second public-person model is introduced to hold them. The opt-in that already
exists — `therapist.is_public`, `therapist.publish_profile`, the public slug and
the public profile columns on the personnel row — is the whole mechanism, and it
is scoped to therapists because a therapist is the person a parent is choosing.

- **Alternatives:** a general `public_person` table covering every role; publish
  non-therapist staff through the existing therapist row.
- **Reason:** a general model would be built now to satisfy a decision nobody has
  taken, and publishing a non-therapist as a therapist would put a false
  professional claim on a public page.
- **Trade-off:** if the owner later decides the founder should appear, that is
  new modelling work rather than a row insert.
- **Revisit when:** the owner decides a non-therapist appears publicly. Until
  that decision exists, no new public-person model is built.

## 2026-09-08 — Uploaded media lives on an API-owned disk

**Status:** Accepted — Milestone 9.5 / pilot (owner decision)

NestJS owns the storage and the serving of uploaded media, on a persistent disk
attached to the API. It is the same tier that already owns PostgreSQL, the domain
rules and the audit trail, so an uploaded portrait is subject to the same
authority checks as the row that names it.

Media bytes do not go into PostgreSQL, and no external object storage is
introduced.

- **Alternatives:** `bytea` columns in PostgreSQL; S3-compatible object storage;
  serving uploads from the Next.js tier.
- **Reason:** byte columns make every backup and every migration carry the media,
  and object storage adds a credential, a bill and a second availability
  dependency to a single-clinic pilot. Serving from Next.js would put the web
  tier in front of a store it does not own, against the architecture boundary.
- **Trade-off:** the API becomes stateful beyond its database, so the disk has to
  be provisioned and backed up deliberately, and horizontal scaling of the API is
  no longer free.
- **Revisit when:** a later infrastructure decision requires it — a second API
  instance, a media volume that outgrows the disk, or a deployment target with no
  persistent local storage.

## 2026-09-08 — Editorial authority and operational authority are split

**Status:** Accepted — Milestone 9.5 (owner decision)

A receptionist may draft routine public service and therapist content under
narrow editorial authority. **A manager alone publishes.** This extends the split
Milestone 9 checkpoint A2 already froze for articles and testimonials —
`article.draft` writes and `article.publish` publishes, held by different roles —
to service and therapist public copy.

Editorial authority is narrow by construction and stops at prose. It does not
widen receptionist operational authority over service durations, active status,
tariffs, availability, booking restrictions, or a therapist's public visibility
opt-in. `therapist.publish_profile` in particular stays manager-only: deciding
that a named colleague appears on a public website is a decision about that
person, not a copy edit.

- **Alternatives:** keep every public write manager-only; grant the receptionist
  `service.update` and `therapist.update`.
- **Reason:** the front desk hears what families actually ask and is the right
  author of a first draft, but `service.update` and `therapist.update` also carry
  duration, status and specialty — operational configuration that
  PROJECT_SPEC.md 4 keeps away from that role. Draft authority must therefore be
  its own name, not a widening of an existing one.
- **Trade-off:** more permission names, and a manager is in the path of every
  publication. That queue is the control.
- **Revisit when:** the manager publish step is measurably the reason public copy
  goes stale. The answer would be delegated publish authority with its own audit,
  never a widened draft permission.

## 2026-09-08 — Milestone 9.5 is a pre-pilot extension, and Milestone 10 is unchanged

**Status:** Accepted — milestone boundary (owner decision)

Milestone 9 remains closed and accepted at `a8a3e90`. Milestone 9.5 opens as the
pre-pilot editorial and media extension: the internal editorial forms Milestone 9
did not deliver, the receptionist draft authority above, and API-owned media
upload and serving. Milestone 10 remains hardening, production and
pilot-readiness work and absorbs none of this.

- **Alternatives:** reopen Milestone 9; fold the editorial work into Milestone 10.
- **Reason:** reopening a closed milestone destroys the meaning of closing one,
  and folding editorial features into a hardening milestone would mean hardening a
  surface that is still being designed.
- **Trade-off:** a fractional milestone number, and one more boundary to hold.
- **Revisit when:** Milestone 9.5 grows past the editorial and media scope named
  here. Anything beyond it is Milestone 10's or a later milestone's.

## 2026-09-08 — The uploaded photograph is never written to disk

**Status:** Accepted — Milestone 9.5 checkpoint A5 (technical decision)

The bytes a member of staff uploads exist in one process's memory for the length
of one request. What is stored is a **master** — re-encoded, orientation
applied, every metadata block discarded — and the responsive renditions derived
from it. There is no originals directory, no quarantine and no column anywhere
in the schema that could name the upload.

Orientation is applied **before** metadata is discarded. Reversing the two
produces a photograph lying on its side that no renderer can correct.

- **Alternatives:** keep the original for future re-derivation; keep it briefly
  and delete it on a schedule; strip metadata but store the original pixels
  losslessly.
- **Reason:** an unedited telephone photograph carries the GPS coordinate of
  wherever it was taken — a family's home, a colleague's home, the clinic — and
  the narrowest way to obey a rule about a category of data is not to hold the
  data. Keeping originals would put that coordinate in every backup, every disk
  image and every future feature's reach, in exchange for a re-derivation the
  2560-pixel master already serves.
- **Trade-off:** a rendition can never be produced at higher quality than the
  master, and a future format change re-encodes from an already-encoded copy.
- **Revisit when:** a rendition requirement genuinely needs more than the master
  holds. The answer then is a larger master, not a retained original.

## 2026-09-08 — Anonymous media reachability is a consequence of published content

**Status:** Accepted — Milestone 9.5 checkpoint A5 (technical decision)

A rendition is served to an anonymous caller only when **all four** hold: the
asset is `ACTIVE`, its attachment is undetached, a manager has published that
attachment, and the owner it hangs off is itself public. The predicate is
re-evaluated from live rows on every request; nothing in the API caches it.

Every failure is the same answer — `404 MEDIA_NOT_FOUND` — whatever the reason.

`CLINIC_SPACE` is the one owner with no row to consult, because
`clinic_public_profile` is always live; there the manager's publication of the
attachment is the whole of the control.

- **Alternatives:** a public flag on the asset itself; signed, expiring URLs;
  distinguishing "exists but unpublished" from "does not exist".
- **Reason:** a flag on the asset would let a photograph outlive the article it
  illustrates. Signed URLs would make revocation a key-rotation problem and would
  put a credential in every page's HTML. Distinguishing the refusals would let a
  stranger enumerate the clinic's unpublished photographs one identifier at a
  time — the reasoning behind `DRAFT_NOT_FOUND` and `AUTH_INVALID_CREDENTIALS`.
- **Trade-off:** one extra correlated `EXISTS` per image request, and a manager
  who unpublishes an article silently unpublishes its pictures.
- **Revisit when:** a page needs a photograph that is deliberately public
  independently of any owner. That is a fifth owner type, not a widened predicate.

## 2026-09-08 — The media revocation window is five minutes, and it bounds only Vala's own caches

**Status:** Superseded 2026-09-30 — by "Published media is `private, no-cache`: immediate
revocation at the Web origin, cheap revalidation" (Milestone 9.5 checkpoint A10).
Originally Accepted — Milestone 9.5 checkpoint A5 (technical decision)

Published renditions are served with `Cache-Control: public, max-age=300,
s-maxage=300, must-revalidate` and a strong `ETag` equal to the SHA-256 of the
bytes. `PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS` is the single constant behind
both the header and the promise.

- **At Vala's origin, revocation is immediate.** The next anonymous request
  after an unpublish, detach, archive or owner unpublish is refused.
- **In any cache Vala controls** — the Next.js tier, a reverse proxy, a CDN the
  clinic later adds — it is bounded by five minutes. Tag invalidation normally
  makes it one request; the window is what remains guaranteed when a layer has
  not received the invalidation.
- **A copy that has already left is bounded by nothing.** A browser cache, a
  scraper, a search index, a proxy, a screenshot: none of these can be recalled,
  and nobody may tell a family otherwise. Content identity solves REPLACEMENT —
  new bytes get a new rendition id, so no cache can substitute the old ones — and
  it does not solve REVOCATION.

- **Alternatives:** `no-store` on image bytes; a long `max-age` with
  `immutable`; content-addressed URLs.
- **Reason:** `no-store` would re-serve every photograph on every page view of a
  site whose visitors are largely on mobile networks, buying a guarantee that is
  already unenforceable one hop out. A long `immutable` cache would make an
  unpublish take effect in a browser only when the page changed, which is not a
  bound at all.
- **Trade-off:** up to five minutes during which an intermediary cache may still
  hand out a photograph the clinic has taken down.
- **Revisit when:** the clinic puts a CDN in front of the site whose purge API
  the product can call. The window can then be stated as the purge latency.

## 2026-09-08 — Media permissions are four names, and publishing is manager-only

**Status:** Accepted — Milestone 9.5 checkpoint A5 (technical decision)

`media.read`, `media.upload` and `media.attach` are the receptionist's;
`media.publish` — which covers publishing an attachment, unpublishing one,
archiving an asset and restoring it — is the manager's alone. Attaching creates
an unpublished attachment and the request has no field that could say otherwise.
Detaching a **published** attachment is refused (`MEDIA_ATTACHMENT_PUBLISHED`);
it must be unpublished first, which is a manager act.

No other authority moves. Nothing operational, financial, scheduling or clinical
is widened, and no existing permission changes meaning.

- **Alternatives:** one `media.manage`; reuse `article.draft`/`article.publish`
  per owner type; make attaching manager-only.
- **Reason:** it is the A2 split applied to a picture. Reusing the content
  permissions would leave `CLINIC_SPACE` — which has no content owner — with no
  authority to name, and would make the guard's answer depend on the request
  body. Manager-only attaching would put the manager in the path of every draft.
- **Trade-off:** four more names, and a receptionist can occupy a therapist's
  single portrait slot with a draft.
- **Revisit when:** the manager publish step is measurably why the site's
  photographs go stale.

## 2026-09-08 — This photographic uploader accepts three formats and never SVG

**Status:** Accepted — Milestone 9.5 checkpoint A5 (technical decision)

JPEG, PNG and WebP, decided from the file's magic number and confirmed by the
decoder — never from the filename or the browser-supplied content type. The list
is also a database CHECK, so it survives an import or a data fix. HEIC/HEIF is
deliberately absent. The accepted Vala SVG brand and logo assets remain static in
the web tier and are not part of this uploader.

- **Alternatives:** accept anything the decoder can read; accept SVG with a
  sanitiser; accept HEIC.
- **Reason:** an SVG is a document with a script engine attached, and serving one
  from the clinic's own origin would put uploader-authored markup on the clinic's
  own domain. HEIC is what a current iPhone stores, but every route by which a
  photograph reaches a receptionist in practice has already converted it to JPEG,
  and accepting it carries a licensing question nobody has answered.
- **Trade-off:** a colleague who somehow has an unconverted HEIC file must
  convert it before uploading.
- **Revisit when:** real pilot uploads are being refused as unsupported. The
  answer is measured against what people actually send, not against a format list.

## 2026-09-08 — Media retention is deliberately undecided, and nothing in the code assumes an answer

**Status:** Superseded — resolved by "Owner: media and testimonial retention" (2026-09-26).
Originally Open — Milestone 9.5 checkpoint A5 (owner decision required)

Archiving a photograph stops it being served everywhere at once and is
reversible. It does **not** remove bytes. There is no `deleted_at`, no purge
column, no retention clock and no code path anywhere in the application that
unlinks a stored file; all three media tables carry the `no_delete` and
`no_truncate` triggers every historical table in this schema carries.

- **Reason:** how long the clinic keeps a photograph nobody publishes any more is
  the owner's decision. A schema or a routine that guessed either way — erasing
  on archive, or promising to keep forever — would pre-empt it, and building the
  deletion capability before the policy would add the risk before the reason.
- **Blocked on:** an owner decision naming a retention period and the event it
  runs from, and whether a family's request to withdraw a photograph erases the
  bytes or only unpublishes them.
- **When it arrives:** a reviewed migration and an operator command, in the shape
  the website-request retention rule already established — no HTTP route in this
  product destroys anything.

## 2026-09-09 — Public service and therapist copy is split into a draft and a published copy, on the same row

**Status:** Accepted — Milestone 9.5 checkpoint A6

`service.public_description` and a therapist's `public_display_name`,
`public_title` and `public_bio` become **working drafts**.
`published_public_description` and `published_public_display_name`,
`published_public_title`, `published_public_bio` beside them are **what the
website says**, and every public read selects the second set. This is the shape
checkpoint A2 accepted for an article, applied unchanged to the two catalog
records that also have a public face.

- **Alternatives:** one set of columns with the receptionist's edit going live
  immediately; one set with published rows refused any edit; a separate
  `service_copy_draft` table holding only pending changes; a published-copy
  table per record.
- **Reason:** with one set of columns the product has to choose between two
  broken rules — an unreviewed sentence on the live page the instant it is
  saved, or a published description nobody can correct without a manager doing
  the typing — and the accepted rule (2026-09-08 — Editorial authority and
  operational authority are split) is neither. A pending-change table would be a
  second editorial model beside the article one, and its null would have to mean
  both "no pending change" and "prepared to be cleared". Two column sets on one
  row is the smallest thing that states the rule: no revision history, no
  version list, no scheduling, and exactly one previous state — the one
  currently on the website.
- **Trade-off:** four columns, a backfill, and one more thing every public read
  has to select correctly. The `IS DISTINCT FROM` comparison that derives
  `hasUnpublishedChanges` is computed per read rather than stored, so it cannot
  disagree with the columns it describes.
- **Revisit when:** a record needs more than one pending version, or a
  publication has to be scheduled. Both are a different feature, not a wider
  version of this one.

## 2026-09-09 — The service name is not draftable, and gets no published copy

**Status:** Accepted — Milestone 9.5 checkpoint A6

Only the public **description** is split. A service's `name` keeps its A1
behaviour: it is what the website calls the service, a manager renaming one
changes the public page at once under `service.update`, and no drafting
authority reaches it.

- **Alternatives:** split the name too; give a service a separate public display
  name that is draftable.
- **Reason:** A1 refused a published copy of a service precisely because its
  name IS its public name — a second stored version could let the site advertise
  something the clinic had stopped offering. A draftable public name would
  reintroduce exactly that gap, and it is configuration rather than copy.
- **Trade-off:** a receptionist who spots a misspelt service name must ask a
  manager. That is the intended boundary rather than a gap in it.
- **Revisit when:** the clinic wants a public name that genuinely differs from
  the operational one. That is a new column and a new decision, not a wider
  editorial permission.

## 2026-09-09 — A service is published with its prepared copy; a later edit to a live service is not

**Status:** Accepted — Milestone 9.5 checkpoint A6

The write that takes a service from unreachable to reachable — `service.update`
setting `isPublic` with an address — promotes the prepared description in the
same transaction. A later edit to a service that is **already** live promotes
nothing; promoting a prepared change there is an explicit act on
`PATCH /content/service-copy/:id/publication`, under `service.update`.

- **Alternatives:** never promote from the service form, so every publication is
  two acts; always promote whenever the row is public after the write.
- **Reason:** ticking the public box IS the decision that what is prepared
  should be seen — it is the same act `article.setPublication(true)` performs —
  so a clinic publishing something new should not get a blank description while
  it waits for a second act. Always promoting is the opposite error and is the
  defect the A2 article model exists to prevent: a manager changing a duration
  would publish whatever unreviewed sentence happened to be in the draft.
- **Trade-off:** the rule is conditional rather than uniform, and it is stated in
  one place — `promoteServicePublicCopy`, which has exactly two callers and is
  the only function that writes the column.
- **Revisit when:** managers report publishing copy they had not read. The answer
  would be to drop the transition promotion and make the first publication two
  acts as well, not to widen it.

## 2026-09-09 — Publishing a colleague's prepared copy IS the opt-in, and gets no route of its own

**Status:** Accepted — Milestone 9.5 checkpoint A6

`PATCH /catalog/therapists/:id/public-profile/visibility` with `isPublic: true`
sets the flag and copies the prepared display name, title and biography onto the
published columns in one statement. Sending it again on somebody already public
is how a manager promotes a prepared change, and is recorded as a real
publication; sending it when nothing has changed writes nothing. There is no
`therapist.public_copy_published` action and no second route.

- **Alternatives:** a separate publication route for a therapist's copy, mirroring
  the service one.
- **Reason:** for a person, "publish" is one decision — this colleague, with these
  words, appears on the website — and A1 already gave it a permission of its own.
  A second route would be two names for one decision a manager would then have to
  choose between. The service needs one because its visibility flag lives on the
  operational form, which must not publish copy as a side effect.
- **Trade-off:** the two records are not symmetrical, and a reader has to know
  why. The asymmetry follows the authority: a service's publication is a catalog
  fact, a person's is a decision about that person.
- **Revisit when:** a therapist's visibility and their copy need to be decided by
  different people. Nothing in the approved model asks for that.

## 2026-09-09 — A receptionist may draft a colleague's public display name, title and biography

**Status:** Accepted — Milestone 9.5 checkpoint A6 (owner decision, coordinator
review; supersedes the narrower reading first implemented in this checkpoint)

`therapist.draft_public_profile` reaches `public_display_name`, `public_title`
and `public_bio` — the whole of the routine public copy about a colleague. It
does not reach the slug, the display order, the photograph path, the personnel
record or `is_public`, and the manager profile surface — its read included —
still refuses this role exactly as checkpoint A2 decided.

The first implementation of A6 withheld the display name on the reasoning that
it is the name a person is published _under_ and therefore part of the
publication decision. **That restriction was an implementer's assumption, not an
owner decision, and the owner boundary is the opposite:** the receptionist may
draft routine public therapist profile content, and the manager alone controls
publication and the visibility opt-in.

- **Alternatives:** withhold the display name from the drafting authority (the
  first implementation); withhold the biography as well.
- **Reason:** drafting a public display name does not publish anybody. The name a
  visitor reads is `published_public_display_name`, a different column that only
  the manager opt-in writes, so preparing a name changes no live page and
  clearing one takes nobody off the website. What is genuinely a decision about a
  person — that they appear at all, and at what address — remains
  `therapist.publish_profile`. Splitting the copy from the decision is exactly
  what the two column sets exist to express, and withholding one of the three
  prose fields would have made the surface unable to prepare a new colleague's
  page at all.
- **Trade-off:** the front desk can prepare the name a colleague would appear
  under. A manager still reads it and publishes it, and
  `therapist_public_profile_chk` refuses a publication that would leave a live
  page nameless.
- **Revisit when:** a clinic wants the published name fixed at the moment a
  profile is created rather than drafted. That is a manager-set field, not a
  narrower draft permission.

## 2026-09-09 — The legacy therapist photograph path is not split, and not yet removed

**Status:** Superseded 2026-09-25 — the path is dropped (Milestone 9.5 stabilisation)

`therapist.public_photo_path` keeps its pre-media behaviour: manager-only under
`therapist.publish_profile`, read by the public projection, and changing it
changes the live page at once. It gains no published counterpart, and no
editorial authority can write it.

- **Alternatives:** split it like the prose; remove it in this checkpoint and
  serve therapist portraits only through the A5 media subsystem.
- **Reason:** the currently accepted public site still depends on it, so removing
  it here would break a live surface in a checkpoint that has no Web lane. And
  splitting a column that the Web checkpoint finishing the A5 migration is going
  to delete would leave a backfill, a CHECK and a projection behind for nothing.
  It is manager-only, so no receptionist authority leaks through it.
- **Trade-off:** for the length of this checkpoint one public field on a therapist
  moves without a publication act, which is stated in the schema comment beside
  it and in the profile contract.
- **Revisit when:** the Web checkpoint removes the dependency. The column goes
  then, with the migration that drops it.

## 2026-09-09 — Editorial routes are mounted under `/content`, and the operational ones stay under `/catalog`

**Status:** Accepted — Milestone 9.5 checkpoint A6

`/content/service-copy` and `/content/therapist-profiles` carry the drafting
routes, beside `/content/articles` and `/content/testimonials`. `/catalog/*`
stays the operational and publication surface and stays manager-only, apart from
the reads a receptionist has always held. The code stays in `CatalogModule`,
which remains the only thing that writes `service` and `therapist`.

- **Alternatives:** hang the editorial routes off `/catalog/services/:id/...`;
  move the services into the website module.
- **Reason:** the path is the authority boundary restated where a reader will see
  it first — "what can the front desk write?" is answerable by one prefix. Moving
  the code would give the website module a second writer of two tables it
  deliberately only reads.
- **Trade-off:** a controller whose route prefix does not match its directory, and
  a class comment on each saying why.
- **Revisit when:** an editorial surface needs a table no catalog module owns.

## 2026-09-09 — A public space is a separate concept from an operational room, with no reference between them

**Status:** Accepted — Milestone 9.5 checkpoint A7

`public_space` is editorial content about the building — a heading, a
paragraph, an order and photographs — drafted under `public_space.draft` and
published under `public_space.publish`. `room` remains scheduling
configuration under `room.*`. The two tables share **no foreign key in either
direction**, and neither module imports the other.

- **Alternatives:** a nullable manager-set `room_id` on `public_space`,
  documented as non-publishing; publishing a room directly by giving `room` its
  own public columns.
- **Reason:** the frozen boundary is that no operational act may publish
  anything and no public read may carry an operational fact. With no column
  joining the tables, both are properties of the SCHEMA — a leak would need a
  new column and a reviewed migration, not a widened `SELECT` — rather than
  promises a projection has to keep. Nothing in the accepted product asks a
  space which room it is, and a nullable link would have been the first half of
  the coupling the checkpoint exists to prevent. A clinic also genuinely
  publishes things that are not rooms (a corridor, a garden) and rooms it does
  not publish.
- **Trade-off:** a clinic that publishes a description of a room maintains its
  name in two places, and no report can join published spaces to operational
  ones.
- **Revisit when:** a decision arrives that genuinely needs the join — a
  room-level public page, or an operational report about published spaces. It
  is then one nullable column and a migration, and the non-publishing rule has
  to be stated at that point rather than assumed now.

## 2026-09-09 — `PUBLIC_SPACE` is a fifth attachment owner, and `CLINIC_SPACE` is left exactly as A5 froze it

**Status:** Accepted — Milestone 9.5 checkpoint A7

`MEDIA_ATTACHMENT_OWNERS` gains `PUBLIC_SPACE`, which names a `public_space`
row and requires an owner id like the other three real owners. `CLINIC_SPACE`
keeps its A5 meaning unchanged: ownerless, `ownerId` null, and returned by no
public projection.

- **Alternatives:** redefine `CLINIC_SPACE` to carry the new `space_id`, which
  would have kept the enum at four values and made every owner type uniform.
- **Reason:** the media workspace shipped in B6 uses the ownerless
  `CLINIC_SPACE` slot as the parking place for a photograph somebody has
  uploaded and framed but not yet placed — its own copy says the page creates no
  public placement. Redefining the slot would have turned that drafting sandbox
  into a live public-gallery target, which is the accident this checkpoint
  exists to prevent, and would have rewritten an accepted A5 contract Agent B
  builds against today. A5 itself said a fifth value would have to be a new
  decision about what the clinic publishes; this is that decision.
- **Trade-off:** two owner types whose names read similarly and whose owner-id
  rules are opposite. The enum comment, the service comment and a schema test
  state the difference; `normalizeOwner` refuses the wrong shape rather than
  silently dropping it.
- **Revisit when:** the web tier gains a first-class "prepared but unplaced"
  concept of its own. `CLINIC_SPACE` is then vocabulary with nothing behind it
  and should be retired in a reviewed migration.

## 2026-09-09 — A handwritten testimonial is never publishable from pixels, and no OCR output is ever authoritative

**Status:** Accepted — Milestone 9.5 checkpoint A7

`public_testimonial.kind` records `TYPED` or `HANDWRITTEN`. For both kinds the
`body` — a human transcription — is the authoritative public text and is
required by the request contract, by a NOT NULL column and by
`public_testimonial_handwritten_body_chk`. No column in this schema holds
machine-read text, and nothing in the API reads a photograph.

- **Alternatives:** no discriminator at all, relying on `body` already being
  required; an `ocr_text` column beside the transcription; a minimum
  transcription length for handwritten notes.
- **Reason:** the rule worth stating is "a photograph of somebody's handwriting
  about their child is not publishable until a person has read it", and a rule
  nobody can point at is a rule that erodes. The discriminator makes it
  checkable, testable and visible to the surface that will render a photographed
  note. An OCR-derived authoritative field would mean publishing a family's
  words because software was confident. A minimum length would be inventing
  policy nobody has approved.
- **Trade-off:** one more enum in the schema, and a rule the database can never
  observe failing, because `public_testimonial_body_chk` already refuses an
  empty body of any kind. That redundancy is the point: the reader finds the
  rule under its own name.
- **Revisit when:** the web tier offers transcription as a drafting aid. What it
  saves must still be what a human read, corrected and accepted through the
  ordinary draft route — which is indistinguishable, here, from typing. H0, the
  clinic's consent policy, remains an owner and legal decision and is encoded
  nowhere.

## 2026-09-10 — The clinic's routine public copy is fixed slots in one table, not columns on the profile

**Status:** Accepted — Milestone 9.5 checkpoint A8

`clinic_content_entry` holds the editorial blocks of the home and about pages:
nine named slots, twenty-one rows, inserted **empty** by the migration and
capped at the accepted design's own counts by
`clinic_content_entry_slot_size_chk` plus a `UNIQUE (slot, position)` index. The
profile table gains no column.

- **Alternatives:** a column per block on `clinic_public_profile`; a general
  block/section tree with a page model behind it; free-form entries a manager
  creates and deletes at will.
- **Reason:** checkpoint A1 said of copy blocks that "inventing a column for
  each would freeze a page layout in the database", and thirty nullable columns
  would have done exactly that. A general block tree is a content-management
  system nobody has asked for and would let a manager restructure pages the
  design has already settled. Fixed slots keep the accepted design's shape — the
  five concern prompts, the three first-session moments — as a property of the
  database rather than a convention a screen has to remember, while making every
  word inside them a manager's to change without a deployment.
- **Trade-off:** the clinic cannot add a sixth concern prompt without a
  migration. That is deliberate: filling a block in is routine content
  maintenance, and adding one is a design change.
- **Assumptions:** the accepted public design's counts are stable. Nothing in
  this repository holds the clinic's real copy; all twenty-one blocks ship empty
  and every fixture is synthetic.
- **Revisit when:** a design change genuinely needs a different count, or a
  block the current nine slots cannot express. Either is one migration — a
  widened CHECK, an INSERT, a contract constant — taken by somebody who has
  decided it.

## 2026-09-10 — Editing the clinic's public copy IS publishing it, so it holds its copy once

**Status:** Accepted — Milestone 9.5 checkpoint A8

`clinic_content_entry` has no draft columns, no `is_public` flag and no
publication route. `clinic_profile.read` and `clinic_profile.update` govern the
whole surface, the receptionist holds neither, and what a manager saves is what
the website says. A block leaves the site by having its `heading` cleared.

- **Alternatives:** the A2 draft/published column pair every other public content
  table carries, with a separate manager publication act; a receptionist drafting
  authority mirroring `article.draft` and `public_space.draft`.
- **Reason:** the split exists to protect a live page from a **lower** authority
  that may prepare copy. There is no lower authority here — checkpoint A2 froze
  the same answer for the profile row itself — so a draft pair would be two
  columns nobody could ever write differently and a publication act with one
  possible actor. Adding one would also have implied a receptionist may draft the
  clinic's public identity, which the checkpoint explicitly refuses.
- **Trade-off:** a manager mid-sentence is a manager editing the live site, with
  no preview state to hide behind. Accepted: these are short blocks on one
  screen, every save is audited with its before and after, and clearing a heading
  is an immediate, reversible way off the page.
- **Revisit when:** a role below manager is given authority over this copy. The
  draft pair arrives with it, not before.

## 2026-09-10 — An unwritten block says nothing, and the same column revokes its photograph

**Status:** Accepted — Milestone 9.5 checkpoint A8

`heading IS NULL` is the whole publication rule of the clinic-content surface.
The public projection omits such a row, and `LIVE_ATTACHMENT_PREDICATE` refuses
any `CLINIC_CONTENT_ENTRY` photograph attached to it.

- **Alternatives:** an `is_public` flag per block; returning every slot with
  nulls and letting the web tier decide; gating the photograph on the
  attachment's own publication alone, as `CLINIC_SPACE` does.
- **Reason:** the fourth condition of the serving predicate asks "is the owner
  public?", and for a table with no publication flag the honest answer is "has
  anybody written this block at all?". One column read by both the projection and
  the predicate cannot drift; two rules could. It also produces the behaviour a
  manager expects without being told: clearing a heading takes the words and the
  picture off the site together, at the origin, immediately.
- **Trade-off:** a photograph published on a block whose heading is later cleared
  becomes unreachable without anybody touching the media library. That is the
  intended reading — the block is off the site, so is its picture — and the
  manager screen shows the same answer the origin gives.
- **Revisit when:** a block is wanted that is a photograph and no words. It would
  need its own rule, stated then.

## 2026-09-10 — `CLINIC_OPEN_GRAPH` is a seventh attachment owner, and the brand marks stay static

**Status:** Accepted — Milestone 9.5 checkpoint A8

`MEDIA_ATTACHMENT_OWNERS` gains `CLINIC_CONTENT_ENTRY`, which names a block and
requires an owner id, and `CLINIC_OPEN_GRAPH`, which is ownerless like
`CLINIC_SPACE` because it hangs off the always-live clinic profile.
`MEDIA_OWNERLESS_ATTACHMENT_OWNERS` names the ownerless pair once, for the
callers that previously tested against `CLINIC_SPACE` by hand.

- **Alternatives:** reusing `CLINIC_SPACE` for the Open Graph photograph; an
  `open_graph_media_id` column on the profile; making the Open Graph image a
  content block with a reserved slot.
- **Reason:** reusing `CLINIC_SPACE` would have given a public projection to the
  slot the 2026-09-09 decision deliberately keeps as the web tier's
  unplaced-photograph sandbox. A direct column on the profile would be a second
  media path beside `media_attachment`. A reserved content slot would have made a
  site-wide fact an entry in a page's list, gated by a heading that has no
  meaning for it.
- **Trade-off:** seven owner labels, two of them ownerless and none of them
  self-evident from the name alone. The enum comment, `normalizeOwner`, a
  seven-branch `media_attachment_owner_chk` and two schema tests state the
  difference; a wrong shape is refused rather than silently reinterpreted.
- **Assumptions:** the Open Graph image is photographic. **The accepted Vala SVG
  logos remain static web-tier assets reviewed by a human**; SVG is still refused
  by this uploader, and nothing in this checkpoint makes a logo staff-manageable.
- **Revisit when:** the clinic wants a different social-preview picture per page.
  That is a per-page media placement and a different decision.

## 2026-09-10 — The clinic's public name has one source, and the web tier's `SITE_NAME` must go

**Status:** Accepted — Milestone 9.5 checkpoint A8

`PublicClinicProfile.displayName` is the authoritative public name. No backend
projection, shared contract or fixture holds a second production copy.
`apps/web/src/server/public-seo.ts` still defines a hard-coded `SITE_NAME`
constant; removing it in favour of the profile read is a **required** Agent B
follow-up, not an optional tidy-up.

- **Alternatives:** leaving the web constant as an offline fallback; duplicating
  the name into the clinic-content response so a page needs one fetch.
- **Reason:** two independently maintained copies of a clinic's own name is
  exactly the failure this checkpoint exists to end — a manager renames the
  clinic, the pages update, and the Open Graph `siteName` and the page titles go
  on saying the old one until somebody deploys.
- **Trade-off:** `displayName` is nullable, so the web tier must render a missing
  name deliberately rather than falling back to a constant. That is the same
  discipline every other profile field already imposes.
- **Revisit when:** never for the duplication itself. If a build-time default is
  ever genuinely needed it must be owner-supplied configuration, not a literal in
  the repository.

## 2026-09-20 — Staff can preview persisted draft media through one session-bound route, gated by the owner's own read permission

**Status:** Accepted — Milestone 9.5, staff-preview checkpoint (Agent A)

`GET /media/renditions/:renditionId/preview` serves a stored rendition to a signed-in
colleague whether or not it is published. It needs `media.read` plus the read permission
of the content the image is attached to (`MediaPreviewService.MEDIA_PREVIEW_OWNER_PERMISSION`).
It refuses archived, erased, unattached and detached-only media. The response is
`Cache-Control: private, no-store` (`MEDIA_PREVIEW_CACHE_CONTROL`). The anonymous
predicate `LIVE_ATTACHMENT_PREDICATE` and the public route are unchanged. This reverses
A5's "no privileged preview route" position for staff only.

- **Alternatives:** signed, short-lived preview URLs; widening the public route for
  sessions; one preview endpoint per content type; `media.read` alone as the gate.
- **Reason:** a manager cannot approve a picture they cannot see after the uploader's
  local preview is gone. A session-bound route reuses the existing guard chain, so a
  copied URL is worthless without a session, with no token scheme to design. One
  media-level route covers articles, testimonials, spaces and B8. Reusing each owner's
  existing read permission means preview grants nothing that reading the draft did not.
- **Trade-off:** a second byte-serving query exists. It is kept safe by answering a
  different question: it is session-only, never publicly cacheable, and shares no SQL
  with the public predicate. A receptionist cannot preview images parked in
  `CLINIC_SPACE`, because that owner type belongs to the manager's clinic profile.
- **Revisit when:** the product wants receptionists to re-view their own unplaced
  uploads, or unattached library thumbnails. Either one widens who can see unpublished
  pixels and needs an owner decision. Also revisit if a third role arrives.

## 2026-09-21 — Service imagery is a dedicated media owner gated on the service being publicly reachable

**Status:** Accepted — Milestone 9.5, checkpoint A9 (Agent A)

`PUBLIC_SERVICE` is the eighth `media_attachment_owner` and the sixth that names a row.
`media_attachment.service_id` references `service(id)` under the existing discriminator,
and `publicServiceSummarySchema` gains a nullable `image` that the list and the detail
reads both carry. The owner gate in `LIVE_ATTACHMENT_PREDICATE` is the THREE conditions
that make a service reachable — `is_public` AND `status = 'ACTIVE'` AND a non-null
`public_slug` — not the flag alone. No permission, error code or audit action was added:
preparing is `media.upload` + `media.attach`, reviewing a draft is
`service.draft_public_copy`, publishing is `media.publish`.

- **Alternatives:** reusing `CLINIC_SPACE` (ownerless, so no service act could withdraw
  the picture and no projection could tell which service it belonged to); reusing
  `PUBLIC_SPACE` (a space is a place, and it would need a service↔space link the product
  deliberately does not have); a `public_photo_path`-style column on `service` (the
  pre-media legacy pattern, with no EXIF stripping, renditions, framing or publication
  gate); publishing no service imagery at all.
- **Reason:** a service is the last record in this product with a published page and no
  way to illustrate it, and it already has everything an owner needs — a row, a
  publication flag, a status and an address. A dedicated owner makes "withdrawing the
  service withdraws the picture" a property of one predicate rather than a promise a
  projection keeps.
- **Trade-off:** an eighth enum label and a sixth owner column, so the owner CHECK is
  restated over eight branches again. The alternative — one loose `owner_id` — cannot be
  constrained or referenced, which is the trade A5 already made.
- **Assumptions:** one photograph per service, matching the accepted design's single slot
  on the list stage and the detail hero; the attachment table can hold more and the
  projection returns the first by `position`, exactly as a testimonial does.
- **Revisit when:** the design wants a gallery per service. That is a widening of `image`
  to `images[]` and a web change, not a schema change.

## 2026-09-21 — A deactivated therapist's portrait stays anonymously servable (open finding, not fixed here)

**Status:** Superseded 2026-09-23 — fixed by "Anonymous media servability is exactly the
owner's public projection" (Milestone 9.5 stabilisation). Kept as the record of the finding.

`LIVE_ATTACHMENT_PREDICATE` gates a `THERAPIST_PROFILE` photograph on `therapist.is_public`
alone, while `PublicSiteService.listTeam` additionally requires `status = 'ACTIVE'`.
`TherapistsService.setStatus` writes `status` and leaves `is_public` standing, so a
colleague who has left the clinic disappears from `/public/team` while the bytes of their
portrait remain retrievable by anybody holding the rendition id, until somebody also clears
their public flag. The same divergence would have existed for services; checkpoint A9
avoided it by gating `PUBLIC_SERVICE` on all three conditions.

- **Decision:** record it; change nothing. A9 adds service imagery and does not alter
  accepted therapist semantics.
- **Alternatives:** adding `AND t.status = 'ACTIVE'` to the therapist branch inside A9;
  clearing `is_public` when a therapist is deactivated.
- **Reason:** narrowing a live serving predicate is a behaviour change to accepted A5/A1
  scope and belongs in a checkpoint that owns it, with its own tests and its own note to
  the web lane.
- **Trade-off:** the gap stays open meanwhile. It is bounded: the photograph was already
  public, no unpublished content is exposed, and a manager clearing the public flag closes
  it immediately.
- **Revisit when:** the next checkpoint that touches therapist publication. The fix is two
  lines — the branch in `media-visibility.ts` and the mirror in `media.service.ts` — plus a
  deactivation test alongside the A9 one.

## 2026-09-23 — Service imagery (A9) and the staff draft preview are accepted as in-scope

**Status:** Accepted — Milestone 9.5 stabilisation (coordinator review of both status audits)

Checkpoint A9 (`PUBLIC_SERVICE` media owner) and the session-bound staff preview
(`GET /media/renditions/:id/preview`) were both built by Agent A ahead of an explicit
checkpoint instruction. The coordinator accepted both in substance: the plan always
required a per-service image, and the plan's manager preview cannot work once the
uploader's local preview is gone. Their entries of 2026-09-20 and 2026-09-21 stand as
written; this entry records that they are in scope, not additions to it.

- **Revisit when:** never for scope; the entries' own revisit triggers still apply.

## 2026-09-23 — A lane does not change the other lane's code without the owning agent's review

**Status:** Accepted — Milestone 9.5 stabilisation (coordinator rule)

`apps/api` and `packages/contracts` belong to Agent A (backend lane); `apps/web` belongs
to Agent B (web lane). From this checkpoint on, a lane that needs a change in the other
lane's code **proposes** it — a contract note, a patch in a message, or a branch the
owner reviews — and the owning agent reviews and lands it. No silent cross-lane edit.

- **Why now:** Agent B changed API code and contracts in `c5dc17e` and `4e840a7` without
  backend review. The changes were reviewed after the fact at this checkpoint (verdicts in
  the checkpoint report), integrated by fast-forward, and corrected in a follow-up commit
  where the review disagreed.
- **Alternatives:** shared ownership of `packages/contracts`; review only for
  security-relevant files.
- **Reason:** the contracts package is the one place both lanes meet, so it is exactly
  where an unreviewed change costs most. One rule with no category judgement is
  cheaper to keep than a rule about which files count.
- **Trade-off:** a web change that needs one new contract field waits for the backend
  owner. That is minutes, not a milestone.
- **Revisit when:** there is only one lane.

## 2026-09-23 — Anonymous media servability is exactly the owner's public projection

**Status:** Accepted — Milestone 9.5 stabilisation (supersedes the open finding of
2026-09-21, and A5's statement that a published `CLINIC_SPACE` photograph is anonymously
servable)

A photograph is anonymously servable only while its owner would appear in that owner's
public projection. The owner conditions are now **one SQL fragment per owner kind** in
`apps/api/src/common/public-reachability.ts`, and both `PublicSiteService` (every public
list, detail and sitemap read) and `OWNER_IS_PUBLIC` in `media-visibility.ts` interpolate
the same fragment. The audit that found the divergences:

| Owner                  | Public projection requires                               | Serve gate before | Gap closed                         |
| ---------------------- | -------------------------------------------------------- | ----------------- | ---------------------------------- |
| `THERAPIST_PROFILE`    | `is_public`, `status = ACTIVE`, slug, published name     | `is_public`       | **deactivation** (a real leak)     |
| `PUBLIC_SERVICE`       | `is_public`, `status = ACTIVE`, slug                     | same three        | none                               |
| `PUBLIC_ARTICLE`       | `is_public`, `public_first_published_at`                 | `is_public`       | implied by a trigger; now explicit |
| `PUBLIC_TESTIMONIAL`   | `is_public`, `status = APPROVED`, `approved_at`          | `is_public`       | implied by a CHECK; now explicit   |
| `PUBLIC_SPACE`         | `is_public`, published name, `public_first_published_at` | `is_public`       | implied by a CHECK and a trigger   |
| `CLINIC_CONTENT_ENTRY` | `heading IS NOT NULL`                                    | same              | none                               |
| `CLINIC_OPEN_GRAPH`    | always read by `GET /public/clinic-content`              | `TRUE`            | none                               |
| `CLINIC_SPACE`         | **read by no projection**                                | `TRUE`            | **published-but-pageless bytes**   |

- **`CLINIC_SPACE` is now never anonymously servable.** It is the web tier's staging slot
  for a photograph uploaded but not yet placed; no page reads it, so a published one was
  bytes reachable by id with no public owner. Publishing such an attachment is still
  accepted (it records manager intent and changes nothing a visitor can reach), and staff
  still see it through the session-bound preview.
- **The library shares the gate.** `media.service.ts` previously kept its own copy of the
  owner gate on the reasoning that a library change must not be able to widen serving.
  Agent B's `c5dc17e` merged the two; that is accepted, because the defect this entry
  fixes is precisely two copies of one rule disagreeing, and the library's "is the page
  live?" must give the same answer as the origin.
- **Alternatives:** clearing `is_public` on deactivation (a second writer of a manager's
  publication decision, and it would not cover the next owner); adding the missing
  conditions to the media predicate only (the next projection change would drift again);
  leaving `CLINIC_SPACE` servable (keeps a frozen A5 test green at the cost of the rule).
- **Reason:** "anything that removes an owner from the site revokes its bytes on the next
  request" can only be true by construction if both readers use one definition.
- **Trade-off:** the fragments are interpolated SQL, so a projection's WHERE clause is no
  longer readable in one place; each fragment's comment names the reads that use it.
- **Revisit when:** a new owner kind or a new projection condition. It goes into the
  fragment, never into one reader. Retiring `CLINIC_SPACE` altogether stays as the
  contract note says: when the web tier has its own "prepared but unplaced" concept.

## 2026-09-23 — A retried upload returns the uploader's existing asset for the same bytes

**Status:** Accepted — Milestone 9.5 stabilisation (frozen A5 outcome: a retry creates no
duplicate)

`media_asset.source_content_hash` holds the SHA-256 of the bytes as uploaded. Before any
image processing, `MediaService.upload` looks for an `ACTIVE`, unpurged asset **created by
the same user** with the same digest and, if there is one, returns it unchanged — no new
files, rows or audit entry. The insert re-checks under a transaction-scoped advisory lock
on (user, digest), so two concurrent retries converge on one asset. Migration
`20260923090000_m95_media_upload_idempotency` is additive (a nullable column and an
index); existing assets have a NULL digest and simply never match.

- **Alternatives:** a client-supplied `Idempotency-Key` (lost when the tab or the web
  process restarts — the failure the checkpoint names); dedup across all users (returns a
  colleague's asset; no wider visibility today, since `media.read` sees the whole library,
  but it couples two people's alt texts and audit trails); dedup on the derived master's
  hash (needs the full, expensive derivation first, and changes whenever sharp does); a
  unique index (would make restoring an archived duplicate fail).
- **Reason:** the photograph itself is the only retry identity that survives every
  interruption. Scoping it to the uploader means the returned asset is one the caller
  created, so nobody gains sight of, or the ability to attach, anything they could not
  before.
- **Trade-off:** the digest of an original telephone photograph is stored. It is not the
  photograph and cannot reproduce it or its GPS; it lets someone who already holds a file
  and can read the database confirm that the file was uploaded — and that reader can
  already see the derived pictures. A second upload of the same bytes with a
  **different** alt text returns the first asset with its first alt text; there is no
  alt-text edit today. An archived asset is not matched, so re-uploading after archiving
  creates a new asset. A concurrent twin that loses the race leaves derived files that no
  row names — the harmless failure mode the A5 upload order already accepts.
- **Revisit when:** alt-text editing arrives (a replay could then update it), or
  deliberate duplicates are ever wanted.

## 2026-09-23 — Uploads stay buffered in memory, and image derivation runs one at a time

**Status:** Accepted — Milestone 9.5 stabilisation

The ≤12 MiB upload stays a memory buffer (multer memory storage); streaming is not
adopted. Derivation (`deriveMedia`) goes through a process-wide FIFO gate of **one**
concurrent derivation (`MEDIA_DERIVE_CONCURRENCY`); later uploads wait holding only
their buffered source.

Measured on synthetic ~50 MP sources (the pixel cap) with sharp 0.34.5, running this
repository's derivation pipeline with 24 libvips threads: one derivation adds
**≈270–290 MiB** RSS (a 50 MP RGBA PNG decodes to ~200 MB); two concurrent add
≈370–480 MiB; four add ≈470–950 MiB. **Peak memory under N concurrent uploads is
therefore about baseline + 290 MiB + N × 12 MiB**, instead of growing by up to
~240 MiB per concurrent upload.

- **Alternatives:** streaming to disk (writes the original, GPS intact — the one file
  the A5 design never creates); streaming into sharp (the decode still needs the full
  bitmap for `rotate()`, so it saves at most the 12 MiB buffer, not the ~200 MB bitmap
  that matters); a lower pixel cap (refuses real telephone panoramas); a gate of two
  (≈480 MiB worst case for twice the throughput nobody needs yet).
- **Reason:** the decoded bitmap, not the 12 MiB buffer, dominates, and only a
  concurrency bound caps it. The buffer is also what keeps the original off disk.
- **Trade-off:** a burst of uploads queues; a worst-case derivation takes seconds, and a
  clinic's staff rarely upload in parallel. Waiting requests keep their buffers; only
  authenticated `media.upload` holders reach the parser, because guards run before the
  interceptor.
- **Revisit when:** uploads are opened to a wider audience, the API runs several
  processes per host, or queueing shows up as web-tier timeouts.

## 2026-09-23 — Follow-up: the legacy therapist photograph path is dropped after its last reader

**Status:** Done 2026-09-25 — see "The legacy therapist photograph path is dropped"

`therapist.public_photo_path` still exists and is still selected by the public team
projection (`PublicTherapistProfile.photoPath`). Agent B removes its last web reader
next; the column, its contract field and the projection's selection then go in one
reviewed, destructive migration owned by the backend lane. See the 2026-09-09 entry
"The legacy therapist photograph path is not split, and not yet removed".

## 2026-09-25 — A photograph's description is correctable, on the asset, behind the publication boundary

**Status:** Accepted — Milestone 9.5 stabilisation

`PATCH /media/:id/alt-text` (`{ altText }`, the upload's `mediaAltTextSchema`) corrects
the description. It is gated by `media.attach`; if the asset is publicly served at that
moment (`assetIsPubliclyServed`, read after a `FOR UPDATE` on the asset, in its own
statement) the service additionally requires `media.publish`, otherwise
`AUTH_FORBIDDEN` (403) — the in-service precedent is the scheduling override. An
unchanged description writes nothing. A change writes `media.alt_text_updated`
(before/after **lengths** and `metadata.isPubliclyServed`). The response is
`{ media, publications }`, where `publications` is the `MediaPublicationIdentity` of every
**live** attachment (read in the mutation transaction), empty when the asset is not
served — so the Web tier invalidates with the existing `invalidateMediaPublication`, and
a receptionist is never handed a draft owner's slug.

- **The description belongs to the asset, not to each attachment.** It says what is in
  the picture, which does not change with placement. Consequence: a photograph used in
  several places has one description, and one correction reaches every page; once any
  one of those uses is live, correcting it is a manager act for all of them.
- **Alternatives:** a per-attachment description (context-specific wording, but a
  second place to forget, and a migration plus a fallback rule for no gain the clinic
  has asked for); requiring unpublish → edit → republish as framing does (three acts and
  a visible gap on the live page, for a typo); letting a same-bytes re-upload overwrite
  the description (a retry would then be a silent edit of public content by whoever
  retried).
- **Reason:** the rule the checkpoint states is exactly the publication boundary the
  rest of the media subsystem already uses; the asset is where the description already
  lives, so no schema change is needed.
- **Trade-off:** the audit trail records that, when and by whom a description changed,
  not the words (a description can name a child and `audit_log` is never pruned — the
  `media.uploaded` rule). The upload retry still returns the existing asset unchanged;
  the correction route is the way to change it. Making an OWNER public does not lock
  the asset, so a receptionist's correction racing a manager publishing the page
  serialises as "corrected, then published" — the ordinary draft-versus-publish race.
- **Revisit when:** the clinic wants different wording for the same photograph in
  different places (then an optional per-attachment override, falling back to the
  asset's), or wants description history visible to staff.

## 2026-09-25 — The legacy therapist photograph path is dropped

**Status:** Accepted — Milestone 9.5 stabilisation

Migration `20260925090000_m95_drop_therapist_public_photo_path` drops
`therapist_public_photo_path_chk` and `therapist.public_photo_path`. **It is
destructive:** any value still in the column is discarded, not migrated — it named a
hand-placed file, not a media asset. `photoPath` is removed from
`PublicTherapistProfile`, `TherapistPublicProfile` and
`UpdateTherapistPublicProfileRequest`; all three are strict, so a stale client that still
sends it is refused with `VALIDATION_FAILED`. No API or Web reader or writer remains
(Web stopped reading it at 34536957; the minimal Web change stops sending it). With it
gone, the manager profile write can no longer change a live page, so it no longer
stamps `public_revised_at`.

- **Alternatives:** keep the column unused (a dead manager-writable public field);
  convert values into media assets (an upload nobody performed, of files not in the
  library).
- **Reason:** a portrait is a `THERAPIST_PROFILE` media attachment; the path was the
  only public therapist field that moved without a publication act.
- **Trade-off:** irreversible for any remaining value; restoring one means re-uploading
  the portrait.
- **Revisit when:** never expected.

## 2026-09-25 — Privacy and consent wording remains developer-maintained and versioned

**Status:** Owner-approved — Milestone 9.5

The privacy-page text and the request-form consent text remain maintained in source by a
developer. They are legal texts, change rarely, and each consent wording is tied to a frozen
consent version. This does not conflict with the rule that routine website content must be
editable without a developer: legal wording and its version boundary are not routine editorial
content.

The owner will supply the final approved wording through the content pack. A developer will
then enter it as an explicit, versioned source change so the words shown for each consent version
remain reviewable and reproducible.

- **Reason:** changing consent words independently of the recorded version would make the stored
  consent ambiguous; source review keeps wording and version changes together.
- **Trade-off:** even a small legal-copy correction requires a developer change and deployment.
- **Revisit when:** legal counsel or the owner requires a staff-managed legal-copy workflow with
  immutable versions, review, approval and a reliable record of which wording each submission
  accepted.

## 2026-09-25 — The API connects as a non-owner runtime role; only migrations run as the owner

**Status:** Accepted — Milestone 10 checkpoint A1

The API and every operator CLI command connect as `clinic_app`, a login whose only
membership is `clinic_runtime`. `clinic_runtime` is `NOLOGIN`, owns nothing and holds the
table privileges migration `20260925120000_m10_a1_runtime_role` grants it — SELECT
everywhere, INSERT/UPDATE/DELETE only where the application's own statements need them,
never TRUNCATE, REFERENCES or TRIGGER, nothing on `_prisma_migrations`, USAGE only on the
one sequence. `clinic_owner` owns the database and runs `prisma migrate deploy`, and
nothing else. Roles are created by `apps/api/prisma/provision-roles.sql`, run once by an
administrator; passwords arrive as psql variables and never enter the repository. The
matrix and the refusals are pinned in `runtime-role.int-spec.ts`; README, Database roles,
has the table.

- **Alternatives:** a migration that creates the role (needs CREATEROLE on the owner, and
  puts a cluster-wide side effect in schema history); an idempotent grants script run
  after each migration (grants drift from the tables they describe); `ALTER DEFAULT
PRIVILEGES` (every future table silently gets the widest shape); column-level UPDATE
  grants mirroring each immutability trigger; a separate role per CLI job.
- **Reason:** grants belong beside the table they describe, in the same reviewed
  migration, and a pinned exact matrix makes an undecided table a CI failure. Table-level
  privileges plus the existing triggers are enough: the triggers remain the one authority
  on which columns change, and a second, column-level copy of those rules would have to
  be kept in step with every column added. Every CLI command runs through the same NestJS
  services as the API, audits the same way, and needs nothing the API does not, so a
  per-job role would restate the same grants.
- **Trade-off:** the runtime still holds UPDATE on tables whose immutable columns only a
  trigger protects — defence there is one layer, as before, but that layer can no longer be
  switched off by the runtime. `appointment_series` holds UPDATE purely because its row is
  locked `FOR UPDATE`. A CLI host is as privileged as the API host. Every new table now
  needs an explicit grant. `user_session` is described as prunable but holds no DELETE,
  because nothing prunes it yet. Integration tests need a second, test-only connection
  string (`TEST_OWNER_DATABASE_URL`) for the reset, and refuse to run the API as anything
  but a least-privilege role. Local `clinic_dev` keeps the container superuser as owner so
  an existing volume needs no ownership rewrite.
- **Revisit when:** a job needs a privilege the API must not have (media erasure, session
  pruning — each widens the matrix in its own migration, or gets its own role); a table's
  protection has to hold against a runtime that already holds UPDATE without a trigger;
  or row-level security is introduced.

## 2026-09-25 — A backup is one encrypted archive of a snapshot-consistent dump and exactly the media its rows refer to

**Status:** Accepted — Milestone 10 checkpoint A2

`scripts/backup/backup.sh` exports one `REPEATABLE READ` snapshot, runs
`pg_dump --snapshot` inside it, and in the same snapshot writes a manifest: every
table's row count and order-independent checksum, every sequence, the catalogue
facts that carry the protections (triggers with their enabled state, constraints,
indexes, function digests, non-owner privileges), and every media storage key the
rows refer to with the SHA-256 recorded in its row. It then copies exactly those
files, checks each hash, and encrypts the lot to an OpenPGP public key as one
`clinic-backup-<UTC>.tar.gpg`. `restore.sh` refuses a non-empty target, checks the
whole archive before changing anything, restores in one transaction, and
`verify.sh` recomputes the manifest on the restored system and exercises the
Milestone 10 A1 refusals from the runtime login. README, Backup and restore, is the
runbook; `drill.sh` runs the whole cycle and eight failure cases in CI.

- **Alternatives:** stop the API (or lock uploads) while copying media; archive the
  whole media directory; physical backups or WAL archiving (`pg_basebackup`,
  pgBackRest) for point-in-time recovery; symmetric encryption with a passphrase on
  the server (`openssl enc`, `gpg --symmetric`); age instead of OpenPGP; comparing
  `pg_dump --schema-only` text instead of catalogue facts; a Node orchestrator
  holding the snapshot through Prisma.
- **Reason:** the API already writes a file before the row naming it commits and
  never deletes one, so "database first, then the files that snapshot names" is
  consistent without stopping anything, and the hash check turns that argument into
  a check. Archiving only referenced files makes "no row refers to missing bytes"
  true by construction. A logical dump restores across servers and minor versions
  and is what a single-site clinic can operate; point-in-time recovery is a
  hosting-stage decision. With public-key encryption the server cannot read its own
  backups, so a compromised server or destination does not expose past ones. GnuPG
  is installed almost everywhere age is not. `pg_dump` text comparison failed on the
  first run: PostgreSQL re-parses a restored CHECK and prints different parentheses.
  A single psql script (`\setenv`, `\!`, `\o`) holds the snapshot without a second
  runtime; driving psql as a coprocess deadlocked on output buffering.
- **Trade-off:** encryption without a signature — anyone with the public key can
  forge an archive that decrypts, so write access to the destination is a trust
  boundary. Unreferenced files (failed uploads) are not backed up. The staging
  directory holds plaintext for the length of a run. The loss window is the backup
  interval. The owner's private key is a single point of failure for every backup;
  the runbook asks for two offline copies. After a restore the web must be built
  against a running API, because public listings are prerendered.
- **Revisit when:** media erasure lands (the purge must not unlink a file while a
  backup may be copying it, or that backup fails — loudly, but it fails); the
  hosting decision offers managed snapshots or object storage; the clinic needs a
  loss window shorter than the backup interval; or the destination is shared with
  anybody who should not be trusted to write to it (sign the archives).

## 2026-09-25 — The backup login reads through `pg_read_all_data`, not per-table grants

**Status:** Accepted — Milestone 10 checkpoint A2

`clinic_backup` (created by `provision-roles.sql` when `backup_password` is given)
is `LOGIN`, `NOSUPERUSER`, holds no other attribute, is a member of
`pg_read_all_data` and nothing else, holds `CONNECT` on the clinic database, and has
`default_transaction_read_only = on`. `backup.sh` refuses to run as any login that
is a superuser, owns the database or anything in it, can become `clinic_owner` or
`clinic_runtime`, may write to any table, or may create objects or temporary tables.

- **Alternatives:** `GRANT SELECT` per table in each migration, like the runtime
  matrix; `ALTER DEFAULT PRIVILEGES` for a backup role; running `pg_dump` as the
  owner.
- **Reason:** the runtime matrix is explicit so that a new table cannot silently get
  write access. For a backup the safe default is the opposite: a table a later
  migration forgot to grant would make `pg_dump` fail on the production server in
  the night, not in CI. `pg_read_all_data` confers `SELECT` and schema `USAGE` only,
  so reading every new table costs no write capability. The owner can drop,
  truncate and disable triggers — exactly what M10 A1 took away from everything but
  migrations.
- **Trade-off:** `pg_read_all_data` is cluster-wide: the login can read any database
  on the cluster it can connect to (`postgres` keeps `PUBLIC` `CONNECT`). Granting it
  needs a superuser or an administrator holding it `WITH ADMIN OPTION`, which some
  managed services do not offer. PostgreSQL 14 or later.
- **Revisit when:** the cluster hosts another application's database, or the hosting
  provider cannot grant predefined roles — then per-table grants in a migration,
  pinned by the integration suite like the runtime matrix.

## 2026-09-25 — `audit_identifiers_masked` pins its search_path, because no backup of this schema could be restored

**Status:** Accepted — Milestone 10 checkpoint A2 (defect found by the restore drill)

The first drill's restore failed on the first nested audit row:
`audit_log_identifiers_masked_chk` calls `audit_identifiers_masked(jsonb)`, which
calls itself by an unqualified name, and pg_restore loads data with an empty
`search_path`. The CHECK raised, the single-transaction restore rolled back, and
every backup this schema had produced would have failed the same way. Migration
`20260925130000_m10_a2_restorable_audit_mask` sets the function's `search_path` to
`pg_catalog, public`; `families-constraints.int-spec.ts` now evaluates it with an
empty path.

- **Alternatives:** rewrite the body with `public.`-qualified recursion; restore
  with the constraint dropped and re-added, or with triggers disabled.
- **Reason:** a one-line `ALTER` leaves the reviewed body untouched, and a restore
  must load the data under the constraints that protect it, not around them.
  `public` is writable only by the owner, so naming it cannot be used to substitute
  a function. The only other function a CHECK calls, `fa_normalize`, uses
  `pg_catalog` builtins alone.
- **Trade-off:** a function with a `SET` clause cannot be inlined; it is PL/pgSQL and
  never could be.
- **Revisit when:** a new function is called from a CHECK, an index expression or an
  exclusion constraint — it must resolve every name under an empty `search_path`.
  The CI drill fails if one does not.

## 2026-09-25 — Backup destination, schedule and retention wait for the owner, and retention decides how long erased data survives

**Status:** Open — Milestone 10 checkpoint A2 (owner decision required)

`backup.sh` takes the destination, the recipient key and a retention period in days
from the environment, with no defaults, and prunes only after a successful backup.
Scheduling waits for the hosting decision; README gives the requirements (a user
that can read the media, a root-only environment file, an alert on a non-zero exit).

- **Blocked on:** where archives are kept (off-server, and who can write there), how
  often they are taken (the loss window), how long they are kept, and who holds the
  private key.
- **Privacy interaction:** a backup keeps website requests that the ninety-day rule
  later erases, and any other erased or corrected value, until the backup itself is
  removed. A request's content really lives for ninety days after closing, plus the
  gap before the purge runs, plus the backup retention period; a restore brings
  erased requests back until the purge runs again, which the runbook does before the
  system is used. The privacy notice and the retention period have to be decided
  together.

## 2026-09-26 — Owner: nightly backups kept 30 days, collected by a clinic computer, copied monthly to a drive

**Status:** Accepted — owner decision, Milestone 10 checkpoint A2 revision. Resolves
"Backup destination, schedule and retention wait for the owner" (2026-09-25).

- **Retention:** 30 days (`BACKUP_RETENTION_DAYS=30` on the server; `RetentionDays: 30`
  on the clinic computer).
- **Schedule:** nightly (`scripts/backup/systemd/clinic-backup.timer`, 02:30 Tehran,
  `Persistent=true`).
- **Privacy:** the privacy notice will state the backup retention alongside the
  ninety-day website-request retention. The wording is the owner's and legal's, not
  the code's. Consequence to state: a request's content can survive about four months
  after closing (90 days + the purge interval + 30 days, or up to about a month on the
  external drive).
- **Off-site copy for the pilot:** a clinic computer that collects backups
  automatically, plus a monthly copy to an external drive kept by the manager. Cloud
  object storage will likely be added before public launch, **as configuration only**.
- **Open, and flagged:** the external drive is replaced monthly, so its copy can be a
  little over 30 days old before it is replaced; the privacy wording should allow
  "about a month" rather than exactly 30 days, or the manager should replace it more
  often.

## 2026-09-26 — Every archive is signed by the server, and restore refuses one it did not sign

**Status:** Accepted — Milestone 10 checkpoint A2 revision

`backup.sh` signs and encrypts in one OpenPGP message with a signing key that exists
only on the server (`BACKUP_SIGNING_KEY_DIR`, no passphrase, `clinic-backup` only).
`restore.sh` and `verify.sh` require `RESTORE_SIGNER_KEY_FILE` — the server's public
signing key, kept off-server with the decryption key — and refuse an archive with no
signature, a bad one, or a good one from any other key, before anything is restored.
The drill proves both planted cases: the genuine content correctly encrypted to the
owner, once unsigned and once signed by another key.

- **Alternatives:** a detached signature or an HMAC beside each archive; signing with
  the owner's offline key (impossible unattended); trusting the destination instead of
  the archive; `age`, which has no signatures.
- **Reason:** sign-then-encrypt is one standard operation in the tool already in use,
  and the check is made by a key the attacker who plants a file does not hold. Keeping
  the verification key off-server means a compromised destination or clinic computer
  cannot swap it. A detached file could be separated from its archive; an HMAC needs
  the same secret on both sides.
- **Trade-off:** whoever controls the server can sign; the signature proves origin,
  not the server's health. Losing the public signing key while the server is also lost
  blocks every restore until a developer deliberately bypasses the check, so the owner
  keeps two copies with the decryption key. A replacement server gets a new signing
  key, and old archives need the old public key.
- **Revisit when:** backups go to shared cloud storage (consider signing with a key held
  in a hardware token), or the server is run by a third party.

## 2026-09-26 — The clinic computer pulls backups over SSH through a forced command, on a Windows schedule

**Status:** Accepted — Milestone 10 checkpoint A2 revision

The server runs `collector-serve.sh` as the forced command of a key-only
`clinic-collector` login (`restrict` in `authorized_keys`, and a `Match User` block
with `ForceCommand` in `sshd_config`). It answers exactly `list`, `get <archive>` and
`ack <archive>`, and refuses anything else, including any name that is not a generated
archive name. The login has no database role, cannot read the media, and holds only
group read on the archives: it cannot delete or alter one even outside its command.
On the clinic computer — **assumed Windows 10 or 11**, with the built-in OpenSSH client —
`install-collector.ps1` registers a scheduled task running `collect-backups.ps1` as
SYSTEM at every start-up and hourly: download to `.partial`, SHA-256 check, rename,
`ack` the newest held, expire its own copies after 30 days. Staff do nothing.

- **Alternatives:** the server pushes to the computer (needs an inbound port at the
  clinic and a computer that is on at night); a Windows file share the server writes
  to; a cloud sync client; an HTTPS download route in the API; `rsync`/`sftp`, which
  would need an SFTP subsystem the forced command cannot narrow as tightly.
- **Reason:** a pull needs nothing open at the clinic and works whenever the computer
  happens to be on. SSH is built into both systems and a forced command narrows the
  credential to three verbs checked by one short script, with file permissions as a
  second wall. Keeping downloads out of the API keeps backup bytes away from the
  process that serves the public.
- **Trade-off:** every night downloads a full backup (about 80 MB at launch, about
  450 MB after a year of photographs). The drill exercises the forced command and the
  PowerShell collector through a local stand-in for SSH; `sshd` configuration itself is
  documented, not tested in CI. The installer was not run in this session (it changes
  the machine's scheduled tasks).
- **Revisit when:** the nightly download is too large for the clinic's connection
  (collect media incrementally), or cloud storage is added (the server uploads, and the
  collector may be retired or kept as a second copy).

## 2026-09-26 — The manager sees a stale off-site copy through one read, with no new permission

**Status:** Accepted — Milestone 10 checkpoint A2 revision (web half handed to Agent B)

Each `ack` writes `offsite-collection` (archive, collected at, newest on the server) to
`BACKUP_STATUS_DIR`. `GET /operations/backup-status`, under `user.read`, reads that one
file and reports the age of the newest off-site copy, measured from when that backup
was **taken**. Past 72 hours it is `STALE`; not configured, never collected and
unreadable are warnings too. The screen is `docs/M10_A2_BACKUP_STATUS_WEB_HANDOFF.md`.

- **Alternatives:** measure from the time of collection (misses a server that stopped
  backing up while the computer keeps collecting the same old file); a Windows
  notification on the clinic computer (silent exactly when the computer is off);
  email or SMS (no such channel in the product); a new `backup.read` permission.
- **Reason:** one age covers both silent failures. The dashboard is where the manager
  already looks. `user.read` is the manager-only name for system oversight; a new
  permission would be vocabulary for one read of two timestamps and would widen
  nothing either way.
- **Trade-off:** the API reads one file outside the media root; the collector can write
  that file, so a compromised collector key could claim a copy it does not hold (it
  still could not touch a backup). No warning appears until the web half ships.
- **Revisit when:** cloud storage is added (report the newest object there too), or a
  second collector exists.

## 2026-09-26 — Owner: media and testimonial retention

**Status:** Accepted — owner decision, Milestone 10 checkpoint A3. Resolves "Media
retention is deliberately undecided" (2026-09-08).

- **Uploaded, never attached anywhere:** the bytes are erased 30 days after upload.
- **Archived by a manager:** restorable for 30 days, then the bytes are erased.
- **A family withdraws testimonial consent:** the manager takes it off the site at once;
  the photograph(s) and the testimonial's words are erased within 7 days. The audit
  trail keeps that it happened, never the erased content.

Implemented as the nightly `MEDIA_ERASURE` and `TESTIMONIAL_ERASURE` jobs (below). The
constants are in `@clinic/contracts` (`MEDIA_UNATTACHED_ERASURE_DAYS`,
`MEDIA_ARCHIVED_ERASURE_DAYS`, `TESTIMONIAL_CONSENT_ERASURE_DAYS`) and, independently, in
the database's erasure guard.

## 2026-09-26 — Erasure is of the bytes, in place, and the database refuses one that is not due

**Status:** Accepted — Milestone 10 checkpoint A3

A photograph's erasure clears `master_storage_key` and every rendition's `storage_key`,
stamps `bytes_purged_at`, removes the files and writes `media.bytes_erased` (actor
`SYSTEM`, `metadata.rule` only). The asset row stays in the library. A testimonial's
erasure clears `body` and `author_label`, stamps `content_erased_at` and writes
`public_testimonial.content_erased` with an empty payload; its photographs go in the same
transaction. Migration `20260926090000_m10_a3_scheduled_jobs_and_erasure` adds
`media_asset_erasure_is_due` (the owner's three rules in SQL), `media_asset_erasure_guard`,
`media_rendition_erasure_only`, `public_testimonial_withdrawal_chk`,
`public_testimonial_erasure_chk` and `public_testimonial_withdrawal_is_final`: an erasure
the database does not consider due is refused, both acts are final, and an erased
photograph cannot be restored, attached or published (`MEDIA_NOT_FOUND`).

- **Alternatives:** delete the rows (lifting `no_delete`); erase text immediately in the
  manager's transaction; erase only the photographs currently attached to a withdrawn
  testimonial; a new `MEDIA_ERASED` error code.
- **Reason:** the `website_request` precedent — the row says something existed and when
  its content went, and nothing it contained. One nightly routine erases words and
  photographs together, under the lock that keeps backups whole. "Ever attached" is the
  privacy-safe reading: a photographed handwritten note detached last month is still the
  family's. A new error code would fail the Web's translation test until Agent B adds the
  Persian; the library already shows `bytesPurgedAt`, which says why.
- **Trade-off:** a photograph that was ever attached to a withdrawn testimonial is erased
  everywhere, including another page that uses it. **The description (`alt_text`) is kept**
  after erasure: it was written for a public screen reader, but it can name a child, and
  erasing it needs `altText` to become nullable in the media contract (a coordinated Web
  change) — open, below. A withdrawal cannot be undone; the Web must confirm before sending
  it. Withdrawals recorded after the newest backup are lost with the server, like any other
  entry in the loss window, and must be recorded again after a restore.
- **Revisit when:** the owner decides descriptions go with the bytes; or a policy needs rows
  as well as bytes to go.

## 2026-09-26 — Media erasure and the backup share one advisory lock

**Status:** Accepted — Milestone 10 checkpoint A3. Resolves the A2 revisit trigger ("the
purge must not unlink a file while a backup may be copying it").

`backup.sql` takes `pg_advisory_lock_shared(4919, 10)` before its snapshot and holds it —
session-level — until `copy-media.sh`, now run inside the same psql session, has copied the
last file. Every erasure transaction first takes the same lock exclusively with
`pg_try_advisory_xact_lock` and commits while holding it; the files are unlinked after the
commit. So no erasure commits while a backup could still need its files, and every backup
starting later reads a snapshot in which the keys are already gone. If a backup holds the
lock, the job waits up to 30 minutes, then leaves the rest for the next night and does not
count as a success. A crash between commit and unlink is repaired by the next run's sweep of
erased assets' directories. `media-erasure.service.spec.ts` pins that both sides name the
same keys; `scheduled-jobs.int-spec.ts` proves the deferral with a held lock.

- **Alternatives:** stop the API during a backup; unlink first and commit after; a lock
  file shared through the filesystem (`flock`); erase only files older than the longest
  possible backup; a pending-unlink table.
- **Reason:** both sides already talk to PostgreSQL, and an advisory lock needs no
  privilege, works in the backup's read-only session and is released if either process
  dies. Commit-then-unlink never leaves a row naming a missing file (which would fail the
  next backup); the sweep covers the opposite crash. The two-key form is a lock space
  nothing else in the application uses.
- **Trade-off:** a backup can wait a few milliseconds for an erasure transaction; an erasure
  can wait up to 30 minutes for a backup. The media copy now runs inside `psql`'s `\!`, so
  its output interleaves with psql's.
- **Revisit when:** backups move to filesystem or volume snapshots, or media move to object
  storage (versioned buckets replace the lock).

## 2026-09-26 — The nightly jobs run as the API's login, and two grants are narrowed by triggers

**Status:** Accepted — Milestone 10 checkpoint A3. Answers the A1 revisit trigger ("a job
needs a privilege the API must not have").

`cli run-jobs` runs `WEBSITE_REQUEST_PURGE`, `SESSION_PRUNE`, `TESTIMONIAL_ERASURE` and
`MEDIA_ERASURE` in that order from `scripts/ops/systemd/clinic-jobs.timer` (04:15 Tehran,
`Persistent=true`), as the API's OS user and `clinic_app`. `clinic_runtime` gains `DELETE`
on `user_session` — refused by `user_session_prune_only_ended` for any session not over for
30 days — and `UPDATE` on `media_rendition` — refused by `media_rendition_erasure_only` for
anything but the erasure of a due photograph — plus `SELECT, UPDATE` on the new
`scheduled_job`. Each job re-checks eligibility under a row lock and is safe to run twice or
concurrently. A job that completes all its work moves `scheduled_job.last_succeeded_at` and
writes `scheduled_job.succeeded` (counts only) in one transaction; one that fails or leaves
work for later writes neither. `GET /operations/job-status` (`user.read`) reports each job
as `OK`, `STALE` (no success for 48 hours) or `NEVER_RUN`.

- **Alternatives:** a separate `clinic_maintenance` role and login for the jobs; a
  scheduler inside the API process; a job-run history table; reading the last success from
  `audit_log`; per-session audit rows for pruning.
- **Reason:** the A1 decision already runs every CLI command through the API's services as
  the API's login; a second role would restate the whole matrix to add two lines, and a
  trigger narrows each grant to exactly the job's act, for the owner as well. A scheduler in
  the web-facing process would keep a destructive loop in the process that serves the
  public; systemd already runs the backup. A four-row table is the fast read; the audit
  trail is the history. A session's creation and revocation are already audited, so its
  removal is a count.
- **Trade-off:** the web-facing API also holds the two narrowed grants; a compromised API
  could erase a photograph the owner's rules already make due, or remove a long-dead
  session, and nothing else. A job that fails is visible to the manager after two days, not
  at once.
- **Revisit when:** a job needs something a trigger cannot narrow, or jobs need their own
  alerting channel.

## 2026-09-26 — Staff sessions are removed thirty days after they end

**Status:** Accepted — Milestone 10 checkpoint A3 (technical)

A session is over at the earliest of its absolute expiry, idle expiry and revocation; the
nightly `SESSION_PRUNE` deletes it 30 days later (`SESSION_PRUNE_AFTER_DAYS`, and the same
window in `user_session_prune_only_ended`).

- **Alternatives:** delete as soon as it ends; keep for a year.
- **Reason:** a month keeps "was this session live when X happened?" answerable during an
  incident; the acts a session performed are in `audit_log`, which names it by UUID with no
  foreign key, for ever.
- **Revisit when:** an incident needs session metadata older than a month.

## 2026-09-26 — A withdrawn testimonial leaves every staff read, and one dates-only read remains

**Status:** Accepted — Milestone 10 checkpoint A3

`POST /content/testimonials/:id/consent-withdrawal` (`testimonial.approve`, manager-only,
no body, `204`, idempotent) revokes the approval, unpublishes and stamps the withdrawal.
From then on the testimonial is `TESTIMONIAL_NOT_FOUND` to list, get, edit, approve,
publish and attach. `GET /content/testimonials/consent-withdrawals` (`testimonial.read`)
lists each withdrawal's id, when it was withdrawn, when its content was erased and the
seven-day due date — never its words, attribution, kind or picture.

- **Alternatives:** a discriminated union on the existing testimonial reads, as
  `website_request` does for purged requests; a `reason` field.
- **Reason:** the lifecycle record stays visible (the `website_request` argument), while the
  existing `Testimonial` contract is untouched — changing it would break the Web's
  typecheck and tests in Agent B's lane. The reason is the family's and is the act itself.
- **Trade-off:** two reads for one table.
- **Revisit when:** the Web's testimonial screens are next reworked; the union may then be
  simpler.

## 2026-09-26 — A testimonial's attribution is audited as a length, from now on

**Status:** Accepted — Milestone 10 checkpoint A3. Supersedes the part of the Milestone 9
A2 design that recorded `authorLabel` in full in `audit_log`.

`public_testimonial.*` audit payloads now carry `authorLabelLength` instead of
`authorLabel`, as they always carried `bodyLength` instead of `body`.

- **Reason:** the owner's rule for a withdrawal is that the trail keeps that the content
  was erased, never the content, and `audit_log` can never be changed. The erasure test
  found the label surviving there.
- **Trade-off:** a reviewer can no longer read, after the fact, which attribution was
  approved; the row itself holds it, frozen from approval until erasure. **Rows written
  before this change still hold labels.** If real testimonials were entered before this
  deploys, removing those labels means rewriting append-only audit rows — an owner decision.
- **Revisit when:** never, while consent can be withdrawn.

## 2026-09-26 — Readiness is a public route that says two words per check

**Status:** Accepted — Milestone 10 checkpoint A3

`GET /health/ready`, public like `/health`, answers `200 {status: "ok", checks: {database:
"ok", media: "ok"}}` or `503` with `unavailable` on the failing check, `no-store`. The
database check is `SELECT 1` with a 2-second timeout; the media check is a real write and
remove of one fixed probe file in the media root, which it never creates. Concurrent probes
share one check and a result is reused for 2 seconds. A failure's kind is logged once per
change of state. The deployment and restore runbooks and the drill use it.

- **Alternatives:** make `/health/db` public; require the internal key; report latency and
  versions.
- **Reason:** the runbooks and an outside monitor must not hold a credential; two words per
  check tell an operator where to look and tell an attacker nothing they could not learn
  from a slow page. `access(W_OK)` misses a full disk or a read-only remount.
- **Trade-off:** an anonymous caller can make the API do one query and one small write
  every two seconds. The API is not public; the Web's `/api/health` should forward it
  (Agent B).
- **Revisit when:** the API is exposed beyond the private network.

## 2026-09-26 — Logs carry an error's kind, never its message, and no username or address

**Status:** Accepted — Milestone 10 checkpoint A3

`describeError` logs an unexpected error's class, driver code, SQLSTATE, constraint name and
errno, and `stackFrames` its stack without the message line; nothing logs an exception
message except `AppError` (fixed developer text) and `EnvConfigError` (variable names). This
covers the error filter, API start-up, the DB health check, the backup-status read and the
CLI. The security log is `event`, `reason` and `requestId` only — the attempted username
and client address are gone. Logs go to journald, bounded by
`scripts/ops/systemd/journald-clinic.conf` (1 GB, one month). `log-hygiene.int-spec.ts`
captures every line during a failed sign-in, a forged session, an upload, a public request
and a failure full of a family's details, and finds none of them.

- **Alternatives:** keep messages and extend `redactSecrets`; log a keyed pseudonym of the
  address; logrotate on files.
- **Reason:** PostgreSQL row details, Prisma call arguments and JSON parse errors put
  personal data in messages, and no redaction can recognise a name. The request id joins a
  log line to the audit row, which holds the facts under its own rules. journald is where
  systemd already sends every process's output.
- **Trade-off:** a production error is harder to diagnose without its message; reproduce it
  with the request id and the constraint name. Repeated failed sign-ins from one address can
  no longer be correlated from the API log.
- **Revisit when:** a brute-force signal is needed (a keyed pseudonym, not the address).

## 2026-09-26 — Open (owner): photo descriptions after erasure, and pre-existing audit labels

**Status:** Resolved — both answered by the owner at the A3 close-out (entries below).
Originally Open — Milestone 10 checkpoint A3

1. **Descriptions.** An erased photograph keeps its `alt_text`. Recommendation: erase it
   with the bytes (it can name a child). Needs `altText` nullable in the media contract and
   the Web to handle it — a coordinated change with Agent B.
2. **Audit labels written before A3.** If real testimonials exist before this deploys,
   their audit rows hold the attribution in full. Leaving them is the default; removing them
   is a reviewed rewrite of append-only rows.

## 2026-09-26 — Owner: GitHub CI is not a gate; local full runs are the evidence

**Status:** Accepted — owner decision, Milestone 10 A3 close-out

GitHub Actions results do not gate a checkpoint and old failed runs are not repaired. The
required evidence is a local full run — the check set, the full integration suite and, for
backup changes, the restore drill — with its output pasted in the report. CI keeps running
and stays useful as a second opinion.

## 2026-09-26 — Owner: the restore drill runs locally, in a throwaway Linux container

**Status:** Accepted — owner decision, Milestone 10 A3 close-out

The owner approved the official PostgreSQL 17 client tools for the drill and chose a
throwaway Docker container over the WSL distribution for everything else it needs. The drill
cannot run on Windows itself: `backup.sql` uses psql's `\!`, which Windows psql runs through
`cmd.exe`, where `$VARIABLE` is not expanded — production and CI are Linux. The runner is
`node:24-bookworm` plus `postgresql-client-17` from the PGDG apt repository and PowerShell 7,
on a private Docker network with two empty `postgres:17-alpine` clusters, running
`scripts/backup/drill.sh` as the unprivileged `node` user on an export of the commit under
test (`git archive`). All of it is removed afterwards.

## 2026-09-26 — Owner: a photograph's description is erased with its bytes (queued)

**Status:** Accepted — owner decision, Milestone 10 A3 close-out. Implemented 2026-09-30 in
Milestone 9.5 checkpoint A10 (entry below). Resolves item 1 of "Open (owner): photo
descriptions after erasure".

When a photograph's bytes are erased, `alt_text` is erased too. It needs `altText` nullable
in the media contract and every Web surface that renders it to handle `null` — a
coordinated change with Agent B.

## 2026-09-26 — Owner: testimonial audit rows written before A3 keep their attribution

**Status:** Accepted — owner decision, Milestone 10 A3 close-out. Resolves item 2 of
"Open (owner): photo descriptions after erasure".

They exist only in synthetic development databases; production starts from an empty
database, so every production audit row is written by code that records the attribution as a
length. No append-only row is rewritten.

## 2026-09-26 — Owner: the server runs in UTC, and business time is Asia/Tehran, explicitly

**Status:** Accepted — owner decision, Milestone 10 A3 close-out

The production server runs in UTC. Every business-date decision — appointment day, charge and
payment dates, day and month boundaries in reports, settlement periods and their close, the
retention clocks, the backup and job schedules — is made in Asia/Tehran explicitly and never
by relying on the host, process or database-session timezone.

**Verified at the close-out.** It already holds; no application defect was found:

- Business dates are decided in SQL by four functions that name `Asia/Tehran` themselves —
  `clinic_date`, `clinic_day_start`, `clinic_moment`, `clinic_clock_time` — and every other
  date in SQL is a `DATE` column or a `'YYYY-MM-DD'` cast. No `CURRENT_DATE`, no
  `timestamptz::date`, no `date_trunc`, `EXTRACT` or `to_char` on a `timestamptz` exists in
  the application's SQL or the migrations.
- The Node side never takes a business date from the process clock; `DATE` values cross it as
  digits (`iso-date.ts`, pinned under several zones by `iso-date.spec.ts`).
- The retention clocks (90 and 30 days) and session expiry are intervals between instants,
  which no zone changes. The timers name `Asia/Tehran` in `OnCalendar`.
- The full integration suite passes with the process in UTC and the database session in UTC
  (a cluster started without `TZ`), and in local Tehran time, on the same commit.

**The regression guard** is `clinic-time-boundaries.int-spec.ts`: the database session is
forced to `Pacific/Kiritimati` (UTC+14) for every connection the API opens, and sessions at
23:00 and 00:15 Tehran — on the last night of Jalali 1404 and at a Gregorian month end, where
00:15 Tehran is still the previous day in UTC — are followed through the diary, the charge
the completion posts and the session report. Replacing `clinic_date` with a session-zone cast
makes it fail (checked). README, Checks, asks for the suite in both zones before a milestone
closes.

**The M4–M8 CI failure is not reproduced, and is not this.** `main` at M8 (`27d9a37`), run
exactly as its CI job ran — `postgres:17-alpine` with no `TZ`, the superuser connection,
`TZ=UTC`, Node 24 — passes 1760 of 1760 integration tests, run between 22:39 and 22:58 UTC,
inside the daily window when UTC's date and Tehran's differ. The failed runs' logs are not
readable from this machine (private repository, no token), so the cause is unknown; a pasted
log of one failed run would settle it.

- **Alternatives:** pin `TZ=Asia/Tehran` for the process (forbidden by the owner, and it
  would hide the class of defect rather than prevent it); set the database's timezone to
  Tehran in provisioning (the same, one layer down).
- **Revisit when:** any business date is computed outside those four functions, or the
  clinic ever operates in a second timezone.

## 2026-09-30 — No public projection carries an internal identifier

**Status:** Accepted — Milestone 9.5 checkpoint A10 (coordinator D2, defence in depth)

`PublicImage.mediaId` is removed from `@clinic/contracts` and from the API projection. A
visitor-facing response identifies a photograph only by its rendition paths
(`media/<renditionId>`), which are the addresses of its bytes. Every public read was
checked — services, team, articles, testimonials, spaces, clinic content, clinic profile,
sitemap and the request submission: apart from slugs, a content-slot enum and
`received: true`, nothing in them identifies anything, and no other internal id was found.
The error envelope's `requestId` stays: it is a per-request correlation id for support,
not a record id. The API groups renditions by asset internally and never emits the key.

- **Alternatives:** keep `mediaId` in the contract and rely on the Web tier stripping it
  (B9's `stripPublicInternalIds`); a separate opaque public handle.
- **Reason:** a strict schema is where "the public never sees this" is enforced; a strip at
  one consumer protects only that consumer. No public page needs a stable key the paths
  do not already give.
- **Trade-off:** a public list is keyed by a rendition path, which changes when the
  photograph is replaced — the right behaviour for a key over rendered bytes.
- **Revisit when:** a public feature genuinely needs to recognise one photograph across
  replacements (none planned).

## 2026-09-30 — A photograph's description is erased with it (implementation)

**Status:** Accepted — Milestone 9.5 checkpoint A10. Implements the owner decision of
2026-09-26.

The erasure (`MediaErasureService.eraseLocked`, used by the nightly retention rules and by
testimonial consent withdrawal) clears `alt_text` in the statement that stamps
`bytes_purged_at`. Migration `20260930090000_m95_a10_erase_media_description` makes
`alt_text` nullable, lets `media_asset_erasure_guard` accept the description as the third
column an erasure changes, clears the description of every photograph already erased
(**destructive for those rows**; production has not yet run an erasure), and adds
`media_asset_description_erasure_chk` — `alt_text IS NULL` exactly when
`bytes_purged_at IS NOT NULL`. `MediaAsset.altText` is `string | null`. Correcting the
description of an erased photograph is `MEDIA_NOT_FOUND`, like attaching, publishing or
restoring it. The audit trail keeps only `media.bytes_erased` with its rule; it never held
the words (`media.uploaded` and `media.alt_text_updated` record lengths).

- **Alternatives:** replace the description with a fixed placeholder (keeps the column
  NOT NULL, but a placeholder is a fake description a screen reader would read); keep it
  (rejected by the owner).
- **Reason:** null is the honest state, and a CHECK in both directions makes an erased
  photograph with words, or a live one without, impossible whatever the caller.
- **Trade-off:** staff can no longer tell what an erased photograph showed; they still see
  that it existed, when it arrived and went, and where it was used. Backups taken before
  the erasure still hold the words until they age out.
- **Revisit when:** a policy needs the asset row itself removed.

## 2026-09-30 — Published media is `private, no-cache`: immediate revocation at the Web origin, cheap revalidation

**Status:** Accepted — Milestone 9.5 checkpoint A10 (media contract owner). Supersedes the
2026-09-08 five-minute revocation window.

`PUBLIC_MEDIA_CACHE_CONTROL = 'private, no-cache'` replaces
`PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS` and `PUBLIC_MEDIA_MAX_AGE_SECONDS`. The API sets
it on `200` and `304`; the Web media route forwards it unchanged and re-asks the API on
every request (B9's D1 fix already does the latter). A visitor's browser may store the
bytes but must revalidate every reuse; no shared cache may store them. A revalidation
carries the content-hash `ETag`, runs the full servability check, and a match answers
`304` without reading the file (the API now reads bytes only when it must send them). A
revoked image answers `404 no-store`.

- **Alternatives:** A5's `max-age=300` (a revoked image stays visible from the browser
  cache, and from any Web cache, for up to five minutes); B9's interim `no-store` (every
  view re-downloads every image); `public, no-cache` (would let a shared cache hold a copy).
- **Reason:** the target is immediate revocation at the clinic's own domain and cheap
  repeat views; `no-cache` plus a strong `ETag` gives both, at one indexed query and a few
  hundred bytes per image per view.
- **Trade-off:** every image view is a round trip, even when unchanged; on a slow mobile
  link that is latency a `max-age` would have avoided. Copies that have already left are
  still bounded by nothing.
- **Revisit when:** a CDN is put in front of the site (then `public, no-cache` with a CDN
  that honours it), or pilot measurements show revalidation latency hurts LCP.

## 2026-09-30 — The team-card thumbnail uses the smallest rendition

**Status:** Accepted — coordinator, Milestone 9.5 A10

The 96 px team-card portrait slot is served from the smallest rendition (320 px wide,
about 14 KB). No smaller rung is added to `MEDIA_RENDITION_WIDTHS`.

- **Alternatives:** a 96/192 px rendition rung.
- **Reason:** the saving is a few kilobytes per card; a new rung is derived for every
  photograph, stored on disk and carried in every backup.
- **Trade-off:** a team page downloads somewhat more than the slot strictly needs.
- **Revisit when:** a page shows enough thumbnails that the difference is measurable.

## 2026-09-30 — Gate steps 10–11 and the D4 first-image check move to the pilot server

**Status:** Accepted — coordinator, Milestone 9.5 A10

The Milestone 9.5 gate's CLS/LCP measurement (step 10), the mobile visual check (step 11)
and the D4 first-image check are deferred to the pilot server, measured there with a real
phone and a public measurement tool. A development machine's numbers do not describe the
clinic's visitors' network or devices.

- **Alternatives:** measure locally with throttling (not representative); skip them.
- **Trade-off:** those checks cannot pass before the pilot server exists; the milestone
  gate records them as deferred, not passed.
- **Revisit when:** the pilot server is up — they are then the first measurements taken.

## 2026-10-01 — The route × role matrix is generated from the decorators and pinned

**Status:** Accepted — Agent A, Milestone 10 A5

`docs/PERMISSION_MATRIX.md` is rendered from the route decorators and `ROLE_PERMISSIONS` by
`apps/api/src/auth/route-access-matrix.ts` and compared byte for byte by a unit test. Every
route that requires no permission is listed in `OPEN_ROUTES` with its reason; every
in-handler permission check is listed in `IN_HANDLER_AUTHORITY`; every controller has a
product area. A new route, a changed requirement or an unrecorded open route fails the test.

- **Alternatives:** a hand-written matrix (drifts on the first change); an HTTP probe of every
  route per role (needs a database and fixtures for 169 routes, and proves the same guard rule).
- **Reason:** the guard chain is deterministic over the decorators, so applying its rule to
  the metadata is exact, runs without a database, and cannot disagree with the guards unless
  the guards change.
- **Trade-off:** the generated file is excluded from Prettier, and regenerating it is a manual
  step in a change that touches routes.
- **Revisit when:** a guard decides on something other than the decorators and the role map.

## 2026-10-01 — The practice clinic acts through services, checked against the matrix

**Status:** Accepted — Agent A, Milestone 10 A5

The two-month simulation calls the domain services the routes call, parses every request with
the route's contract schema, and before each act checks that the acting role could make the
call over HTTP according to the route × role matrix. Its expected figures come from its own
price list and share rules; the reconciliation re-derives the money rules without importing
ledger, settlement or report code, and compares the book, base rows and the application's
answers.

- **Alternatives:** drive it over HTTP with real sessions (closest to the browser, but the dev
  binary would need a listening server, passwords for every account and a forced password
  change first); raw SQL fixtures (forbidden: a second implementation of the domain).
- **Reason:** the services are what the controllers call after the guards and pipes, the
  guard decision is reproduced exactly by the matrix, and the same code then serves the test
  and the practice environment.
- **Trade-off:** controller-level response shaping is not exercised by the simulation; it is
  covered by the per-route integration suites.
- **Revisit when:** a controller starts doing domain work beyond calling its service.

## 2026-10-01 — Open (owner): permission findings from the A5 review

**Status:** Open — for the owner; nothing was changed

Eight findings are listed in `docs/M10_A5_PERMISSION_REVIEW.md` §1: (1) a receptionist can
deactivate a family that owes money and the default family-balances report then omits it;
(2) recording a testimonial consent withdrawal is manager-only although it arrives at the
desk; (3) every desk correction (payment void, charge void, reopen) needs the manager the same
day; (4) every discount, including a standing one, needs the manager; (5) a therapist's day
off can only be entered by the manager; (6) a missing price blocks charging until the manager
adds it; (7) the receptionist's end-of-day check covers only their own entries; (8) backup and
job status reuse `user.read`. (1) affects money visibility and is recommended before go-live.

## 2026-10-01 — Money never disappears from a report because of a family's status

**Status:** Accepted — owner decision (A5 finding 1); implemented by Agent A, Milestone 10 A6

Owner: money must never disappear from a report because of a family's status. A receptionist
may still deactivate a family, but not silently while it owes money or holds credit.

- **Reports:** the family-accounts report and its CSV list, by default, every active family
  **and** every inactive family whose derived position is non-zero (amount due or credit). Each
  row carries `family.status`; the file carries it in a column beside the name.
  `includeInactive=true` now adds only inactive families standing at zero, so the two sums and
  the owing/in-credit counts are identical with and without it. Every other money summary was
  checked and already ignores family status (list in `docs/M10_A6_WEB_HANDOFF.md`).
- **Deactivation:** `PATCH /families/:id/status` to `INACTIVE` on a family with a non-zero
  position is refused `409 FAMILY_BALANCE_UNACKNOWLEDGED`, details `{ amountDueToman,
creditToman }` (the account's own derivation, read after the family row is locked). The
  caller resends with `acknowledgedBalance` equal to those figures; a mismatch (the balance
  moved) is refused again with the new figures. Success writes `family.status_changed` and
  `family.deactivated_with_balance` (metadata: the two amounts). A zero-balance family is
  unchanged. Same route, same permission (`family.update_status`, both roles).
- **Alternatives:** block deactivation outright while a balance exists (the owner chose
  acknowledgement); make deactivation manager-only (more desk friction, does not fix the
  report); show inactive families always (lists settled families nobody needs).
- **Reason:** the report rule is the guarantee — it holds whatever happens after deactivation
  (a later void can create a balance on an inactive family); the acknowledgement is the warning
  in front of it, and an amount the person saw is the only thing worth auditing.
- **Trade-off:** a void or concession does not lock the family row, so it can change the
  balance between the read and the commit of a deactivation; the acknowledgement then records
  the amount as read. The family stays visible either way and the void is audited on its own.
- **Revisit when:** the clinic wants inactive families with open promises or future bookings
  treated the same way, or the family search (which carries no money) to surface them.

## 2026-10-01 — How the server is installed, and its size

**Status:** Accepted — Agent A, Milestone 10 A7 (staging rehearsal); server size for the owner to confirm

- **Decision:** one Ubuntu 24.04 LTS server installed by `docs/DEPLOYMENT_RUNBOOK.md`:
  PostgreSQL 17 (PGDG) on localhost, Node 24 (NodeSource), nginx as the only way in, API and
  web as systemd services under their own users (`clinic-api`, `clinic-web`), code owned by
  a separate `clinic-build`, secrets in four root-owned files in `/etc/clinic` each readable
  by one user, migrations and operator commands through `systemd-run` so no secret passes
  through a shell. Size: **2 vCPU, 4 GB RAM with a 2 GB swap file, 60 GB disk**.
- **Alternatives:** containers (Docker Hub is unreachable from Iranian hosting and adds a
  layer nobody here operates); a managed database (none confirmed at the chosen host); 40 GB
  disk (holds year one, not year two's backups).
- **Reason:** rehearsed twice on a disposable server — the second time by executing the
  runbook's own commands — with measured resources (`docs/M10_A7_STAGING_REHEARSAL.md` §3):
  normal use peaks under 2 GiB, a 12 MP photograph costs one core for ~7 s, a web build on
  the server peaks at 1.6 GiB.
- **Trade-off:** the web is built on the server, so an upgrade needs the build's memory and a
  short web outage; nginx works around a web-tier redirect defect (`proxy_redirect`) until
  Agent B removes it (A7 §5, B1). _Superseded in part (2026-10-02, M10-B12/A8): the web
  now redirects to a path; the `proxy_redirect` workaround is withdrawn from every nginx
  config and instruction._
- **Revisit when:** the API's resident memory passes 1.5 GiB, the backup directory passes
  half the disk, the chosen provider offers only another Ubuntu release, or upgrades become
  frequent enough to want building elsewhere and shipping the build.

## 2026-10-02 — Releases side by side; a migration is undone by restoring, never by a down script

**Status:** Accepted — Agent A, Milestone 10 A8 (upgrade and rollback rehearsal)

- **Decision:** each release is installed in `/srv/clinic-releases/<commit>` and
  `/srv/clinic` is a root-owned link to the live one. An upgrade builds the next release
  beside the live one while the site works, closes the site, migrates, moves the link and
  reopens; the previous release stays built until a later upgrade, so a code rollback is
  moving the link back. Migrations have no down scripts: each is classed **code** (purely
  additive, the previous release runs on it) or **restore** (anything else), in the
  runbook's register (step 18.3). Before a migration the site closes, a backup is taken and
  **proven by a restore on the server** (`scripts/ops/restore-on-server.sh`) before
  anything changes; going back from a **restore** migration sets the upgraded database and
  media aside (renamed, never deleted) and restores that backup.
- **Alternatives:** in-place extraction (B12's web-only upgrade: no previous release left to
  go back to); hand-written down migrations (on tables guarded by immutability triggers,
  written for a case that may never come and never rehearsed); a database copy by
  `CREATE DATABASE … TEMPLATE` before migrating (seconds, no owner key, but a second recovery
  path the drill does not prove, and it loses the database's own grants).
- **Reason:** the one recovery path is the one every drill and this rehearsal exercise
  (`docs/M10_A8_UPGRADE_REHEARSAL.md`: two restore rollbacks, one code rollback); measured
  downtime is seconds for code, under a minute with migrations at rehearsal size.
- **Trade-off:** a restore rollback loses what was entered on the new release from the
  live system (kept set aside, listed from its audit history for re-entry), so migration
  upgrades are done outside clinic hours and decided on before the clinic opens; the
  owner's private backup key must be on the server for the upgrade's duration; each kept
  release costs 0.3–0.5 GB.
- **Revisit when:** a migration must be applied while the clinic works, the restore of a
  real backup takes more than a few minutes, or the owner cannot be present for upgrades
  with migrations.

## 2026-10-16 — A therapist's day can be closed in part

**Status:** Accepted — Agent A, Milestone 10 A9 (tour item T-012, owner-approved for the pilot)

- **Decision:** a closure (`therapist_availability_exception`, `is_available = false`) may
  carry a start and an end; with them it closes that range of the date only, without them
  the whole day as before. Times are `HH:MM` on the clinic's calendar (Asia/Tehran), end
  after start, within the day. The resolved day takes each partial closure out of the
  recurring windows and leaves dated extra windows standing — the whole-day rule, applied
  to a range — and lists them as `closedRanges`; `isClosed` still means the whole day.
  Booking, moving and the recurrence preview are unchanged: they read the resolved
  windows, so a session inside a closed range is refused with
  `APPOINTMENT_OUTSIDE_AVAILABILITY` unless overridden with a recorded reason. Same
  permission (`availability.manage`), same audit (`therapist_availability.updated`, the
  exception with its times).
- **Overlaps are refused, not merged:** closures on one date may not overlap (a whole-day
  closure overlaps every closure of its date), and a partial closure may not overlap an
  extra window; all three answer `AVAILABILITY_EXCEPTION_CONFLICT`. Back-to-back ranges are
  allowed. A whole-day closure beside an extra window stays allowed ("not my usual hours,
  these instead"). Enforced by two exclusion constraints, replacing the one-closure-per-date
  unique index.
- **Existing sessions:** a closure — whole-day or partial — cancels and moves nothing. The
  scheduled appointments it leaves outside the therapist's hours are returned with the
  closure (`affectedAppointments`) and stay readable through
  `GET /availability/therapists/:therapistId/closure-conflicts?from&to` (`availability.read`).
  Before this, a whole-day closure surfaced nothing at all; it now surfaces conflicts the
  same way, so both kinds behave alike.
- **Alternatives:** a separate partial-closure table (two places to read a closure from,
  and the precedence rule written twice); merging overlapping closures (two rows answering
  "why is this hour closed", and removing one would silently reopen hours the other meant
  to close); cancelling or flagging the sessions in the range (a session promised to a
  family is changed by a person who has spoken to them); a stored conflict flag on the
  appointment (state that goes stale the moment the closure is removed).
- **Trade-off:** the conflict list is computed on read, so it is "now", not "when the
  closure was made"; the migration is rollback class **restore** (runbook 18.3).
- **Revisit when:** a closure must span several days, or the clinic asks for the diary to
  act on a closure (notify, propose a new time) rather than show it.
