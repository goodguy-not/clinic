import { Injectable } from '@nestjs/common';
import type { PostSessionChargeResponse, SessionChargeResponse } from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import { actorContext, canonicalText } from '../catalog/catalog-support';
import { AppError } from '../common/app-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { SessionRatingService } from '../settlement/ratings/session-rating.service';
import {
  findCurrentOrLatestChargeForParticipant,
  lockChargeRow,
  readChargeDetail,
  readChargeRow,
} from './charge-detail';
import { ChargePostingService } from './charge-posting.service';

/**
 * The explicit, operator-initiated post.
 *
 * IT OWNS THE TRANSACTION AND NOTHING ELSE. Every rule — the two facts, the
 * lock, the idempotent answer, the tariff, the snapshot, the audit row — belongs
 * to `ChargePostingService` and is not restated here. What this class adds is the
 * transaction boundary the lifecycle callers already have, and the translation
 * from the two declining outcomes into the refusals an operator sees.
 *
 * THIS IS THE RECOVERY PATH, and there are two things to recover from. A session
 * completed while its service had no applicable tariff is completed, attended and
 * unpriced: a manager records the tariff and posts the charge from here. A charge
 * raised wrongly is voided (checkpoint A4) and re-raised from here — which works
 * because `session_charge_one_valid_per_participant_uq` is partial on
 * `voided_at IS NULL`, so the withdrawn row leaves the index and stays in the
 * table.
 *
 * A REFUSAL ROLLS THE TRANSACTION BACK, and there is nothing in it to lose:
 * nothing was written before the decision. `TARIFF_MISSING` here is deliberately
 * an error rather than the silence the automatic path answers with — a person
 * asked for this charge to exist now, and telling them nothing happened without
 * saying why is the failure mode PROJECT_SPEC.md 5 requires a visible pricing
 * error instead of.
 *
 * A RETRY IS NOT A REFUSAL. A second post against a seat that already has a valid
 * charge is `ALREADY_POSTED` with that charge, never
 * `CHARGE_EXISTS_FOR_PARTICIPANT`: the request asked for the session to be
 * charged and it is, so nothing was refused (CLAUDE.md — retries are idempotent).
 */
