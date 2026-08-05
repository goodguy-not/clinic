import { z } from 'zod';
import { isoDateSchema } from '../dates';
import { TARIFF_MAX_PRICE_TOMAN, tomanAmountSchema } from '../money';
import { catalogReasonSchema, durationMinutesSchema } from './common';

/**
 * Whether a tariff's family-facing price is a real charge or an intentional
 * zero.
 *
 * Explicit, never inferred from `priceToman === '0'`. The clinic runs genuinely
 * free programmes — complimentary screening, introductory consultation
 * campaigns — and those are a different fact from an ordinarily paid service
 * discounted to nothing for one family. The first is a `FREE` tariff and is set
 * up here; the second stays a `PAID` tariff and is handled later by the
 * discount model, which preserves the original price.
 *
 * A `FREE` tariff says what the family pays. It decides nothing about what the
 * therapist is paid: complimentary-programme compensation and clinic subsidy
 * are an independent settlement decision and are not inferable from this value.
 *
 * Must stay identical to the `tariff_price_mode` PostgreSQL enum.
 */
export const TARIFF_PRICE_MODES = ['PAID', 'FREE'] as const;

export type TariffPriceMode = (typeof TARIFF_PRICE_MODES)[number];

export const tariffPriceModeSchema = z.enum(TARIFF_PRICE_MODES);

/**
 * A paid tariff's price. Strictly above zero — zero is not a cheap price, it is
 * a different price mode, and accepting it here would make `FREE` reachable
 * through the ordinary amount field.
 *
 * Both refinements re-test the digit shape before converting, because Zod runs
 * remaining checks after a failed one and `BigInt('')` throws.
 */
const paidPriceTomanSchema = tomanAmountSchema
  .refine(
    (value) => /^\d+$/.test(value) && BigInt(value) > 0n,
    'a paid tariff must have a price above zero',
  )
  .refine(
    (value) => /^\d+$/.test(value) && BigInt(value) <= BigInt(TARIFF_MAX_PRICE_TOMAN),
    'exceeds the maximum tariff price',
  );

/**
 * An effective-dated price.
 *
 * `therapistId` is null for a general tariff — one that applies to any
 * therapist providing this service and duration. A therapist-specific tariff
 * takes precedence over a general one for the same date.
 *
 * Rows are immutable once written. A correction voids the row and inserts a
 * replacement rather than editing values in place, so a price that was in
 * effect on a past date stays readable exactly as it was applied. The database
 * enforces this with a trigger, not only the service layer.
 *
 * Family-specific pricing (PROJECT_SPEC.md 5) is absent because families do not
 * exist yet; it arrives as an additive column, not a reshape of this table.
 */
