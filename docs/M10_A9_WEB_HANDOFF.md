# M10 A9 — partial-day closures and the service address rule: what the Web tier needs (for Agent B)

Agent A, Milestone 10, checkpoint A9 (tour item T-012; DECISION_LOG, 2026-10-16). The API
half is done. In `apps/web` Agent A changed only what kept the build and tests green:

- `src/server/errors-fa.ts`: a Persian message for the new `SERVICE_PUBLIC_ADDRESS_REQUIRED`
  (the coverage test fails the build without one). Wording is the coordinator's to adjust.
- `src/app/(internal)/availability-pages.test.ts`: `closedRanges: []` on the resolved-day
  fixture (the field is now required).
- `src/server/api-client.test.ts`: `affectedAppointments: []` and `closedRanges: []` on two
  mocked responses, so they match the contract.

**What the Web does today, unchanged:** the availability page still records whole-day
closures exactly as before (the form sends no times). A partial closure made through the API
is **listed as «روز بسته» with no times** by the current exception list (it shows times only
for extra windows), and the resolved-day panel does not mention it — the windows it shows are
already correct. Items 1–3 fix that.

## 1. Recording a partial closure (`/therapists/{id}/availability`, «ثبت روز بسته»)

Route unchanged: `POST /availability/therapists/:therapistId/exceptions`, permission
`availability.manage` (manager only — no new permission). Body:
`createAvailabilityExceptionRequestSchema` (`packages/contracts/src/appointments/availability.ts`).
For a closure:

| Field                  | Meaning                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `isAvailable`          | `false`                                                                                                           |
| `exceptionDate`        | `YYYY-MM-DD` (Gregorian), as today                                                                                |
| `startTime`, `endTime` | **new, optional.** Both absent or both `null` = the whole day (today's behaviour). Both `HH:MM` = that range only |
| `reason`               | as today                                                                                                          |

- Times are the clinic's wall clock (Asia/Tehran), `00:00`–`23:59`, end after start. "Leaves
  at 14:00" is `14:00`–`23:59`; "arrives at 11:00" is `00:00`–`11:00` (or from the start of
  the day's hours). Use the same 24-hour Persian-digit time input as the extra-window form
  (T-011) and convert to `HH:MM` ASCII before parsing, as that form does.
- In `src/server/availability-forms.ts`, `availabilityExceptionFromBody` for `kind === 'closed'`
  should pass `startTime`/`endTime` from the body **only when the manager chose "part of the
  day"**, and omit them (or send `null`) for "the whole day". Suggested form shape: a choice
  «کل روز» / «بخشی از روز», with the two time inputs shown only for the second (the T-013
  pattern). Validate with the contract schema in the BFF route, as today.
- Refusals the form must explain (all through the existing `failureRedirect` + `errors-fa`):
  - `400 VALIDATION_FAILED` — one time without the other, end not after start, a bad time.
  - `409 AVAILABILITY_EXCEPTION_CONFLICT` — the date already has a closure overlapping this
    range (a whole-day closure overlaps every closure of its date), or a partial closure
    would overlap an extra window on that date. Its current Persian message («برای این
    تاریخ، استثنای دیگری از قبل ثبت شده است.») still fits; it could name overlapping hours.
    Back-to-back ranges are accepted.
  - `422 THERAPIST_INACTIVE`, `404 THERAPIST_NOT_FOUND` — as today.

## 2. Showing it (same page)

- **Exception list:** for `isAvailable === false` with `startTime`/`endTime` not null, show
  the range (same formatting as an extra window) and a badge distinguishing it from a
  whole-day closure (e.g. «بسته (بخشی از روز)» beside «روز بسته»). Removal is the existing
  `DELETE`, unchanged.
- **Resolved-day panel:** `GET /availability/resolution` now returns `closedRanges:
[{ startTime, endTime, reason }]`, in start order — the partial closures of that date,
  already subtracted from `windows`. `isClosed` still means **whole day only** and is
  `false` on a day with only partial closures. Show `closedRanges` beside the windows ("closed
  11:00–12:00: reason"). Do not subtract anything in the Web: `windows` is the answer.

## 3. The sessions a closure leaves outside the therapist's hours (new)

A closure — whole-day **or** partial — cancels and moves nothing. The scheduled sessions it
leaves outside the therapist's hours are surfaced two ways; both return the same item shape,
`closureAffectedAppointmentSchema`:

| Field                          | Meaning                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `appointmentId`                | link to `/appointments/{id}`                                                                      |
| `seriesId`                     | non-null for a recurring-series occurrence (link to the series if useful)                         |
| `date`, `startTime`, `endTime` | clinic calendar day and wall-clock times, computed by the API — show these, no conversion         |
| `startsAt`, `endsAt`           | the instants, if needed                                                                           |
| `availabilityOverrideReason`   | non-null when the session was booked there with a recorded override: say "placed deliberately: …" |
| `children`                     | `appointmentChildSummarySchema[]` (name, file number, family id), as on the day view              |

Listed only when the session is `SCHEDULED`, overlaps a closed range of its date, and is not
inside the resolved availability of that date (a session in an extra window on a closed day
is not listed). Order: by start.

1. **At the moment of closing:** the `POST` response is now
   `{ exception, affectedAppointments: [...] }` (always `[]` for an extra window). The BFF
   route redirects after the POST, so it cannot carry the list itself: redirect with
   `?success=exception-added&closed=<date>` (or similar) and let the page read item 2's
   route for that date. If the list is non-empty, show it prominently: "these N sessions
   are still booked inside the closed hours; contact the families and move or cancel them"
   — linking each to the appointment page, where moving and cancelling already exist.
2. **Afterwards:** `GET /availability/therapists/:therapistId/closure-conflicts?from=YYYY-MM-DD&to=YYYY-MM-DD`
   (both required, inclusive, `to >= from`, no maximum span), permission `availability.read`
   (manager and receptionist). Response `closureConflictResponseSchema`:
   `{ appointments: [...] }`. Suggested use: on the availability page, a "sessions in closed
   hours" panel for the selected date or the coming weeks (e.g. today → +60 days), empty
   state when there are none. The list is computed on every read: removing a closure or
   moving the session makes the item disappear; nothing is stored.

Add `getClosureConflicts(therapistId, { from, to }, context)` to `api-client.ts`, parsing with
`closureConflictResponseSchema`, and a handler-coverage entry as for the other availability
reads. Never compute conflicts in the Web.

## 4. Booking screens — no change needed

Booking, moving and the recurrence preview already show `APPOINTMENT_OUTSIDE_AVAILABILITY` and
the override field. A session inside a closed range is refused exactly as on a closed day, and
the preview marks that week `outsideAvailability: true`.

## 5. Service form — the address rule is now the API's too

`POST /catalog/services` and `PATCH /catalog/services/:id` refuse a service that would be
public with no address: **`422 SERVICE_PUBLIC_ADDRESS_REQUIRED`**. On an update the effective
state is checked (an omitted `publicSlug` means unchanged). Agent B's form check stays as the
convenience; the BFF routes already map any API error code to `errors-fa`, so nothing else is
required. A legacy row that is public with no address (Milestone 2 data) can no longer be saved
public without an address: the form should prompt for one or for «فقط داخلی».
