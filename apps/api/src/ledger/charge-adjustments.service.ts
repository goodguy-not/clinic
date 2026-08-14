import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CreateChargeAdjustmentRequest, SessionChargeResponse } from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import { actorContext, canonicalText } from '../catalog/catalog-support';
import { AppError } from '../common/app-error';
import { isCheckViolation, isRestrictViolation, violatesConstraint } from '../common/pg-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { uuidv7 } from '../common/uuid';
import {
  lockAdjustmentRow,
  lockChargeRow,
  readChargeDetail,
  sumActiveAdjustments,
  type ChargeRow,
} from './charge-detail';

/**
 * Concessions on a session that happened: granting one, and taking it back.
 *
 * AN ADJUSTMENT IS NOT A CORRECTION OF THE CHARGE. The session happened, the
 * charge stands, and the family owes less for it — three facts that remain true
 * together. Nothing here rewrites the amount, the tariff snapshot, the
 * service/therapist snapshot or an earlier adjustment; the reduction is a new
 * row, and the effective amount is derived from the charge and the rows beneath
 * it (`readChargeDetail`). A charge that was wrong is voided and re-posted
 * instead — that is `SessionChargesService`, and it is a different decision with
 * a different reason.
 *
 * EVERY MILESTONE 5 CONCESSION IS BORNE IN FULL BY THE CLINIC, and that is
 * written here rather than accepted from a caller: `therapist_discount_toman = 0`
 * and `clinic_discount_toman = amount_toman` (DECISION_LOG, 2026-08-14 — Every
 * Milestone 5 discount is genuinely clinic-borne). The frozen request carries no
 * therapist portion, there is no override field and no hidden one, and
 * `charge_adjustment_clinic_borne_chk` refuses anything else whether or not it
 * came from this class. A shared or therapist-borne concession needs an approved
 * settlement rule to be borne against, and Milestone 8 is where that arrives.
 *
 * THERE IS NO UPWARD CORRECTION. `charge_adjustment` only ever reduces
 * (`amount_toman > 0` and the sum bounded by the charge), so "the family owes
 * more than the session was priced at" is not expressible — it would be a
 * different fact needing rules nobody has approved.
 *
 * ONE LOCK ORDER FOR BOTH OPERATIONS: the parent `session_charge` row `FOR
 * UPDATE` first, then the adjustment. Voiding a charge takes the same row and
 * nothing else (checkpoint A4), so an adjustment and a void serialise against
 * each other rather than interleaving, and no transaction in this module can
 * hold a lock another one needs next.
 */
