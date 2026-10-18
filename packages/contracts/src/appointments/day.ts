import { z } from 'zod';
import { tariffPriceModeSchema } from '../catalog/tariffs';
import { fileNumberSchema } from '../families/common';
import { isoDateSchema } from '../dates';
import { noShowDecisionStateSchema } from '../ledger/common';
import { tomanAmountSchema } from '../money';
import { appointmentParticipantSchema, appointmentSchema } from './appointments';
import { individualOutcomeSchema } from './common';

/**
 * The operational read model: one clinic day, and one appointment as a screen
 * reads it.
 *
 * A READ MODEL, NOT A SECOND SOURCE OF TRUTH. Everything here is derived from
 * rows this milestone already owns, plus the names an interface has to print.
 * It is denormalised on purpose, for the reason `familySummarySchema` is: a
 * receptionist looking at a day needs the child, the therapist, the room and
 * the service by name at once, and fetching each by id would be an N+1 across
 * an HTTP boundary on the busiest screen in the clinic.
 *
 * WHY IT IS A SEPARATE SHAPE FROM `appointmentDetailSchema`. That one is what a
 * WRITE returns — the booking and its seats, and nothing a write has no
 * business knowing. This one is what a READ shows, and it carries a price
 * suggestion that no write path may see, let alone store. Keeping them apart is
 * what stops a tariff lookup creeping into the transaction that books a
 * session.
 */

/**
 * The child in a seat, as a day view prints them.
 *
 * `familyId` travels with the child so the interface can reach the family
 * account in one hop; it is not a second copy of a fact that could disagree,
 * because `child.family_id` is immutable in the database. The file number is
 * here because it is what the clinic says out loud when identifying a child.
 *
 * Nothing sensitive appears: no national identifier, no phone number, no
 * address, no birth date. A day list is read on a screen at a reception desk.
 */
export const appointmentChildSummarySchema = z.strictObject({
  id: z.uuid(),
  familyId: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  fileNumber: fileNumberSchema,
});

export type AppointmentChildSummary = z.infer<typeof appointmentChildSummarySchema>;

/**
 * A seat, with the child it belongs to resolved.
 *
 * `noShowDecision` (M10.5 phase 1) is where an absent seat of a completed
 * session stands with the manager — awaiting, no penalty, or a penalty with its
 * percent — and null for every other seat.
 */
export const appointmentParticipantViewSchema = z.strictObject({
  participant: appointmentParticipantSchema,
  child: appointmentChildSummarySchema,
  noShowDecision: noShowDecisionStateSchema.nullable(),
});

export type AppointmentParticipantView = z.infer<typeof appointmentParticipantViewSchema>;

/**
 * What the clinic's price list currently says about this session — A SUGGESTION,
 * AND NOTHING MORE.
 *
 * It is resolved from the existing tariff rules against the appointment's own
 * clinic date, therapist, service and duration, exactly as
 * `/catalog/tariff-resolution` does. It is computed on every read and stored
 * nowhere: an appointment carries no tariff source and no price snapshot in
 * this milestone, and the amount a family is actually charged is decided by
 * Milestone 5 when the session is priced — from the tariff in force then, not
 * from a number a booking screen once displayed.
 *
 * A MISS IS VISIBLE AND BLOCKS NOTHING. "Missing tariff is a visible error"
 * (PROJECT_SPEC.md 5), and the receptionist must still be able to book,
 * complete and record the session; `MISSING` is therefore a value this shape
 * carries rather than an error that fails the read.
 */
export const appointmentTariffSuggestionSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('RESOLVED'),
    tariffId: z.uuid(),
    priceMode: tariffPriceModeSchema,
    priceToman: tomanAmountSchema,
  }),
  z.strictObject({ status: z.literal('MISSING') }),
]);

export type AppointmentTariffSuggestion = z.infer<typeof appointmentTariffSuggestionSchema>;

/** The names an interface prints instead of a uuid. */
const namedSchema = z.strictObject({ id: z.uuid(), name: z.string() });

/**
 * One appointment, ready to render.
 *
 * `outcomeUnresolved` is stated by the server rather than inferred by each
 * consumer. It means: the session was not cancelled, its end time has passed,
 * and a seat still carries `PENDING` — the receptionist dashboard's "unresolved
 * outcomes" list (PROJECT_SPEC.md 10). Deriving it in the browser would need
 * the browser to decide what "already over" means against a clock the server
 * owns, and two screens would eventually disagree about which sessions are
 * outstanding.
 */
export const appointmentViewSchema = z.strictObject({
  appointment: appointmentSchema,
  participants: z.array(appointmentParticipantViewSchema),
  service: namedSchema,
  therapist: z.strictObject({ id: z.uuid(), fullName: z.string() }),
  room: namedSchema,
  tariffSuggestion: appointmentTariffSuggestionSchema,
  outcomeUnresolved: z.boolean(),
  /**
   * M10.5 phase 1 (T-028): the "What happened?" answer for an individual
   * session, derived by the server (`INDIVIDUAL_OUTCOMES`); null for a session
   * with more than one seat (group sessions, phase 2).
   */
  individualOutcome: individualOutcomeSchema.nullable(),
  /**
   * The instant from which "present" and "did not come" are accepted (T-020) —
   * the scheduled start, stated so the page can say "available from 11:00"
   * without deciding the rule itself. Cancelling is never time-limited.
   */
  outcomeOpensAt: z.iso.datetime(),
});

export type AppointmentView = z.infer<typeof appointmentViewSchema>;

export const appointmentViewResponseSchema = appointmentViewSchema;

export type AppointmentViewResponse = z.infer<typeof appointmentViewResponseSchema>;

/**
 * Which day, and optionally whose.
 *
 * `date` is a clinic calendar day in Asia/Tehran, never a range: the approved
 * read model is one day, and a filter that could span a month is a report.
 *
 * The filters are ids, and there is deliberately no free-text search here: a
 * family or child name in a query string reaches the browser history, the
 * `Referer` header and every access log, which is the reason family search is a
 * POST (DECISION_LOG, Milestone 3).
 *
 * There is no status filter. A cancelled appointment stays visible in the day
 * it was booked into — the clinic has to see the hole in the diary and the fact
 * that somebody cancelled it — so the day is returned whole and the interface
 * groups it.
 */
export const appointmentDayQuerySchema = z.strictObject({
  date: isoDateSchema,
  therapistId: z.uuid().optional(),
  roomId: z.uuid().optional(),
});

export type AppointmentDayQuery = z.infer<typeof appointmentDayQuerySchema>;

/**
 * The three things the dashboard counts, plus the totals they are read against.
 *
 * Counted from exactly the appointments in this response, in one pass on the
 * server, so a badge and the list beneath it cannot disagree. They are counts
 * of appointments, not of seats: an individual appointment has one participant,
 * and a group booking — when it arrives — will need its own answer rather than
 * a number that silently changed meaning.
 */
export const appointmentDaySummarySchema = z.strictObject({
  total: z.number().int().nonnegative(),
  scheduled: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  unresolvedOutcomes: z.number().int().nonnegative(),
  noShows: z.number().int().nonnegative(),
});

export type AppointmentDaySummary = z.infer<typeof appointmentDaySummarySchema>;

/** A clinic day, in start order. */
export const appointmentDayResponseSchema = z.strictObject({
  date: isoDateSchema,
  summary: appointmentDaySummarySchema,
  appointments: z.array(appointmentViewSchema),
});

export type AppointmentDayResponse = z.infer<typeof appointmentDayResponseSchema>;
