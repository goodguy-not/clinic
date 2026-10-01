# M10-A5 — Permission review and synthetic clinic reconciliation

Agent A, Milestone 10, checkpoint A5. Two deliverables: a definitive statement of who may do
what, derived from the code; and proof that money stays correct over two months of realistic
use. Everything referred to here is synthetic.

## 1. Permission review

### The matrix

- **Where:** [`docs/PERMISSION_MATRIX.md`](PERMISSION_MATRIX.md) — every NestJS route, what it
  requires, and ✔/— for Manager, Receptionist and an anonymous visitor, grouped by product
  area.
- **How it is made:** `apps/api/src/auth/route-access-matrix.ts` walks the module graph from
  `AppModule` and reads the same decorators NestJS routes and guards by (path, verb, endpoint
  access). A role's verdict is the guard chain's own rule applied to `ROLE_PERMISSIONS`
  (a permission list is an AND). Nothing is restated by hand.
- **How it is pinned:** `apps/api/src/auth/route-access-matrix.spec.ts` (a unit test, no
  database) renders the matrix and compares it byte for byte with the committed file, and
  fails when:
  - a route is added, removed, or changes what it requires, or a role gains or loses a name
    (the document no longer matches — regenerate and review the diff);
  - a controller has no product area;
  - a route that requires no permission is not in the recorded list of open routes with a
    reason, or a recorded open route no longer exists or changed kind;
  - a permission is demanded by no route and no recorded in-handler check;
  - a route demands a permission no role holds;
  - a source file checks `permissions.includes(...)` inside a handler without being recorded.
- **Regenerate** (from `apps/api`):
  `UPDATE_PERMISSION_MATRIX=1 pnpm exec jest src/auth/route-access-matrix.spec.ts`

### What it found

- **169 routes, every one accounted for.** 149 require named permissions. 20 require none and
  each is recorded with its reason: 2 liveness probes (`/health`, `/health/ready`), 1 operator
  probe the web tier does not front (`/health/db`), sign-in, 3 self-service routes for a
  signed-in user (own session, sign-out, own password), and 13 public-site routes reachable
  only through the Next.js server and returning only published content (plus the contact
  form). Nothing is reachable by accident; NestJS itself is never exposed.
