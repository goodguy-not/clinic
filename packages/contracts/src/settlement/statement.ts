import { z } from 'zod';
import { isoDateSchema } from '../dates';
import { signedTomanAmountSchema, tomanAmountSchema } from '../money';
import { reportRangeSchema, reportTherapistSummarySchema } from '../reports/common';
import { tariffPriceModeSchema } from '../catalog/tariffs';
import { sessionChargeKindSchema } from '../ledger/charges';
import { penaltyPercentSchema } from '../ledger/common';
import { ratedViaSchema, settlementLineTypeSchema, shareBasisPointsSchema } from './common';

/**
 * THE SETTLEMENT STATEMENT: one therapist, one period, every session that
 * counted, and the exceptions that did not.
 *
 * MANAGER-ONLY, AND THERE IS NO THERAPIST-FACING VARIANT OF IT. `settlement.read`
 * is held by the manager alone and no therapist-facing permission exists in this
 * milestone (the frozen Milestone 8 decision); a therapist sees their settlement
 * because a manager shows it to them, printed or on screen. That is a smaller
 * product than a therapist portal and it is the approved one — PROJECT_SPEC.md
 * places no portal in the initial product, and inventing a read authority for a
 * role that cannot log in would be authority nobody asked for.
 *
 * KEYED ON `SESSION_DATE`, AND NO NEW DATE BASIS IS INTRODUCED. A settlement
 * line belongs to the day the session happened, which is exactly what
 * `SESSION_DATE` already means in `reports/common.ts` and exactly what a
 * `session_charge` snapshots. A rating entered late belongs to the session's
 * day, never to the day somebody got round to rating it — the same rule that
 * puts a late-posted charge on the session's day. A `SETTLEMENT_RATED_AT` basis
 * would let the same session sit in two different months depending on
 * administrative speed, which is precisely the ambiguity the four existing bases
 * were separated to remove.
 *
 * THE BACKEND SUPPLIES EVERY TOTAL. CLAUDE.md forbids the web tier from
 * calculating a therapist share or a settlement figure at all, so `totals` is
 * stated rather than summed in a browser from `lines` — which could not be done
 * correctly anyway, because a statement carries `CORRECTION` lines whose signs
 * a naive sum would get wrong.
 *
 * IT IS NOT PAGED, for the reason the therapist activity report is not: a
 * therapist's month is tens of sessions read against one another and against a
 * total, and a page two would hide the comparison the reader came for.
 */

/**
 * WHICH THERAPIST, AND OVER WHAT PERIOD.
 *
 * `therapistId` IS REQUIRED, NOT OPTIONAL. A settlement statement is one
 * person's earnings; a clinic-wide variant would be a different report with a
 * different shape and a different conversation about who may see it, and
 * leaving the filter optional would create it by accident on the day somebody
 * omitted the field.
 *
 * The range is mandatory and inclusive at both ends, as every ranged report's
 * is, and there is no maximum span, for the reason recorded in
 * `reports/common.ts`.
 */
export const settlementStatementQuerySchema = z
  .strictObject({
    therapistId: z.uuid(),
    from: isoDateSchema,
    to: isoDateSchema,
  })
  .refine((value) => value.from <= value.to, 'the range must not end before it starts');

export type SettlementStatementQuery = z.infer<typeof settlementStatementQuerySchema>;

/**
 * The same question, asked for a file instead of a screen.
 *
 * THE READ'S SCHEMA ITSELF rather than a copy of it — the statement is not
 * paged, so the file and the screen are the same question with nothing to drop,
 * and an alias is what keeps a later filter from reaching one surface and not
 * the other (`therapistActivityExportQuerySchema` does the same).
 *
 * EXPORTING IT REQUIRES BOTH AUTHORITIES: `SETTLEMENT_EXPORT_PERMISSIONS` is
 * `settlement.read` AND `report.export`, the shape every Milestone 7 export
 * already has. Taking the file out of the building is a different act from
 * reading the screen, and revoking the read takes its export with it.
 */
export const settlementStatementExportQuerySchema = settlementStatementQuerySchema;

export type SettlementStatementExportQuery = SettlementStatementQuery;

