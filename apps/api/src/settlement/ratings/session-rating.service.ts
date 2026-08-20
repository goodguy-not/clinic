import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CorrectSessionRatingRequest,
  RateSessionRequest,
  RatedVia,
  SessionSettlement,
} from '@clinic/contracts';
import { AuditService } from '../../audit/audit.service';
import { actorContext, canonicalText } from '../../catalog/catalog-support';
import { AppError } from '../../common/app-error';
import { isUniqueViolation, violatesConstraint } from '../../common/pg-error';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { uuidv7 } from '../../common/uuid';
import { PrismaService } from '../../prisma/prisma.service';
import {
  lockChargeRow,
  readChargeRow,
  sumActiveTherapistAllocations,
} from '../../ledger/charge-detail';
import { resolveShareRuleRow } from '../share-rules/share-rule-resolution';
import { splitSessionValue } from './share-split';

/**
 * THE APPLIED THERAPIST SHARE SNAPSHOT: what one session earned, recorded once
 * and never re-resolved.
 *
 * ------------------------------------------------------------------------
 * CONFIGURATION VERSUS FACT, WHICH IS THE WHOLE POINT OF THE CHECKPOINT.
 * `ShareRulesService` owns the AGREEMENT — what a therapist takes, and between
 * which dates. This owns what a SESSION EARNED. The percentage is copied onto
 * the session as a NUMBER at the moment it is rated; `applied_share_rule_id` is
 * recorded as provenance and is never read back to recompute anything. So a
 * rule voided, corrected or replaced next month cannot restate last month's
 * earnings, and the immutability trigger on `session_settlement` means no
 * statement can either.
 * ------------------------------------------------------------------------
 * ONE SOURCE OF SETTLEMENT POLICY, AND IT IS THE SHARE RULE.
 *
 * Every percentage written by this service is resolved by `resolveShareRuleRow`
 * from the therapist's effective-dated rule covering the CHARGE's service date.
 * There is no per-session override rate, no free-typed percentage and no request
 * shape that can carry one: a number typed onto one session would be settlement
 * policy stated somewhere with no effective date, no supersession history and no
 * void trail, and next month's figure for the same therapist would depend on
 * which screen somebody used. A wrong percentage is fixed by correcting the RULE
 * — which voids it and writes a replacement naming it — and then correcting the
 * rating, which re-resolves against the corrected agreement.
 *
 * `applied_share_rule_id` IS THEREFORE ON EVERY ROW, and the column is NOT NULL.
 * ------------------------------------------------------------------------
 * THERE ARE EXACTLY TWO WAYS A RATING IS CREATED, AND NEITHER IS A READ.
 *
 *   1. AUTOMATICALLY, in the same transaction as the charge that caused it
 *      (`rateOnPost`, called only by `ChargePostingService`). The charge and its
 *      settlement fact commit together or not at all.
 *   2. EXPLICITLY, by a manager, on a session that is still unrated (`rate`).
 *
 * `ratedVia` RECORDS WHICH OF THE TWO HAPPENED AND NOTHING MORE. It is not an
 * override flag — there is nothing to override — and the caller never sends it:
 * the posting path writes `AUTOMATIC` and this service writes `EXPLICIT` for
 * every manager-initiated rating, so the field cannot disagree with what
 * actually happened.
 *
 * NOTHING ELSE WRITES ONE. There is no background sweep, no backfill, no
 * lazy-create on read, and no "resolve it now if it is missing" anywhere: `read`
 * refuses with `SESSION_NOT_RATED` rather than inventing a rating, and a share
 * rule created after the fact rates nothing by itself. That is the difference
 * between a settlement fact somebody decided and one that appeared because
 * somebody opened a screen.
 * ------------------------------------------------------------------------
 * A MISSING SHARE RULE IS NOT A ZERO, AND IT NEVER BLOCKS THE CHARGE.
 *
 * When no rule covers the therapist on the session's service date, `rateOnPost`
 * writes nothing and says so. The charge still exists — the session happened and
 * the child attended, and refusing to record that because nobody entered a
 * percentage would lose the clinical fact to protect the settlement — and the
 * session is UNRATED, which is the ABSENCE of a row. It is the same shape
 * `TARIFF_MISSING` already has on the ledger side, for the same reason.
 *
 * A zero-valued placeholder would be a settlement fact asserting that somebody
 * earned nothing, which is a different claim from nobody having decided yet, and
 * the difference is a therapist's month.
 * ------------------------------------------------------------------------
 * LOCK ORDER — `session_charge` FIRST, THEN `session_settlement`.
 *
 * Every write here takes the parent charge row `FOR UPDATE` before touching a
 * rating, which is the order the ledger already uses for `charge_adjustment`. A
 * second attempt to rate one session therefore WAITS for the first and then sees
 * what it committed, rather than racing it;
 * `session_settlement_one_valid_per_charge_uq` is the final authority and its
 * violation is translated into `SESSION_ALREADY_RATED` rather than recovered
 * from.
 * ------------------------------------------------------------------------
 * IT READS THE CHARGE AND WRITES NOTHING IN THE LEDGER. `lockChargeRow` is the
 * ledger's own function, used unchanged so "which charge is valid" has one
 * reading in this system; nothing here inserts, updates or voids a charge, an
 * adjustment or a payment. The dependency points one way at module level too:
 * `LedgerModule` imports `SettlementModule`, never the reverse.
 * ------------------------------------------------------------------------
 * VOIDING A CHARGE DOES NOT TOUCH ITS RATING, AND THAT IS DELIBERATE.
 *
 * A rating records what percentage WAS APPLIED to that charge while it stood. A
 * void is a later fact about the charge; it does not travel backwards and make
 * the percentage never have been applied, and withdrawing the rating as a side
 * effect would write a settlement fact — with an actor and a reason — that
 * nobody decided. Both histories therefore stay intact and independent.
 *
 * WHAT A VOIDED CHARGE LOSES IS CURRENT VALUE, NOT HISTORY. `read` refuses a
 * rating whose charge has been withdrawn, and every settlement figure a later
 * checkpoint computes must join the charge and exclude voided ones — the same
 * `voided_at IS NULL` predicate every total in this system already applies. A
 * re-posted charge is a NEW charge with its own id, so it takes its own rating
 * through the ordinary path, unobstructed by the old one: the unique index is
 * per charge, not per seat.
 * ------------------------------------------------------------------------
 * `therapist_gross_toman` AND `clinic_gross_toman` ARE THE SPLIT OF THE
 * PRE-DISCOUNT CHARGE, AND STAY SO AFTER C4. A concession changes what the
 * FAMILY owes and, when it is allocated, who BEARS it — neither of which
 * restates what the session was worth. The therapist's NET is the gross on this
 * row less the active therapist-borne portions against the same charge, and it
 * is DERIVED BY READING rather than stored: no column here moves when a
 * concession is granted or withdrawn, and the immutability trigger means none
 * could.
 *
 * WHAT THIS SERVICE OWES C4 IS ONE REFUSAL, AND IT IS IN `voidRow`. A rating
 * bearing a standing therapist-borne allocation cannot be withdrawn or
 * corrected, because the allocation was bounded by the gross share THIS rating
 * applied.
 *
 * WHAT IS STILL DELIBERATELY ABSENT: no statement is produced, no earned or
 * unsettled figure is aggregated, no period is closed and no payout is recorded.
 */

