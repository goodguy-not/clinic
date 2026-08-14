import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SessionChargeDetail, TariffPriceMode } from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import { resolveTariffSql } from '../catalog/tariffs/tariff-resolution';
import { actorContext } from '../catalog/catalog-support';
import { AppError } from '../common/app-error';
import { isUniqueViolation, violatesConstraint } from '../common/pg-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { findValidChargeForParticipant, readChargeDetail } from './charge-detail';

/**
 * THE ONLY RUNTIME PATH THAT MAY CREATE A PRIMARY SESSION CHARGE.
 *
 * Three callers reach it — a completion, an attendance record, and the explicit
 * re-post endpoint — and there is exactly one implementation of "may this seat be
 * charged, at what price, and has it been charged already". A second copy of that
 * question is how a clinic ends up charging a family twice for one session, or
 * charging a child who never arrived.
 *
 * ------------------------------------------------------------------------
 * TWO FACTS, AND NEITHER IMPLIES THE OTHER.
 *
 * A primary session charge may exist only when `appointment.status = COMPLETED`
 * AND the seat's `attendance = ATTENDED` (CLAUDE.md, non-negotiable rules). Those
 * are recorded by two different operations, in either order: a receptionist marks
 * the child in when they arrive and completes the session afterwards, or
 * completes the day's sessions in a batch and resolves attendance later. THE
 * CHARGE IS CREATED WHICHEVER OF THE TWO BECOMES TRUE LAST, which is why both
 * lifecycle writes call this and why neither of them decides eligibility itself.
 *
 * A `NO_SHOW` and a cancellation therefore produce nothing at all, without either
 * needing a rule of its own: neither can satisfy the conjunction above. That is
 * the whole enforcement of "cancellation creates no charge" and "no-show creates
 * no charge until a policy is approved" — a refusal that cannot be forgotten
 * because there is no second path to forget it on.
 * ------------------------------------------------------------------------
 * IT RUNS INSIDE THE CALLER'S TRANSACTION AND OPENS NONE OF ITS OWN.
 *
 * The signature takes a transaction client, exactly as `AuditService.record`
 * does, so the charge, its audit row and the state change that caused it commit
 * together or not at all. A completion that succeeded while its charge was rolled
 * back is the state PROJECT_SPEC.md 15 calls "completed but unpriced" and it must
 * never be produced by a crash between two transactions.
 *
 * THE APPOINTMENT LOCK IS THE SERIALISATION POINT. `lockAppointment` re-takes the
 * `FOR UPDATE` the lifecycle callers already hold — re-entrant within one
 * transaction, and free — and establishes it for the explicit re-post, which has
 * no lock of its own. Every path that can create a charge for one seat therefore
 * queues behind one row lock, and each one re-reads eligibility and the existing
 * charge AFTER acquiring it. That is what makes a double-click, two concurrent
 * completions, a completion racing an attendance record and two concurrent
 * re-posts all produce exactly one charge: the second transaction does not race
 * the first, it waits for it and then sees what it committed.
 *
 * The re-read is deliberately a SEPARATE STATEMENT from the lock. PostgreSQL
 * gives each statement in a read-committed transaction its own snapshot, so a
 * statement issued after the lock is granted sees the status the previous holder
 * committed. Folding the two together would make the answer depend on
 * EvalPlanQual's treatment of the other joined tables, which is a subtlety no
 * financial rule should rest on.
 *
 * `session_charge_one_valid_per_participant_uq` remains the final authority
 * (checkpoint A1). Nothing here loosens it and nothing here relies on winning a
 * race instead of taking the lock.
 * ------------------------------------------------------------------------
 * A MISSING TARIFF IS NOT A ZERO CHARGE, AND NOT A ROLLBACK.
 *
 * `TARIFF_MISSING` comes back as an outcome rather than an exception, and the two
 * kinds of caller do two different things with it. An automatic post is a
 * consequence of a clinical fact that has already happened: the session took
 * place and the child attended, and refusing to record that because nobody
 * entered a price would lose the fact to protect the invoice. So completion and
 * attendance succeed, no charge is written, and the session stays visibly
 * unpriced — `AppointmentView.tariffSuggestion` already reports `MISSING` for
 * exactly this session (PROJECT_SPEC.md 5 requires the gap to be visible). The
 * EXPLICIT re-post is a person asking for the charge to be raised now, and
 * silence would be the wrong answer: it raises `TARIFF_MISSING` (404), and the
 * fix is to record the tariff and re-post.
 *
 * A `FREE` TARIFF IS A DIFFERENT THING ENTIRELY and produces a real charge of
 * zero with `priceMode = FREE`. It is not a pricing gap; it is a priced session
 * that costs nothing (DECISION_LOG, 2026-08-06 — Explicit PAID and FREE tariff
 * modes), and `session_charge_price_mode_chk` keeps the two shapes unreachable
 * from one another.
 * ------------------------------------------------------------------------
 * WHAT IS SNAPSHOTTED, AND FROM WHERE. The service, therapist and session length
 * are the appointment's as delivered; the clinic day is `clinic_date(starts_at)`,
 * computed by PostgreSQL so `Asia/Tehran` is applied in the one place this system
 * applies it; the family is the charged child's own, so the pair keyed by
 * `session_charge_child_id_family_id_fkey` cannot name a child of another family.
 * The price and mode come from the tariff in force ON THE SERVICE DATE, resolved
 * by `resolveTariffSql` — the same fragment the day view suggests prices with, so
 * a family is never quoted one number and charged another. None of it is a
 * pointer to current truth: a later tariff, a renamed service or a moved booking
 * changes nothing here, and the immutability trigger makes that structural.
 */

