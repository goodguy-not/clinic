# CLAUDE.md

## Context

This repository is a Persian RTL rehabilitation-clinic platform:

- `apps/web`: Next.js public site, internal UI, and selective BFF;
- `apps/api`: NestJS modular monolith;
- PostgreSQL: system of record.

Use `docs/PROJECT_SPEC.md` for product rules and `docs/DECISION_LOG.md` for accepted technical/business decisions. For later milestones, read only the relevant specification sections unless a cross-cutting change requires more context.

## Decision ownership

You are the primary technical decision-maker. Reviewer feedback is advisory unless it identifies a conflict with approved scope, a non-negotiable domain rule, privacy/security, data integrity, production safety, or the approved milestone.

Evaluate suggestions independently. Accept, modify, or reject them with concise reasoning. For important choices state: decision, credible alternative, reason, trade-off, and revisit trigger.

## Product boundary

Initial product: families/children, therapists/services/rooms/tariffs, receptionist-entered appointments, completed-session charges, payments, credits, payment promises, family balances, basic reports, audit history, public website, and simple contact-request inbox.

Not initial product: native app, parent portal, direct online booking/payment, automated SMS/waiting list, clinical records, AI screening, full CRM/HR, microservices, Redis/queues/CQRS/GraphQL/Kubernetes.

## Non-negotiable rules

- A family may have multiple children.
- Balance is family-level; each charge identifies the child.
- Only a completed appointment creates the primary session charge.
Each appointment participant has at most one valid primary session charge; retries are idempotent. An individual appointment has exactly one participant.
- Cancellation creates no charge by default. No-show policy is unresolved; default to no charge.
- Tariff changes never rewrite historical charges.
- Final financial records are voided/adjusted, never physically deleted.
- Corrections preserve actor, time, reason, and audit history.
- Payment promises do not reduce balance.
- Partial payments and overpayments/credit are supported.
- Money uses integer storage in one approved unit.
- Therapist-settlement rules are never inferred.


- Therapist settlement is based on completed-session value, regardless of whether or when the family pays.
- Therapist share percentages may differ by therapist and may change over time; historical sessions must preserve the applied percentage as a snapshot.
- A session discount may be borne entirely by the clinic, entirely by the therapist, or split between them.
- The therapist discount amount plus the clinic discount amount must equal the total family discount.
- Discount allocation and any manual override must be explicit, auditable, and must never rewrite historical sessions.

## Architecture boundary

- NestJS owns database access, domain rules, authoritative authorization/validation, transactions, audit, and financial state transitions.
- Next.js never accesses PostgreSQL or calculates balances, charges, or therapist shares.
- A selective BFF is allowed for secure browser sessions, Server Actions, page-specific aggregation, response shaping, and UI-friendly errors.
- Avoid a generic catch-all proxy. Server Components may call a server-only NestJS client directly.
- Keep NestJS a modular monolith and avoid duplicated business logic.
- ORM and API-contract choices remain open until reasoned in planning.

## Working style and context economy

- Inspect only files relevant to the current milestone.
- Do not repeat the specification; cite section numbers.
- Distinguish blockers from questions that can wait.
- Prefer the smallest reviewable implementation.
- Avoid future abstractions, unused packages, placeholder marketing/legal/medical copy, and hand-editing generated files.
- Use focused checks during edits and the agreed full check set at milestone completion.
- Ask humans for business decisions, real content, private data, credentials, DNS, and production approval rather than inventing them.
- Never use real clinic data in tests, seeds, logs, screenshots, commits, or prompts.
- Never operate directly on production from an AI coding session.

At milestone end report: files changed, migrations/contracts, commands and actual results, tests, deviations, risks, assumptions, and open decisions. Stop at the milestone boundary.
