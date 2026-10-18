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
  // Deactivating a family that owes money or holds credit, without acknowledging
  // the amount (or acknowledging an amount that is no longer true). The details
  // carry the family's current balance (`familyBalanceSchema`); nothing changed.
  'FAMILY_BALANCE_UNACKNOWLEDGED',
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
  // An outcome recorded too early (M10-A10, T-020), in Asia/Tehran by the
  // database clock, for every role. A session on a later date than today takes
  // no outcome at all; on its own date attendance may be recorded at any time,
  // but completion and no-show only from its scheduled start. Two codes because
  // the fixes differ: "wait for that day" and "wait until it starts". Details:
  // `appointmentOutcomeTimingDetailsSchema`.
  'APPOINTMENT_OUTCOME_DATE_IN_FUTURE',
  'APPOINTMENT_OUTCOME_BEFORE_START',
  // A this-and-future change that would place an occurrence at an instant that
  // has already passed (M10-A10, T-023) — typically moving the weekday earlier
  // in the current week. The series is planning; the past is not re-planned.
  'RECURRENCE_OCCURRENCE_IN_PAST',
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
  // A service is public only with an address to be public AT (M10-A9). Refused
  // on create and on the state an update would leave, rather than stored as a
  // flag the website silently ignores.
  'SERVICE_PUBLIC_ADDRESS_REQUIRED',
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
  // A public space that is not there (Milestone 9.5, checkpoint A7). Its own
  // code rather than a shared one, because every entity in this list has its
  // own and because the sentence a manager needs names the thing they were
  // looking for.
  //
  // THERE IS DELIBERATELY NO CODE FOR A HANDWRITTEN TESTIMONIAL WITHOUT A
  // TRANSCRIPTION. The transcription is the `body`, `body` is required by the
  // request contract and by a NOT NULL column, and a handwritten testimonial
  // with nothing written down is refused as `VALIDATION_FAILED` — a malformed
  // request rather than a domain state. A second code would suggest there is a
  // legitimate half-written state that this product will hold, and there is
  // not: the picture is never the meaning.
  'PUBLIC_SPACE_NOT_FOUND',
  // An editorial slot on the clinic profile that is not there (Milestone 9.5,
  // checkpoint A8). It can only be reached by addressing an id that does not
  // exist, because the slots themselves are created by a migration and neither
  // created nor deleted at runtime.
  //
  // THERE IS DELIBERATELY NO CODE FOR AN EMPTY SLOT. An entry with no heading
  // is not an error state: it is a block the clinic has not written yet, the
  // public read omits it, and the manager read shows it as the empty box it is.
  'CLINIC_CONTENT_ENTRY_NOT_FOUND',
  // There is deliberately NO `ARTICLE_SLUG_REQUIRED` or `ARTICLE_INCOMPLETE`:
  // an article's slug, title and body are NOT NULL from creation, so a draft is
  // always publishable and there is no half-written state to refuse.

  // The public request form (Milestone 9, checkpoint A3). ONE CODE, AND IT IS
  // THE ONLY REFUSAL A STRANGER CAN BE TOLD ABOUT BEYOND `VALIDATION_FAILED`.
  //
  // `PUBLIC_REQUEST_THROTTLED` is the abuse control seen from the visitor's
  // side: too many submissions from one place in too short a time. It says
  // "later", it names no limit, no counter and no window, and it is deliberately
  // indifferent to WHAT was submitted — the point of a rate limit that cannot be
  // used as an oracle is that the answer turns only on the caller.
  //
  // THERE IS DELIBERATELY NO `PUBLIC_REQUEST_DUPLICATE`. A repeated submission
  // succeeds, with the ordinary success body, and stores nothing. A code saying
  // otherwise would let anybody holding a mobile number ask this endpoint
  // whether that person has already contacted the clinic, which is a disclosure
  // about a real family made to a stranger — see
  // `publicRequestSubmissionResponseSchema`.
  //
  // AND NO CODE ABOUT AN INBOX, A REQUEST STATUS, A CONVERSION OR A RETENTION
  // RUN. Those are checkpoint A4, and none of them is a refusal an anonymous
  // visitor could ever receive.
  'PUBLIC_REQUEST_THROTTLED',

  // The website request inbox (Milestone 9, checkpoint A4). THREE CODES, ALL
  // THREE INTERNAL, AND NO ANONYMOUS CALLER CAN EVER RECEIVE ONE. The A3 comment
  // above said a code about an inbox, a status or a conversion would belong to
  // this checkpoint; these are those codes, and they are refusals shown to a
  // COLLEAGUE processing a message, never to the person who sent it.
  //
  // `WEBSITE_REQUEST_NOT_FOUND` is the ordinary miss. It is the answer for an id
  // that never existed and for one that does — there is no state in which a
  // request is hidden from a caller holding `website_request.read`, so the code
  // never has to distinguish "gone" from "not yours".
  //
  // `WEBSITE_REQUEST_TRANSITION_INVALID` is the accepted lifecycle refusing a
  // move: back to `NEW`, out of `CLOSED`, out of `CONVERTED_TO_FAMILY`, or into
  // the status a request is already in. It names no status and no rule, because
  // the legal moves are stated in `WEBSITE_REQUEST_LEGAL_TRANSITIONS` and the
  // screen offers exactly those — a caller receiving this has raced somebody
  // else, and the honest answer is "reload and look at it again".
  //
  // `WEBSITE_REQUEST_ALREADY_LINKED` is the one-family rule seen from the
  // colleague's side, and it is deliberately the same answer whether the second
  // link names the SAME family or a different one. A link is a claim about whose
  // message this was; re-pointing it at another family would rewrite that claim,
  // and confirming "yes, it is already that family" would make this route a way
  // to test family membership against a request id.
  //
  // THERE IS NO CODE FOR THE RETENTION RUN. It is an operator command with no
  // caller to answer: it purges what is eligible, says how many, and refuses
  // nothing.
  'WEBSITE_REQUEST_NOT_FOUND',
  'WEBSITE_REQUEST_TRANSITION_INVALID',
  'WEBSITE_REQUEST_ALREADY_LINKED',

  // The media subsystem (Milestone 9.5, checkpoint A5). NINE CODES, AND THE
  // SPLIT BETWEEN THEM IS THE SPLIT BETWEEN "your file is wrong" AND "your
  // screen is stale".
  //
  // THE FIRST FOUR ARE ABOUT BYTES, AND EVERY ONE OF THEM IS DECIDED FROM THE
  // BYTES. A filename and a browser-supplied content type are things the caller
  // chose; neither is consulted, so a `.jpg` that is really a PDF is
  // `MEDIA_TYPE_UNSUPPORTED` and not a corrupt JPEG.
  //
  // `MEDIA_TYPE_UNSUPPORTED` covers SVG explicitly, and that is the case worth
  // naming: this workflow is for photographs, and an SVG is a document with a
  // script engine attached. `MEDIA_FILE_CORRUPT` is a file of an accepted type
  // that no decoder can read — truncated in transit, or never an image at all.
  // `MEDIA_FILE_TOO_LARGE` is raised WHILE the body is arriving, so the process
  // never holds an oversized upload. `MEDIA_IMAGE_UNUSABLE` is a decodable
  // photograph the clinic will not publish: smaller than the minimum on either
  // side, or a decompression bomb whose pixel count exceeds the ceiling. One
  // code for both, because the fix is the same — send a different photograph —
  // and because telling a caller which internal ceiling they hit tells them how
  // to sit exactly beneath it.
  'MEDIA_NOT_FOUND',
  'MEDIA_TYPE_UNSUPPORTED',
  'MEDIA_FILE_TOO_LARGE',
  'MEDIA_FILE_CORRUPT',
  'MEDIA_IMAGE_UNUSABLE',
  // The remaining four are about the LIFECYCLE, and all four are conflicts with
  // a state somebody else already put the row in.
  //
  // `MEDIA_ARCHIVED` refuses attaching or publishing an asset a manager has
  // taken out of circulation. `MEDIA_ATTACHMENT_NOT_FOUND` covers a missing
  // attachment and one already detached alike — the fix is the same, attach it
  // again. `MEDIA_ALREADY_ATTACHED` is the same photograph offered twice to one
  // owner. `MEDIA_ATTACHMENT_PUBLISHED` refuses DETACHING something the public
  // can currently see: unpublish first, which is a manager act, so that taking
  // an image off a live page can never be done by the weaker authority that put
  // it there.
  //
  // THERE IS DELIBERATELY NO `MEDIA_FORBIDDEN`, NO `MEDIA_NOT_PUBLISHED` AND NO
  // `MEDIA_UNATTACHED`. An anonymous request for something that is not public
  // receives `MEDIA_NOT_FOUND` and nothing else, whatever the reason —
  // unattached, drafted, unpublished, archived, owner unpublished, or simply
  // never existed. Distinguishing them would let a stranger enumerate the
  // clinic's unpublished photographs one identifier at a time, which is exactly
  // the disclosure the publication rule exists to prevent. It is the reasoning
  // behind `DRAFT_NOT_FOUND` and `AUTH_INVALID_CREDENTIALS`, applied to bytes.
  'MEDIA_ARCHIVED',
  'MEDIA_ATTACHMENT_NOT_FOUND',
  'MEDIA_ALREADY_ATTACHED',
  'MEDIA_ATTACHMENT_PUBLISHED',

  // Session outcomes and no-show penalties (M10.5 phase 1, T-028 and T-022).
  // Each has a details schema stated beside the contract that raises it.
  //
  // A different one-click answer for a session that is already closed or
  // cancelled. Details: `appointmentOutcomeAlreadyRecordedDetailsSchema`.
  'APPOINTMENT_OUTCOME_ALREADY_RECORDED',
  // A discount whose two stated portions do not add up to it (D10). Details:
  // `adjustmentPortionsDetailsSchema`.
  'ADJUSTMENT_PORTIONS_DO_NOT_ADD_UP',
  // The decision named does not exist. No details.
  'NO_SHOW_DECISION_NOT_FOUND',
  // A decision already stands for this seat: a different second decision, an
  // absence corrected to present, or a reopen. Withdraw it first. Details:
  // `noShowDecisionExistsDetailsSchema`.
  'NO_SHOW_DECISION_EXISTS',
  // Withdrawing a decision already withdrawn: the screen is stale. No details.
  'NO_SHOW_DECISION_ALREADY_WITHDRAWN',
  // Only an absent seat of a completed session can be decided. Details:
  // `noShowNotDecidableDetailsSchema`.
  'NO_SHOW_NOT_DECIDABLE',
  // A penalty on a session priced FREE: any percentage of zero is zero, so only
  // "no penalty" is possible. No details.
  'NO_SHOW_PENALTY_ON_FREE_SESSION',
  // A penalty charge is withdrawn by withdrawing its decision, never voided
  // directly. Details: `penaltyVoidThroughDecisionDetailsSchema`.
  'NO_SHOW_PENALTY_VOID_THROUGH_DECISION',

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
