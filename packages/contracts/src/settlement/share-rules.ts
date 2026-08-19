import { z } from 'zod';
import { isoDateSchema } from '../dates';
import { settlementReasonSchema, shareBasisPointsSchema } from './common';

/**
 * THE THERAPIST SHARE RULE: what percentage of a session's value a therapist
 * takes, and between which dates that agreement held.
 *
 * IT IS CONFIGURATION, NOT A SETTLEMENT FACT. Nothing here says what any
 * session earned. A rule is the agreement; the earning is the per-session
 * snapshot that checkpoint C3 copies off a rule at the moment a session is
 * rated (`ratings.ts`), and once copied it is never re-resolved. That is the
 * whole reason this configuration can be corrected at all: changing a rule
 * changes what FUTURE ratings resolve to and rewrites no session that has
 * already been rated.
 *
 * FOUR RULES SHAPE EVERY SHAPE BELOW.
 *
 *   1. RESOLUTION IS BY THE SERVICE DATE, NEVER BY THE CLOCK.
 *      `resolveShareRuleQuery` requires `serviceDate` and has no default: an
 *      agreement that changed in Mordad must still answer "what applied in
 *      Tir?" with the Tir figure, in Shahrivar and forever after. No shape here
 *      reads a current time.
 *   2. THERE IS NO DEFAULT SHARE AND NO SILENT ZERO. A therapist with no rule
 *      covering a date resolves to `SHARE_RULE_MISSING`, an error, exactly as a
 *      missing tariff does. Zero is a legitimate agreed share — salaried cover,
 *      a clinic-funded programme — so answering "no rule" with zero would make
 *      an unconfigured therapist indistinguishable from one who agreed to take
 *      nothing, and the difference is somebody's month.
 *   3. A RULE IS NEVER EDITED. There is no update shape in this file and no
 *      update route: a correction voids the row and inserts a replacement that
 *      names it, so the percentage that applied on a past date stays readable
 *      exactly as it was applied. It is the `tariff` decision applied to the
 *      other side of the money, and the database enforces it with a trigger.
 *   4. THE SCOPE IS THE THERAPIST, AND ONLY THE THERAPIST. There is no
 *      per-service, per-duration or per-family share rule here, because none is
 *      approved: CLAUDE.md says percentages may differ BY THERAPIST and may
 *      change OVER TIME, and nothing else. A second scope dimension would be a
 *      settlement rule inferred rather than approved, which CLAUDE.md forbids
 *      outright — and it stays additive if it is ever approved.
 *
 * A SHARE RULE IS NOT VISIBLE TO A THERAPIST. Every route over these shapes is
 * manager-only (`therapist_share.read`, `.create`, `.void`), and this milestone
 * introduces no therapist-facing surface of any kind.
 */
