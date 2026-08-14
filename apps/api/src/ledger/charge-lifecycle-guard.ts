import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/app-error';

/**
 * THE ONE PLACE THAT REFUSES TO FALSIFY A VALID CHARGE.
 *
 * A primary session charge is valid while its appointment is `COMPLETED` and its
 * seat is `ATTENDED` (CLAUDE.md, non-negotiable rules). Those two facts are the
 * charge's whole justification, and `ChargePostingService` establishes them under
 * the appointment lock before writing a row. NOTHING RE-ESTABLISHES THEM
 * AFTERWARDS: a reopen or an attendance reversal would leave the money standing
 * on a session the database no longer says happened, and the family would be
 * billed for it with nothing in the record to say why.
 *
 * SO THE LIFECYCLE IS REFUSED, AND THE CHARGE IS NOT TOUCHED. The alternative —
 * voiding the charge as a side effect of reopening — collapses two decisions into
 * one request: "this session did not happen as recorded" and "this money should
 * not be owed" are separate judgements with separate reasons, and an operator who
 * only meant the first would silently make the second. They are also two audit
 * facts, and a trail that records one act cannot answer why the money went.
 *
 * The approved sequence is therefore: the reversal is refused, the manager voids
 * the charge with a FINANCIAL reason, and then performs the correction with its
 * own LIFECYCLE reason. The withdrawn charge stays visible forever, and if the
 * session becomes `COMPLETED + ATTENDED` again the ordinary posting path raises a
 * new one — which works because the exactly-once index is partial on
 * `voided_at IS NULL`.
 *
 * ------------------------------------------------------------------------
 * IT IS OWNED BY THE LEDGER AND CALLED BY THE LIFECYCLE, exactly as
 * `ChargePostingService` is. "Does this seat carry money?" is a financial
 * question, and `AppointmentsService` holds no charge SQL and must not learn any:
 * a copy of this predicate over there would be a second reading of what "valid"
 * means, and the two would eventually disagree about a voided row.
 *
 * IT RUNS UNDER THE CALLER'S APPOINTMENT LOCK, and that is what makes the read
 * sound rather than merely likely. Every path that can CREATE a charge takes the
 * booking's row `FOR UPDATE` first, so while a lifecycle transaction holds that
 * lock no charge can appear behind this check: the answer cannot go stale between
 * the read and the write it guards. A charge that is VOIDED concurrently is the
 * harmless direction — this transaction refuses on a charge that was valid when
 * it looked, the reversal is retried, and the second attempt sees the void.
 *
 * NO ROW LOCK IS TAKEN ON `session_charge` HERE. Taking one would put a lifecycle
 * transaction on both the appointment and a charge row while `void` holds a charge
 * row and takes nothing else — a second lock order for no benefit, since the
 * appointment lock already excludes the only writer that could invalidate this
 * read.
 *
 * A REFUSAL IS A ROLLBACK. It is thrown, not returned, so the appointment status,
 * the seat's attendance and every financial row are left exactly as they were —
 * there is no partial reversal to clean up, because the transaction that would
 * have made one never commits.
 */
@Injectable()
export class ChargeLifecycleGuard {
  /**
   * Refuses when any of these seats still carries a charge that has not been
   * voided, and NAMES THE ONE THAT BLOCKED.
   *
   * The predicate is `voided_at IS NULL` — the same one
   * `session_charge_one_valid_per_participant_uq` is partial on and the same one
   * `findValidChargeForParticipant` reads with, so "valid" has one meaning in
   * this system. A voided charge is history and blocks nothing: that is the whole
   * mechanism by which the correction sequence completes.
   *
   * Every affected seat in ONE statement: a reopen changes the status of a
   * booking, which falsifies the premise of every charge under it at once, and
   * asking per seat would be several round trips to reach the same refusal.
   *
   * ------------------------------------------------------------------------
   * THE REFUSAL CARRIES THE BLOCKING RECORD, because "a charge exists" is not
   * actionable on its own. The manager's next step is to open that charge and
   * decide whether to void it, and a message with no identifier makes them go
   * looking for it. So `details` names the charge and states what it is currently
   * worth to the family — which is what the decision is actually about.
   *
   * THE SET IS GENUINELY PLURAL, AND THE QUERY IS WRITTEN FOR THAT. An
   * appointment is the shared resource booking and a participant is one child's
   * seat in it; an INDIVIDUAL appointment has one seat, a GROUP session has
   * several (DECISION_LOG, 2026-08-02 — Two-level appointment model). The
   * one-seat case is a property of the bookings the current interface creates,
   * NOT of the schema — nothing in PostgreSQL constrains an appointment to one
   * participant, deliberately — so this must not read the first seat and stop.
   * Every affected seat is considered, and the group feature arriving changes
   * nothing here.
   *
   * ONE CHARGE REPORTED, NOT A LIST, and that is a presentation decision rather
   * than an assumption about how many there are. A manager with several blockers
   * still corrects them one at a time, and the next refusal names the next one.
   * The earliest is returned — `ORDER BY created_at, id` — so a retried request
   * does not name a different record each time. A bulk error contract invented
   * for this checkpoint would be a shape frozen before anything renders it.
   *
   * IDENTIFIERS AND ONE AMOUNT, AND NOTHING ELSE. No name, no file number, no
   * national identifier, no phone number: an error envelope travels to a browser
   * and into logs, and personal data does not need to be in either to answer
   * "which charge is stopping me?".
   * ------------------------------------------------------------------------
   * THE AMOUNT IS THE EFFECTIVE ONE, COMPUTED IN POSTGRESQL AND NOT IN NODE.
   *
   * A charge with an active concession against it is worth less than it was
   * raised for, and reporting the base amount would show the manager a number the
   * family was never going to owe. So the active adjustments are subtracted here,
   * by the same `voided_at IS NULL` rule `readChargeDetail` sums with — one
   * definition of "effective", not two that can disagree about a withdrawn
   * concession.
   *
   * It arrives as `::text` rather than as a `bigint`. That is the canonical wire
   * representation the whole ledger uses (`tomanAmountSchema`): `BigInt` has no
   * JSON form and would throw inside the error filter, and a `number` silently
   * loses precision above 2^53. The digits are the value.
   */
  async assertNoValidCharge(
    tx: Prisma.TransactionClient,
    participantIds: readonly string[],
  ): Promise<void> {
    if (participantIds.length === 0) return;

    const seats = Prisma.join(participantIds.map((id) => Prisma.sql`${id}::uuid`));

    const rows = await tx.$queryRaw<BlockingChargeRow[]>`
      SELECT c.id,
             (
               c.amount_toman - coalesce((
                 SELECT sum(a.amount_toman)
                 FROM charge_adjustment a
                 WHERE a.session_charge_id = c.id AND a.voided_at IS NULL
               ), 0)
             )::text AS effective_amount_toman
      FROM session_charge c
      WHERE c.appointment_participant_id IN (${seats})
        AND c.voided_at IS NULL
      ORDER BY c.created_at ASC, c.id ASC
      LIMIT 1
    `;

    const blocking = rows[0];
    if (blocking === undefined) return;

    throw new AppError('CHARGE_EXISTS_FOR_PARTICIPANT', {
      sessionChargeId: blocking.id,
      effectiveAmountToman: blocking.effective_amount_toman,
    });
  }
}

/** The blocking charge, with its effective value already summed by PostgreSQL. */
type BlockingChargeRow = {
  id: string;
  /** Canonical decimal digits, never a `number` and never a `BigInt`. */
  effective_amount_toman: string;
};
