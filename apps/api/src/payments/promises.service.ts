import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreatePromiseRequest,
  PromiseResponse,
  RescheduledPromiseResponse,
} from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import type {
  PromiseCancelledAudit,
  PromiseCreatedAudit,
  PromiseFulfilledAudit,
  PromiseRescheduledAudit,
} from '../audit/payment-audit';
import { assertPaymentAuditSafe } from '../audit/payment-audit';
import { actorContext, canonicalOptionalText, canonicalText } from '../catalog/catalog-support';
import { AppError } from '../common/app-error';
import { isUniqueViolation, violatesConstraint } from '../common/pg-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';
import { assertFamilyExists, lockPaymentRow } from './payment-detail';
import { assertPromiseOpen, lockPromiseRow, readPromiseDetail } from './promise-detail';

/**
 * What a family said it would pay, and what became of it.
 *
 * NOTHING IN THIS FILE MOVES MONEY, IN ANY STATE (CLAUDE.md; PROJECT_SPEC.md 8).
 * No method below reads a charge, writes a payment, computes a balance or
 * touches a credit: creating, fulfilling, rescheduling and cancelling a promise
 * all leave `netChargedTotalToman`, `confirmedPaymentTotalToman`, `creditToman`
 * and `amountDueToman` exactly as they were. Fulfilment records a historical
 * LINK to a payment that already stood on its own — it does not create, amend or
 * re-value that payment, and the surplus of a larger one is visible as derived
 * credit rather than as anything recorded here.
 *
 * THE LOCK ORDER IS `payment_promise -> payment`, and every method that needs
 * both takes them in that order. Only fulfilment needs both. The promise row is
 * locked FIRST and unconditionally, so:
 *
 *   * two resolutions of one promise serialise on the promise row, the loser
 *     re-reads a terminal status and is refused `PROMISE_NOT_OPEN` — one
 *     transition, one audit row, whichever pair of verbs raced;
 *   * two promises claiming one payment serialise on the PAYMENT row, which the
 *     winner holds `FOR UPDATE` until it commits, so the loser's duplicate check
 *     sees the committed link and is refused `PAYMENT_ALREADY_FULFILS_PROMISE`;
 *   * a payment void — which locks the payment and NEVER a promise (A4) — cannot
 *     form a cycle with any of them, because no transaction here ever holds a
 *     payment lock while waiting for a promise lock.
 *
 * NO RETRY LOOP ANYWHERE. Every race above resolves into a named refusal the
 * caller can act on, and retrying a financial act on the caller's behalf is how
 * one intention becomes two records.
 *
 * THE DATABASE IS THE BACKSTOP AND IS NOT THE MESSAGE.
 * `enforce_payment_promise_transition`, the two biconditional CHECKs, the
 * composite foreign key and the unique index on `fulfilling_payment_id` all
 * still hold against a psql session with no service in front of it. What this
 * class adds is the frozen name — `PROMISE_NOT_OPEN` rather than a
 * `restrict_violation` — and it translates a database failure back into one only
 * where the failure is attributable to exactly one rule.
 */