export const shareRuleSchema = z.strictObject({
  id: z.uuid(),
  therapistId: z.uuid(),
  shareBasisPoints: shareBasisPointsSchema,
  effectiveStart: isoDateSchema,
  /** Null is an open-ended agreement: in force until something supersedes it. */
  effectiveEnd: isoDateSchema.nullable(),
  voidedAt: z.iso.datetime().nullable(),
  voidReason: z.string().nullable(),
  /**
   * The rule this one replaced, when it was created as a correction.
   *
   * Recorded on the REPLACEMENT rather than on the withdrawn row, so the
   * history reads forwards: a voided rule keeps its own `voidReason`, and the
   * row that took over says which one it took over from.
   */
  supersedesShareRuleId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

export type ShareRule = z.infer<typeof shareRuleSchema>;

/**
 * Creating a rule, and correcting one, are the same request with one field
 * different — deliberately, because a correction IS a void plus a create, and
 * expressing it as two calls would let a failure between them leave a therapist
 * with no rule at all over a range they had one for.
 *
 * `reason` IS REQUIRED EXACTLY WHEN `supersedesShareRuleId` IS PRESENT, and
 * refused when it is absent. A correction withdraws a figure somebody may
 * already have been shown, and CLAUDE.md requires every settlement correction
 * to be explicit and reasoned; a first statement of an agreement corrects
 * nothing and has nothing to explain, so accepting a reason there would create
 * a second place to say why that no void row would ever carry.
 */
export const createShareRuleRequestSchema = z
  .strictObject({
    therapistId: z.uuid(),
    shareBasisPoints: shareBasisPointsSchema,
    effectiveStart: isoDateSchema,
    effectiveEnd: isoDateSchema.nullable().optional(),
    supersedesShareRuleId: z.uuid().optional(),
    reason: settlementReasonSchema.optional(),
  })
  // Mirrors `therapist_share_rule_effective_range_chk`. Both dates are
  // individually valid, so nothing else here would catch an end before its
  // start — it would reach PostgreSQL, fail the CHECK, and surface as an
  // internal error rather than as the ordinary input mistake it is. String
  // comparison is exact for `YYYY-MM-DD`: the format is fixed-width and
  // lexicographic order is chronological order.
  .refine(
    (value) =>
      value.effectiveEnd === null ||
      value.effectiveEnd === undefined ||
      value.effectiveEnd >= value.effectiveStart,
    { message: 'the effective end must not be before the effective start', path: ['effectiveEnd'] },
  )
  .refine((value) => value.supersedesShareRuleId === undefined || value.reason !== undefined, {
    message: 'a correction must state why the previous share rule is being withdrawn',
    path: ['reason'],
  })
  .refine((value) => value.supersedesShareRuleId !== undefined || value.reason === undefined, {
    message: 'a reason belongs to a correction; a first share rule withdraws nothing',
    path: ['reason'],
  });

export type CreateShareRuleRequest = z.infer<typeof createShareRuleRequestSchema>;

export const voidShareRuleRequestSchema = z.strictObject({
  reason: settlementReasonSchema,
});

export type VoidShareRuleRequest = z.infer<typeof voidShareRuleRequestSchema>;

/**
 * Resolution input.
 *
 * `serviceDate` is required and is never defaulted to today — rule 1 in the
 * header. A caller that means today can say which day today is.
 */
export const resolveShareRuleQuerySchema = z.strictObject({
  therapistId: z.uuid(),
  serviceDate: isoDateSchema,
});

export type ResolveShareRuleQuery = z.infer<typeof resolveShareRuleQuerySchema>;

/**
 * The share rule that applied on a service date.
 *
 * Always carries a rule: a miss is `SHARE_RULE_MISSING`, never an empty
 * success, so no caller can read absence as zero (rule 2).
 */
export const resolveShareRuleResponseSchema = z.strictObject({
  shareRule: shareRuleSchema,
});

export type ResolveShareRuleResponse = z.infer<typeof resolveShareRuleResponseSchema>;

/**
 * List filters. Deliberately narrow — enough to read one therapist's history,
 * or what was in force on a date. Anything broader is reporting, which is a
 * later checkpoint with its own approved shape.
 *
 * Voided rows are excluded unless asked for, so the ordinary reading is "what
 * is in force" rather than a history that has to be filtered by eye. Asking for
 * them is how a corrected rule stays inspectable after the correction.
 */
export const shareRuleListQuerySchema = z.strictObject({
  therapistId: z.uuid().optional(),
  /** Keeps only rules whose effective range contains this date. */
  onDate: isoDateSchema.optional(),
  includeVoided: z.coerce.boolean().optional(),
});

export type ShareRuleListQuery = z.infer<typeof shareRuleListQuerySchema>;

export const shareRuleResponseSchema = z.strictObject({ shareRule: shareRuleSchema });

export type ShareRuleResponse = z.infer<typeof shareRuleResponseSchema>;

export const shareRuleListResponseSchema = z.strictObject({
  shareRules: z.array(shareRuleSchema),
});

export type ShareRuleListResponse = z.infer<typeof shareRuleListResponseSchema>;