/** Which act asked for the rating. Recorded in the audit row, never in the row. */
export type RatingTrigger = 'CHARGE_POSTED' | 'EXPLICIT_RATING' | 'RATING_CORRECTION';

/**
 * Which act withdrew it. TWO MEMBERS, AND THERE IS NO CHARGE-VOID MEMBER:
 * withdrawing a charge does not withdraw its rating, so no act outside this
 * service ever produces one.
 */
export type RatingVoidTrigger = 'EXPLICIT_VOID' | 'RATING_CORRECTION';

/**
 * The charge facts a rating is built from, as the posting path already has them
 * — so a charge just written in this transaction is not read back to rate it.
 */
export type RatableCharge = {
  readonly chargeId: string;
  readonly appointmentParticipantId: string;
  readonly therapistId: string;
  /** The clinic calendar day, as digits. Never a `Date` through a timezone. */
  readonly serviceDate: string;
  readonly baseAmountToman: bigint;
};

/**
 * What one automatic rating attempt did.
 *
 * `UNRATED` is a value rather than an exception because only the caller knows
 * what to do with it, and on the posting path the answer is "nothing": the
 * charge stands and the session is visibly unrated. Throwing here would roll a
 * completion back over a percentage nobody had entered yet.
 */
export type AutomaticRatingAttempt =
  | { readonly status: 'RATED'; readonly settlement: SessionSettlement }
  | { readonly status: 'UNRATED' };