/** Which act asked for the charge. Recorded in the audit row, never in the charge. */
export type ChargeTrigger = 'APPOINTMENT_COMPLETED' | 'ATTENDANCE_RECORDED' | 'EXPLICIT_REPOST';

/**
 * What one posting attempt did.
 *
 * The first two members are the frozen `chargePostResult` outcomes and carry the
 * charge. The last two are the two ways a post can decline to write, reported as
 * values rather than thrown, because an automatic caller must be able to ignore
 * them and an explicit one must be able to refuse the request — and only the
 * caller knows which it is. Throwing here would make the automatic path roll back
 * a completion over a pricing gap.
 */
export type ChargePostAttempt =
  | { readonly status: 'POSTED'; readonly charge: SessionChargeDetail }
  | { readonly status: 'ALREADY_POSTED'; readonly charge: SessionChargeDetail }
  | { readonly status: 'NOT_ELIGIBLE' }
  | { readonly status: 'TARIFF_MISSING' };

export type ChargePostRequest = {
  readonly participantId: string;
  readonly actor: ResolvedSession;
  readonly context: RequestContext;
  readonly trigger: ChargeTrigger;
};

/** The seat and its booking, as the posting decision reads them. */
type EligibilityRow = {
  appointment_id: string;
  child_id: string;
  family_id: string;
  attendance: string;
  status: string;
  service_id: string;
  therapist_id: string;
  duration_minutes: number;
  /** `clinic_date(starts_at)` as digits, never as a `Date` through a timezone. */
  service_date: string;
};

type TariffRow = { id: string; price_mode: TariffPriceMode; price_toman: bigint };

@Injectable()
export class ChargePostingService {
  constructor(private readonly audit: AuditService) {}

