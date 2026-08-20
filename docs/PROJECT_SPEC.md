# Rehabilitation Clinic Platform — Product Specification

**Version:** 1.2  
**Product UI:** Persian, RTL, Jalali date display  
**Preferred direction:** pnpm monorepo, Next.js, NestJS, PostgreSQL

## 1. Goal

The urgent problem is unreliable manual accounting, not online payment. The receptionist records appointments and payments, may miscount completed sessions, and may forget delayed-payment promises. The first product must make recorded facts traceable and all counts/balances automatic.

A successful workflow is:

1. find/create family and child;
2. schedule appointment;
3. record actual outcome;
4. create the correct session charge exactly once;
5. record full/partial payment or a future promise;
6. show the correct family balance and statement;
7. let the manager audit sensitive changes.

The product also includes a public clinic website and a simple contact-request inbox.

## 2. Scope

### Included

- manager/receptionist authentication and authorization;
- families and multiple children per family;
- therapists, services, rooms, availability, tariffs;
- one-time and recurring appointments;
- completed/cancelled/no-show/rescheduled outcomes;
- automatic completed-session charge;
- discounts, corrections, voids, partial payments, credit;
- payment promises and overdue follow-up;
- family account, receptionist dashboard, basic reports;
- audit trail for sensitive changes;
- public pages, articles, approved testimonials, contact form/inbox.

### Excluded for now

Native app, parent portal, direct online booking/payment, automated SMS/waiting list, clinical notes, progress reports, AI screening/diagnosis, full CRM/HR/SOP automation, advanced analytics, microservices, and true offline-first use.

## 3. Manual facts vs automatic results

Receptionist enters: family/child, appointment, actual outcome, received payment, payment promise, notes, and correction reason.

System derives: end time, tariff suggestion, session charge, completed-session count, valid charges, payments, credit/balance, overdue promises, and the therapist share applied to each completed session.

A manually typed balance is never the source of truth.

## 4. Roles

### Manager

Full operational access; user/access management; configuration; reports; sensitive financial correction/void; audit review; settlement configuration, per-session share rating, and period close (manager-only).

### Receptionist

Family/child management; appointment operations; outcome entry; payment/promise entry; account and operational reports; website-request processing.

Restrictions: no physical deletion of final financial records, no global tariff/share changes, no unauthorized correction, no security administration.

### Therapist

Optional in the first release. Default access, if created, is own schedule only; no financial access.

## 5. Core domain

### Family and child

- Family is the financial-account unit and may have multiple children.
- Each charge references the relevant child.
- Search supports parent name, child name, mobile, and file number.
- Likely duplicates should be warned about.
- Records with history are deactivated, not deleted.

Minimum family data: primary parent, relationship, primary/alternate mobile, optional address, non-clinical note, active status, audit fields.

Minimum child data: family, name, birth date, file number, optional approved demographics/source, non-clinical note, active status, audit fields.

### Therapist, service, room, availability

Therapist: name, specialty, active status, supported services, availability, and an effective-dated share rule.

Service: name, public description, allowed durations, active/public status.

Room: name, active status, optional service restrictions.

Availability: recurring working windows plus dated exceptions. Out-of-availability booking is blocked or requires an authorized, recorded override.

### Tariff

A tariff may depend on service, duration, therapist, family, and effective date range.

Rules:

- family-specific price overrides general price;
- appointment stores a price snapshot;
- changing a tariff never changes historical charges;
- missing tariff is a visible error;
- finalized amounts are corrected through an auditable adjustment, not silent overwrite.

## 6. Appointments

Minimum appointment data: family, child, service, therapist, room, start, duration/end, tariff source, price snapshot, status, note, optional recurrence-series ID.

Recommended statuses: `SCHEDULED`, `COMPLETED`, `CANCELLED_BY_FAMILY`, `CANCELLED_BY_CLINIC`, `NO_SHOW`, `RESCHEDULED`, and controlled `VOIDED` where necessary.

Recurring scheduling supports weekly patterns, occurrence count/end date, conflict preview, edit/cancel one occurrence, and edit/cancel this-and-future occurrences. Each occurrence remains independently traceable.

Prevent or authorize explicitly:

- therapist overlap;
- room overlap;
- child overlap;
- inactive room;
- invalid times;
- appointment outside therapist availability.

### Appointment-to-charge invariant

- Only a valid transition to `COMPLETED` creates the primary session charge.
- One appointment has at most one valid primary session charge.
- Retries/repeated submissions are idempotent.
- Cancellation creates no charge by default.
- `NO_SHOW` creates no charge until policy is approved.
- Reversing completion is controlled and voids/offsets rather than deletes financial history.
- Protect the invariant in both application logic and PostgreSQL where practical.

## 7. Family ledger

The family account shows child-level session detail and family-level totals: valid charges, payments, credits, balance, last payment, promises, adjustments, and voids.

A session charge records at least: family, child, appointment, therapist, service, service date/duration, base amount, adjustment/discount, final amount, type/status, actor/time, and correction/void reason.

