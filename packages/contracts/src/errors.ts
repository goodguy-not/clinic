import { z } from 'zod';

/**
 * Stable error codes shared by NestJS and Next.js.
 *
 * These strings are the contract. NestJS returns a code and a short English
 * developer message; Next.js maps the code to Persian for the browser
 * (CLAUDE.md, Architecture boundary: NestJS never returns Persian text).
 *
 * A code is never renamed or reused for a different meaning — Next's Persian
 * map is keyed by it, and a test iterates this list so a new code without a
 * translation fails the build.
 */
export const ERROR_CODES = [
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_SESSION_INVALID',
  'AUTH_SESSION_EXPIRED',
  'AUTH_PASSWORD_CHANGE_REQUIRED',
  'AUTH_FORBIDDEN',
  'AUTH_INTERNAL_KEY_INVALID',
  'AUTH_CSRF_INVALID',
  'AUTH_ORIGIN_REJECTED',
  'VALIDATION_FAILED',
  'PASSWORD_POLICY_VIOLATION',
  'USER_NOT_FOUND',
  'USER_USERNAME_TAKEN',
  'USER_SELF_MODIFICATION_FORBIDDEN',
  'USER_LAST_MANAGER',

  // Clinic reference data.
  'THERAPIST_NOT_FOUND',
  'SERVICE_NOT_FOUND',
  'ROOM_NOT_FOUND',
  'TARIFF_NOT_FOUND',
  'SERVICE_NAME_TAKEN',
  'ROOM_NAME_TAKEN',
  // A tariff may only price a duration its service actually offers, and a
  // duration may not be withdrawn while a tariff still prices it. Both are the
  // same foreign key seen from opposite ends, and they are separate codes
  // because they are separate mistakes with separate fixes.
  'TARIFF_DURATION_NOT_ALLOWED',
  'SERVICE_DURATION_IN_USE',
  'TARIFF_OVERLAP',
  'TARIFF_ALREADY_VOIDED',
  'TARIFF_SCOPE_MISMATCH',
  // Pricing something the clinic no longer offers is almost always a mistake.
  // Resolution of a past date is unaffected: history does not stop being true
  // when a service is retired.
  'SERVICE_INACTIVE',
  'THERAPIST_INACTIVE',
  // No tariff covers the requested service date. A visible error rather than a
  // silent zero (PROJECT_SPEC.md 5).
  'TARIFF_MISSING',

  // Families and children.
  'FAMILY_NOT_FOUND',
  'CHILD_NOT_FOUND',
  // A likely duplicate was found and has not been acknowledged. The details
  // carry the candidates the user must look at and a draft token; the write did
  // not happen. Names alone never produce this — only a shared guardian mobile,
  // or the same name and birth date inside one family.
  'FAMILY_POSSIBLE_DUPLICATE',
  'CHILD_POSSIBLE_DUPLICATE',
  // Hard uniqueness, with no override: a national identifier names exactly one
  // person, and one paper file belongs to one child.
  'CHILD_NATIONAL_ID_TAKEN',
  'CHILD_LEGACY_FILE_NUMBER_TAKEN',
  // Exactly one primary guardian, and that one reachable on a mobile or a
  // landline.
  'FAMILY_PRIMARY_GUARDIAN_INVALID',
  'FAMILY_INACTIVE',
  // Measured against the clinic's own calendar day in Asia/Tehran, never the
  // server's.
  'CHILD_BIRTH_DATE_IN_FUTURE',
  // One code for missing, expired, already consumed, wrong user, wrong session
  // and wrong purpose. A draft token is a bearer credential, and distinguishing
  // those conditions would tell its holder which one they tripped — the same
  // reasoning that makes AUTH_INVALID_CREDENTIALS cover four login failures.
  'DRAFT_NOT_FOUND',

  // Appointments. Every code below is raised by an endpoint as of Milestone 4.
  'APPOINTMENT_NOT_FOUND',
  'APPOINTMENT_SERIES_NOT_FOUND',
  'APPOINTMENT_PARTICIPANT_NOT_FOUND',
  // Three separate conflicts, never one `APPOINTMENT_CONFLICT`. Each names a
  // different resource, each is resolved by changing a different field, and the
  // interface has to say which one is busy for the receptionist to fix it
  // without guessing. They are raised from three named PostgreSQL exclusion
  // constraints, so the code is decided by which constraint fired rather than
  // by a re-read that could disagree with it.
  'APPOINTMENT_THERAPIST_CONFLICT',
  'APPOINTMENT_ROOM_CONFLICT',
  'APPOINTMENT_CHILD_CONFLICT',
  // The start, end and duration do not describe one coherent window.
  'APPOINTMENT_TIME_INVALID',
  // The service does not offer this session length. Distinct from
  // `TARIFF_DURATION_NOT_ALLOWED`, which is the same foreign key seen while
  // pricing rather than while booking: different mistake, different fix.
  'APPOINTMENT_DURATION_NOT_ALLOWED',
  // The requested status change is not a permitted transition from the current
  // one — completing a cancelled appointment, cancelling a completed one.
  'APPOINTMENT_TRANSITION_INVALID',
  // Booked outside the therapist's recurring windows, or on a day a dated
  // exception closes. PROJECT_SPEC.md 5 requires this to be prevented or
  // explicitly authorized: it is refused unless the caller holds
  // `appointment.override_availability` AND states a reason, which is then
  // recorded on the appointment and in the audit row of the change that carried
  // it. It is the ONLY overridable scheduling rule.
  'APPOINTMENT_OUTSIDE_AVAILABILITY',
  // The weekly rule the clinic will not accept: a last date earlier than the
  // first session, more than `RECURRENCE_OCCURRENCES_MAX` sessions, or a session
  // beyond `RECURRENCE_HORIZON_MONTHS` (PROJECT_SPEC.md 6). One code, because
  // the fix is the same in all three cases: change the bound.
  'RECURRENCE_RULE_INVALID',
  // A working window whose end is not after its start, or an exception that
  // closes a day and carries times anyway.
  'AVAILABILITY_WINDOW_INVALID',
  // Two recurring windows describe the same weekday and overlapping hours.
  // Refused rather than merged: a recurring window is current configuration and
  // carries no dates, so a therapist's week has exactly one reading and two rows
  // covering one hour would make "is she working then?" a question with two
  // answers.
  'AVAILABILITY_WINDOW_OVERLAP',
  // Two dated exceptions collide on one date — two extra windows over the same
  // hours, two closed days, or a closed day and an extra window on the same
  // date, which is a contradiction rather than a refinement.
  'AVAILABILITY_EXCEPTION_CONFLICT',
  // The exception named does not exist, or belongs to a different therapist.
  'AVAILABILITY_EXCEPTION_NOT_FOUND',
  // Booking something the clinic no longer offers. `SERVICE_INACTIVE` and
  // `THERAPIST_INACTIVE` already exist for the other two.
  'ROOM_INACTIVE',
  'CHILD_INACTIVE',
  // The two catalog compatibility rules, separate because they are separate
  // mistakes with separate fixes: one is corrected by choosing another
  // therapist, the other by choosing another room. Each is an allow-list that
  // is enforced only when the clinic has recorded one — an empty list is
  // "unrestricted", not "supports nothing".
  'APPOINTMENT_THERAPIST_SERVICE_NOT_SUPPORTED',
  'APPOINTMENT_ROOM_SERVICE_NOT_ALLOWED',

  // The ledger. Eight codes, and `TARIFF_MISSING` is reused rather than
  // duplicated as a charge-shaped variant: a session whose date no tariff covers
  // is the same fact whether it is met while pricing or while charging, and one
  // code keeps one Persian message and one fix — record the tariff.
  'CHARGE_NOT_FOUND',
  // Voiding a charge that is already void. Separate from `CHARGE_VOIDED`
  // because they are separate mistakes: this one means the correction has
  // already happened, and the caller is looking at a stale screen.
  'CHARGE_ALREADY_VOIDED',
  // Acting on a voided charge — adjusting it, or adjusting an adjustment of it.
  // The charge no longer stands, so there is nothing to reduce, and the fix is
  // to re-post rather than to retry.
  'CHARGE_VOIDED',
  // A valid primary charge already exists for this participant. It is raised
  // where a SECOND charge would otherwise be created — notably by reopening a
  // completed session whose charge still stands, which must be voided first. An
  // explicit re-post does NOT raise it: a retry is idempotent by rule
  // (CLAUDE.md) and returns the existing charge as `ALREADY_POSTED`.
  'CHARGE_EXISTS_FOR_PARTICIPANT',
  // The session cannot be charged: it is not completed, or this child did not
  // attend it. Only an attended participant of a completed appointment may be
  // charged (CLAUDE.md), and a cancellation and a no-show deliberately create
  // nothing.
  'CHARGE_NOT_ELIGIBLE',
  'ADJUSTMENT_NOT_FOUND',
  'ADJUSTMENT_ALREADY_VOIDED',
  // The concession would take the family's effective amount for the session
  // below zero, counting the adjustments already active against the charge.
  // Also what a `FREE` charge produces: any positive amount exceeds a zero
  // charge, and there is no concession to record on a session never priced.
  'ADJUSTMENT_EXCEEDS_CHARGE',
  // `ADJUSTMENT_SPLIT_INVALID` NOW EXISTS, AND IT IS LISTED WITH SETTLEMENT
  // BELOW RATHER THAN HERE. Through Milestone 5 there was deliberately no such
  // code: the adjustment request carried no therapist portion and there was no
  // split to validate, because every discount was genuinely clinic-borne
  // (DECISION_LOG, 2026-08-14). Milestone 8 approves a therapist-borne portion,
  // so a split becomes submittable and therefore refusable — but what makes it
  // invalid is a settlement fact (no rating, no share to bear the portion
  // against, or a portion that would drive a therapist net below zero), which is
  // why the code sits with the settlement vocabulary and not with the ledger.

  // Money in. Ten codes over two records, and each one names a situation with a
  // fix of its own — the reasoning that gave the ledger eight rather than one
  // `CHARGE_INVALID`.
  'PAYMENT_NOT_FOUND',
  // Voiding a payment that is already void: the correction has already
  // happened and the caller is looking at a stale screen. Separate from
  // `PAYMENT_VOIDED` for the reason `CHARGE_ALREADY_VOIDED` is separate from
  // `CHARGE_VOIDED`.
  'PAYMENT_ALREADY_VOIDED',
  // Acting on a voided payment — offering it as the evidence that a promise was
  // kept. Voided money is not money, so the fix is to record the payment that
  // actually arrived, not to retry.
  'PAYMENT_VOIDED',
  // `receivedOn` is after the clinic's calendar day. A future receipt is not a
  // payment, it is a promise, and the promise record already models one
  // (DECISION_LOG, 2026-08-15 — A payment may be back-dated but never
  // post-dated). Back-dating is unlimited and raises nothing.
  'PAYMENT_DATE_IN_FUTURE',
  // The payment offered belongs to another family. It exists so the composite
  // foreign key `payment_promise_fulfilling_payment_id_family_id_fkey` has a
  // translation rather than surfacing as an internal error; a payment the
  // caller cannot see at all is `PAYMENT_NOT_FOUND`, which is what keeps this
  // code from confirming the existence of another family's money.
  'PAYMENT_FAMILY_MISMATCH',
  // One payment fulfils at most one promise, and the surplus of a large payment
  // is visible as credit rather than as evidence for a second promise
  // (DECISION_LOG, 2026-08-15 — A promise is a calendar fact).
  'PAYMENT_ALREADY_FULFILS_PROMISE',
  // The payment does not cover the promised amount. There is no partial
  // fulfilment model: the fix is to record the payment that covers it, or to
  // reschedule or cancel the promise.
  'PROMISE_PAYMENT_TOO_SMALL',
  'PROMISE_NOT_FOUND',
  // Fulfilling, rescheduling or cancelling a promise that has already ended.
  // Terminal is terminal: `FULFILLED`, `RESCHEDULED` and `CANCELLED` never
  // transition again. It covers the derived `MISSED` reading too — a missed
  // promise is stored `OPEN` and may be resolved normally, so `MISSED` never
  // raises this.
  'PROMISE_NOT_OPEN',
  // A rescheduled successor due before today at the clinic. An intention already
  // overdue at the moment it is agreed records nothing. Creating a promise with
  // a past due date is explicitly allowed and never raises this (DECISION_LOG,
  // 2026-08-15 — A promise may be born late).
  'PROMISE_DUE_DATE_IN_PAST',
  // There is deliberately no `PAYMENT_AMOUNT_INVALID` and no
  // `PROMISE_AMOUNT_INVALID`: a non-positive or oversized amount is refused by
  // the request schema as `VALIDATION_FAILED`, exactly as every other bounded
  // amount in this package is. And no `FAMILY_CREDIT_*` code of any kind —
  // credit is derived from rows, never recorded, so there is no operation on it
  // to refuse.

  // Therapist settlement (Milestone 8). TWELVE CODES, AND EVERY ONE OF THEM IS
  // RAISED BY AN ENDPOINT THE ACCEPTED PLAN CONTAINS. Nothing here anticipates a
  // rule that has not been approved — CLAUDE.md is explicit that a settlement
  // rule not explicitly approved must not be inferred, and a speculative error
  // code is a rule inferred in the one place nobody reviews.
  //
  // The share rule is effective-dated and immutable, exactly as a tariff is, so
  // its codes mirror the tariff's almost name for name. They are separate codes
  // rather than reused ones because they are separate mistakes with separate
  // fixes, and because a Persian message that said "tariff" while a manager was
  // editing a share percentage would be worse than useless.
  //
  // `SHARE_RULE_NOT_FOUND` IS THE THIRTEENTH CODE, AND IT IS A C1 OMISSION
  // CORRECTED IN C2 RATHER THAN A NEW RULE. C1 froze four share-rule codes and
  // a lifecycle whose void and read routes are addressed BY ID; an unknown id
  // therefore had no answer. `SHARE_RULE_MISSING` cannot serve as one — it is
  // 422 and means "no rule covers this SERVICE DATE", the state that must never
  // be read as zero — and answering a mistyped id with it would report the
  // frozen missing-rule condition for a request that named nothing. Every other
  // addressable entity in this package carries its own `*_NOT_FOUND`; this is
  // that pattern, not an extension of the settlement vocabulary.
  'SHARE_RULE_NOT_FOUND',
  'SHARE_RULE_MISSING',
  'SHARE_RULE_OVERLAP',
  'SHARE_RULE_SCOPE_MISMATCH',
  'SHARE_RULE_ALREADY_VOIDED',
  // Rating a session that already carries a valid rating. The fix is to correct
  // the existing one, not to add a second: a session has at most one rating that
  // stands, for the reason a participant has at most one valid primary charge.
  'SESSION_ALREADY_RATED',
  // Acting on a session that has never been rated — reading its settlement
  // figures, or withdrawing a rating that is not there. It is the UNRATED state
  // surfacing as a refusal, and it exists precisely so that state is never
  // answered with a zero.
  'SESSION_NOT_RATED',
  // Withdrawing a rating that is already withdrawn: the correction has already
  // happened and the caller is looking at a stale screen. Separate from
  // `SESSION_NOT_RATED` for the reason `CHARGE_ALREADY_VOIDED` is separate from
  // `CHARGE_VOIDED`.
  'RATING_ALREADY_VOIDED',
  // The rating cannot be withdrawn on its own, because a therapist-borne
  // discount has already been allocated against it. Withdrawing it would leave a
  // concession apportioned to a share that no longer exists, so the fix is to
  // withdraw the concession first or to correct the rating.
  'RATING_HAS_THERAPIST_ALLOCATIONS',
  // The concession's therapist portion cannot be honoured: the session carries
  // no rating to bear it, or the portion would drive the therapist net below
  // zero, which CLAUDE.md forbids outright. It is NOT raised for a portion
  // larger than the concession itself — that shape is refused by the request
  // schema as `VALIDATION_FAILED`, like every other bounded amount here.
  'ADJUSTMENT_SPLIT_INVALID',
  // The range being closed overlaps a period already closed for this therapist.
  // Refused rather than merged or trimmed: an overlap would settle some sessions
  // twice, and silently succeeding is how somebody is paid for one session in
  // two months. Repeating the IDENTICAL request is not an overlap — it is
  // idempotent and answers `ALREADY_CLOSED`.
  'SETTLEMENT_PERIOD_OVERLAP',
  // The closed period asked for does not exist. Named in its own right rather
  // than folded into a generic miss, because a period IS an addressable entity
  // once it has been closed — it has an id, it is listed, and its lines are read
  // by that id.
  'SETTLEMENT_PERIOD_NOT_FOUND',
  // A rating a closed period depends on cannot simply be withdrawn: the closed
  // figure would be left standing with nothing behind it, and a closed period is
  // immutable and never reopened. The fix is the atomic correction, which
  // withdraws and re-rates in one act.
  'RATING_REPLACEMENT_REQUIRED',
  // The replacement rating in a correction does not name the same session charge
  // as the rating being withdrawn. Correcting one therapist's month by re-rating
  // a different session is a mistake only ever noticed by whoever ends up short.
  'RATING_SCOPE_MISMATCH',
  // There is deliberately NO `SETTLEMENT_PERIOD_HAS_UNRATED_SESSIONS`. A close
  // does not fail merely because unrated sessions exist (the frozen Milestone 8
  // rule): it succeeds and records how many it left out, on the period, forever.
  // There is no `SETTLEMENT_PERIOD_CLOSED` either — a closed period is never
  // reopened, so there is no operation on it to refuse — and no code of any kind
  // about a therapist payout, which this milestone does not record.

  // The public website (Milestone 9, checkpoint A2). SEVEN CODES, AND EVERY ONE
  // OF THEM IS A REFUSAL A MANAGER CAN READ AND ACT ON.
  //
  // `PUBLIC_SLUG_IMMUTABLE` IS WHERE THE A1 DATABASE TRIGGER BECOMES A
  // SENTENCE. A slug that has been publicly reachable cannot be changed or
  // cleared, because this product has no redirect, alias or URL-history
  // machinery and a moved URL would silently break every link anybody has
  // already followed (DECISION_LOG, 2026-08-21). The honest answer is a refusal
  // that says so, not a 500 from a trigger and not a silent success that
  // rewrote a promise.
  //
  // `PUBLIC_SLUG_TAKEN` is the unique index seen from the manager's side, and
  // it is deliberately not `SERVICE_NAME_TAKEN`: the slug is unique across
  // EVERY published thing of that kind including private and retired rows, so
  // the conflicting record may be one the manager cannot see in the list they
  // are looking at.
  'PUBLIC_SLUG_IMMUTABLE',
  'PUBLIC_SLUG_TAKEN',
  // A therapist cannot be published without the approved content the opt-in is
  // an opt-in TO: an address and a name they agreed to appear under. Refused
  // rather than filled in from the personnel record, which would be a
  // publication decision nobody made.
  'THERAPIST_PUBLIC_PROFILE_INCOMPLETE',
  'ARTICLE_NOT_FOUND',
  'TESTIMONIAL_NOT_FOUND',
  // The words of an approved testimonial are frozen. Editing them would leave
  // text on a public page that nobody reviewed, so the fix is to withdraw the
  // approval first — which also takes it off the site — and approve the new
  // wording deliberately.
  'TESTIMONIAL_APPROVED',
  // Publishing something the privacy review has not passed. It is the state
  // PROJECT_SPEC.md 11 exists to require, surfacing as a refusal: approval is
  // never inferred from a record existing.
  'TESTIMONIAL_NOT_APPROVED',
  // There is deliberately NO `ARTICLE_SLUG_REQUIRED` or `ARTICLE_INCOMPLETE`:
  // an article's slug, title and body are NOT NULL from creation, so a draft is
  // always publishable and there is no half-written state to refuse. And no
  // code of any kind about a website request, its consent or its inbox — those
  // are later checkpoints, and every one of them touches personal data this one
  // does not accept.

  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorCodeSchema = z.enum(ERROR_CODES);

/**
 * The single error shape every NestJS endpoint returns.
 *
 * `requestId` is always present so a user can quote it to support and an
 * operator can correlate the browser response with the audit row and the
 * server log line that share it.
 */
export const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: errorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.uuid(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