@Injectable()
export class ChargeAdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Grants a concession on a priced session, and says who decided it and why.
   *
   * THE PARENT CHARGE IS LOCKED BEFORE ANYTHING IS DECIDED, and the affordability
   * question is answered under that lock. Two concessions of 60,000 against a
   * charge of 100,000, submitted together, would both read a stale active total
   * of zero without it and would both pass — leaving a family owing minus twenty
   * thousand toman, which CLAUDE.md forbids outright. With it the second waits,
   * re-reads a total that includes the first, and is refused.
   *
   * THE DATABASE IS STILL THE AUTHORITY. `enforce_charge_adjustment_bounds`
   * re-takes the same lock inside the INSERT and re-computes the same sum, so the
   * floor holds for the repair script and the psql session too. The check above it
   * is not a substitute and is not a weakening of it: it exists so a manager is
   * told `ADJUSTMENT_EXCEEDS_CHARGE` — with a Persian message and a remaining
   * amount they can act on — rather than seeing an internal error. Both refuse the
   * same request, and the translation below covers the case where only the trigger
   * sees it.
   *
   * A `FREE` CHARGE IS UNADJUSTABLE and needs no rule of its own: its amount is
   * zero, so any positive concession exceeds it and is refused by the same bound.
   * A `PAID` charge waived in full is the opposite case — it is allowed, it
   * produces an effective amount of zero, and it stays `PAID` with an adjustment
   * naming the manager who waived it. The two are different facts that both
   * display as zero, and neither can become the other.
   */
  async create(
    chargeId: string,
    body: CreateChargeAdjustmentRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<SessionChargeResponse> {
    const reason = canonicalText(body.reason);
    const amount = BigInt(body.amountToman);

    return this.prisma.$transaction(async (tx) => {
      const charge = await lockChargeRow(tx, chargeId);

      // A voided charge is history: there is nothing standing to reduce, and the
      // replacement charge — not this one — is what a live concession belongs to.
      // The trigger says the same thing; this says it with a code and a fix.
      if (charge.voided_at !== null) throw new AppError('CHARGE_VOIDED');

      const activeTotal = await sumActiveAdjustments(tx, chargeId);
      if (activeTotal + amount > charge.amount_toman) {
        throw new AppError('ADJUSTMENT_EXCEEDS_CHARGE');
      }

      const adjustmentId = uuidv7();
      await insertAdjustment(tx, { adjustmentId, chargeId, amount, reason, actor });

      // In the same transaction as the row it records, so a concession and the
      // trail of who granted it cannot be separated by a failure. The payload is
      // the financial fact: ids, the amount, the explicit allocation, the reason.
      // No name, no file number and no phone number is copied into `audit_log`,
      // which is append-only and permanent.
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'charge_adjustment.created',
        entityType: 'charge_adjustment',
        entityId: adjustmentId,
        after: {
          sessionChargeId: chargeId,
          amountToman: amount.toString(),
          // Stated rather than implied. "The clinic bore all of it" is the fact
          // that makes this row safe to keep before settlement exists, and a
          // reader a year from now should not have to know the Milestone 5
          // policy to see it.
          therapistDiscountToman: '0',
          clinicDiscountToman: amount.toString(),
          reason,
        },
        metadata: chargeMetadata(charge),
      });

      return { charge: await readChargeDetail(tx, chargeId) };
    });
  }

  /**
   * Withdraws a concession, which restores the amount it had removed.
   *
   * NOT A DELETE AND NOT AN EDIT. Three columns are written onto the row and
   * nothing else: the amount, the allocation, the original reason, the actor and
   * the instant it was granted all stay exactly as recorded, and
   * `enforce_charge_adjustment_immutability` refuses any statement that says
   * otherwise. The concession was genuinely granted, and that stays permanently
   * readable next to the reason it was taken back.
   *
   * THE FINANCIAL EFFECT IS RESTORED BY THE READ, not by a stored total. The
   * voided row leaves the active sum (`sumActiveAdjustments`, and the same
   * predicate in the trigger), so the effective amount returned below is the
   * charge as it now stands — no number was written anywhere that could disagree.
   *
   * ONE-WAY, ENFORCED TWICE, as a charge void is: there is no un-void request in
   * the frozen contract, the `UPDATE` is predicated on `voided_at IS NULL`, and
   * the immutability trigger raises on any attempt to change an existing void's
   * instant, actor or reason. A second void therefore CANNOT overwrite the first
   * one's reason; the check above it is what turns that into
   * `ADJUSTMENT_ALREADY_VOIDED` instead of an internal error.
   *
   * IT IS PERMITTED ON A VOIDED CHARGE, deliberately. Voiding the charge does not
   * void its adjustments and this does not un-void the charge; a manager
   * withdrawing a concession attached to a charge that was itself withdrawn is
   * recording an intent about history, and refusing it would invent a rule to
   * protect a total that a voided charge does not contribute to anyway.
   */
  async void(
    chargeId: string,
    adjustmentId: string,
    reason: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<SessionChargeResponse> {
    const canonicalReason = canonicalText(reason);

    return this.prisma.$transaction(async (tx) => {
      // The parent first and the adjustment second, which is this module's only
      // lock order. It also makes a concurrent charge void and this void
      // serialise rather than race.
      const charge = await lockChargeRow(tx, chargeId);
      const current = await lockAdjustmentRow(tx, chargeId, adjustmentId);

      if (current.voided_at !== null) throw new AppError('ADJUSTMENT_ALREADY_VOIDED');

      await tx.$executeRaw`
        UPDATE charge_adjustment
           SET voided_at = transaction_timestamp(),
               voided_by_user_id = ${actor.userId}::uuid,
               void_reason = ${canonicalReason}
         WHERE id = ${adjustmentId}::uuid AND voided_at IS NULL
      `;

      // Re-read after the UPDATE and before the audit row, so the trail carries
      // the instant PostgreSQL stamped rather than one Node guessed, and so the
      // detail returned below and the audit payload come from the same state.
      const detail = await readChargeDetail(tx, chargeId);
      const voided = detail.adjustments.find((one) => one.id === adjustmentId);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'charge_adjustment.voided',
        entityType: 'charge_adjustment',
        entityId: adjustmentId,
        // The transition, both sides, because "it is void" does not state that
        // it was not.
        before: { voidedAt: null },
        after: { voidedAt: voided?.voidedAt ?? null, voidReason: canonicalReason },
        // What concession was withdrawn from which charge, as flat countable
        // keys. The amount and the allocation are repeated here because the
        // question this trail answers is "how much did the clinic give away and
        // then take back", and that must be answerable without re-reading a row
        // that may since have been voided too.
        metadata: {
          ...chargeMetadata(charge),
          amountToman: current.amount_toman.toString(),
          therapistDiscountToman: current.therapist_discount_toman.toString(),
          clinicDiscountToman: current.clinic_discount_toman.toString(),
        },
      });

      return { charge: detail };
    });
  }
}