@Injectable()
export class SessionChargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: ChargePostingService,
    private readonly ratings: SessionRatingService,
    private readonly audit: AuditService,
  ) {}

  async post(
    participantId: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<PostSessionChargeResponse> {
    return this.prisma.$transaction(async (tx) => {
      const attempt = await this.posting.post(tx, {
        participantId,
        actor,
        context,
        trigger: 'EXPLICIT_REPOST',
      });

      switch (attempt.status) {
        case 'POSTED':
          return { outcome: 'POSTED' as const, charge: attempt.charge };
        case 'ALREADY_POSTED':
          return { outcome: 'ALREADY_POSTED' as const, charge: attempt.charge };
        // The session was not completed, or this child did not attend it. One
        // code for both, because the caller's fix is the same: record what
        // actually happened to the session first.
        case 'NOT_ELIGIBLE':
          throw new AppError('CHARGE_NOT_ELIGIBLE');
        // Reused rather than duplicated as a charge-shaped variant: a date no
        // tariff covers is the same fact whether it is met while pricing or
        // while charging, and one code keeps one Persian message and one fix.
        case 'TARIFF_MISSING':
          throw new AppError('TARIFF_MISSING');
      }
    });
  }

  /**
   * What one seat currently owes, if anything.
   *
   * THE ONE READ AN APPOINTMENT SCREEN NEEDS. A session detail page has a
   * participant and has to show whether that seat has been charged, for how much,
   * and what is left after any concession — without asking the browser to work
   * any of it out. It answers with `sessionChargeDetail`, the same shape every
   * ledger write returns, built by the same `readChargeDetail`. No arithmetic
   * exists here.
   *
   * NO TRANSACTION AND NO LOCK. Nothing is decided, so there is nothing to
   * serialise; two statements against a read-committed snapshot are enough for a
   * view, exactly as `AppointmentReadService` reasons.
   *
   * A STANDING CHARGE WINS; OTHERWISE THE SEAT'S HISTORY ANSWERS. The selection
   * is `findCurrentOrLatestChargeForParticipant`'s total order: the valid charge
   * if there is one — at most one, by
   * `session_charge_one_valid_per_participant_uq` — and otherwise the most
   * recently withdrawn. A seat that was charged, corrected and re-charged
   * therefore answers with the charge that stands, and a seat whose charge was
   * withdrawn and not replaced answers with that withdrawal.
   *
   * RETURNING A VOIDED ROW MAKES NOTHING OWED. `voidedAt`, `voidedByUserId` and
   * `voidReason` are populated on it, which is exactly how a caller tells the two
   * apart on a shape that carries one charge, and no total in this system
   * consults this method. What it buys is that "this session was charged and the
   * charge was taken back" is reachable at all: the alternative was a 404 that a
   * screen could not distinguish from a session nobody ever charged, which are
   * opposite situations for the person deciding whether to re-post.
   *
   * `CHARGE_NOT_FOUND` NOW MEANS EXACTLY ONE THING: this seat has no charge
   * history whatsoever. A participant that does not exist answers the same way,
   * and neither confirms the other — a caller guessing seat ids learns only that
   * there is nothing to see.
   */
  async readForParticipant(participantId: string): Promise<SessionChargeResponse> {
    const charge = await findCurrentOrLatestChargeForParticipant(this.prisma, participantId);
    if (charge === undefined) throw new AppError('CHARGE_NOT_FOUND');

    return { charge: await readChargeDetail(this.prisma, charge.id) };
  }

  /**
   * Withdraws a charge that should not stand, and says why.
   *
   * NOT A DELETE, AND NOT AN EDIT. Final financial records are voided or
   * adjusted, never physically deleted (CLAUDE.md), so this writes three columns
   * onto the row and touches nothing else. Every snapshot column — who was
   * treated, by whom, for what, on which day, for how much — is left exactly as
   * raised, and `enforce_session_charge_immutability` refuses any statement that
   * says otherwise whether or not it came from here.
   *
   * ONE-WAY, AND THAT IS ENFORCED TWICE. There is no un-void request in the
   * frozen contract, the `UPDATE` below is predicated on `voided_at IS NULL`, and
   * the trigger raises `restrict_violation` on any attempt to change a void's
   * instant, actor or reason once it exists. So a second void CANNOT overwrite
   * the first one's reason even if every check above it were removed; what the
   * checks add is that the manager is told `CHARGE_ALREADY_VOIDED` instead of
   * seeing an internal error.
   *
   * THE LOCK IS ON THE CHARGE ROW AND ON NOTHING ELSE. Two simultaneous voids
   * serialise on it and the second re-reads `voided_at` after the first commits,
   * so exactly one financial transition and exactly one audit row are produced.
   * No appointment lock is taken: a void changes no appointment and no
   * attendance, and widening the footprint would put this transaction into the
   * lifecycle's lock order for no rule it needs. The two meet correctly anyway —
   * a lifecycle reversal reads this row under the appointment lock, and either
   * sees a void that has committed or refuses on a charge that was still valid.
   *
   * IT DOES NOT REOPEN, UNCOMPLETE OR UN-ATTEND ANYTHING. Voiding the money and
   * correcting the session are two decisions with two reasons, and this endpoint
   * makes exactly one of them (see `ChargeLifecycleGuard`).
   *
   * ADJUSTMENTS ATTACHED TO THE CHARGE ARE LEFT ALONE — not deleted, not voided,
   * not rewritten. They are history of a concession that was genuinely granted,
   * and a voided charge contributes nothing to any account total whatever its
   * arithmetic says, so there is no number for them to distort.
   *
   * THE SETTLEMENT RATING IS THE ONE EXCEPTION, AND IT IS WITHDRAWN HERE
   * (Milestone 8, checkpoint C3). An adjustment reduces a charge that no longer
   * counts, so it distorts nothing by standing; a RATING is what a therapist
   * earned, and it is read by a settlement statement that knows only about
   * ratings. Left standing against a withdrawn charge it would be the single
   * figure in this system that a void does not reach — somebody paid for a
   * session the clinic has taken the money back for. So it is withdrawn in this
   * transaction, carrying this void's own reason and its own
   * `session_settlement.voided` audit fact.
   *
   * NOTHING IS DELETED AND NOTHING IS REWRITTEN. The rating keeps every figure
   * it applied; if the session is charged again, the new charge is rated in its
   * own right by the ordinary posting path.
   */
  async void(
    chargeId: string,
    reason: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<SessionChargeResponse> {
    const canonicalReason = canonicalText(reason);

    return this.prisma.$transaction(async (tx) => {
      const current = await lockChargeRow(tx, chargeId);
      if (current.voided_at !== null) throw new AppError('CHARGE_ALREADY_VOIDED');

      // `voided_at IS NULL` in the predicate as well as in the check above: the
      // check is what produces the named refusal, this is what makes a second
      // void structurally unable to write even if the check were wrong.
      await tx.$executeRaw`
        UPDATE session_charge
           SET voided_at = transaction_timestamp(),
               voided_by_user_id = ${actor.userId}::uuid,
               void_reason = ${canonicalReason}
         WHERE id = ${chargeId}::uuid AND voided_at IS NULL
      `;

      const voided = await readChargeRow(tx, chargeId);

      // Under the charge lock this transaction already holds, so the rating
      // cannot be created concurrently while its withdrawal is being written.
      await this.ratings.voidForVoidedCharge(tx, current, canonicalReason, actor, context);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'session_charge.voided',
        entityType: 'session_charge',
        entityId: chargeId,
        // The transition, both sides, because "it is void" does not state that
        // it was not. The actor and the instant are columns of the audit row
        // itself and are not repeated into the payload.
        before: { voidedAt: null },
        after: {
          voidedAt: voided.voided_at?.toISOString() ?? null,
          voidReason: canonicalReason,
        },
        // What money was withdrawn from whom, as flat countable keys — the same
        // financial identifiers `session_charge.posted` records and nothing
        // more. No name, no phone number and no file number is copied into
        // `audit_log`, which is append-only and permanent.
        metadata: {
          familyId: current.family_id,
          childId: current.child_id,
          appointmentId: current.appointment_id,
          appointmentParticipantId: current.appointment_participant_id,
          priceMode: current.price_mode,
          amountToman: current.amount_toman.toString(),
        },
      });

      return { charge: await readChargeDetail(tx, chargeId) };
    });
  }
}
