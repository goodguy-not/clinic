# CLAUDE.md

## Source of truth

Read `docs/PROJECT_SPEC.md` before planning or implementing product work. It is authoritative for scope, terminology, business rules, non-goals, acceptance scenarios, and open decisions.

## Workflow

- Start complex work in Plan Mode.
- Do not implement until the plan or milestone is explicitly approved.
- Work on one approved milestone at a time and stop afterward.
- Before editing, list intended files and restate scope.
- After editing, run tests and summarize the diff.
- Do not silently resolve open business decisions.

## MVP

The MVP is a Persian RTL Next.js public website and internal manager/receptionist panel, backed by a NestJS REST API and PostgreSQL. Data entry is manual; appointment and financial calculations are automatic and auditable.

The MVP is not a native app, parent portal, online booking, online payment, automated SMS, clinical record system, AI screening tool, or distributed microservice system.

## Core business rules

- A family may have multiple children.
- Balance belongs to the family; charges identify the child.
- Only a completed appointment creates the primary session charge.
- One appointment can create at most one primary charge.
- Repeated requests must not duplicate charges.
- Cancelled appointments do not create charges by default.
- No-show charging is unresolved; default to no charge.
- Tariff changes never rewrite historical charges.
- Final financial records are never physically deleted.
- Voids and corrections require reason, actor, timestamp, and audit history.
- Payment promises are not payments and do not reduce balance.
- Partial payments and overpayments are supported.
- Money uses integer storage, never floating point.
- Do not guess therapist settlement rules.

## Security

- Use server-side authorization.
- Never commit secrets.
- Never use real clinic, child, parent, or patient data in tests, seeds, logs, commits, or prompts.
- Keep audit logs for sensitive actions.
- Use transactions for appointment completion, charge creation, payments, voids, and allocations.
- Destructive migrations require explicit approval and a backup plan.
- Never operate directly on production.

## Approved architecture

- Use a pnpm TypeScript monorepo.
- `apps/web` is Next.js App Router for the public site, admin UI, and a selective BFF.
- `apps/api` is a NestJS modular monolith and the sole owner of PostgreSQL, business rules, transactions, RBAC, and audit logs.
- Next.js must never access the database directly.
- Next.js must never calculate balances, charges, therapist shares, or appointment financial transitions.
- Server Components should call NestJS through a server-only generated API client, not through the app's own Route Handlers.
- Client-side interactions may use explicit Server Actions or Route Handlers when a BFF is justified.
- Do not create a generic catch-all proxy from Next.js to NestJS.
- NestJS must validate and authorize every protected operation even when Next.js already checked it.
- Generate OpenAPI from NestJS and a TypeScript client for Next.js; do not hand-edit generated files.
- ORM choice is unresolved until Plan Mode compares Prisma and TypeORM for migrations, transactions, locking, and PostgreSQL constraints.

## Engineering preferences

- Keep NestJS as a modular monolith; do not split domain modules into deployable services.
- Prefer Server Components for public and read-heavy pages, Client Components only where interaction requires them.
- Keep domain modules and frontend features separated.
- Add database constraints where practical.
- Add automated tests for financial, permission, API-contract, and BFF-boundary rules.
- Keep changes small and reviewable.
- Avoid premature abstractions, Redis, queues, GraphQL, CQRS, and future-scope infrastructure unless an approved milestone requires them.
- Store timestamps in UTC; display local/Jalali dates in the presentation layer.
- User-facing text is Persian and RTL.

## Completion report

At each milestone report files changed, migrations, tests, commands and results, risks, assumptions, unresolved decisions, and the suggested next milestone. Do not begin it automatically.