  /**
   * Post the primary charge for one seat, if it may be posted and has not been.
   *
   * Idempotent by rule (CLAUDE.md): a retry against a seat that already has a
   * valid charge returns that charge as `ALREADY_POSTED`, writes no second row
   * and — the part that is easy to get wrong — writes no second audit row. An
   * audit trail that records a posting that did not happen is a false record, and
   * `session_charge.posted` is meant to answer "how many charges were raised?".
   */
  async post(tx: Prisma.TransactionClient, request: ChargePostRequest): Promise<ChargePostAttempt> {
    const { participantId, actor, context, trigger } = request;

    await this.lockAppointmentOfSeat(tx, participantId);

    const seat = await readEligibility(tx, participantId);
    if (seat.status !== 'COMPLETED' || seat.attendance !== 'ATTENDED') {
      return { status: 'NOT_ELIGIBLE' };
    }

    // Read AFTER the lock, so a charge committed by the transaction we just
    // waited for is visible. Read BEFORE the tariff, because an existing charge
    // must be returned unchanged even when today's price list can no longer
    // resolve the session it priced.
    const existing = await findValidChargeForParticipant(tx, participantId);
    if (existing !== undefined) {
      return { status: 'ALREADY_POSTED', charge: await readChargeDetail(tx, existing.id) };
    }

    const tariff = await resolveTariff(tx, seat);
    if (tariff === undefined) return { status: 'TARIFF_MISSING' };

    const chargeId = uuidv7();
    await insertCharge(tx, { chargeId, participantId, seat, tariff, actor });

    // Written only on a real insert, and in this transaction. The payload is the
    // financial fact and nothing else: ids, the snapshot, the mode and the
    // amount. No name, no phone number and no file number is copied into
    // `audit_log`, which is append-only and permanent — a second, undeletable
    // store of personal data kept to answer a question that never needed it.
    await this.audit.record(tx, actorContext(actor, context), {
      action: 'session_charge.posted',
      entityType: 'session_charge',
      entityId: chargeId,
      after: {
        familyId: seat.family_id,
        childId: seat.child_id,
        appointmentId: seat.appointment_id,
        appointmentParticipantId: participantId,
        serviceId: seat.service_id,
        therapistId: seat.therapist_id,
        durationMinutes: seat.duration_minutes,
        serviceDate: seat.service_date,
        tariffId: tariff.id,
        priceMode: tariff.price_mode,
        amountToman: tariff.price_toman.toString(),
      },
      // Flat, as `cancelledBy` is on a cancellation: "how many charges were
      // raised by hand rather than by completing a session?" is a question the
      // pilot will ask, and a key buried in a diff is not something you can
      // count.
      metadata: { trigger },
    });

    return { status: 'POSTED', charge: await readChargeDetail(tx, chargeId) };
  }

