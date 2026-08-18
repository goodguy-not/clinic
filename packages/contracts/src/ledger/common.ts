import { z } from 'zod';
import { fileNumberSchema } from '../families/common';
import { TARIFF_MAX_PRICE_TOMAN, tomanAmountSchema } from '../money';

/**
 * A recorded reason on a financial act.
 *
 * Required everywhere it appears — voiding a charge, granting a concession,
 * withdrawing one. CLAUDE.md requires every correction to preserve actor, time
 * and reason, and PROJECT_SPEC.md 9 requires the reason to stay readable
 * afterwards. The same shape as `catalogReasonSchema` and
 * `appointmentReasonSchema`, restated here rather than imported so a change to
 * how a booking explains itself cannot silently change how money does.
 */
export const ledgerReasonSchema = z.string().trim().min(1).max(500);

/**
 * The amount a family is relieved of by one adjustment.
 *
 * STRICTLY ABOVE ZERO. `charge_adjustment` only ever reduces, so a zero
 * adjustment is not a small concession — it is a row that records nothing and
 * would still consume a reason, an actor and a line in the family account. An
 * increase is a different fact needing rules that are not approved.
 *
 * BOUNDED ABOVE BY THE GLOBAL AMOUNT CEILING, AND BY NOTHING ELSE. The upper
 * limit here is the same fat-finger guard the ledger enforces in
 * `charge_adjustment_amount_bounds_chk` — one number, reused rather than
 * re-invented — so a mistyped run of digits is refused at entry instead of
 * travelling to PostgreSQL to fail a CHECK and surface as an internal error.
 *
 * WHAT IS STILL NOT STATED HERE is the per-charge rule: "not more than this
 * charge, less what has already been taken off it" depends on rows this request
 * cannot see and is decided by the server under a lock on the parent charge,
 * surfacing as `ADJUSTMENT_EXCEEDS_CHARGE`. A remainder guessed in the browser
 * would be a second answer that can disagree with the only authoritative one.
 * The two bounds are different in kind: this one says the input is a plausible
 * amount of money, that one says the concession is affordable.
 *
 * The digit shape is re-tested before each conversion, because Zod runs
 * remaining checks after a failed one and `BigInt('')` throws.
 */
export const adjustmentAmountTomanSchema = tomanAmountSchema
  .refine(
    (value) => /^\d+$/.test(value) && BigInt(value) > 0n,
    'an adjustment must reduce the charge by more than zero',
  )
  .refine(
    (value) => /^\d+$/.test(value) && BigInt(value) <= BigInt(TARIFF_MAX_PRICE_TOMAN),
    'exceeds the maximum amount the ledger accepts',
  );

/**
 * How much of one concession the THERAPIST bears, when the clinic and the
 * therapist have agreed to share it (Milestone 8, checkpoint C1).
 *
 * ZERO IS LEGITIMATE HERE, unlike on `adjustmentAmountTomanSchema` above, and
 * the difference is the whole distinction between the two fields. A zero
 * ADJUSTMENT is a row that records nothing; a zero THERAPIST PORTION is the
 * ordinary, overwhelmingly common case — a concession the clinic bears in full,
 * stated explicitly instead of left to be inferred. CLAUDE.md requires exactly
 * that for a therapist who does not participate in discounts: the therapist
 * amount is zero and the clinic bears all of it, even when that makes the
 * clinic net negative.
 *
 * THE CLINIC PORTION IS NEVER SUBMITTED, AND THAT IS WHAT MAKES AN INVALID
 * SPLIT UNREPRESENTABLE. CLAUDE.md requires the therapist amount plus the
 * clinic amount to equal the total family discount, always. A request carrying
 * both halves could state a pair that does not add up, and the server would
 * then have to decide which of the caller's two numbers to believe. So the
 * request carries the TOTAL and the THERAPIST'S SHARE OF IT, and the clinic
 * takes the exact residual — the same residual discipline the therapist/clinic
 * gross split uses, for the same reason.
 *
 * BOUNDED BY THE CONCESSION ITSELF, and that bound is stated on the request
 * rather than here, because it is a relationship between two fields. What is
 * bounded here is the plausibility of the number in isolation, exactly as
 * everywhere else in this package.
 *
 * WHAT IS STILL NOT STATED ANYWHERE IN THE REQUEST is whether the therapist has
 * a share to bear the portion against at all, and whether bearing it would
 * drive their net below zero — which CLAUDE.md forbids. Both depend on the
 * session's rating, which this request cannot see; the server decides them and
 * answers `ADJUSTMENT_SPLIT_INVALID`.
 */
export const therapistDiscountPortionTomanSchema = tomanAmountSchema.refine(
  (value) => /^\d+$/.test(value) && BigInt(value) <= BigInt(TARIFF_MAX_PRICE_TOMAN),
  'exceeds the maximum amount the ledger accepts',
);

/**
 * The child a charge belongs to, as a family account prints them.
 *
 * Balance is family-level and every charge identifies the child (CLAUDE.md,
 * non-negotiable rules), so this is what makes the account readable rather than
 * a column of uuids.
 *
 * Deliberately NOT `appointmentChildSummarySchema`: that shape carries
 * `familyId` so a day list can hop to the account, and inside the account the
 * family is already named by the response around it. Nothing sensitive appears
 * here either — no national identifier, no phone number, no birth date.
 */
export const chargeChildSummarySchema = z.strictObject({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  fileNumber: fileNumberSchema,
});

export type ChargeChildSummary = z.infer<typeof chargeChildSummarySchema>;

/** The default and the ceiling for one page of an account. */
export const LEDGER_PAGE_SIZE_DEFAULT = 25;
export const LEDGER_PAGE_SIZE_MAX = 100;

/**
 * Offset paging, not a cursor.
 *
 * A family account is read by a person looking for a session they remember, on
 * a list that is tens of rows for a family and not thousands. Page numbers are
 * what that person can navigate; a cursor would buy stability under concurrent
 * insertion that this read does not need — financial history is append-only and
 * ordered by a service date that does not move.
 *
 * Both fields are coerced because they arrive as query string values.
 */
export const ledgerPageQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(LEDGER_PAGE_SIZE_MAX)
    .default(LEDGER_PAGE_SIZE_DEFAULT),
});

export type LedgerPageQuery = z.infer<typeof ledgerPageQuerySchema>;

/**
 * Where the page sits in the whole result.
 *
 * `total` is the number of rows the filter matches, not the number returned, so
 * an interface can render "۲۶ تا ۵۰ از ۳۱۲" without a second request. `hasMore`
 * is stated by the server rather than derived from the three numbers by every
 * consumer, for the reason `outcomeUnresolved` is on the day view: two screens
 * doing the same arithmetic eventually disagree.
 */
export const pageInfoSchema = z.strictObject({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

export type PageInfo = z.infer<typeof pageInfoSchema>;