Ledger rules:

- balance is derived from valid ledger records;
- a cache is acceptable only if rebuildable/reconcilable;
- final records are never physically deleted;
- corrections preserve original history;
- money uses integers in one documented base unit;
- rial vs toman must be decided before final financial migrations.

## 8. Payments and promises

Payment data: family, date/time, integer amount, method, optional reference, note, recording user, status (`CONFIRMED`, `PENDING`, `VOIDED`).

Rules:

- positive partial payment is valid;
- payment may be smaller or larger than debt;
- overpayment creates family credit;
- void restores the correct balance and preserves history;
- promise is not payment.

### Allocation decision

Before building payments, choose either:

1. family-level ledger without explicit charge allocation; or
2. explicit payment allocation to charges, normally oldest first.

The technical planner should recommend one based on reporting, correction complexity, and future online payment. If allocation exists, totals cannot exceed the payment or open charge, and voiding preserves allocation history.

### Payment promise

Fields: family, promised amount, due date, follow-up date, note, status (`OPEN`, `FULFILLED`, `MISSED`, `RESCHEDULED`, `CANCELLED`), optional linked payment, actor/time.

Rules:

- promise never changes balance;
- overdue open promises appear on dashboard;
- rescheduling preserves old due-date history;
- a confirmed payment may fulfill an explicitly linked promise.

## 9. Discounts, corrections, and therapist settlement

Support session discount, family-specific price, free session, debt waiver, incorrect-amount correction, and controlled void. Final values are not silently overwritten; actor, time, reason, and before/after effect remain inspectable.

Therapist settlement is **implemented (Milestone 8)** and its basis is frozen: share is based on **completed-session value, independent of whether or when the family pays**. Percentages are effective-dated per therapist, and the percentage applied to a session is stored as an immutable historical snapshot that later rule changes never restate.

A session discount may be borne entirely by the clinic, entirely by the therapist, or split between them; the therapist and clinic portions must sum exactly to the family discount. Therapist net is never negative; clinic net may be negative and must remain visible as an explicit subsidy.

See CLAUDE.md ("Non-negotiable rules") and DECISION_LOG 2026-08-19/2026-08-20 for the accepted settlement model. Any settlement rule not recorded there remains unresolved and must not be inferred.

## 10. Dashboard and reports

Receptionist dashboard: today's appointments, unresolved outcomes, cancellations/no-shows, today's payments/charges, promises due/overdue, website requests, pricing/data errors, and conflicts.

Initial reports:

- sessions by date/family/child/therapist/service/status;
- family accounts with charges, payments, balance, last payment, count, promise;
- promises due/overdue/fulfilled/rescheduled;
- payments by date/method/user;
- therapist activity, without share until rules are approved.

Readable print view is required. CSV/spreadsheet export is optional if simple and safe; PDF is not initially required.

## 11. Public website

Pages: home, about, manager/team, services and service detail, articles, testimonials/approved anonymized success stories, contact/location, privacy notice, and request form.

Request fields: parent name, mobile, optional child name/age, service, preferred contact time, note, consent.

Inbox statuses: new, contacted, follow-up needed, converted to family, closed. This is not a full CRM.

Content rules:

- draft/published workflow and authorized publishing;
- readable unique URLs and basic SEO metadata/sitemap/robots/canonical/Open Graph;
- testimonials and stories require approval/privacy review;
- no identifying child or clinical data is published.

## 12. Architecture and BFF

Preferred structure:

```text
apps/web       Next.js App Router
apps/api       NestJS modular monolith
packages/api-client   typed/generated contract client if justified
```

NestJS owns PostgreSQL, domain invariants, authorization, transactions, audit, appointment transitions, finance, and sensitive reporting.

Next.js may provide a selective BFF for secure cookie/session handling, Server Actions, page-specific aggregation/shaping, and UI-friendly error translation. It must not access PostgreSQL, duplicate financial logic, or become a catch-all proxy. Server Components may call a server-only NestJS client directly.

The planner should recommend:

- browser/Next/Nest authentication and CSRF approach;
- ORM after comparing transaction control, migrations, locks, constraints, testability, and maintenance;
- typed API-contract approach that minimizes drift without fragile generation overhead.

## 13. Security, audit, and operations

Minimum expectations: HTTPS production, secure authentication/session, server-side least privilege, suitable CSRF and login-abuse protection, secrets outside Git, environment separation, no sensitive logs, synthetic test data, production debug off, backups, and tested restore.

Audit sensitive actions: role/tariff changes, transition to/from completed, charge/payment create-correct-void, discounts/waivers, settlement rules, and sensitive exports where practical.

Transactions are likely required for completion+charge, completion reversal, payment+allocation, payment void, settlement close, and multi-record request conversion.

Candidate constraints: unique primary charge per appointment, positive payment/promise/allocation, valid times, valid allocation totals, and conflict protection where practical. Planning should state what PostgreSQL guarantees versus application logic.

## 14. Critical acceptance scenarios

