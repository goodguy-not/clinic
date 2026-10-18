import { z } from 'zod';
import { catalogReasonSchema } from '../catalog/common';
import { isoDateSchema } from '../dates';
import { clockTimeSchema, weekdaySchema } from './common';
import { therapistAvailabilityExceptionSchema, therapistAvailabilitySchema } from './appointments';
import { appointmentChildSummarySchema } from './day';

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
 * A closure: the whole of a date, or one time range on it (M10-A9, tour item
 * T-012).
 *
 * WITHOUT TIMES IT IS A DAY OFF, exactly as before: the therapist's ordinary week
 * does not apply on that date. Paired with an extra window on the same date it
 * says "not my usual hours, these instead", which is the only way to record that
 * arrangement and is deliberately permitted.
 *
 * WITH TIMES IT IS A PARTIAL CLOSURE — "leaves at 14:00", "arrives at 11:00" —
 * and removes that range, and only that range, from the ordinary week for the
 * date. Both times or neither: a closure with one bound is a half-stated fact.
 * The times are wall-clock `HH:MM` on the clinic's calendar (Asia/Tehran), like
 * every other availability time, so `00:00` to `23:59` is the whole of the day a
 * range can name and nothing outside the day can be expressed. Absent and null
 * are the same answer, so a form that always sends the two fields can send them
 * empty for a whole-day closure.
 *
 * Two closures of one date may not overlap, and a whole-day closure overlaps
 * everything on its date; a partial closure may not overlap an extra window on
 * its date either, because the two would contradict each other. The database
 * refuses all three with `AVAILABILITY_EXCEPTION_CONFLICT`.
 *
 * The reason is optional — "why" is worth recording and is usually private
 * enough that requiring it would produce fiction.
 */
const closedDayExceptionSchema = z
  .strictObject({
    isAvailable: z.literal(false),
    exceptionDate: isoDateSchema,
    startTime: clockTimeSchema.nullish(),
    endTime: clockTimeSchema.nullish(),
    reason: catalogReasonSchema.nullable(),
  })
  .refine(
    (value) => (value.startTime == null) === (value.endTime == null),
    'a partial closure needs both a start and an end',
  )
  .refine(
    (value) => value.startTime == null || value.endTime == null || value.endTime > value.startTime,
    'the closure must end after it starts',
  );

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
  /** A WHOLE-DAY closure. A partial closure leaves this false. */
  isClosed: z.boolean(),
  closedReason: z.string().nullable(),
  /**
   * The partial closures on this date, in start order (M10-A9). Each has
   * already been taken out of the ordinary week in `windows`; they are listed so
   * an interface can say WHY the day is shorter than the therapist's usual one.
   * Empty on a date with none, and on a whole-day closure, which `isClosed`
   * states instead.
   */
  closedRanges: z.array(
    z.strictObject({
      startTime: clockTimeSchema,
      endTime: clockTimeSchema,
      reason: z.string().nullable(),
    }),
  ),
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

/**
 * A scheduled appointment that a closure has left outside the therapist's hours
 * (M10-A9).
 *
 * WHAT A CLOSURE DOES TO THE DIARY: NOTHING. Closing a day, or part of one,
 * cancels and moves nothing — a session the clinic has promised a family is
 * changed only by a person who has spoken to that family. What the closure does
 * is make the conflict visible, and this is the shape it is shown in.
 *
 * Listed when it is `SCHEDULED`, falls on a date carrying a closure, overlaps a
 * closed range on that date (a whole-day closure is the whole date), and is not
 * inside the resolved availability for that date — so a session sitting in an
 * extra window on a closed day is not a conflict. Series occurrences are
 * appointments like any other and are listed with their `seriesId`.
 *
 * `availabilityOverrideReason` is carried because an appointment that was booked
 * with a recorded override is still in conflict, but the interface should be
 * able to say it was placed there deliberately.
 *
 * Times are the clinic's calendar and clock (Asia/Tehran), computed by
 * PostgreSQL; the instants are there for anything that needs them.
 */
export const closureAffectedAppointmentSchema = z.strictObject({
  appointmentId: z.uuid(),
  seriesId: z.uuid().nullable(),
  date: isoDateSchema,
  startTime: clockTimeSchema,
  endTime: clockTimeSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  availabilityOverrideReason: z.string().nullable(),
  children: z.array(appointmentChildSummarySchema),
});

export type ClosureAffectedAppointment = z.infer<typeof closureAffectedAppointmentSchema>;

/**
 * `affectedAppointments` is the closure conflicts of the exception's date, read
 * in the same transaction that wrote it (M10-A9). Always empty for an extra
 * window, which can only add hours.
 */
export const availabilityExceptionResponseSchema = z.strictObject({
  exception: therapistAvailabilityExceptionSchema,
  affectedAppointments: z.array(closureAffectedAppointmentSchema),
});

/**
 * Both bounds inclusive and both required: unlike the exception list, a
 * conflict read is a diary read and has to say which days it means. No maximum
 * span, as for every report range: the cost follows the closures and scheduled
 * sessions in the range, which an over-long range does not multiply.
 */
export const closureConflictQuerySchema = z
  .strictObject({
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .refine((value) => value.to >= value.from, 'the range must not end before it starts');

export type ClosureConflictQuery = z.infer<typeof closureConflictQuerySchema>;

export const closureConflictResponseSchema = z.strictObject({
  appointments: z.array(closureAffectedAppointmentSchema),
});

export type ClosureConflictResponse = z.infer<typeof closureConflictResponseSchema>;

export type AvailabilityExceptionResponse = z.infer<typeof availabilityExceptionResponseSchema>;

export const resolveAvailabilityResponseSchema = z.strictObject({
  availability: resolvedAvailabilitySchema,
});

export type ResolveAvailabilityResponse = z.infer<typeof resolveAvailabilityResponseSchema>;
