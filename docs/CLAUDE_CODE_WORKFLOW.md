# Claude Code Collaboration Workflow

## Roles

- **Owner:** owns product policy, private data, budget, and approval.
- **Claude Code:** owns technical analysis and implementation recommendations.
- **Adviser:** reviews plans/diffs/tests and offers non-binding feedback, except when identifying an approved-requirement, security, privacy, integrity, production-safety, or milestone-scope conflict.

## Setup

Place these files in the repository:

```text
CLAUDE.md
docs/PROJECT_SPEC.md
docs/CLAUDE_CODE_WORKFLOW.md
docs/DECISION_LOG.md
```

Commit them, then start from the root:

```bash
git add CLAUDE.md docs/
git commit -m "docs: add clinic product specification and workflow"
claude --permission-mode plan
```

Use Section 19 of `PROJECT_SPEC.md` as the first prompt.

## Advisory review format

Send Claude's plan to the adviser. The adviser should reply as:

```text
Advisory review

Strong points:
- ...

Questions worth reconsidering:
- ...

Possible requirement/integrity conflicts:
- ...

Optional alternatives:
- ...

These are advisory observations. Please evaluate them independently and explain any accepted, modified, or rejected point.
```

Record final decisions in `DECISION_LOG.md`; do not store full chat transcripts.

## Implement one milestone

After review, approve one small milestone. Use:

```text
Please implement only the approved milestone.

Before editing, briefly restate the scope, expected files, and any material blocker.
Use your technical judgment while preserving the approved scope and domain invariants. Avoid unrelated cleanup and future abstractions.

After implementation, report files changed, migrations/contracts, commands and actual results, tests, deviations, risks, assumptions, and a concise diff summary. Stop after this milestone.
```

## What to send for review

```bash
git status --short
git diff --stat
```

Also send relevant diffs, migrations/schema changes, API-contract changes, test output, warnings, and UI screenshots only when visual behavior matters. Do not paste lockfiles, generated clients, build output, or unrelated formatting.

## Test cadence

- During edits: focused affected-module tests and fast checks.
- At milestone end: agreed formatting, lint/type, affected unit/integration, migration validation, and build when relevant.
- Before merge/release/pilot: full suite and end-to-end acceptance.

Require actual command output, not an unsupported “tests pass” statement.

## Human-owned work

Do outside Claude Code and provide when needed:

- decide money unit, no-show/cancellation policy, settlement basis, discounts, roles;
- prepare private structured clinic configuration and opening balances;
- provide approved Persian content, brand assets, photos, location, biographies, testimonials, and legal/privacy wording;
- control domain, DNS, hosting, production secrets, deployment approval, and backup retention;
- clean/import/reconcile real historical data.

Use fake data in development. Never paste real child/family data into AI prompts.

## Work to avoid unless justified

- repeated full-repository summaries;
- generic Next/Nest tutorials;
- many equivalent architecture alternatives;
- speculative future modules;
- placeholder legal/medical/marketing copy;
- row-by-row mock data instead of a seed script;
- full test suite after every tiny edit;
- early UI variant exploration;
- manual edits to generated clients;
- production deployment, credentials, or DNS operations;
- exhaustive comments on obvious code.

For deterministic local work, prefer a short command or script.

## Owner's useful local commands

```bash
git status --short
git diff --stat
git diff -- path/to/file
git switch -c milestone/00-foundation
git add -p
git commit -m "chore: initialize project foundation"
```

Before a meaningful migration: get an explanation, inspect the migration, identify destructive/backfill/locking risk, test on a disposable database, run focused tests, then approve. Production migration approval is human-owned.

## Pilot

Synthetic seed → acceptance scenarios → simulated receptionist days → workflow fixes → backup/restore test → synthetic-data training → limited pilot → reconcile totals → expand only after matching.