/**
 * ONE LINE OF A STATEMENT: one rated session, and what each side of it was
 * worth.
 *
 * THE SIX MONEY FIELDS ARE THREE PAIRS, AND ONLY ONE OF THE SIX IS SIGNED.
 *
 *   * `therapistGrossToman` — the snapshotted share of the pre-discount basis.
 *   * `therapistDiscountToman` — the part of the family's concession this
 *     therapist agreed to bear. Zero for a therapist who does not participate in
 *     discounts, which is the default and not a special case.
 *   * `therapistNetToman` — gross less that portion. UNSIGNED, because CLAUDE.md
 *     states outright that a therapist net share must never be negative: a
 *     therapist can be asked to give up their whole share of a session and never
 *     to fund the clinic's part of it.
 *   * `clinicGrossToman` — the exact residual of the split (`SHARE_ROUNDING`).
 *   * `clinicDiscountToman` — the rest of the family's concession. Therapist
 *     portion plus clinic portion equals the total family discount, always
 *     (CLAUDE.md), which is why neither is optional and neither is inferred.
 *   * `clinicNetToman` — SIGNED, and the only signed figure here. CLAUDE.md
 *     requires a clinic net to be able to go below zero when the clinic
 *     explicitly bears a concession larger than its own gross share, and
 *     requires that subsidy to be VISIBLE rather than clamped. A therapist who
 *     does not participate in discounts on a heavily discounted session is the
 *     ordinary way this happens, not an error state.
 *
 * `baseAmountToman` IS THE PRE-DISCOUNT CHARGE, restated on the line so a reader
 * can check the split without opening the family's account — and so the line
 * says what it was a share OF, which is the number people argue about.
 *
 * `settledToman` IS HOW MUCH OF THIS LINE A CLOSED PERIOD ALREADY CARRIES
 * (Milestone 8, checkpoint C6), and it is the field that makes the statement
 * reconcile against closed history without a second calculation. It is the sum
 * of the session's materialised settlement lines — its `PRIMARY` plus every
 * later `CORRECTION` — on the therapist side, and the difference
 * `therapistNetToman − settledToman` is therefore the movement against this
 * session that NO closed period carries yet: zero for a session settled and
 * unchanged since, the whole net for a session never closed, and NEGATIVE for a
 * session whose charge was withdrawn or whose concession grew after its period
 * closed. It is signed for that last case alone.
 *
 * A SESSION APPEARS HERE IF IT CURRENTLY EARNS SOMETHING **OR** IF IT HAS EVER
 * BEEN SETTLED. The second half is C6's: a session whose charge was withdrawn
 * after its period closed is worth nothing now — every money field above is
 * zero for it — but a closed period still carries it, and a statement that
 * dropped the line would hide the correction the next close has to make.
 *
 * `lineType` DISTINGUISHES THIS MONTH'S WORK FROM LAST MONTH'S CORRECTION, and
 * on a `CORRECTION` line every money field is the DELTA being carried in, which
 * is why they may be negative in aggregate even where the field itself is
 * unsigned per-session. `correctsSessionSettlementId` names the rating being
 * corrected and is null on a `PRIMARY` line.
 *
 * ON THIS SESSION-DATE-KEYED READ, EVERY LINE IS `PRIMARY` AND CARRIES THE
 * SESSION'S CURRENT AUTHORITATIVE POSITION. A `CORRECTION` is a movement that
 * lands in a LATER PERIOD, while this statement is keyed on `SESSION_DATE` — so
 * a correction to a session in this range is not work that belongs to some
 * other range of days, it is a change to THIS session, and reporting it as a
 * second line beside its own primary would state the same session twice in one
 * column. The movement is stated instead as the difference between
 * `therapistNetToman` and `settledToman`, per line and in the totals; the
 * `CORRECTION` lines themselves are materialised rows of the PERIOD that
 * carried them, and are summarised on the closed period record
 * (`carriedInCorrectionCount`, `carriedInCorrectionToman` in `close.ts`), which
 * is the period-keyed surface where a period-keyed fact belongs.
 *
 * `appliedShareBasisPoints` AND `ratedVia` TRAVEL WITH EVERY LINE, so the
 * printed statement itself says which percentage was applied and whether the
 * session was rated as part of charging it or picked up by hand afterwards. A
 * settlement figure whose percentage is only discoverable by opening another
 * screen is a figure the therapist has to take on trust.
 *
 * NO FAMILY AND NO CHILD APPEARS ON THIS LINE. A settlement statement is about
 * work and money between the clinic and a therapist; who the child was is not
 * needed to check the arithmetic, and printing a roster of children onto a
 * document that leaves the building as a file would be a disclosure nobody
 * asked for. The session is identified by its date, its service and the charge
 * it came from.
 */