1. **Delayed payment:** three completed sessions create three charges; partial payment reduces balance; promise does not; later payment settles correctly.
2. **Two children:** family total includes both, while each row identifies the child; one payment may cover both.
3. **Cancellation:** no charge, still visible in appointment report.
4. **Idempotency:** retrying completion never creates a duplicate primary charge.
5. **Tariff change:** past charge stays unchanged; new appointment uses new suggestion.
6. **Payment void:** correct balance is restored; original payment and reason remain.
7. **Conflict:** overlapping therapist/room/child booking is prevented or authorized explicitly.
8. **Recurrence:** changing one occurrence leaves others unchanged unless a series operation is selected.
9. **Correction:** incorrect amount is adjusted auditably; old value/reason remain inspectable.
10. **Public request:** form entry appears in inbox and may be linked to a family.

Tests should prioritize these scenarios, authorization, and migration/data integrity.

## 15. Open business decisions

Resolve before the related milestone:

1. rial or toman storage;
2. no-show and late-cancellation charge policy;
3. receptionist same-day correction authority;
4. family-level ledger vs explicit allocation;
5. prepaid family credit policy;
6. ~~therapist settlement basis and discount effect~~ — **resolved (Milestone 8)**: completed-session value, independent of family payment; discounts are allocated explicitly between therapist and clinic (section 9);
7. ~~settlement period~~ — **resolved (Milestone 8)**: a period is an explicit inclusive range of clinic days chosen by the manager at close time, not a fixed calendar cycle. Ranges may not overlap, gaps are permitted, and a closed period is immutable;
8. exact services, durations, rooms, hours, schedules, tariffs, special prices;
9. initial statement/export requirement;
10. content/testimonial approver;
11. hosting, backup destination, and retention;
12. browser/Next/Nest session preference.

## 16. Suggested milestones

0. **Foundation:** pnpm workspace, Next/Nest skeletons, PostgreSQL dev environment, configuration, quality checks, CI; no clinic features.
1. **Auth:** manager/receptionist access, chosen session flow, Nest authorization, initial audit foundation.
2. **Reference data:** therapists, services, rooms, availability, tariffs.
3. **Families:** family/child CRUD, search, duplicate warning, permissions/audit.
4. **Appointments:** calendar, recurrence, conflicts, statuses, daily outcome review.
5. **Ledger:** price snapshot, completed-session charge, idempotency, family account, correction/void.
6. **Payments:** partial payment, credit, approved allocation design, void, promises/overdue.
7. **Dashboard/reports.**
8. **Therapist settlement:** complete. Share rules, per-session applied-share snapshots, concession allocation, statement, period close, closed-period detail, and audited CSV export.
9. **Public site:** content, SEO fundamentals, request form/inbox/conversion.
10. **Hardening/pilot:** acceptance, permission review, backup/restore, synthetic simulation, reconciliation.

The technical planner may refine boundaries if it keeps changes small and independently testable.

## 17. Human-owned inputs

Humans provide/approve:

- business policies and opening balances;
- therapist/service/room/schedule/tariff data;
- clinic name, logo, photos, contact/location, biographies, Persian copy, testimonials, privacy/consent wording;
- domain/DNS, hosting accounts, production secrets, deployment approval, backup policy;
- historic-data cleanup, conflict resolution, import approval, and pilot reconciliation.

AI may provide templates/scripts/checklists but must not invent these facts or receive real private data in ordinary prompts.

## 18. Definition of done

A milestone is done when approved scope works, server validation/authorization exists, critical tests pass, migrations/contracts are reviewed, no future scope was added, actual command results are reported, risks/assumptions are visible, and no real clinic data was used.

## 19. Initial Plan Mode prompt

```text
Please read CLAUDE.md, docs/PROJECT_SPEC.md, docs/CLAUDE_CODE_WORKFLOW.md, and docs/DECISION_LOG.md.

Please act as the project's primary technical planner. Approved product rules and data-integrity constraints are binding; architectural suggestions and reviewer comments are advisory inputs for your independent evaluation.

For this pass, please do not modify files, install packages, or run migrations.

Please provide a concise plan covering:
1. scope and non-goals;
2. early blockers vs decisions that can wait;
3. recommended Next.js/NestJS/PostgreSQL monorepo and selective-BFF boundaries;
4. browser/Next/Nest authentication and CSRF approach;
5. conceptual data model, key constraints, and void/deletion behavior;
6. appointment transitions and idempotent charge creation;
7. ledger, partial payment, credit, void, promise, and allocation recommendation;
8. ORM and API-contract recommendation with one credible alternative and trade-off;
9. manager/receptionist permission boundary;
10. security, audit, backup/restore, and migration-safety approach;
11. focused tests for the acceptance scenarios;
12. small milestones and exact Milestone 0 file changes;
13. likely failure modes and simplifications.

Please make and explain your own technical recommendations. Clearly separate approved rules, technical decisions, assumptions, and open questions. Avoid repeating the specification and do not implement anything yet.
```
