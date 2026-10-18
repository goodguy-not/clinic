# M10 A10 — tour batch 2: what the Web tier needs (for Agent B)

Agent A, Milestone 10, checkpoint A10 (owner decisions T-010 revised, T-018, T-020, T-023,
T-024, T-025, and the tariff race; DECISION_LOG, 2026-10-18). The API half is done. In
`apps/web` Agent A changed only what kept the build and the tests green, or what would
otherwise send a field the API now refuses:

| File                                                       | Change                                                                                                                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/errors-fa.ts`                                  | Persian placeholders for `APPOINTMENT_OUTCOME_DATE_IN_FUTURE`, `APPOINTMENT_OUTCOME_BEFORE_START`, `RECURRENCE_OCCURRENCE_IN_PAST` (the coverage test fails without them). Wording is yours. |
| `src/server/catalog-forms.ts`                              | `serviceFormToRequest` no longer sends `publicSlug`; `servicePublicAddressValid` removed.                                                                                                    |
| `src/app/api/catalog/services/{create,update}/route.ts`    | no longer call `servicePublicAddressValid`.                                                                                                                                                  |
| `src/server/content-forms.ts`                              | `articleFormToRequest` no longer sends `publicSlug`.                                                                                                                                         |
| `src/app/api/content/therapist-profiles/settings/route.ts` | no longer sends `publicSlug`.                                                                                                                                                                |
| tests                                                      | `booking-pages.test.ts` (two new preview fields), `catalog-forms.test.ts`, `content-api-client.test.ts`, `content-routes.test.ts`, `public-request-form.test.ts` (age 0–99).                 |

Web typecheck and 1163 Web tests pass. **Nothing visible was changed** — every form still
shows what it showed. §1 has three things that must be done **before this branch is
deployed**, because the forms still ask for an address the API no longer takes.

## 1. Nobody types a web address (T-010) — before deploy

The API assigns every service, therapist and article its address when the row is created
(eight characters such as `k7m2q9xd`; never changes, never reused). Create/update requests
for service, therapist profile and article **refuse** `publicSlug` (`VALIDATION_FAILED`);
every response still carries `publicSlug` (always set now, though the schema type stays
`string | null`).

1. **Service form** (`catalog/services/service-form.tsx`): remove the address input, its
   `required`/`pattern`, the `slug` state and the submit-time check that focuses
   `#publicSlug` — **today a manager cannot create a service as public** (the empty
   required input blocks the submit) and a typed value is silently dropped. Show the
   assigned address read-only (`{origin}/services/{service.publicSlug}`) on edit, public or
   not; on create say it will be assigned. Keep the first-publication confirm if you like
   (the address is now known before publication) — it is no longer a warning about typing.
2. **Article form** (`content/article-form.tsx`): remove the required address input —
   **today an article cannot be created without typing one**, and the typed value is
   dropped. Show the assigned address on edit (the editorial workspace already prints
   `/articles/{publicSlug}`).
3. **Therapist profile editor** (`content/therapists/[id]/therapist-profile-editor.tsx`):
   remove the address input and its hidden copy; show `/team/{publicSlug}` read-only.

Remove the address hints/copy that mention «حروف انگلیسی کوچک». `SERVICE_PUBLIC_ADDRESS_REQUIRED`
and `PUBLIC_SLUG_TAKEN` are unreachable now (keep their translations; codes are never
removed). Cache invalidation is unchanged: mutation responses still name the slug.

## 2. Outcomes only once the session has happened (T-020)

Server rule, every role, Asia/Tehran: a session on a **later date** takes no outcome at all
→ `APPOINTMENT_OUTCOME_DATE_IN_FUTURE` (422). On **its own date**, «حاضر» is accepted at
any time, but «انجام شد» (complete) and «غایب» (no-show) only from the start time →
`APPOINTMENT_OUTCOME_BEFORE_START` (422). Earlier dates: everything, as before.

`error.details` (`appointmentOutcomeTimingDetailsSchema`): `outcome`
(`COMPLETED`|`ATTENDED`|`NO_SHOW`), `sessionDate`, `startTime` (`HH:MM`), `startsAt`, `today`.

- Suggested messages: future date — «این جلسه برای {تاریخ جلالی} است؛ نتیجه را از همان
  روز می‌توان ثبت کرد.» Before start — «ثبت انجام/غیبت از ساعت {startTime} ممکن است؛ حضور
  کودک را همین حالا می‌توانید ثبت کنید.»
- Optional but kind: in the day view and the appointment page, disable «انجام شد» and
  «غایب» before the start (and all three on a future date), with the same sentence as a
  hint. The server stays the authority — the browser clock is not trusted.

## 3. Conflicts name every busy dimension (T-024)

Codes unchanged (`APPOINTMENT_CHILD_CONFLICT` / `_THERAPIST_` / `_ROOM_`: the first busy one,
in that order). New `error.details` (`appointmentConflictDetailsSchema`):