export const settlementStatementLineSchema = z.strictObject({
  sessionSettlementId: z.uuid(),
  sessionChargeId: z.uuid(),
  /**
   * M10.5 phase 1: `SESSION` or `NO_SHOW_PENALTY`, with the penalty's percent
   * (null on a session line), and the session the line belongs to, so the lines
   * of one session can be grouped. A penalty is rated and settled like any
   * charge, on its session's date (A5).
   */
  chargeKind: sessionChargeKindSchema,
  penaltyPercent: penaltyPercentSchema.nullable(),
  appointmentId: z.uuid(),
  serviceDate: isoDateSchema,
  serviceId: z.uuid(),
  serviceName: z.string(),
  durationMinutes: z.number().int().positive(),
  /**
   * WHY THE SESSION IS WORTH WHAT IT IS WORTH, WHERE THE MONEY CANNOT SAY.
   *
   * `FREE` means the session was charged under a `FREE` tariff and is therefore
   * WORTH ZERO BY RULE — a rated session, complimentary on purpose, and part of
   * `freeSessionCount`. `PAID` means it was priced, whatever the amounts then
   * came to.
   *
   * IT IS HERE BECAUSE ZERO IS NOT EVIDENCE. A reader looking only at the
   * amounts cannot tell a complimentary session from a priced one discounted to
   * nothing, from one whose charge was later withdrawn — three different facts
   * with three different fixes that all render as the same row of noughts. A
   * `PAID` session discounted to zero IS NOT FREE and must never be shown as
   * such. Deciding this on the client by testing an amount against zero would be
   * a second, wrong, source of truth; this field is the first and only one.
   *
   * IT SAYS NOTHING ABOUT UNRATED SESSIONS, which have no line here at all —
   * absence of a rating is never a zero line (rule 3 in `common.ts`) and is
   * reported as `unratedSessionCount` instead.
   */
  priceMode: tariffPriceModeSchema,
  lineType: settlementLineTypeSchema,
  correctsSessionSettlementId: z.uuid().nullable(),
  appliedShareBasisPoints: shareBasisPointsSchema,
  ratedVia: ratedViaSchema,
  baseAmountToman: tomanAmountSchema,
  therapistGrossToman: tomanAmountSchema,
  therapistDiscountToman: tomanAmountSchema,
  therapistNetToman: tomanAmountSchema,
  clinicGrossToman: tomanAmountSchema,
  clinicDiscountToman: tomanAmountSchema,
  clinicNetToman: signedTomanAmountSchema,
  settledToman: signedTomanAmountSchema,
});

export type SettlementStatementLine = z.infer<typeof settlementStatementLineSchema>;

/**
 * WHAT THE PERIOD CAME TO, STATED BY THE SERVER.
 *
 * THE COLUMN SUMS ARE SIGNED WHERE A CARRIED-IN CORRECTION CAN PULL THEM BELOW
 * ZERO. A per-session therapist net is never negative, but a period containing a
 * `CORRECTION` line that withdraws more than this period's primaries added is
 * genuinely negative, and clamping it would state a figure the clinic does not
 * mean. The gross columns stay unsigned: a correction adjusts nets, and a gross
 * is a split of work that happened.
 *
 * THE THREE SETTLEMENT FIGURES ARE THE ACCEPTED NAMES, AND THEY ARE NOT A
 * LEDGER:
 *
 *   * `earnedUnsettledToman` — net settlement for lines in this range that no
 *     closed period covers yet. It is a description of THIS RANGE, not a running
 *     position carried forward from the beginning of time.
 *   * `settledToman` — net settlement for lines in this range that a closed
 *     period already covers.
 *   * `netSettlementToman` — the two together: what this range came to.
 *
 * `pendingCorrectionToman` IS A BREAKDOWN OF `earnedUnsettledToman`, NOT A THIRD
 * ADDEND (Milestone 8, checkpoint C6). The identity above is unchanged —
 * `netSettlementToman = earnedUnsettledToman + settledToman` — and this states
 * how much of the unsettled figure is a MOVEMENT AGAINST WORK ALREADY CLOSED
 * rather than new work nobody has closed yet. The two are unsettled for opposite
 * reasons and need opposite acts: new work is waiting for its first close, while
 * a pending correction is waiting to be carried into the next one, and it is the
 * only one of the two that can be negative. A manager reading `-400,000` beside
 * a month of ordinary sessions is reading a charge somebody withdrew after the
 * period closed, and folding it into a single unsettled figure would make that
 * look like a month in which very little happened.
 *
 * `correctionCount` COUNTS SESSIONS, NOT MOVEMENTS, so it reads against
 * `sessionCount` rather than against a number of rows nobody can see: it is how
 * many sessions in this range have moved since a closed period carried them —
 * whether the movement has already been carried into a later close or is still
 * pending. Zero is the ordinary answer, and it is the answer for every range in
 * a clinic that has never had to correct anything.
 *
 * NONE OF THEM IS A `balance`, AN AMOUNT `owed`, `payable`, `receivable` OR
 * `due`, AND THE ABSENCE IS DELIBERATE. Milestone 8 does not record therapist
 * payouts at all — no payment out, no settlement of a settlement — so there is
 * nothing anywhere in this system that could ever decrease such a figure. A
 * field named `owed` would therefore only ever grow, and would be read by the
 * first person who saw it as a debt the clinic is running up. `settled` here
 * means "closed off in a period", not "paid".
 */
