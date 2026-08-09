import { z } from 'zod';
import { catalogReasonSchema } from '../catalog/common';
import { isoDateSchema } from '../dates';
import { clockTimeSchema, weekdaySchema } from './common';
import { therapistAvailabilityExceptionSchema, therapistAvailabilitySchema } from './appointments';

/**
 * Managing and reading a therapist's availability.
 *
 * TWO KINDS OF FACT, AND THEY ARE MANAGED DIFFERENTLY.
 *
 * The recurring windows are the therapist's ordinary week. They are current
 * configuration and are replaced AS A SET — the same shape as a family's
 * guardians and a therapist's supported services — because a schedule is read
 * and corrected as a whole ("Saturdays and Mondays, mornings"), not as a series
 * of individual row edits. The set that was replaced is preserved in
 * `audit_log`, not in the table.
 *
 * A dated exception is a single-day fact about one date — a day off, or one
 * extra window — and accumulates rather than being replaced. Those are added
 * and removed one at a time.
 *
 * THERE IS NO EFFECTIVE-DATED AVAILABILITY HISTORY, and no shape here can
 * express one. A recurring window carries a weekday and two times; a dated fact
 * carries exactly one date. Nothing in between exists.
 *
 * WEEKDAYS ARE SATURDAY-FIRST throughout, exactly as `weekdaySchema` states. No
 * shape here exposes PostgreSQL's Sunday-first `EXTRACT(DOW)`.
 *
 * TIMES ARE WALL-CLOCK `HH:MM` in the clinic's timezone, never instants. What is
 * recorded is "Saturdays, 09:00 to 13:00", and that fact does not move when a
 * particular date does.
 */

/**
 * One recurring working window as it is submitted.
 *
 * A WEEKDAY AND A PAIR OF TIMES, AND NOTHING ELSE. There is deliberately no
 * start date, no end date and no equivalent of one, because recurring
 * availability is CURRENT CONFIGURATION: what the set says is what is true, and
 * the set that preceded it is history in `audit_log` rather than a row that is
 * still in the table waiting to apply.
 *
 * A future-dated or past-dated window would be effective-dated availability
 * history, which is not approved. Recording that a therapist's hours change on a
 * date is done by editing the set on that date. The columns that would have
 * stored such a bound are dropped by the availability migration, so there is
 * nothing to express one with at any layer.
 *
 * No id and no `createdAt` either: the set is replaced wholesale, so a window is
 * described by what it says rather than by which row previously said it.
 *
 * The refinement mirrors `therapist_availability_window_chk`. String comparison
 * is exact here: `HH:MM` is fixed-width, so lexicographic order is chronological
 * order.
 */
export const availabilityWindowInputSchema = z
  .strictObject({
    weekday: weekdaySchema,
    startTime: clockTimeSchema,
    endTime: clockTimeSchema,
  })
  .refine((value) => value.endTime > value.startTime, 'the window must end after it starts');

export type AvailabilityWindowInput = z.infer<typeof availabilityWindowInputSchema>;

/**
 * The ceiling on one therapist's weekly set: seven days with room for a morning,
 * an afternoon and an evening block each, and nothing beyond that.
 *
 * Not a performance limit. It is the point past which a submission is a mistake
 * or an attempt to use the schedule as a data store, and refusing it keeps one
 * therapist's replacement transaction small enough to be uninteresting.
 */
export const AVAILABILITY_WINDOWS_MAX = 21;

/**
 * The whole recurring set for one therapist.
 *
 * An empty array is legitimate and means "this therapist has no standing hours",
 * which is a real state — a therapist who works only on dated arrangements, or
 * one whose hours have not been entered yet. It is deliberately not an error.
 */
export const replaceAvailabilityWindowsRequestSchema = z.strictObject({
  windows: z.array(availabilityWindowInputSchema).max(AVAILABILITY_WINDOWS_MAX),
});

export type ReplaceAvailabilityWindowsRequest = z.infer<
  typeof replaceAvailabilityWindowsRequestSchema
>;

/**
 * A date on which the therapist's ordinary week does not apply.
 *
 * Carries no times, and structurally cannot: a closed day with a start and an
 * end is a half-stated fact that every later reader would have to guess about.
 * The reason is optional — "why" is worth recording and is usually private
 * enough that requiring it would produce fiction.
 *
 * On its own this is a day off. Paired with an extra window on the same date it
 * says "not my usual hours, these instead", which is the only way to record that
 * arrangement and is deliberately permitted.
 */