type SettlementRow = {
  id: string;
  session_charge_id: string;
  appointment_participant_id: string;
  therapist_id: string;
  service_date: string;
  applied_share_basis_points: number;
  applied_share_rule_id: string;
  rated_via: RatedVia;
  base_amount_toman: bigint;
  therapist_gross_toman: bigint;
  clinic_gross_toman: bigint;
  reason: string | null;
  supersedes_session_settlement_id: string | null;
  created_at: Date;
  created_by_user_id: string;
  voided_at: Date | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
};

/**
 * `service_date` as `::text` rather than as a `date`, for the reason
 * `CHARGE_COLUMNS` reads it that way: Prisma maps a PostgreSQL `DATE` onto a
 * JavaScript `Date` at UTC midnight, and every conversion back through a local
 * timezone is a chance for the clinic day to move by one. The digits are the
 * value.
 */
const SETTLEMENT_COLUMNS = Prisma.sql`
  id, session_charge_id, appointment_participant_id, therapist_id,
  service_date::text AS service_date, applied_share_basis_points,
  applied_share_rule_id, rated_via::text AS rated_via, base_amount_toman,
  therapist_gross_toman, clinic_gross_toman, reason,
  supersedes_session_settlement_id, created_at, created_by_user_id,
  voided_at, voided_by_user_id, void_reason
`;

/** What the rating that is about to be written says, before it exists. */
type RatingDecision = {
  readonly appliedShareBasisPoints: number;
  /** Never null: a rating without a rule behind it is unrepresentable. */
  readonly appliedShareRuleId: string;
  readonly ratedVia: RatedVia;
  readonly reason: string | null;
};