@Injectable()
export class PromisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Recording that a family said it would pay.
   *
   * ONE INSERT, ONE AUDIT ROW, ONE TRANSACTION. There is nothing to lock: the row
   * is new, it collides with nothing, and no invariant in `payment_promise` spans
   * two rows at creation time. A lock taken for future-proofing would be a lock
   * ordering nobody could reason about later.
   *
   * A PAST DUE DATE IS ACCEPTED AND IS NOT AN ERROR (DECISION_LOG, 2026-08-15 —
   * A promise may be born late). A promise agreed last week and entered today is
   * a real fact, and refusing it would push the clinic to enter a false date. The
   * row is stored `OPEN` and reads immediately as derived `MISSED`, which is why
   * no check against `clinic_date()` appears here and why
   * `enforce_payment_promise_born_open` deliberately does not test the due date
   * either. There is no age bound, because any bound would be an invented number.
   *
   * THE STATUS IS NEVER STATED BY THE CALLER. `createPromiseRequestSchema` is
   * strict and carries three fields; the actor, the instant and the `OPEN` state
   * are the server's, and `enforce_payment_promise_born_open` refuses a row born
   * any other way.
   *
   * NO LINKED PAYMENT HERE. A promise is created as an intention; the payment
   * that settles it is named later, explicitly, through the fulfil route.
   */
  async create(
    familyId: string,
    body: CreatePromiseRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<PromiseResponse> {
    const note = canonicalOptionalText(body.note);

    return this.prisma.$transaction(async (tx) => {
      await assertFamilyExists(tx, familyId);

      const promiseId = uuidv7();

      // `created_at` is `transaction_timestamp()` and not Prisma's `now()`, so
      // the promise and its audit row carry the same instant, and the creation
      // instant is the server's rather than anything a caller could state.
      await tx.$executeRaw`
        INSERT INTO payment_promise (
          id, family_id, amount_toman, due_on, note, status, created_at, created_by_user_id
        ) VALUES (
          ${promiseId}::uuid,
          ${familyId}::uuid,
          ${body.amountToman}::bigint,
          ${body.dueOn}::date,
          ${note},
          'OPEN'::payment_promise_status,
          transaction_timestamp(),
          ${actor.userId}::uuid
        )
      `;

      // The note is written in full, because the note IS the fact being recorded
      // (DECISION_LOG, 2026-08-15). No guardian name, no phone number, no file
      // number and no child id: a promise is a family fact, and `familyId` is
      // the whole of the traceability this row needs. The actor, the instant and
      // the request id are columns of the audit row itself.
      const after: PromiseCreatedAudit = {
        familyId,
        amountToman: body.amountToman,
        dueOn: body.dueOn,
        note,
      };

      assertPaymentAuditSafe({ after });

      // In the same transaction as the INSERT, so a failed audit write takes the
      // promise with it.
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'payment_promise.created',
        entityType: 'payment_promise',
        entityId: promiseId,
        after,
      });

      return { promise: await readPromiseDetail(tx, promiseId) };
    });
  }

  /**
   * Marking a promise kept, by naming the payment that kept it.
   *
   * THE PAYMENT IS EXPLICIT AND IS NEVER INFERRED (DECISION_LOG, 2026-08-15). No
   * statement below looks for a payment near the due date: "was this promise
   * kept?" is a recorded human judgement, not a proximity match.
   *
   * THE ORDER OF THE SEVEN CHECKS IS THE LOCK ORDER, and it is not
   * interchangeable. The promise is read and locked first — so a caller naming a
   * promise that has already ended is told so before any payment is touched, and
   * so this transaction never waits on a payment while holding nothing — and the
   * payment is read and locked second. Reversing them would be the
   * `payment -> payment_promise` direction the approved order forbids and would
   * put this path in a cycle with the void.
   *
   * `FOR UPDATE` ON THE PAYMENT, NOT `FOR SHARE`. The trigger takes `FOR SHARE`
   * because all it needs is to keep a void out; this transaction needs more,
   * because "has any other promise already claimed this payment?" is a question
   * whose answer two concurrent fulfilments would otherwise both read as no. The
   * exclusive lock makes them serialise, so the loser reads the winner's
   * committed link and is refused by NAME rather than by a translated unique
   * violation. That index remains the backstop, and its violation is translated
   * below for the caller that reaches the table another way.
   *
   * EXACTLY ONE TRANSITION, PREDICATED ON `status = 'OPEN'`. The check above is
   * what produces the named refusal; the predicate is what makes a second
   * fulfilment structurally unable to write even if the check were wrong.
   *
   * NO PARTIAL FULFILMENT, NO ALLOCATION ROW AND NO AMOUNT IN THE REQUEST. A
   * payment LARGER than the promise fulfils it entirely and the surplus shows as
   * derived credit on the family position; a smaller one is refused, because
   * there is no remainder anywhere to record against the promise.
   */
  async fulfill(
    promiseId: string,
    paymentId: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<PromiseResponse> {
    return this.prisma.$transaction(async (tx) => {
      const promise = await lockPromiseRow(tx, promiseId);
      assertPromiseOpen(promise);

      // The second and last lock in the approved order. A payment id naming
      // nothing is `PAYMENT_NOT_FOUND` — the frozen code for a payment that is
      // not there, which is what this is; `PROMISE_NOT_FOUND` would be a lie
      // about which of the two records is missing.
      const payment = await lockPaymentRow(tx, paymentId);

      // The composite foreign key `(fulfilling_payment_id, family_id)` refuses
      // this too, and refuses it for the caller that never came through here.
      // What this adds is the frozen name instead of a `foreign_key_violation`.
      if (payment.family_id !== promise.family_id) throw new AppError('PAYMENT_FAMILY_MISMATCH');

      // Voided money is money the clinic says it never received; it cannot be
      // evidence that a promise was kept. Read under the payment's own exclusive
      // lock, so a void cannot slip between this check and the commit.
      if (payment.voided_at !== null) throw new AppError('PAYMENT_VOIDED');

      if (payment.amount_toman < promise.amount_toman) {
        throw new AppError('PROMISE_PAYMENT_TOO_SMALL');
      }

      // One payment fulfils at most one promise. Read AFTER the payment lock is
      // held, which is what makes it correct under concurrency rather than a
      // check two transactions can both pass.
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM payment_promise WHERE fulfilling_payment_id = ${paymentId}::uuid
      `;
      if (claimed[0] !== undefined) throw new AppError('PAYMENT_ALREADY_FULFILS_PROMISE');

      // The reason is left null: it is optional on a kept promise
      // (`payment_promise_resolution_chk`), because the linked payment is the
      // explanation and demanding prose for a kept promise would produce prose
      // nobody means.
      await this.resolve(tx, promiseId, 'FULFILLED', null, actor.userId, {
        column: 'fulfilling_payment_id',
        id: paymentId,
      });

      // BOTH AMOUNTS, because a payment may be larger than the promise it
      // fulfils and a trail carrying one number would leave a reader unable to
      // explain why a promise of 500,000 is settled by a payment of 800,000
      // without opening two more tables. The bank reference is never copied
      // (DECISION_LOG, 2026-08-15) — not even as `hasReference`, which the
      // payment's own record already stated.
      const after: PromiseFulfilledAudit = {
        familyId: promise.family_id,
        promisedAmountToman: promise.amount_toman.toString(),
        paymentId,
        paymentAmountToman: payment.amount_toman.toString(),
      };

      assertPaymentAuditSafe({ after });

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'payment_promise.fulfilled',
        entityType: 'payment_promise',
        entityId: promiseId,
        after,
      });

      return { promise: await readPromiseDetail(tx, promiseId) };
    });
  }

  /**
   * Agreeing a new date instead of the one that was promised.
   *
   * TWO ROWS, ONE TRANSACTION, AND THE OLD ONE IS NEVER EDITED INTO THE NEW ONE.
   * The predecessor keeps its own amount, due date, note, creation actor and
   * creation instant, gains a resolution and a forward link, and becomes
   * terminal; the successor is a NEW promise for the same amount and note on the
   * new date. That is what makes "rescheduling preserves old due-date history"
   * (PROJECT_SPEC.md 8) structural rather than a convention —
   * `enforce_payment_promise_transition` refuses any statement that says
   * otherwise, whether or not it came from here.
   *
   * THE SUCCESSOR IS INSERTED BEFORE THE PREDECESSOR IS CLOSED, because the
   * forward link A1 stores has to name a row that exists. Both carry the same
   * `transaction_timestamp()`, which is the equality the trigger's
   * no-backwards-chain rule is written for.
   *
   * THE PREDECESSOR IS LOCKED FIRST, BEFORE ANYTHING IS WRITTEN. Two concurrent
   * reschedules therefore serialise on it and the loser is refused
   * `PROMISE_NOT_OPEN` having inserted nothing — no orphan successor, no second
   * live promise for one intention, exactly one chain.
   *
   * THE SUCCESSOR MAY NOT BE DUE IN THE PAST, and this is the one place the two
   * due-date rules differ (DECISION_LOG, 2026-08-15): creation accepts a past
   * date, rescheduling does not. An intention already overdue at the moment it is
   * agreed records nothing. `clinic_date()` decides, not the Node clock.
   *
   * A `MISSED` PREDECESSOR IS THE ORDINARY CASE. It is stored `OPEN`, so it
   * reschedules normally — which is the whole reason `MISSED` is derived rather
   * than stored.
   *
   * NEITHER THE AMOUNT NOR THE NOTE MAY CHANGE (frozen F1). A different amount is
   * a different intention: a cancel and a new promise.
   */
  async reschedule(
    promiseId: string,
    dueOn: string,
    reason: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<RescheduledPromiseResponse> {
    const canonicalReason = canonicalText(reason);

    return this.prisma.$transaction(async (tx) => {
      const promise = await lockPromiseRow(tx, promiseId);
      assertPromiseOpen(promise);

      await this.assertDueOnNotPast(tx, dueOn);

      const successorId = uuidv7();

      await tx.$executeRaw`
        INSERT INTO payment_promise (
          id, family_id, amount_toman, due_on, note, status, created_at, created_by_user_id
        ) VALUES (
          ${successorId}::uuid,
          ${promise.family_id}::uuid,
          ${promise.amount_toman}::bigint,
          ${dueOn}::date,
          ${promise.note},
          'OPEN'::payment_promise_status,
          transaction_timestamp(),
          ${actor.userId}::uuid
        )
      `;

      await this.resolve(tx, promiseId, 'RESCHEDULED', canonicalReason, actor.userId, {
        column: 'rescheduled_to_promise_id',
        id: successorId,
      });

      // Both dates and the successor's id, so the chain is followable forward
      // from any link without re-reading the table, and the reason, which is
      // mandatory and also lives on the promise itself.
      const after: PromiseRescheduledAudit = {
        familyId: promise.family_id,
        amountToman: promise.amount_toman.toString(),
        previousDueOn: promise.due_on,
        newDueOn: dueOn,
        successorPromiseId: successorId,
        reason: canonicalReason,
      };

      assertPaymentAuditSafe({ after });

      // ONE audit row, on the promise that was rescheduled. The successor is not
      // separately `payment_promise.created`: it was not created as an intention
      // in its own right, it is the other half of this one act, and a second row
      // would make "how many promises did this clinic take?" double-count every
      // reschedule.
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'payment_promise.rescheduled',
        entityType: 'payment_promise',
        entityId: promiseId,
        after,
      });

      return {
        promise: await readPromiseDetail(tx, promiseId),
        successor: await readPromiseDetail(tx, successorId),
      };
    });
  }

  /**
   * Abandoning a promise.
   *
   * THE REASON IS MANDATORY, for the reason a void's is: a promise abandoned with
   * no explanation is exactly what CLAUDE.md forbids of a correction. It is
   * stored ON the promise as well as in the trail, because "why was this promise
   * cancelled?" is a question about the promise.
   *
   * IT MOVES NOTHING AND REVERSES NOTHING. A promise never changed a balance, so
   * cancelling one restores no total and creates no compensating row; there is
   * nothing here to undo.
   *
   * NO DELETION. The row survives whole and says it was cancelled — a promise
   * ended by disappearing is a promise nobody can account for later, and
   * `payment_promise_no_delete` refuses it in any case.
   *
   * A `MISSED` PROMISE IS CANCELLED NORMALLY, being stored `OPEN`. It is the
   * commonest case there is.
   */
  async cancel(
    promiseId: string,
    reason: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<PromiseResponse> {
    const canonicalReason = canonicalText(reason);

    return this.prisma.$transaction(async (tx) => {
      const promise = await lockPromiseRow(tx, promiseId);
      assertPromiseOpen(promise);

      await this.resolve(tx, promiseId, 'CANCELLED', canonicalReason, actor.userId, null);

      const after: PromiseCancelledAudit = {
        familyId: promise.family_id,
        amountToman: promise.amount_toman.toString(),
        dueOn: promise.due_on,
        reason: canonicalReason,
      };

      assertPaymentAuditSafe({ after });

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'payment_promise.cancelled',
        entityType: 'payment_promise',
        entityId: promiseId,
        after,
      });

      return { promise: await readPromiseDetail(tx, promiseId) };
    });
  }

  /**
   * The one UPDATE all three resolutions make, and the one place their failures
   * are named.
   *
   * THE WHOLE RESOLUTION IN ONE STATEMENT — state, link, actor, instant and
   * reason together — so `payment_promise_resolution_chk` and the two
   * biconditional link CHECKs see a complete resolution rather than a
   * half-written one, and so the promise and its audit row carry the same
   * `transaction_timestamp()`.
   *
   * THE LINK COLUMN COMES FROM A CLOSED UNION AND NEVER FROM A CALLER. The two
   * links are the only ones a promise has, and each is written by the one verb
   * that owns it: a fulfilment names a payment, a reschedule names a successor,
   * a cancel names nothing.
   *
   * `AND status = 'OPEN'` IS IN THE PREDICATE AS WELL AS IN THE CHECK ABOVE.
   * `assertPromiseOpen` is what produces the refusal a caller reads; this is what
   * makes a second transition structurally unable to write even if that check
   * were removed. A zero row count is unreachable while the row lock is held —
   * and it is asserted rather than assumed, because the alternative is an audit
   * row claiming a transition that never happened. It answers with the same code
   * the check does; it is the same fact learned one statement later, not a second
   * rule.
   *
   * THE UNIQUE INDEX ON `fulfilling_payment_id` IS TRANSLATED HERE AND NOWHERE
   * ELSE, and only because it is attributable to exactly one rule: one payment
   * fulfils at most one promise. Every other database failure on this path is
   * left to surface as itself — guessing which named error a `check_violation`
   * meant would be a second, unverifiable statement of a rule the service already
   * makes above.
   */
  private async resolve(
    tx: Prisma.TransactionClient,
    promiseId: string,
    status: 'FULFILLED' | 'RESCHEDULED' | 'CANCELLED',
    reason: string | null,
    userId: string,
    link: { column: 'fulfilling_payment_id' | 'rescheduled_to_promise_id'; id: string } | null,
  ): Promise<void> {
    const linkAssignment =
      link === null
        ? Prisma.empty
        : link.column === 'fulfilling_payment_id'
          ? Prisma.sql`, fulfilling_payment_id = ${link.id}::uuid`
          : Prisma.sql`, rescheduled_to_promise_id = ${link.id}::uuid`;

    let updated: number;

    try {
      updated = await tx.$executeRaw`
        UPDATE payment_promise
           SET status = ${status}::payment_promise_status,
               resolved_at = transaction_timestamp(),
               resolved_by_user_id = ${userId}::uuid,
               resolution_reason = ${reason}
               ${linkAssignment}
         WHERE id = ${promiseId}::uuid AND status = 'OPEN'
      `;
    } catch (error) {
      if (
        isUniqueViolation(error) &&
        violatesConstraint(error, 'payment_promise_fulfilling_payment_id_key')
      ) {
        throw new AppError('PAYMENT_ALREADY_FULFILS_PROMISE');
      }

      throw error;
    }

    if (updated === 0) throw new AppError('PROMISE_NOT_OPEN');
  }

  /**
   * "Not before today" measured in the clinic's own calendar day.
   *
   * ASKED OF `clinic_date()`, WHICH IS THE SAME FUNCTION THE TRIGGER USES, so
   * this is not a second domain model of what today is — it is the one
   * authoritative answer, read early enough to name the refusal. It is `STABLE`
   * and derived from `transaction_timestamp()`, so the answer this check gets and
   * the answer the trigger gets a statement later are the same value.
   *
   * TODAY IS ACCEPTED. A promise agreed for today is due today, not overdue; only
   * a date strictly before today is refused.
   */
  private async assertDueOnNotPast(tx: Prisma.TransactionClient, dueOn: string): Promise<void> {
    const rows = await tx.$queryRaw<{ past: boolean }[]>`
      SELECT ${dueOn}::date < clinic_date() AS past
    `;

    if (rows[0]?.past === true) throw new AppError('PROMISE_DUE_DATE_IN_PAST');
  }
}