const closedDayExceptionSchema = z.strictObject({
  isAvailable: z.literal(false),
  exceptionDate: isoDateSchema,
  reason: catalogReasonSchema.nullable(),
});

/** One extra window on a date, outside the ordinary weekly pattern. */
const extraWindowExceptionSchema = z
  .strictObject({
    isAvailable: z.literal(true),
    exceptionDate: isoDateSchema,
    startTime: clockTimeSchema,
    endTime: clockTimeSchema,
    reason: catalogReasonSchema.nullable(),
  })
  .refine((value) => value.endTime > value.startTime, 'the window must end after it starts');

/**
 * A discriminated union rather than one shape with optional times, so a closed
 * day cannot carry a window and an extra window cannot lack one. The database
 * CHECK states the same pairing; this makes it a validation error rather than a
 * constraint failure.
 */
export const createAvailabilityExceptionRequestSchema = z.discriminatedUnion('isAvailable', [
  closedDayExceptionSchema,
  extraWindowExceptionSchema,
]);

export type CreateAvailabilityExceptionRequest = z.infer<
  typeof createAvailabilityExceptionRequestSchema
>;

/**
 * Exception list filter. Both bounds are inclusive and both are optional; there
 * is deliberately no implicit "from today", because a caller that means today
 * can say so and a caller reviewing a past month must not have to fight a
 * default.
 */
export const availabilityExceptionListQuerySchema = z
  .strictObject({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine(
    (value) => value.from === undefined || value.to === undefined || value.to >= value.from,
    'the range must not end before it starts',
  );

export type AvailabilityExceptionListQuery = z.infer<typeof availabilityExceptionListQuerySchema>;

/**
 * What one therapist's availability actually is on one date.
 *
 * THE RESOLVED ANSWER, not the stored rows. The recurring windows for that
 * weekday, the dated exceptions for that date and the precedence between them
 * are applied server-side and the result is a plain, ordered, non-overlapping
 * list of windows. A caller that composed this itself would be a second
 * implementation of the rule, and the two would eventually disagree.
 *
 * `isClosed` says the ordinary week was suspended for this date, which is why
 * the day differs from the therapist's usual one — and it reads differently in
 * an interface from a weekday they simply never work. It is NOT the bookability
 * test: `windows` is, always. A closed day may still carry a dated window, which
 * is how "not my usual Saturday hours, but I will come in for 15:00 to 18:00" is
 * recorded.
 */
export const resolvedAvailabilitySchema = z.strictObject({
  therapistId: z.uuid(),
  date: isoDateSchema,
  /** Saturday-first, derived from the date at the clinic's own calendar. */
  weekday: weekdaySchema,
  isClosed: z.boolean(),
  closedReason: z.string().nullable(),
  windows: z.array(z.strictObject({ startTime: clockTimeSchema, endTime: clockTimeSchema })),
});

export type ResolvedAvailability = z.infer<typeof resolvedAvailabilitySchema>;

/**
 * Deliberately not nested under a therapist path, for the reason
 * `/catalog/tariff-resolution` is not nested under `tariffs/`: a resolution is a
 * question, not a sub-resource, and a distinct path cannot collide with an id
 * segment.
 */
export const resolveAvailabilityQuerySchema = z.strictObject({
  therapistId: z.uuid(),
  date: isoDateSchema,
});

export type ResolveAvailabilityQuery = z.infer<typeof resolveAvailabilityQuerySchema>;

export const availabilityWindowListResponseSchema = z.strictObject({
  windows: z.array(therapistAvailabilitySchema),
});

export type AvailabilityWindowListResponse = z.infer<typeof availabilityWindowListResponseSchema>;

export const availabilityExceptionListResponseSchema = z.strictObject({
  exceptions: z.array(therapistAvailabilityExceptionSchema),
});

export type AvailabilityExceptionListResponse = z.infer<
  typeof availabilityExceptionListResponseSchema
>;

export const availabilityExceptionResponseSchema = z.strictObject({
  exception: therapistAvailabilityExceptionSchema,
});

export type AvailabilityExceptionResponse = z.infer<typeof availabilityExceptionResponseSchema>;

export const resolveAvailabilityResponseSchema = z.strictObject({
  availability: resolvedAvailabilitySchema,
});

export type ResolveAvailabilityResponse = z.infer<typeof resolveAvailabilityResponseSchema>;