- **78 permissions; every one is used.** 77 are demanded by a route.
  `appointment.override_availability` is demanded inside the booking handlers (booking or
  moving outside a therapist's hours) and is recorded as such. Five other in-handler checks
  are recorded the same way (see the matrix's last table).
- **No route requires a permission no role holds.** The manager holds all 78 and can call all
  169 routes. The receptionist holds 39 and can call 105. A visitor can reach 16 (2 directly,
  14 through the site).
- **Nothing was changed.** The findings below are for an owner decision.

### Plain-language summary by product area

**Families and children.** Both roles do everything that exists: search, register (with the
duplicate check and its acknowledgement), edit, add children, and activate or deactivate a
family or child. Nothing is ever deleted. A visitor cannot reach any of it.

**Catalog — therapists, services, rooms, prices, working hours.** Both roles can look
everything up (who works when, what a session costs). Only the manager can create or change a
therapist, service or room, set or withdraw a price, or change a therapist's working hours and
days off.

**Scheduling.** The receptionist runs the diary: books single and weekly sessions (with a
preview that shows conflicts first), moves, cancels (by the family or by the clinic), stops a
weekly series from a date, records who attended, and completes sessions. With a written
reason they may book outside a therapist's hours. Only the manager can reopen a session that
was completed by mistake.

**Charges, payments and promises.** The receptionist sees each family's account, raises the
charge for a completed session (completing does this automatically; re-posting is safe and
never charges twice), records payments of any size including prepayments, and handles payment
promises from start to finish (create, mark kept against a payment, move to a new date,
cancel). Only the manager can withdraw a charge, grant or withdraw a discount, or void a
payment. A promise never reduces what a family owes.

**Therapist settlement.** Manager only, entirely: therapists' share percentages, rating
sessions, correcting a rating, closing a period, the settlement statement and its export. The
receptionist sees none of it.

**Reports and export.** Both roles see the dashboard; the receptionist's version shows only the
money they personally recorded, the manager's shows the whole clinic. The receptionist can read
the session, promise and therapist-activity reports on screen. The payments and family-balances
reports, and every download (CSV export), are manager only.

**Website requests (contact form).** Both roles read the inbox, move a request through its
statuses, and link it to an existing or newly registered family.

**Content and media (public website).** The receptionist can draft and edit articles,
testimonials, service descriptions, therapist profile text and clinic spaces, upload photos,
attach them to drafts, frame them and describe unpublished ones. Only the manager can publish
or unpublish anything, approve a testimonial or record a withdrawal of consent, publish a
therapist on the website, change the clinic's address and contact details, change the
description of a photo already on the site, or archive a photo.

**Operations and backups.** The manager sees backup and nightly-job status. Staff accounts —
create, change role, disable, reset a password, unlock, sign someone out — are manager only.
Every signed-in user can see their own session, sign out and change their own password.

**Anonymous visitor.** Can read the published website (services, team, articles,
testimonials, spaces, clinic details, published photos), send the contact form, and reach the
sign-in page. Nothing else.

### For an owner decision (reported, not changed)

Each is an observation from the code and from running the two-month simulation as two roles.
None is a defect against an approved rule; each is a place where the approved rule may not be
what the clinic wants day to day.

1. **A receptionist can deactivate a family that still owes money, and the debt then drops out
   of the manager's default family-balances report.** `family.update_status` is the
   receptionist's; deactivation has no balance or future-booking check; the family-accounts
   report and its export exclude inactive families unless "include inactive" is chosen.
   Options: block deactivation while a balance or future booking exists; make it manager-only;
   or include inactive families with a balance in the default report. _Money visibility —
   recommended to decide before go-live._
2. **A receptionist cannot record a parent's withdrawal of testimonial consent.** It is behind
   `testimonial.approve` (manager). The withdrawal usually arrives by phone at the desk and
   starts the seven-day erasure clock. Option: a separate "record withdrawal" authority for the
   receptionist (recording is not approving). _Privacy timing._
3. **Every correction the desk makes needs the manager the same day.** In the simulation:
   a payment keyed with the wrong amount (void, `payment.void`), a child marked attended who
   was absent (the charge must be withdrawn before the absence can be recorded,
   `charge.void`), and a session completed with the wrong length (`appointment.reopen`). These
   were decided manager-only with no same-day window (DECISION_LOG 2026-08-14, 2026-08-15).
   Confirm that the manager is reliably available for this, or revisit with a same-day,
   own-entry, reasoned void for the receptionist.
4. **Every discount needs the manager, including a standing one.** A family with an agreed
   20% hardship discount needs the manager to grant it on every session (`charge.adjust`). The
   product has no pre-approved standing discount. Confirm, or record as a later feature.
5. **A therapist's day off can only be entered by the manager** (`availability.manage`). The
   desk can cancel the day's sessions (by the clinic) but cannot stop new bookings being
   offered that day. Option: let the receptionist add an availability exception.
6. **A missing price stops the desk until the manager adds it.** Sessions without a tariff
   complete without a charge and stay "uncharged" until the manager creates the price and the
   desk re-posts. Working as designed; confirm the dashboard warning is enough.
7. **The receptionist's end-of-day cash check covers only their own entries.** The dashboard
   reconciliation is "recorded by me"; the clinic-wide day total is in the payments report,
   which is manager-only. With two receptionists on shifts, confirm who balances the till.
8. **Backup and job status reuse `user.read`.** Any future role given `user.read` (to see the
   staff list) would also see operational status. Fine with two roles; revisit if a third role
   is introduced.

## 2. Synthetic clinic simulation and reconciliation

### What runs

`apps/api/src/dev/clinic-simulation.ts` builds a small clinic and runs about two months of it:
from three weeks before the previous Jalali month to yesterday, plus a week of future
bookings. On 2026-10-01 that is 2026-08-02 → 2026-09-30 (Mordad 11 → Mehr 8, 1405), crossing
two Jalali month ends, with Shahrivar 1405 closed for settlement. It is relative to the
clinic's own today, so it always contains one whole closed month.

Every act goes through the domain service the matching route calls, with the request parsed by
that route's contract schema, performed by the person who would do it (two receptionists on
morning and afternoon shifts, the manager, an anonymous visitor). Before each act the
simulation checks the route × role matrix and stops if that role could not make the call — so
it is also a dual-role walkthrough. It writes no SQL.

Covered, each at least once (the test asserts all 43): registration with a duplicate mobile
(discarded), a shared grandparent's mobile (acknowledged), a duplicate child (discarded), a
shared landline (notice); 24 weekly series with a conflict found by the preview and avoided;
a series stopped from a date; cancellations by family and by clinic (a therapist's sick day);
no-shows; attendance corrected; sessions completed with the outcome pending and charged next
day, once by two receptionists at the same moment; charges re-posted (idempotent) and
completed twice at once; unpriced 60-minute sessions charged after the price was added; a
completion reopened, its length corrected and re-charged; a price rise at the month start;
concessions borne by the clinic, split, borne entirely by the therapist, and a full waiver on
a non-participating therapist's session (negative clinic net); a concession withdrawn; charges
withdrawn; exact, partial, over and prepaid payments; a mistyped payment voided; promises
kept, rescheduled, cancelled, overdue and open; a share rule entered wrongly and corrected with
every affected rating corrected; a therapist with no rule (sessions unrated, rated later); a
share percentage raised mid-history; the month closed for all three therapists, closed twice
(idempotent); after the close a charge withdrawn, a late concession, and two sessions rated
(carried in); month-end payments and family-balances exports; contact-form enquiries converted
to a new family, linked to an existing one, closed, followed up, left new, and one repeated
submission absorbed.

On 2026-10-01: 14 families, 19 children, 235 sessions, 163 charges, 84 payments, 9 promises,
3 closed periods, 5 website requests; 336 entities checked for their audit entries.

### The independent reconciliation

`apps/api/src/dev/clinic-reconciliation.ts` compares three sources: the simulation's own book
(amounts from its own price list and share rules, never read back from the application), the
base rows read with plain SQL, and the application's answers (family account, family-balances
and payment reports, dashboard, settlement statement, closed-period detail). Its money model
re-derives the rules from CLAUDE.md and imports nothing from the ledger, settlement or report
code. Sixteen checks:

charges vs price list and session · one valid charge per completed attended seat under
retries · appointment status and attendance · concessions and their explicit split ·
applied share snapshot per session · payments · promises · every family balance four ways ·
clinic totals for every day (dashboard, base rows, payment report) · per Jalali month ·
closed-period lines as expected and unchanged since the close · closed lines' arithmetic
(therapist net never negative, the clinic subsidy visible) · settlement statement per
therapist (lines, settled, pending correction, unsettled, unrated) · exported files ·
an audit entry for every financial act and none missing for any financial row · website
request lifecycle.

**Result: zero discrepancies**, in UTC and in Tehran time. The integration test also attempts
to update and delete closed settlement rows, charges and payments as the database owner, and
every attempt is refused.

**Defects found in the application: none.** Two disagreements appeared on the first runs, and
both were gaps in my model, not in the application: a rescheduled promise's successor is
audited inside the reschedule entry that names it (not under its own id), and a seat whose
charge the manager withdrew is legitimately uncharged. Both were fixed in the model.

**The reconciliation can fail.** Two deliberate faults were injected into the model and each
was caught: rounding the therapist share down instead of half-up (27 rating and settlement
discrepancies — the 285,000 play-therapy price at 33.33% is exactly x.5) and counting voided
payments as paid (family balance and clinic total discrepancies). Both were reverted.

### The practice clinic

The same simulation is the training and demo clinic. On an empty disposable database (name
ending `_dev`, `_test`, `_ci` or `_demo`) with one manager from `bootstrap-manager`:

```bash
node dist/dev/main.js --confirm --practice-clinic
```

It prints the history range, the counts, every reconciliation check, and the two practice
receptionist accounts with one-time passwords; it exits non-zero if anything does not
reconcile. All people are "نمونه" plus a tree's name, every mobile starts `0900` (not an
issued prefix), no child has a national identifier, enquiries come from TEST-NET addresses.
It publishes one service so the contact form has something to name, and writes no other
website content: it is not a way to manage real content.

## Files, checks and open items

- New: `apps/api/src/auth/route-access-matrix.ts`, `route-access-matrix.spec.ts`,
  `docs/PERMISSION_MATRIX.md` (generated; excluded from Prettier),
  `apps/api/src/dev/clinic-simulation.ts`, `clinic-reconciliation.ts`,
  `apps/api/test/clinic-simulation.int-spec.ts`, this file.
- Changed: `apps/api/src/dev/synthetic-clinic.ts` (seven helpers exported for reuse),
  `apps/api/src/dev/main.ts` (`--practice-clinic`), `.prettierignore`, `README.md`,
  `docs/DECISION_LOG.md`.
- No migration, no contract change, no change to any permission, route or role, nothing under
  `apps/web`.
- Open: the eight owner decisions above.