  /**
   * Takes the booking's row lock, named by the seat.
   *
   * `FOR UPDATE OF a` locks the appointment and not the seat: the appointment row
   * is the serialisation point every Milestone 4 write already uses, and the lock
   * order of this system takes it first. Re-taking a lock the caller holds is a
   * no-op within the transaction, so a completion pays nothing for it and the
   * explicit re-post — which holds nothing — gets the same guarantee.
   */
  private async lockAppointmentOfSeat(
    tx: Prisma.TransactionClient,
    participantId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT a.id
      FROM appointment_participant ap
      JOIN appointment a ON a.id = ap.appointment_id
      WHERE ap.id = ${participantId}::uuid
      FOR UPDATE OF a
    `;

    if (rows[0] === undefined) throw new AppError('APPOINTMENT_PARTICIPANT_NOT_FOUND');
  }
}

/**
 * The two facts and the snapshot, in one statement issued under the lock.
 *
 * `clinic_date(starts_at)` is the authoritative clinic-date path — the same
 * function `readClinicSpan` and the day view use, so the day a charge belongs to
 * and the day the diary shows it on cannot come from two different timezones.
 */
async function readEligibility(
  tx: Prisma.TransactionClient,
  participantId: string,
): Promise<EligibilityRow> {
  const rows = await tx.$queryRaw<EligibilityRow[]>`
    SELECT a.id AS appointment_id,
           ap.child_id,
           c.family_id,
           ap.attendance::text AS attendance,
           a.status::text AS status,
           a.service_id,
           a.therapist_id,
           a.duration_minutes,
           clinic_date(a.starts_at)::text AS service_date
    FROM appointment_participant ap
    JOIN appointment a ON a.id = ap.appointment_id
    JOIN child c ON c.id = ap.child_id
    WHERE ap.id = ${participantId}::uuid
  `;

  const row = rows[0];
  if (row === undefined) throw new AppError('APPOINTMENT_PARTICIPANT_NOT_FOUND');
  return row;
}

/**
 * Which price applies to this session, on the day it happened.
 *
 * `resolveTariffSql` and no second reading of the precedence rule: a voided row
 * never applies, the effective range must contain the SERVICE date rather than
 * today, and a therapist-specific tariff beats the general one. A tariff created
 * or voided after this session was priced changes nothing about the row this
 * writes, because the snapshot is what the charge stores.
 */
async function resolveTariff(
  tx: Prisma.TransactionClient,
  seat: EligibilityRow,
): Promise<TariffRow | undefined> {
  const rows = await tx.$queryRaw<TariffRow[]>`
    ${resolveTariffSql(Prisma.sql`id, price_mode::text AS price_mode, price_toman`, {
      serviceId: Prisma.sql`${seat.service_id}::uuid`,
      durationMinutes: Prisma.sql`${seat.duration_minutes}::int`,
      therapistId: Prisma.sql`${seat.therapist_id}::uuid`,
      serviceDate: Prisma.sql`${seat.service_date}::date`,
    })}
  `;

  return rows[0];
}

/**
 * The INSERT, and the guarantee it does not check first.
 *
 * `created_at` comes from `transaction_timestamp()` rather than from Node, so a
 * charge and the audit row recording it carry the same instant and neither
 * depends on the skew between the API host and the database.
 *
 * The unique violation is TRANSLATED RATHER THAN RECOVERED FROM. Every path that
 * can insert a charge for this seat holds the appointment lock and re-read the
 * seat's valid charge under it, so a duplicate cannot be reached; if the
 * guarantee ever weakens, the caller is told a valid charge already exists —
 * which is true, and which a refreshed screen explains — instead of receiving an
 * internal error. It is not recovered from because a failed statement aborts the
 * PostgreSQL transaction: a re-read after it would fail too, and the honest
 * answer is a named refusal rather than a retry loop dressed up as idempotency.
 */
async function insertCharge(
  tx: Prisma.TransactionClient,
  args: {
    chargeId: string;
    participantId: string;
    seat: EligibilityRow;
    tariff: TariffRow;
    actor: ResolvedSession;
  },
): Promise<void> {
  const { chargeId, participantId, seat, tariff, actor } = args;

  try {
    await tx.$executeRaw`
      INSERT INTO session_charge (
        id, family_id, child_id, appointment_id, appointment_participant_id,
        service_id, therapist_id, duration_minutes, service_date,
        tariff_id, price_mode, amount_toman, created_at, created_by_user_id
      ) VALUES (
        ${chargeId}::uuid,
        ${seat.family_id}::uuid,
        ${seat.child_id}::uuid,
        ${seat.appointment_id}::uuid,
        ${participantId}::uuid,
        ${seat.service_id}::uuid,
        ${seat.therapist_id}::uuid,
        ${seat.duration_minutes},
        ${seat.service_date}::date,
        ${tariff.id}::uuid,
        ${tariff.price_mode}::tariff_price_mode,
        ${tariff.price_toman.toString()}::bigint,
        transaction_timestamp(),
        ${actor.userId}::uuid
      )
    `;
  } catch (error) {
    if (
      isUniqueViolation(error) &&
      violatesConstraint(error, 'session_charge_one_valid_per_participant_uq')
    ) {
      throw new AppError('CHARGE_EXISTS_FOR_PARTICIPANT');
    }

    throw error;
  }
}
