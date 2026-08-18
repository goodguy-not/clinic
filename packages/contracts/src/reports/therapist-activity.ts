import { z } from 'zod';
import { isoDateSchema } from '../dates';
import { reportRangeSchema, reportTherapistSummarySchema } from './common';

/**
 * Therapist activity: how much work each therapist did, and NOT what it was
 * worth (PROJECT_SPEC.md 10 — "therapist activity, without share until rules are
 * approved").
 *
 * ROUTE FROZEN HERE (Milestone 7, checkpoint C1). No controller implements it
 * yet.
 *
 *   GET /reports/therapist-activity   `therapistActivityQuerySchema` -> `therapistActivityResponseSchema`
 *
 * NOT ONE FIELD OF MONEY EXISTS IN THIS FILE, AND THAT IS A DOMAIN RULE RATHER
 * THAN A SCOPE CUT. Therapist settlement is based on completed-session value and
 * on share percentages that may differ per therapist and change over time; those
 * rules are approved for Milestone 8 and no part of them may be inferred before
 * then (CLAUDE.md — any settlement rule not explicitly approved remains
 * unresolved and must not be inferred). A "session value" column here would be
 * the first half of a settlement calculation, published on a screen, before
 * anybody had approved the second half.
 *
 * COUNTS AND DURATIONS ONLY. Both are facts about the diary, which is why this
 * report is readable by both roles under `appointment.read`: it says the same
 * thing a person could count by paging through the day views, and saves them
 * doing it.
 *
 * IT IS NOT PAGED. A clinic has tens of therapists, not thousands, and the whole
 * point of the report is that the rows are read against one another; a page two
 * would hide the comparison the reader came for.
 */

/**
 * Which period, and optionally whose.
 *
 * KEYED ON `SESSION_DATE`, the clinic calendar day the session sits on. The
 * range is mandatory and inclusive at both ends, as every ranged report's is.
 *
 * `therapistId` narrows the report to one person — which is how a therapist's own
 * month is read — and `serviceId` to one kind of work. Ids only, no names.
 *
 * `includeInactive` DEFAULTS TO FALSE. A therapist who has left the clinic did
 * the work they did, and their rows are still counted whenever they fall in the
 * range; what this flag decides is whether a therapist with NO activity in the
 * period appears as a zero row. Off, the report lists the active roster plus
 * anybody who worked; on, it lists every therapist the clinic has ever recorded,
 * which is what a year-end comparison wants and a weekly review does not.
 *
 * Not `z.coerce.boolean()`: `Boolean('false')` is `true`, so a filter written
 * that way could never be turned off. The two spellings are stated explicitly,
 * exactly as `includeVoided` is on the ledger reads.
 */
export const therapistActivityQuerySchema = z
  .strictObject({
    from: isoDateSchema,
    to: isoDateSchema,
    therapistId: z.uuid().optional(),
    serviceId: z.uuid().optional(),
    includeInactive: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .refine((value) => value.from <= value.to, 'the range must not end before it starts');

export type TherapistActivityQuery = z.infer<typeof therapistActivityQuerySchema>;

/**
 * The same question, asked for a file instead of a screen (Milestone 7,
 * checkpoint C5).
 *
 *   GET /reports/therapist-activity/export
 *     `therapistActivityExportQuerySchema` -> text/csv
 *
 * IT IS THE READ'S SCHEMA ITSELF, not a copy of it, and it can be because this
 * report was never paged: the screen already answers with every therapist the
 * filter matched, so the file and the screen are the same question with no
 * `page` to drop. An alias rather than a second declaration is what keeps a
 * later filter from reaching one surface and not the other.
 *
 * THE FILE CARRIES NO MONEY, BECAUSE THE REPORT HAS NONE. No share, no
 * settlement, no session value and no rate — the rules are unapproved
 * (CLAUDE.md), and an export is the likeliest place for somebody to add a
 * column "just for the accountant".
 */
export const therapistActivityExportQuerySchema = therapistActivityQuerySchema;

export type TherapistActivityExportQuery = TherapistActivityQuery;

/**
 * One therapist's period.
 *
 * THE COUNTS ARE SEATS, AS THE SESSION REPORT'S ARE. `attendedCount` is the work
 * that actually happened; `noShowCount` is the hour the therapist waited and the
 * room was held, which is precisely the number that makes a no-show policy
 * discussable when the clinic comes to approve one. `cancelledCount` released
 * the slot and is counted separately for the same reason.
 *
 * `attendedDurationMinutes` IS THE ONLY DURATION, AND IT COUNTS ATTENDED SEATS
 * ONLY. Summing the booked minutes of cancellations and no-shows into one
 * "hours worked" figure would produce a number that reads as time delivered and
 * is not — and it is a number somebody would eventually multiply by a rate.
 */
export const therapistActivityRowSchema = z.strictObject({
  therapist: reportTherapistSummarySchema,
  scheduledCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  cancelledCount: z.number().int().nonnegative(),
  attendedCount: z.number().int().nonnegative(),
  noShowCount: z.number().int().nonnegative(),
  unresolvedOutcomeCount: z.number().int().nonnegative(),
  attendedDurationMinutes: z.number().int().nonnegative(),
});

export type TherapistActivityRow = z.infer<typeof therapistActivityRowSchema>;

/**
 * Every therapist the filter matched, by name.
 *
 * `totals` IS THE COLUMN SUM OF THE ROWS ABOVE — the clinic's own activity over
 * the same period — so a reader does not add a column of numbers by hand and
 * reach a different answer from the server's. It is filter-scoped, like every
 * other total in this directory.
 */
export const therapistActivityTotalsSchema = z.strictObject({
  therapistCount: z.number().int().nonnegative(),
  scheduledCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  cancelledCount: z.number().int().nonnegative(),
  attendedCount: z.number().int().nonnegative(),
  noShowCount: z.number().int().nonnegative(),
  unresolvedOutcomeCount: z.number().int().nonnegative(),
  attendedDurationMinutes: z.number().int().nonnegative(),
});

export type TherapistActivityTotals = z.infer<typeof therapistActivityTotalsSchema>;

export const therapistActivityResponseSchema = z.strictObject({
  range: reportRangeSchema,
  totals: therapistActivityTotalsSchema,
  therapists: z.array(therapistActivityRowSchema),
});

export type TherapistActivityResponse = z.infer<typeof therapistActivityResponseSchema>;