/**
 * Which money this concession is against, as the charge void records it.
 *
 * Identifiers only, and the same ones `session_charge.voided` writes, so the two
 * financial trails can be read side by side without a join and without either
 * carrying a person's name.
 */
function chargeMetadata(charge: ChargeRow) {
  return {
    sessionChargeId: charge.id,
    familyId: charge.family_id,
    childId: charge.child_id,
    appointmentId: charge.appointment_id,
    appointmentParticipantId: charge.appointment_participant_id,
    chargeAmountToman: charge.amount_toman.toString(),
  };
}

/**
 * The INSERT, with the allocation the server decides and the caller cannot state.
 *
 * `created_at` comes from `transaction_timestamp()` rather than from Node, so the
 * adjustment and the audit row recording it carry the same instant.
 *
 * THE TRIGGER'S REFUSALS ARE TRANSLATED, NOT RECOVERED FROM. The two conditions
 * it raises are both already decided above under the same lock, so neither should
 * be reachable; if one ever is — a lock weakened, a caller added — the manager is
 * told which rule refused them rather than receiving an internal error. It is not
 * retried, because a failed statement aborts the PostgreSQL transaction and a
 * retry loop dressed as idempotency would be the dishonest answer.
 */
async function insertAdjustment(
  tx: Prisma.TransactionClient,
  args: {
    adjustmentId: string;
    chargeId: string;
    amount: bigint;
    reason: string;
    actor: ResolvedSession;
  },
): Promise<void> {
  const { adjustmentId, chargeId, amount, reason, actor } = args;

  try {
    await tx.$executeRaw`
      INSERT INTO charge_adjustment (
        id, session_charge_id, amount_toman,
        therapist_discount_toman, clinic_discount_toman, reason,
        created_at, created_by_user_id
      ) VALUES (
        ${adjustmentId}::uuid,
        ${chargeId}::uuid,
        ${amount.toString()}::bigint,
        0::bigint,
        ${amount.toString()}::bigint,
        ${reason},
        transaction_timestamp(),
        ${actor.userId}::uuid
      )
    `;
  } catch (error) {
    // The cumulative floor, raised by the trigger with `check_violation`. The
    // row-level amount bounds share that SQLSTATE and are already refused by
    // `adjustmentAmountTomanSchema` before the request reaches here, so they are
    // excluded by name rather than swallowed into the same code.
    if (
      isCheckViolation(error) &&
      !violatesConstraint(error, 'charge_adjustment_amount_bounds_chk')
    ) {
      throw new AppError('ADJUSTMENT_EXCEEDS_CHARGE');
    }

    // The voided-parent refusal, raised by the same trigger.
    if (isRestrictViolation(error)) throw new AppError('CHARGE_VOIDED');

    throw error;
  }
}
