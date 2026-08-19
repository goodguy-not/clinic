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
import { findValidRatingForCharge } from '../settlement/ratings/session-rating.service';
import {
  lockAdjustmentRow,
  lockChargeRow,
  readChargeDetail,
  sumActiveAdjustments,
  sumActiveTherapistAllocations,
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
 * A CONCESSION IS BORNE BY THE CLINIC, BY THE THERAPIST, OR BY BOTH, AND WHICH
 * ONE IS AN EXPLICIT FACT (CLAUDE.md; Milestone 8 checkpoint C4). Clinic-borne
 * remains the DEFAULT and the overwhelming majority: a request that omits the
 * therapist portion, or states it as zero, produces exactly the row Milestone 5
 * produced — `therapist_discount_toman = 0`, `clinic_discount_toman =
 * amount_toman` — through the same statements, and that path consults the
 * settlement tables not at all.
 *
 * A POSITIVE PORTION IS RECORDED AS SUBMITTED, OR REFUSED WITH A REASON; IT IS
 * NEVER REINTERPRETED. C1 made `therapistDiscountToman` submittable ahead of the
 * runtime that honours one, and C2 added a temporary guard refusing every
 * non-zero portion outright — so that a manager could not state a shared
 * concession, receive a 200, and have the clinic recorded as bearing all of it,
 * a different financial fact from the one they submitted and discoverable only
 * at settlement. THAT GUARD IS NOW REPLACED BY THE REAL SPLIT rather than
 * removed. What remains are the two questions only the server can answer — is
 * there an authoritative applied share to bear this against, and does bearing it
 * leave the therapist net at or above zero — and both answer
 * `ADJUSTMENT_SPLIT_INVALID` when the answer is no.
 *
 * THE CALLER STATES THE TOTAL AND THE THERAPIST'S SHARE OF IT; THE CLINIC TAKES
 * THE EXACT RESIDUAL. So therapist + clinic = the family's concession by
 * construction, with no pair of numbers a caller can send that fails to add up
 * and no second answer for the server to choose between
 * (`createChargeAdjustmentRequestSchema`, and
 * `charge_adjustment_split_identity_chk` beneath it).
 *
 * THE APPLIED SNAPSHOT IS THE AUTHORITY FOR THE GROSS, NOT THE CURRENT RULE.
 * `session_settlement.therapist_gross_toman` is what was applied to THIS session
 * and was frozen when it was rated (checkpoint C3); nothing here re-resolves a
 * percentage, so a share rule corrected next month cannot retroactively widen or
 * narrow what a therapist already bore on a session last month.
 *
 * CLINIC NET MAY GO NEGATIVE, AND IS NEITHER CLAMPED NOR HIDDEN. Nothing here
 * bounds the clinic's residual: a concession larger than the clinic's gross
 * share is an explicit subsidy, it is exactly what a therapist who does not
 * participate in discounts produces, and CLAUDE.md requires it to stay visible
 * in reports. The only two floors in this system are the family's effective
 * charge and the therapist's net, and both are enforced below and in the
 * database.
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
   *
   * THE THERAPIST-NET FLOOR IS ANSWERED UNDER THE SAME LOCK AS THE FAMILY ONE,
   * and that is why there is only one lock. Two therapist-borne portions of
   * 40,000 against an applied share of 60,000, submitted together, would both
   * read an allocated total of zero without it and both pass, leaving a
   * therapist owed minus twenty thousand toman — the mirror image of the race
   * the family floor was written to survive, and forbidden by the same file.
   * Both questions are decided from rows read after `lockChargeRow`, and every
   * write that can move either side of either inequality — a concession here, a
   * rating withdrawal or correction in `SessionRatingService` — takes that same
   * charge row first.
   *
   * THE APPLIED SHARE IS READ, NEVER RECOMPUTED. `findValidRatingForCharge`
   * returns the STANDING snapshot C3 froze onto this session, and a session with
   * no standing rating has nothing to bear a portion against — which is
   * `ADJUSTMENT_SPLIT_INVALID`, not a zero and not a silently clinic-borne row.
   */
  async create(
    chargeId: string,
    body: CreateChargeAdjustmentRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<SessionChargeResponse> {
    const reason = canonicalText(body.reason);
    const amount = BigInt(body.amountToman);
    // Omitted means clinic-borne, which is what this request has always meant.
    // The schema has already proved the digit shape and that the portion does
    // not exceed the concession it is part of, so this conversion is safe.
    const therapistPortion = BigInt(body.therapistDiscountToman ?? '0');

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

      await assertTherapistPortionAffordable(tx, chargeId, therapistPortion);

      const adjustmentId = uuidv7();
      await insertAdjustment(tx, {
        adjustmentId,
        chargeId,
        amount,
        therapistPortion,
        reason,
        actor,
      });

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
          // THE ACTUAL SPLIT, BOTH HALVES, ALWAYS. It was stated explicitly even
          // when the policy pinned it, so that a reader a year from now would
          // not have to know the Milestone 5 policy to see who bore the cost;
          // now that both halves can genuinely vary, it is the whole financial
          // point of the row. Nothing wider is copied here — no name, no file
          // number, no phone number — and `audit_log` is append-only and
          // permanent.
          therapistDiscountToman: therapistPortion.toString(),
          clinicDiscountToman: (amount - therapistPortion).toString(),
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
   * BOTH SIDES ARE RESTORED BY THE SAME MECHANISM, AND NEITHER IS RESTORED BY A
   * WRITE. A withdrawn therapist-borne portion leaves
   * `sumActiveTherapistAllocations` in the same breath, so the therapist's net
   * returns to the applied gross, the allowance for a further concession returns
   * with it, and the rating this portion stood against becomes withdrawable
   * again — all of it derived from the rows, none of it stamped onto the
   * settlement snapshot, which C3 made structurally unwritable anyway.
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
 * CAN THIS SESSION'S THERAPIST BEAR THIS MUCH OF THE CONCESSION?
 *
 * TWO CONDITIONS, ONE CODE, AND THE CODE ALREADY MEANT BOTH.
 * `ADJUSTMENT_SPLIT_INVALID` was frozen in C1 as "the session carries no rating
 * to bear it, or the portion would drive the therapist net below zero"
 * (`errors.ts`), and those are exactly the two refusals here. They are not split
 * into two codes because the fix is the same in kind — allocate less, or rate
 * the session first — and the Persian message names both situations.
 *
 * A ZERO PORTION ASKS NOTHING. It issues no statement, so an ordinary
 * clinic-borne concession costs exactly what it cost in Milestone 5 and works
 * identically on an unrated session, on a session whose rating was withdrawn,
 * and on a `FREE` one.
 *
 * THE GROSS COMES FROM THE STANDING RATING AND THE ALLOWANCE FROM THE ACTIVE
 * ROWS, WHICH IS WHY THE FLOOR IS CUMULATIVE RATHER THAN PER-ROW. Three
 * concessions of 25,000 each against an applied share of 60,000 must fail on the
 * third, not pass because each is individually small; and withdrawing one of
 * them must give its portion back, which it does because the sum counts only
 * `voided_at IS NULL` rows.
 *
 * `FREE` SESSIONS NEED NO SPECIAL CASE. A zero base gives a zero applied gross,
 * so every positive portion exceeds it here — and the family-side ceiling has
 * already refused the concession itself for the same reason.
 *
 * THE DATABASE IS STILL THE AUTHORITY. `enforce_charge_adjustment_bounds`
 * re-derives both of these in SQL, under the same lock, inside the INSERT, so
 * the floor holds for the repair script and the psql session too. This exists so
 * a manager is told which rule refused them instead of seeing an internal error;
 * `insertAdjustment` translates the trigger's version of the same two refusals.
 */
async function assertTherapistPortionAffordable(
  tx: Prisma.TransactionClient,
  chargeId: string,
  therapistPortion: bigint,
): Promise<void> {
  if (therapistPortion === 0n) return;

  const rating = await findValidRatingForCharge(tx, chargeId);
  if (rating === undefined) throw new AppError('ADJUSTMENT_SPLIT_INVALID');

  const allocated = await sumActiveTherapistAllocations(tx, chargeId);
  if (allocated + therapistPortion > rating.therapist_gross_toman) {
    throw new AppError('ADJUSTMENT_SPLIT_INVALID');
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
 * The INSERT, with the therapist portion as submitted and the clinic's as the
 * exact residual.
 *
 * THE CLINIC HALF IS COMPUTED HERE AND IS NOT THE CALLER'S TO STATE, which is
 * what makes an allocation that does not add up unrepresentable rather than
 * merely refused: `amount - therapistPortion` satisfies
 * `charge_adjustment_split_identity_chk` by construction, and the request schema
 * refuses a `clinicDiscountToman` field outright. `therapistPortion <= amount`
 * was already proved by the schema, so the residual is never negative and
 * `charge_adjustment_amount_bounds_chk` cannot be reached from here.
 *
 * `created_at` comes from `transaction_timestamp()` rather than from Node, so the
 * adjustment and the audit row recording it carry the same instant.
 *
 * THE TRIGGER'S REFUSALS ARE TRANSLATED, NOT RECOVERED FROM. All four conditions
 * it raises are already decided above under the same lock, so none should be
 * reachable; if one ever is — a lock weakened, a caller added — the manager is
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
    therapistPortion: bigint;
    reason: string;
    actor: ResolvedSession;
  },
): Promise<void> {
  const { adjustmentId, chargeId, amount, therapistPortion, reason, actor } = args;
  const clinicPortion = amount - therapistPortion;

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
        ${therapistPortion.toString()}::bigint,
        ${clinicPortion.toString()}::bigint,
        ${reason},
        transaction_timestamp(),
        ${actor.userId}::uuid
      )
    `;
  } catch (error) {
    if (isCheckViolation(error)) {
      // The two settlement-side refusals, raised by the trigger and named by it.
      // Matched FIRST and by name, because they share their SQLSTATE with the
      // family-side ceiling below and mean something entirely different: this
      // one is about what the THERAPIST can bear, and the fix is a smaller
      // portion or a rated session.
      if (
        violatesConstraint(error, 'charge_adjustment_therapist_share_required') ||
        violatesConstraint(error, 'charge_adjustment_therapist_net_floor')
      ) {
        throw new AppError('ADJUSTMENT_SPLIT_INVALID');
      }

      // The cumulative family-side floor, raised by the same trigger. The
      // row-level amount bounds share that SQLSTATE and are already refused by
      // `adjustmentAmountTomanSchema` before the request reaches here, so they
      // are excluded by name rather than swallowed into the same code.
      if (!violatesConstraint(error, 'charge_adjustment_amount_bounds_chk')) {
        throw new AppError('ADJUSTMENT_EXCEEDS_CHARGE');
      }
    }

    // The voided-parent refusal, raised by the same trigger.
    if (isRestrictViolation(error)) throw new AppError('CHARGE_VOIDED');

    throw error;
  }
}
