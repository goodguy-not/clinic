# M10 A3 — scheduled jobs, erasure and health: what the Web tier needs (for Agent B)

Agent A built the API half and changed nothing in `apps/web`. Every contract change is
**additive** — new exports only; `Testimonial` and `MediaAsset` are unchanged — and the Web's
typecheck and 1125 tests pass against it as they are. Nothing below is urgent for the Web to
keep working; items 1 to 3 are needed for the owner's decisions to be usable.

## 1. Job warnings beside the backup warning (after the A2 banner)

`GET /operations/job-status` — same guard chain and the same permission as
`/operations/backup-status`: **`user.read`, manager-only**; receptionist `403`. No new
permission. Response: `jobStatusResponseSchema` (`packages/contracts/src/operations/job-status.ts`):

| Field               | Meaning                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| `warning`           | true when any job is a warning — **the only field that decides showing a banner**       |
| `warningAfterHours` | 48 (`SCHEDULED_JOB_WARNING_HOURS`)                                                      |
| `jobs[]`            | always all four, in order: `{ job, state, warning, lastSucceededAt, ageHours }`         |
| `state`             | `OK`; `STALE` (no success for 48 hours); `NEVER_RUN` (never succeeded on this database) |

- **Where/how:** the same place and the same pattern as the backup banner in
  `docs/M10_A2_BACKUP_STATUS_WEB_HANDOFF.md` — a Server Component read through the server-only
  NestJS client, `no-store`, only for a user holding `user.read`; no call for the receptionist.
- **What it says** (wording is the coordinator's to translate): one line per job in warning:
  - `WEBSITE_REQUEST_PURGE`: "Website messages are not being erased on schedule."
  - `SESSION_PRUNE`: "Old sign-in records are not being cleared."
  - `TESTIMONIAL_ERASURE`: "Withdrawn testimonials are not being erased on schedule." — the
    most important one: it carries a seven-day promise.
  - `MEDIA_ERASURE`: "Unused and archived photographs are not being erased on schedule."
  - Suffix for all: "Tell the developer." `NEVER_RUN` and `STALE` read the same to the manager.
- **If the call fails**, show a generic "the status of scheduled tasks could not be read",
  never nothing.
- **Tests:** OK (no banner), one STALE, one NEVER_RUN, receptionist makes no call, failed call.

## 2. A family withdraws testimonial consent (manager)

`POST /content/testimonials/:id/consent-withdrawal` — **`testimonial.approve`, manager-only**,
no body, `204`, idempotent (a repeat is `204`). `404 TESTIMONIAL_NOT_FOUND` if the id does
not exist.

- **Where:** a manager-only action on the testimonial page, beside approve/publish. A Server
  Action or a specific route handler, as the existing approval/publication acts are done.
- **It is final and irreversible.** Confirm first, with the consequence stated: the
  testimonial leaves the site now; within `TESTIMONIAL_CONSENT_ERASURE_DAYS` (7) its words,
  its attribution and every photograph ever attached to it are erased — including if that
  photograph is used on another page. No undo.
- **After it,** the testimonial is gone from `GET /content/testimonials` and
  `GET /content/testimonials/:id` answers `404`: redirect to the list with a success notice.
- **The record:** `GET /content/testimonials/consent-withdrawals` (`testimonial.read`) →
  `testimonialConsentWithdrawalListResponseSchema`: `{ id, consentWithdrawnAt,
contentErasedAt | null, erasureDueBy }` — dates only, no words. A small section under the
  testimonial list: "Consent withdrawn on _date_ — erased on _date_" or "— to be erased by
  _date_". Jalali dates.
- **Tests:** manager sees the action, receptionist does not; confirm step; list section with
  erased and pending rows.

## 3. Erased photographs in the media library

The contract already carries `bytesPurgedAt` on `MediaAsset`.

- An asset with `bytesPurgedAt` set: show it as erased (no image to render — its renditions
  no longer serve), and hide attach, publish and restore. The API answers `MEDIA_NOT_FOUND`
  (already translated) if they are tried.
- An **archived** asset: say it can be restored until `archivedAt` +
  `MEDIA_ARCHIVED_ERASURE_DAYS` (30), after which it is erased.
- Optionally, an unattached asset: it is erased `MEDIA_UNATTACHED_ERASURE_DAYS` (30) after
  `createdAt` unless it is attached somewhere.

## 4. Web health should report readiness

`/api/health` currently calls the API's liveness. The API now has **`GET /health/ready`**
(no credential): `200 {"status":"ok","checks":{"database":"ok","media":"ok"}}`, or `503` with
`"unavailable"` on the failing check. Suggestion: `/api/health` calls it server-side and
reports `api`, `database` and `media` as `ok`/`unavailable` — no latency, no error text, no
path — and `503` when any is down, `no-store`. The drill already waits on `/api/health`, and an
outside monitor can only reach the web.

## 5. Web logging (production)

The API's rule (README, Logging): no personal data, no request bodies, no photo descriptions
or file names, no session tokens in logs. `apps/web/src` has no `console.*` today. Worth
checking in your lane: Server Action and route-handler errors (Next.js logs an unhandled
error with its message — the same database-detail risk), and the upload route's handling of
the original file name. The web's systemd unit logs to the journal, which
`scripts/ops/systemd/journald-clinic.conf` bounds (1 GB, one month).

## Pending, not for now

Owner decision open: whether an erased photograph's description (`altText`) is erased too.
If yes, `altText` becomes nullable in the media contract and every place the Web renders it
must handle `null` — a coordinated change, not yet requested.