export const tariffSchema = z.strictObject({
  id: z.uuid(),
  serviceId: z.uuid(),
  durationMinutes: durationMinutesSchema,
  therapistId: z.uuid().nullable(),
  priceMode: tariffPriceModeSchema,
  priceToman: tomanAmountSchema,
  freeReason: z.string().nullable(),
  effectiveStart: isoDateSchema,
  effectiveEnd: isoDateSchema.nullable(),
  voidedAt: z.iso.datetime().nullable(),
  voidReason: z.string().nullable(),
  supersedesTariffId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

export type Tariff = z.infer<typeof tariffSchema>;

/** What a tariff prices, and when. Identical across both price modes. */
const tariffScopeFields = z.strictObject({
  serviceId: z.uuid(),
  durationMinutes: durationMinutesSchema,
  therapistId: z.uuid().nullable(),
  effectiveStart: isoDateSchema,
  effectiveEnd: isoDateSchema.nullable(),
  /**
   * Set when this tariff replaces one being voided in the same transaction.
   * The replacement must price the same service, duration and therapist scope;
   * changing what is priced makes it a new tariff, not a correction.
   */
  supersedesTariffId: z.uuid().optional(),
});

export const createPaidTariffRequestSchema = tariffScopeFields.extend({
  priceMode: z.literal('PAID'),
  priceToman: paidPriceTomanSchema,
});

/**
 * A free tariff carries no amount at all — the server writes zero. Accepting a
 * `priceToman` here would create a second way to express the price and a way
 * for the two to disagree.
 *
 * `confirmFreePrice` is a deliberate, request-only speed bump: creating a free
 * programme has to be something a user chose, not something they reached by
 * leaving a field blank. It is never persisted and never audited — it records
 * nothing about the tariff, only about the submission.
 */
export const createFreeTariffRequestSchema = tariffScopeFields.extend({
  priceMode: z.literal('FREE'),
  freeReason: catalogReasonSchema,
  confirmFreePrice: z.literal(true),
});

/**
 * The refinement mirrors `tariff_effective_range_chk`.
 *
 * Both dates are individually valid, so nothing else here would catch an end
 * before its start — it would reach PostgreSQL, fail the CHECK, and surface as
 * an internal error rather than as the ordinary input mistake it is.
 *
 * String comparison is exact for `YYYY-MM-DD`: the format is fixed-width and
 * lexicographic order is chronological order, so no parsing is needed.
 */
export const createTariffRequestSchema = z
  .discriminatedUnion('priceMode', [createPaidTariffRequestSchema, createFreeTariffRequestSchema])
  .refine(
    (value) => value.effectiveEnd == null || value.effectiveEnd >= value.effectiveStart,
    'the effective end must not be before the effective start',
  );

export type CreateTariffRequest = z.infer<typeof createTariffRequestSchema>;

export const voidTariffRequestSchema = z.strictObject({
  reason: catalogReasonSchema,
});

export type VoidTariffRequest = z.infer<typeof voidTariffRequestSchema>;

/**
 * Resolution input. `durationMinutes` is coerced because these arrive as query
 * string values; every other field is already a string on the wire.
 *
 * `serviceDate` is required and never defaulted to today. An effective-dated
 * price must be resolved against the date of the session it prices, and a
 * caller that means "today" can say so.
 */
export const resolveTariffQuerySchema = z.strictObject({
  serviceId: z.uuid(),
  durationMinutes: z.coerce.number().int().positive().max(480),
  therapistId: z.uuid().optional(),
  serviceDate: isoDateSchema,
});

export type ResolveTariffQuery = z.infer<typeof resolveTariffQuerySchema>;

/**
 * The resolved tariff for a service date.
 *
 * A miss is an error, not an empty success: "missing tariff is a visible error"
 * (PROJECT_SPEC.md 5). This shape therefore always carries a tariff.
 */
export const resolveTariffResponseSchema = z.strictObject({
  tariff: tariffSchema,
});

export type ResolveTariffResponse = z.infer<typeof resolveTariffResponseSchema>;

/**
 * List filters.
 *
 * Deliberately narrow: enough to find the tariffs for one service, or one
 * therapist's, or the ones that applied on a date. Anything broader would be
 * reporting, which is a later milestone with its own approved shape.
 *
 * `scope` distinguishes the two kinds of tariff, which a therapist id alone
 * cannot: absent means "either", `general` means the fallback tariffs that
 * apply to any therapist, and `therapist` narrows to `therapistId`.
 *
 * Voided rows are excluded unless asked for, so the ordinary reading of the
 * list is "what is in force" rather than a history that has to be filtered by
 * eye.
 */
export const tariffListQuerySchema = z.strictObject({
  serviceId: z.uuid().optional(),
  scope: z.enum(['general', 'therapist']).optional(),
  therapistId: z.uuid().optional(),
  /** Keeps only tariffs whose effective range contains this date. */
  onDate: isoDateSchema.optional(),
  includeVoided: z.coerce.boolean().optional(),
});

export type TariffListQuery = z.infer<typeof tariffListQuerySchema>;

export const tariffResponseSchema = z.strictObject({ tariff: tariffSchema });

export type TariffResponse = z.infer<typeof tariffResponseSchema>;

export const tariffListResponseSchema = z.strictObject({
  tariffs: z.array(tariffSchema),
});

export type TariffListResponse = z.infer<typeof tariffListResponseSchema>;