export const settlementStatementTotalsSchema = z.strictObject({
  /** Lines of kind `SESSION` (M10.5: what it always meant), and of kind `NO_SHOW_PENALTY`. */
  sessionCount: z.number().int().nonnegative(),
  penaltyCount: z.number().int().nonnegative(),
  correctionCount: z.number().int().nonnegative(),
  baseAmountToman: tomanAmountSchema,
  therapistGrossToman: tomanAmountSchema,
  therapistDiscountToman: tomanAmountSchema,
  therapistNetToman: signedTomanAmountSchema,
  clinicGrossToman: tomanAmountSchema,
  clinicDiscountToman: tomanAmountSchema,
  clinicNetToman: signedTomanAmountSchema,
  earnedUnsettledToman: signedTomanAmountSchema,
  pendingCorrectionToman: signedTomanAmountSchema,
  settledToman: signedTomanAmountSchema,
  netSettlementToman: signedTomanAmountSchema,
});

export type SettlementStatementTotals = z.infer<typeof settlementStatementTotalsSchema>;

/**
 * THE THREE THINGS THE PERIOD CONTAINED THAT NO TOTAL ABOVE INCLUDES.
 *
 * THEY ARE COUNTS, THEY ARE SEPARATE, AND THEY ARE NEVER SUMMED INTO MONEY.
 * That is the whole design: each names a session the statement could not settle,
 * for a different reason, with a different fix, and folding any of them into a
 * zero amount would make it disappear into a column that already balances.
 *
 *   * `unratedSessionCount` — completed, attended, charged, and nobody has
 *     decided the share yet. It is the first-class state of rule 3 in
 *     `common.ts`: NOT a rating of zero, and not a session worth nothing. A
 *     close may still succeed with unrated sessions in the range, and the
 *     count is what tells a manager how much of the month they are closing
 *     without.
 *   * `freeSessionCount` — sessions from a `FREE` tariff, which earn zero and
 *     ARE rated. Counted separately so a therapist reading a statement can see
 *     why the session count and the money do not track: complimentary work is
 *     work, and a line of zeroes with no explanation reads as an error.
 *   * `unchargedCompletedSessionCount` — completed and attended, but carrying no
 *     valid primary charge, so there is no basis to settle from at all. It is
 *     the ledger gap surfacing in the settlement view: the fix is to post the
 *     charge, not to rate anything, and it is the same fact the dashboard's
 *     `unchargedCompletedSessionCount` names.
 *
 * A SESSION IS COUNTED IN AT MOST ONE OF THEM, so the three can be read side by
 * side without a reader wondering whether they overlap: an uncharged session
 * cannot be rated and is never also counted as unrated.
 */
export const settlementStatementExceptionsSchema = z.strictObject({
  unratedSessionCount: z.number().int().nonnegative(),
  freeSessionCount: z.number().int().nonnegative(),
  unchargedCompletedSessionCount: z.number().int().nonnegative(),
  /**
   * M10.5 phase 1: absent seats of completed sessions in this range with no
   * standing manager decision. The close screen's warning — not stored, not
   * blocking: a penalty decided after the close is carried into the next one,
   * labelled with its own session date. Disjoint from the three above (an
   * absent seat carries no charge until decided).
   */
  undecidedNoShowCount: z.number().int().nonnegative(),
});

export type SettlementStatementExceptions = z.infer<typeof settlementStatementExceptionsSchema>;

/**
 * The statement as one response.
 *
 * `range` ECHOES THE PERIOD AND ITS BASIS, as every ranged report does, so a
 * printed or exported statement dates itself and says what it counted.
 * `therapist` names the person, because a page of money with a uuid on it is not
 * a document anybody can hand over.
 *
 * `exceptions` IS A SIBLING OF `totals`, NOT A KEY INSIDE IT. A count of things
 * that were not settled has no business sitting among figures that were, and the
 * separation is what stops a later reader from adding it to anything.
 */
export const settlementStatementResponseSchema = z.strictObject({
  range: reportRangeSchema,
  therapist: reportTherapistSummarySchema,
  lines: z.array(settlementStatementLineSchema),
  totals: settlementStatementTotalsSchema,
  exceptions: settlementStatementExceptionsSchema,
});

export type SettlementStatementResponse = z.infer<typeof settlementStatementResponseSchema>;