@Injectable()
export class SessionRatingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Rate a session as part of posting its charge, if a rule covers it.
   *
   * RUNS INSIDE THE CALLER'S TRANSACTION AND OPENS NONE OF ITS OWN, exactly as
   * `AuditService.record` and `ChargePostingService.post` do, so the charge, its
   * settlement fact and the audit rows for both commit together. A charge that
   * survived while its rating was rolled back would be an unrated session nobody
   * decided to leave unrated.
   *
   * IT TAKES NO LOCK. The charge was inserted by this transaction moments ago
   * under the appointment lock, so no other transaction can see it yet, let
   * alone rate it. The unique index is still translated below, because "cannot
   * happen" and "is refused if it does" are different guarantees.
   */
  async rateOnPost(
    tx: Prisma.TransactionClient,
    charge: RatableCharge,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<AutomaticRatingAttempt> {
    const rule = await resolveShareRuleRow(tx, charge.therapistId, charge.serviceDate);

    // No rule covering the SERVICE DATE means the session is unrated, and
    // unrated means no row. Not a zero, not a default, and not a reason to
    // refuse the charge.
    if (rule === undefined) return { status: 'UNRATED' };

    const row = await this.insert(
      tx,
      charge,
      {
        appliedShareBasisPoints: rule.share_basis_points,
        appliedShareRuleId: rule.id,
        ratedVia: 'AUTOMATIC',
        reason: null,
      },
      actor,
    );

    await this.auditRated(tx, row, actor, context, 'CHARGE_POSTED');

    return { status: 'RATED', settlement: toSessionSettlement(row) };
  }

  /**
   * Rate a session that is still unrated, on a manager's explicit instruction.
   *
   * THE RECOVERY PATH, and there is one thing to recover from: a session
   * completed and charged while its therapist had no share rule covering that
   * day. A manager records the rule and rates the session from here.
   *
   * THE RATE IS RESOLVED AGAINST THE SESSION'S SERVICE DATE, NOT TODAY. It
   * re-asks the question the posting path asked, of the same statement, using
   * the clinic day stored on the CHARGE — so rating a session from Tir in
   * Shahrivar applies Tir's agreement, and keeps applying it however many times
   * the configuration changes afterwards. There is no current-rate fallback
   * anywhere in this file and no `now()` in any statement it issues.
   *
   * THE CALLER SENDS A REASON AND NOTHING ELSE. No percentage is submittable:
   * the share rule is the only source of settlement policy, so this endpoint
   * cannot state one (`rateSessionRequestSchema`). A wrong percentage is
   * corrected on the RULE and then carried onto the session by `correct` below,
   * which re-resolves — two audited acts, neither of which invents a figure that
   * no agreement ever recorded.
   *
   * A MISS IS `SHARE_RULE_MISSING`, AND THAT IS WHERE THIS DIFFERS FROM
   * `rateOnPost`. A person asked for this session to be rated now, and silence
   * would be the wrong answer; the fix is to record the rule that covers the
   * date and try again.
   *
   * THE RESULT IS ALWAYS `EXPLICIT`, AND THE REASON IS ALWAYS REQUIRED. Reaching
   * back to a session nobody rated is a decision about somebody's earnings taken
   * after the fact, and CLAUDE.md requires every such act to be explicit,
   * reasoned and auditable.
   */
  async rate(
    chargeId: string,
    body: RateSessionRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<SessionSettlement> {
    const row = await this.prisma.$transaction(async (tx) => {
      const charge = await this.lockRatableCharge(tx, chargeId);

      // Read AFTER the lock, so a rating committed by the transaction we just
      // waited for is visible rather than raced.
      const standing = await findValidRatingForCharge(tx, chargeId);
      if (standing !== undefined) throw new AppError('SESSION_ALREADY_RATED');

      const decision = await this.decide(tx, charge, body.reason);
      const inserted = await this.insert(tx, charge, decision, actor);

      await this.auditRated(tx, inserted, actor, context, 'EXPLICIT_RATING');

      return inserted;
    });

    return toSessionSettlement(row);
  }

  /**
   * What this session currently earns.
   *
   * A READ, AND IT WRITES NOTHING. No transaction, no lock, no audit row and —
   * the part that matters — no rating. An unrated session answers
   * `SESSION_NOT_RATED`, which is the UNRATED state surfacing as a refusal;
   * resolving a percentage here and returning it would be a settlement figure
   * nobody decided, indistinguishable in a later report from one somebody did.
   *
   * A WITHDRAWN CHARGE EARNS NOTHING NOW, WHATEVER IT ONCE EARNED. The rating
   * row is untouched by the void and stays in the table as the historical record
   * of what was applied while the charge stood — but it is not a CURRENT
   * settlement value, and this read answers what is current. So a voided charge
   * is `CHARGE_VOIDED`, the ledger's existing code for acting on withdrawn
   * money, rather than a live-looking figure a screen would render as owed to
   * somebody.
   *
   * THE CHARGE IS READ, NOT THE RATING ALONE, and that ordering is the point:
   * the question "does this session earn anything?" cannot be answered from the
   * settlement table by itself, and every later checkpoint that totals earnings
   * must join the charge and apply the same `voided_at IS NULL` predicate every
   * other total in this system applies.
   */
  async read(chargeId: string): Promise<SessionSettlement> {
    const charge = await readChargeRow(this.prisma, chargeId);
    if (charge.voided_at !== null) throw new AppError('CHARGE_VOIDED');

    const row = await findValidRatingForCharge(this.prisma, chargeId);
    if (row === undefined) throw new AppError('SESSION_NOT_RATED');

    return toSessionSettlement(row);
  }

  /**
   * Withdraw a rating that should not stand.
   *
   * NOT A DELETE AND NOT AN EDIT. Three columns are written onto the row and
   * every snapshot column is left exactly as applied;
   * `session_settlement_enforce_immutability` refuses any statement that says
   * otherwise, whether or not it came from here. Withdrawing returns the session
   * to the EXPLICIT UNRATED state — the absence of a standing row — which is the
   * same state a session that was never rated is in, and is deliberately
   * reachable only through this act.
   *
   * ONE-WAY, ENFORCED TWICE: there is no un-void request in the frozen contract,
   * the `UPDATE` is predicated on `voided_at IS NULL`, and the trigger refuses
   * to change a void once it exists.
   *
   * A RATING A CLOSED PERIOD DEPENDS ON MAY NOT BE LEFT ABSENT (checkpoint C6).
   * Once a session carries a closed `PRIMARY` settlement line, the closed figure
   * behind it must keep having a rating to stand on — and the period is never
   * reopened, so there is no later act that could repair a session left unrated.
   * The bare withdrawal is therefore refused with `RATING_REPLACEMENT_REQUIRED`
   * and the caller uses `correct` below, which never leaves the session unrated
   * for an instant. This is the refusal C3 deliberately deferred; `correct` was
   * shipped complete then precisely so C6 adds a refusal here rather than a
   * capability.
   *
   * THE QUESTION IS ASKED OF THE CHARGE, NOT OF THIS RATING ROW. After an
   * earlier correction the closed line names a rating that has since been
   * withdrawn, so "does a closed line name THIS row?" would let the replacement
   * be withdrawn bare and leave exactly the state the rule forbids. What a
   * closed period depends on is that the SESSION is rated.
   *
   * `settlement_line_requires_valid_rating` re-derives the same condition at
   * COMMIT and is the authority; this exists to produce a named refusal with a
   * fix rather than an internal error.
   */
  async void(
    ratingId: string,
    reason: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<SessionSettlement> {
    const canonicalReason = canonicalText(reason);

    const row = await this.prisma.$transaction(async (tx) => {
      const target = await this.lockRatingUnderItsCharge(tx, ratingId);
      if (target.voided_at !== null) throw new AppError('RATING_ALREADY_VOIDED');
      if (await hasClosedPrimaryLine(tx, target.session_charge_id)) {
        throw new AppError('RATING_REPLACEMENT_REQUIRED');
      }

      await this.voidRow(tx, target, canonicalReason, actor, context, 'EXPLICIT_VOID');

      return readRatingRow(tx, ratingId);
    });

    return toSessionSettlement(row);
  }

  /**
   * Withdraw a rating and write its replacement AS ONE ACT.
   *
   * THE ATOMICITY IS THE CONTRACT, NOT AN IMPLEMENTATION DETAIL. Two separate
   * calls have a moment between them in which the session is unrated, and that
   * moment is observable: a statement read there reports the session as an
   * unrated exception, and a close performed there excludes it silently and
   * permanently, because a closed period is never reopened. One transaction
   * means the figure moves from one explained value to another explained value
   * with no state in between where a therapist's session has simply vanished.
   *
   * IT IS THE SHAPE C6 NEEDS AND IT IS COMPLETE NOW. When settlement periods
   * arrive, correcting a rating a closed period depends on is exactly this
   * operation, plus a `CORRECTION` line carrying the delta into the first period
   * still open. What is deferred is that line — not the void-and-replace, which
   * is here.
   *
   * BOTH AUTHORITIES, AND, NOT OR. The route names
   * `SETTLEMENT_RATING_CORRECTION_PERMISSIONS`, because the act genuinely
   * withdraws and re-rates: a caller who may withdraw but not rate must not
   * reach a request that rates.
   *
   * THE SCOPE IS CHECKED AGAINST THE RATING ACTUALLY LOADED. The request schema
   * already refuses a replacement naming a different charge from the withdrawal;
   * this re-checks the loaded row, because the id the caller sent and the row it
   * names are two different claims. Correcting one therapist's month by
   * re-rating a different session is a mistake only ever noticed by whoever ends
   * up short.
   */
  async correct(
    body: CorrectSessionRatingRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<SessionSettlement> {
    const withdrawReason = canonicalText(body.withdrawReason);

    const row = await this.prisma.$transaction(async (tx) => {
      const charge = await this.lockRatableCharge(tx, body.sessionChargeId);

      const target = await lockRatingRow(tx, body.sessionSettlementId);
      if (target.session_charge_id !== body.sessionChargeId) {
        throw new AppError('RATING_SCOPE_MISMATCH');
      }
      if (target.voided_at !== null) throw new AppError('RATING_ALREADY_VOIDED');

      // The replacement is decided BEFORE the withdrawal is written, so a
      // correction that cannot produce a replacement — no rule covers the
      // service date — leaves the existing rating standing instead of leaving
      // the session unrated. The rollback would do it anyway; deciding first is
      // what makes that independent of the transaction.
      const decision = await this.decide(tx, charge, body.replacement.reason);

      await this.voidRow(tx, target, withdrawReason, actor, context, 'RATING_CORRECTION');

      const replacement = await this.insert(tx, charge, decision, actor, target.id);
      await this.auditRated(tx, replacement, actor, context, 'RATING_CORRECTION');

      return replacement;
    });

    return toSessionSettlement(row);
  }

  /**
   * Which percentage a manager-initiated rating will carry, and where it came
   * from — which is the same place the posting path takes it from, by the same
   * statement.
   *
   * THE REQUEST CANNOT INFLUENCE THE NUMBER. It carries a reason and nothing
   * else, so the only inputs to this decision are the therapist and the clinic
   * day, both read from the charge. That is what makes an explicit rating a
   * RECOVERY of the agreement that applied rather than a second, unversioned
   * place to state one.
   *
   * `EXPLICIT` IS WRITTEN HERE AND IS NOT THE CALLER'S TO CHOOSE, so the
   * provenance recorded is always the act that actually happened.
   */
  private async decide(
    tx: Prisma.TransactionClient,
    charge: RatableCharge,
    reason: string,
  ): Promise<RatingDecision> {
    const rule = await resolveShareRuleRow(tx, charge.therapistId, charge.serviceDate);
    // Never a zero and never today's rule: the caller is told no agreement
    // covers the day the session happened, and records one.
    if (rule === undefined) throw new AppError('SHARE_RULE_MISSING');

    return {
      appliedShareBasisPoints: rule.share_basis_points,
      appliedShareRuleId: rule.id,
      ratedVia: 'EXPLICIT',
      reason: canonicalText(reason),
    };
  }

  /**
   * The charge, locked, and refused if it is not a live settlement subject.
   *
   * A VOIDED CHARGE CANNOT BE RATED. There is nothing standing to settle: the
   * money was withdrawn, and the replacement charge — not this one — is what a
   * live rating belongs to. `CHARGE_VOIDED` is the ledger's existing code for
   * acting on withdrawn money and means exactly this.
   *
   * The five facts it returns are the ones the rating snapshots, and they are
   * carried into the INSERT rather than re-read there — the composite foreign
   * key makes it impossible for them to be anything but this charge's own
   * anyway.
   */
  private async lockRatableCharge(
    tx: Prisma.TransactionClient,
    chargeId: string,
  ): Promise<RatableCharge> {
    const charge = await lockChargeRow(tx, chargeId);
    if (charge.voided_at !== null) throw new AppError('CHARGE_VOIDED');

    return {
      chargeId: charge.id,
      appointmentParticipantId: charge.appointment_participant_id,
      therapistId: charge.therapist_id,
      serviceDate: charge.service_date,
      baseAmountToman: charge.amount_toman,
    };
  }

  /**
   * A rating, locked in this system's order: its charge first, then the rating.
   *
   * The rating is read unlocked to learn which charge it belongs to, which is
   * safe because that column is immutable and the row cannot move between
   * charges. Everything decided afterwards is decided from the locked re-read.
   */
  private async lockRatingUnderItsCharge(
    tx: Prisma.TransactionClient,
    ratingId: string,
  ): Promise<SettlementRow> {
    const unlocked = await readRatingRow(tx, ratingId);
    await lockChargeRow(tx, unlocked.session_charge_id);

    return lockRatingRow(tx, ratingId);
  }

  /**
   * The INSERT, with the split computed here and re-derived by the database.
   *
   * `created_at` comes from `transaction_timestamp()` rather than from Node, so
   * a rating and the audit row recording it carry the same instant and neither
   * depends on the skew between the API host and the database.
   *
   * The unique violation is TRANSLATED RATHER THAN RECOVERED FROM. Every path
   * here holds the charge lock and re-read the standing rating under it, so a
   * duplicate cannot be reached; if that ever weakens, the caller is told a
   * rating already stands — which is true, and which a refreshed screen explains
   * — instead of receiving an internal error. It is not retried, because a
   * failed statement aborts the PostgreSQL transaction.
   */
  private async insert(
    tx: Prisma.TransactionClient,
    charge: RatableCharge,
    decision: RatingDecision,
    actor: ResolvedSession,
    supersedesId: string | null = null,
  ): Promise<SettlementRow> {
    const id = uuidv7();
    const split = splitSessionValue(charge.baseAmountToman, decision.appliedShareBasisPoints);

    try {
      const rows = await tx.$queryRaw<SettlementRow[]>`
        INSERT INTO session_settlement (
          id, session_charge_id, appointment_participant_id, therapist_id,
          service_date, applied_share_basis_points, applied_share_rule_id,
          rated_via, base_amount_toman, therapist_gross_toman, clinic_gross_toman,
          reason, supersedes_session_settlement_id, created_at, created_by_user_id
        ) VALUES (
          ${id}::uuid,
          ${charge.chargeId}::uuid,
          ${charge.appointmentParticipantId}::uuid,
          ${charge.therapistId}::uuid,
          ${charge.serviceDate}::date,
          ${decision.appliedShareBasisPoints},
          ${decision.appliedShareRuleId}::uuid,
          ${decision.ratedVia}::session_rated_via,
          ${charge.baseAmountToman.toString()}::bigint,
          ${split.therapistGrossToman.toString()}::bigint,
          ${split.clinicGrossToman.toString()}::bigint,
          ${decision.reason},
          ${supersedesId}::uuid,
          transaction_timestamp(),
          ${actor.userId}::uuid
        )
        RETURNING ${SETTLEMENT_COLUMNS}
      `;

      const inserted = rows[0];
      if (inserted === undefined) throw new AppError('INTERNAL_ERROR');
      return inserted;
    } catch (error) {
      if (
        isUniqueViolation(error) &&
        violatesConstraint(error, 'session_settlement_one_valid_per_charge_uq')
      ) {
        throw new AppError('SESSION_ALREADY_RATED');
      }

      throw error;
    }
  }

  /**
   * The one permitted update: standing to withdrawn, nothing else touched.
   *
   * `voided_at IS NULL` in the predicate as well as in the caller's check: the
   * check is what produces the named refusal, this is what makes a second
   * withdrawal structurally unable to write even if the check were wrong.
   *
   * A RATING BEARING A THERAPIST-BORNE CONCESSION IS NOT WITHDRAWABLE, AND THAT
   * IS CHECKED HERE SO IT COVERS BOTH ACTS. Checkpoint C4 made a family
   * concession allocable between the therapist and the clinic, bounded by the
   * gross share THIS rating applied; withdrawing the rating would leave that
   * allocation standing against a share that no longer exists, and the
   * cumulative floor — which reads only standing ratings — would stop checking
   * anything at all. `RATING_HAS_THERAPIST_ALLOCATIONS` was frozen in C1 for
   * exactly this and was unreachable until now.
   *
   * A CORRECTION IS REFUSED TOO, NOT WAVED THROUGH ON THE STRENGTH OF ITS
   * REPLACEMENT. `correct` reaches this method, so it is refused by the same
   * line. Letting it pass when the replacement's gross happened to be large
   * enough would silently re-anchor an allocation a manager reasoned about
   * against one applied percentage onto a different one they never saw — and
   * the allocation row cannot be re-pointed anyway, because
   * `enforce_charge_adjustment_immutability` forbids rewriting it. The sequence
   * is therefore three explicit, separately reasoned acts: withdraw the
   * concession, correct the rating, re-grant the concession against the share
   * that now applies.
   *
   * READ UNDER THE CHARGE LOCK EVERY CALLER ALREADY HOLDS, so a concession
   * committing concurrently cannot slip past between this and the UPDATE.
   * `session_settlement_enforce_allocation_guard` re-derives the same sum inside
   * the statement and is the authority; this exists to produce a named refusal
   * with a fix rather than an internal error.
   */
  private async voidRow(
    tx: Prisma.TransactionClient,
    target: SettlementRow,
    reason: string,
    actor: ResolvedSession,
    context: RequestContext,
    trigger: RatingVoidTrigger,
  ): Promise<void> {
    const allocated = await sumActiveTherapistAllocations(tx, target.session_charge_id);
    if (allocated > 0n) throw new AppError('RATING_HAS_THERAPIST_ALLOCATIONS');

    await tx.$executeRaw`
      UPDATE session_settlement
         SET voided_at = transaction_timestamp(),
             voided_by_user_id = ${actor.userId}::uuid,
             void_reason = ${reason}
       WHERE id = ${target.id}::uuid AND voided_at IS NULL
    `;

    await this.audit.record(tx, actorContext(actor, context), {
      action: 'session_settlement.voided',
      entityType: 'session_settlement',
      entityId: target.id,
      // The transition, both sides, because "it is withdrawn" does not state
      // that it was not. The actor and the instant are columns of the audit row
      // itself and are not repeated into the payload.
      before: { voidedAt: null },
      after: { voidReason: reason },
      metadata: { ...ratingFacts(target), trigger },
    });
  }

  private async auditRated(
    tx: Prisma.TransactionClient,
    row: SettlementRow,
    actor: ResolvedSession,
    context: RequestContext,
    trigger: RatingTrigger,
  ): Promise<void> {
    await this.audit.record(tx, actorContext(actor, context), {
      action: 'session_settlement.rated',
      entityType: 'session_settlement',
      entityId: row.id,
      after: ratingFacts(row),
      // Flat, as `trigger` is on a posted charge: "how many sessions are rated
      // by hand rather than by the charge that created them?" is a question the
      // pilot will ask, and a key buried in a diff is not something you can
      // count.
      metadata: {
        trigger,
        ...(row.supersedes_session_settlement_id === null
          ? {}
          : { supersedesSessionSettlementId: row.supersedes_session_settlement_id }),
      },
    });
  }
}

/**
 * The standing rating of one charge, if there is one.
 *
 * The predicate matches `session_settlement_one_valid_per_charge_uq` exactly,
 * which is what makes "at most one row can come back" a property of the database
 * rather than of this query. Withdrawn ratings stay in the table and are
 * deliberately not returned: they are history, not what the therapist earned.
 */
/**
 * Whether a closed settlement period already carries this session.
 *
 * READ UNDER THE CHARGE LOCK the caller already holds, so a close committing
 * concurrently cannot slip between this and the withdrawal — `close` takes every
 * candidate charge `FOR UPDATE` in the same lock order this file uses.
 *
 * `PRIMARY` ONLY. A `CORRECTION` line records a movement and is never the thing
 * a session's closed value rests on; the rule is that a session represented by a
 * closed PRIMARY keeps a valid rating, and a session with corrections has one by
 * definition.
 */
async function hasClosedPrimaryLine(
  tx: Prisma.TransactionClient,
  chargeId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM settlement_line
    WHERE session_charge_id = ${chargeId}::uuid AND line_type = 'PRIMARY'
    LIMIT 1
  `;

  return rows[0] !== undefined;
}

export async function findValidRatingForCharge(
  client: PrismaService | Prisma.TransactionClient,
  chargeId: string,
): Promise<SettlementRow | undefined> {
  const rows = await client.$queryRaw<SettlementRow[]>`
    SELECT ${SETTLEMENT_COLUMNS} FROM session_settlement
    WHERE session_charge_id = ${chargeId}::uuid AND voided_at IS NULL
  `;

  return rows[0];
}

/**
 * A rating held `FOR UPDATE`.
 *
 * `SESSION_NOT_RATED` for an id that names nothing, which is the frozen code for
 * acting on a session that carries no rating — including withdrawing one that is
 * not there. There is deliberately no `RATING_NOT_FOUND`: a caller guessing ids
 * learns only that there is nothing to act on.
 */
async function lockRatingRow(
  tx: Prisma.TransactionClient,
  ratingId: string,
): Promise<SettlementRow> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM session_settlement WHERE id = ${ratingId}::uuid FOR UPDATE
  `;

  if (locked[0] === undefined) throw new AppError('SESSION_NOT_RATED');

  return readRatingRow(tx, ratingId);
}

async function readRatingRow(
  client: PrismaService | Prisma.TransactionClient,
  ratingId: string,
): Promise<SettlementRow> {
  const rows = await client.$queryRaw<SettlementRow[]>`
    SELECT ${SETTLEMENT_COLUMNS} FROM session_settlement WHERE id = ${ratingId}::uuid
  `;

  const row = rows[0];
  if (row === undefined) throw new AppError('SESSION_NOT_RATED');
  return row;
}

/**
 * The settlement facts an audit row records.
 *
 * WHAT IS HERE: the session it settles, the therapist, the clinic day, the
 * percentage that was applied, where it came from, and the three amounts. All of
 * it is the fact being recorded — DECISION_LOG 2026-08-09 writes the fact being
 * changed in full, because masking it "would make the trail useless for the
 * corrections it exists to explain", and a settlement correction is precisely
 * what this trail exists to explain.
 *
 * WHAT IS NOT HERE: no family, no child, no name, no file number and no phone
 * number. `audit_log` is append-only and permanent, and a settlement question is
 * about a therapist and a session — the family who was charged is the LEDGER's
 * fact and is already recorded on `session_charge.posted`. Copying it here would
 * build a second undeletable store of who was seen, to answer a question that
 * never needed it.
 *
 * `appointmentParticipantId` IS AN OPAQUE SEAT ID and is the row's own column;
 * it is what makes a rating traceable to the session it settles without naming
 * the child who sat in it.
 */
function ratingFacts(row: SettlementRow): Record<string, string | number | boolean | null> {
  return {
    sessionChargeId: row.session_charge_id,
    appointmentParticipantId: row.appointment_participant_id,
    therapistId: row.therapist_id,
    serviceDate: row.service_date,
    appliedShareBasisPoints: row.applied_share_basis_points,
    appliedShareRuleId: row.applied_share_rule_id,
    ratedVia: row.rated_via,
    baseAmountToman: row.base_amount_toman.toString(),
    therapistGrossToman: row.therapist_gross_toman.toString(),
    clinicGrossToman: row.clinic_gross_toman.toString(),
  };
}

export function toSessionSettlement(row: SettlementRow): SessionSettlement {
  return {
    id: row.id,
    sessionChargeId: row.session_charge_id,
    appointmentParticipantId: row.appointment_participant_id,
    therapistId: row.therapist_id,
    serviceDate: row.service_date,
    appliedShareBasisPoints: row.applied_share_basis_points,
    appliedShareRuleId: row.applied_share_rule_id,
    ratedVia: row.rated_via,
    baseAmountToman: row.base_amount_toman.toString(),
    therapistGrossToman: row.therapist_gross_toman.toString(),
    clinicGrossToman: row.clinic_gross_toman.toString(),
    reason: row.reason,
    supersedesSessionSettlementId: row.supersedes_session_settlement_id,
    createdAt: row.created_at.toISOString(),
    createdByUserId: row.created_by_user_id,
    voidedAt: row.voided_at === null ? null : row.voided_at.toISOString(),
    voidedByUserId: row.voided_by_user_id,
    voidReason: row.void_reason,
  };
}