```
{ conflicts: [ { resource: 'CHILD'|'THERAPIST'|'ROOM', resourceId, appointmentId, startsAt, endsAt }, … ] }
```

Every busy dimension, each with every session in the way, never empty. `resourceId` is the
child, therapist or room **the form submitted**, so name it from the form's own options.
Suggested: one line per entry — «{نام کودک} در این زمان جلسهٔ دیگری دارد (۱۰:۰۰ تا ۱۰:۴۵)»,
«{درمانگر} …», «{اتاق} …» — times in Tehran, Persian digits; optionally link
`/appointments/{appointmentId}`. Raised by: book, move (`PATCH /appointments/:id`), series
create, series update-from. `booking-action.ts` already maps the three codes; it needs to
read `details` too.

## 4. Outside availability says why (T-025)

`APPOINTMENT_OUTSIDE_AVAILABILITY` now has `error.details` (`availabilityRefusalDetailsSchema`):
`reason` (`OUTSIDE_WORKING_HOURS` | `CLOSED_DAY` | `PARTIAL_CLOSURE`), `date`, `startTime`,
`endTime`, `availableWindows[]`, `closedRanges[]`, `overridable` (this user holds
`appointment.override_availability`).

- Suggested: `CLOSED_DAY` «درمانگر در این روز حضور ندارد.»; `PARTIAL_CLOSURE` «درمانگر از
  {start} تا {end} در دسترس نیست.» (from `closedRanges`); `OUTSIDE_WORKING_HOURS` «ساعت
  حضور درمانگر در این روز: {windows}» or «… در این روز ساعت حضوری ثبت نشده است.» when empty.
- If `overridable`, point to / reveal the override-reason field («اگر درمانگر پذیرفته است،
  دلیل را بنویسید و دوباره ثبت کنید.»); if not, say a colleague with the permission can.

## 5. Series: «این جلسه و جلسه‌های بعد» may change the weekday (T-023)

`PATCH /appointment-series/:id/update-from` body gains **`weekday`** (optional, Saturday-first
0–6; absent or `null` = keep each occurrence's date, today's behaviour). With it, every
remaining scheduled occurrence from the pivot moves to that weekday **inside its own
Saturday–Friday week**, at the new `startTime` — same appointments, nothing cancelled,
earlier sessions untouched. All or nothing.

**New route** `POST /appointment-series/:id/update-from/preview` — same body, permission
`appointment.update`, writes nothing. Response `seriesUpdatePreviewResponseSchema`:
`occurrences[]` (`appointmentId`, `currentStartsAt`, `date`, `startsAt`, `endsAt`,
`unchanged`, `outsideAvailability`, `outsideAvailabilityReason`, `conflicts[]`, `blockedBy`),
`blockedCount`, `applicable`. Suggested flow, like series creation: fill the form → preview
table (old → new date/time, a reason or conflict line per blocked row, «بدون تغییر» rows
greyed) → apply only when `applicable` or with an override reason for availability-only
blocks. New code `RECURRENCE_OCCURRENCE_IN_PAST` (422, `details.appointmentId`,
`details.startsAt`): moving the weekday earlier in the current week would put a future
session in the past — suggest choosing the next session as the pivot.

The series creation preview's occurrences also gained `outsideAvailabilityReason` and
`conflicts` (same shapes); show them like §3/§4. `blockedBy` may now also be
`RECURRENCE_OCCURRENCE_IN_PAST` (update preview only).

## 6. Public request: child age 0–99 (T-018)

The contract bound is 99 (was 120); a submission of 100+ is `VALIDATION_FAILED` and your form
already shows «لطفاً سن فرزندتان را به سال کامل وارد کنید.». Optional: `maxLength={2}` on the
age input and «(۰ تا ۹۹)» in the helper. Stored requests are unaffected.

## 7. Staging, when it is next upgraded (Agent A / owner, not Agent B)

- The migration gives every service and therapist without an address one, and a service
  that was flagged public **without** an address becomes private (it was never on the site);
  each change is an audit row by SYSTEM naming the migration. Proved on a pre-A10 database
  with four legacy service shapes and one therapist: public-without-address → private with
  an address; private-without → address; published `speech-therapy` and private
  `draft-address` → unchanged; therapist → address; any later change refused.
- Read-only check for T-020 on existing data (nothing written):

```sql
SELECT a.id, a.starts_at, a.status, ap.attendance
FROM appointment a
JOIN appointment_participant ap ON ap.appointment_id = a.id
WHERE (clinic_date(a.starts_at) > clinic_date(now())
       AND (a.status = 'COMPLETED' OR ap.attendance <> 'PENDING'))
   OR (a.starts_at > now() AND (a.status = 'COMPLETED' OR ap.attendance = 'NO_SHOW'));
```
