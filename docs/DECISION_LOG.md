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
