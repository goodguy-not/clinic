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
