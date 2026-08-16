import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CreatePaymentRequest, PaymentResponse } from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import type {
  PaymentRecordedAudit,
  PaymentVoidedAfterAudit,
  PaymentVoidedBeforeAudit,
  PaymentVoidedMetadataAudit,
} from '../audit/payment-audit';
import { assertPaymentAuditSafe } from '../audit/payment-audit';
import { actorContext, canonicalOptionalText, canonicalText } from '../catalog/catalog-support';
import { AppError } from '../common/app-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertFamilyExists,
  findFulfilledPromiseId,
  lockPaymentRow,
  readPaymentDetail,
} from './payment-detail';

/**
 * Recording money that arrived.
 *
 * ONE INSERT, ONE AUDIT ROW, ONE TRANSACTION, AND NOTHING ELSE. A payment is a
 * family fact (DECISION_LOG, 2026-08-15): it names no charge, no session and no
 * child, so nothing is allocated, no charge is touched and no promise is
 * resolved here. What the family owes stays derived from rows at read time —
 * there is no stored balance and no credit column anywhere in this system — so
 * this write has exactly one row to produce and one fact to record about it.
 *
 * NO LOCK, AND THAT IS A DECISION RATHER THAN AN OMISSION. A payment has no
 * contention key: it is a new row, it collides with nothing, and no invariant in
 * `payment` spans two rows for two transactions to race over. The charge void
 * takes `FOR UPDATE` because two voids of ONE row must serialise; there is no
 * such row here. A lock taken for future-proofing would be a lock ordering
 * nobody could reason about later.
 *
 * NO IDEMPOTENCY KEY (checkpoint A3 scope). Two identical payments entered twice
 * are two payments, because two families really can hand over the same amount in
 * the same way on the same day, and the system cannot tell a duplicate entry from
 * a genuine repeat. The accepted risk is a pilot revisit trigger and is recorded
 * as one; inventing an idempotency table now would be infrastructure for a rule
 * nobody has approved.
 *
 * A PAYMENT IS BORN CONFIRMED. There is no status column and no pending state
 * (DECISION_LOG, 2026-08-15 — A payment is confirmed or voided): the row is
 * inserted with its three void columns null, `enforce_financial_row_born_active`
 * refuses anything else, and `paymentStatus` reads `CONFIRMED` off exactly that.
 *
 * NOTHING IS EVER REWRITTEN. A wrong payment is voided and re-recorded (A4);
 * `enforce_payment_immutability` refuses every other change, including to the
 * note and the reference, whether or not it came from here.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async record(
    familyId: string,
    body: CreatePaymentRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<PaymentResponse> {
    const reference = canonicalOptionalText(body.reference);
    const note = canonicalOptionalText(body.note);

    return this.prisma.$transaction(async (tx) => {
      await assertFamilyExists(tx, familyId);
      await this.assertReceivedOnNotFuture(tx, body.receivedOn);

      const paymentId = uuidv7();

      // `created_at` is `transaction_timestamp()` and not Prisma's `now()`, so
      // the payment and its audit row carry the same instant — the property the
      // audit design depends on — and so the actual creation instant is the
      // server's rather than anything a caller could state.
      await tx.$executeRaw`
        INSERT INTO payment (
          id, family_id, amount_toman, method, received_on,
          reference, note, created_at, created_by_user_id
        ) VALUES (
          ${paymentId}::uuid,
          ${familyId}::uuid,
          ${body.amountToman}::bigint,
          ${body.method}::payment_method,
          ${body.receivedOn}::date,
          ${reference},
          ${note},
          transaction_timestamp(),
          ${actor.userId}::uuid
        )
      `;

      // The bank reference is NEVER copied (DECISION_LOG, 2026-08-15 — Payment
      // and promise audit carries no bank reference): `audit_log` is append-only
      // and permanent, so a banking identifier written into it is a second
      // undeletable store of a value the payment id already leads to. Only
      // whether one exists is recorded, and the note is written in full, because
      // the note IS the fact being recorded.
      //
      // No guardian name, no phone number, no file number and no child id: a
      // payment is a family fact, and `familyId` is the whole of the
      // traceability this row needs. The actor, the instant and the request id
      // are columns of the audit row itself.
      const after: PaymentRecordedAudit = {
        familyId,
        amountToman: body.amountToman,
        method: body.method,
        receivedOn: body.receivedOn,
        hasReference: reference !== null,
        note,
      };

      // The type above already makes a `reference` key a compile error; this is
      // the runtime line for the value that could arrive some other way.
      assertPaymentAuditSafe({ after });

      // In the same transaction as the INSERT, so a failed audit write takes the
      // payment with it. An unaudited payment is worse than a refused one: the
      // operator can re-enter money, and nobody can reconstruct a financial act
      // that was never recorded.
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'payment.recorded',
        entityType: 'payment',
        entityId: paymentId,
        after,
      });

      return { payment: await readPaymentDetail(tx, paymentId) };
    });
  }

  /**
   * Withdraws money that should not have been recorded, and says why.
   *
   * A CORRECTION, NOT A DELETION. The row survives whole: amount, method,
   * family, received day, reference, note, entry instant and entry actor are
   * left exactly as recorded, three void columns are written beside them, and
   * `enforce_payment_immutability` refuses any statement that says otherwise
   * whether or not it came from here. There is no delete path, no replacement
   * payment and no refund: re-recording corrected money is a separate, later
   * `POST /families/:id/payments`, with its own actor, instant and audit row.
   *
   * ONE-WAY, AND ENFORCED TWICE. There is no un-void request in the frozen
   * contract, the `UPDATE` is predicated on `voided_at IS NULL`, and the trigger
   * raises `restrict_violation` on any attempt to change a void once it exists.
   * So a second void CANNOT overwrite the first manager's reason even if every
   * check above it were removed; what the checks add is that the manager is told
   * `PAYMENT_ALREADY_VOIDED` instead of seeing an internal error. This is
   * deliberately NOT a second state machine — the two states are read off the
   * one column the database itself decides on.
   *
   * THE LOCK IS THE PAYMENT ROW AND NOTHING ELSE (see `lockPaymentRow`). No
   * promise is locked, which keeps this transaction out of the
   * `payment -> payment_promise` direction the approved order forbids.
   *
   * VOIDING A PAYMENT THAT FULFILLED A PROMISE IS ALLOWED, AND THE PROMISE IS
   * NOT TOUCHED. It stays `FULFILLED`: a judgement recorded at the time is not
   * un-made by a later correction, and a terminal promise cannot transition
   * again in any case — a database that also refused the void would make a
   * payment recorded in error against a promise permanently uncorrectable, which
   * is why the schema deliberately does not refuse it. The consequence is made
   * traceable instead, by naming the promise in the audit metadata.
   *
   * IT MOVES NO TOTAL, BECAUSE THERE IS NO STORED TOTAL. What the family owes is
   * derived from rows at read time, so voiding the row is the whole of the
   * correction; nothing here computes paid, credit or due.
   */
  async void(
    paymentId: string,
    reason: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<PaymentResponse> {
    const canonicalReason = canonicalText(reason);

    return this.prisma.$transaction(async (tx) => {
      const current = await lockPaymentRow(tx, paymentId);
      if (current.voided_at !== null) throw new AppError('PAYMENT_ALREADY_VOIDED');

      // Read under the payment lock and locking nothing itself, which is what
      // keeps the approved lock order intact while still letting the audit row
      // explain what the void made stale.
      const fulfilledPromiseId = await findFulfilledPromiseId(tx, paymentId);

      // `voided_at IS NULL` in the predicate as well as in the check above: the
      // check is what produces the named refusal, this is what makes a second
      // void structurally unable to write even if the check were wrong.
      //
      // `RETURNING` rather than a re-read: the instant written into the row and
      // the instant written into the audit payload are then the same value from
      // the same statement, not two reads that a later refactor could let drift.
      const updated = await tx.$queryRaw<{ voided_at: Date }[]>`
        UPDATE payment
           SET voided_at = transaction_timestamp(),
               voided_by_user_id = ${actor.userId}::uuid,
               void_reason = ${canonicalReason}
         WHERE id = ${paymentId}::uuid AND voided_at IS NULL
        RETURNING voided_at
      `;

      // Unreachable while the lock above is held — and asserted rather than
      // assumed, because the alternative is an audit row claiming a transition
      // that never happened. It answers with the same code the check does; it
      // is the same fact learned one statement later, not a second rule.
      const voidedAt = updated[0]?.voided_at;
      if (voidedAt === undefined) throw new AppError('PAYMENT_ALREADY_VOIDED');

      const before: PaymentVoidedBeforeAudit = { voidedAt: null };

      // The transition from both sides: "it is void" does not record that it
      // was not.
      const after: PaymentVoidedAfterAudit = {
        voidedAt: voidedAt.toISOString(),
        voidReason: canonicalReason,
      };

      // Enough to explain the correction without opening another table, and no
      // more. The bank reference is NEVER copied (DECISION_LOG, 2026-08-15) —
      // not even as `hasReference`, which the record already stated and which a
      // void does not change — and no name, phone number, file number or child
      // id appears here. The actor, the instant and the request id are columns
      // of the audit row itself.
      const metadata: PaymentVoidedMetadataAudit = {
        familyId: current.family_id,
        amountToman: current.amount_toman.toString(),
        method: current.method,
        receivedOn: current.received_on,
        fulfilledPromiseId,
      };

      assertPaymentAuditSafe({ before, after, metadata });

      // In the same transaction as the UPDATE, so a failed audit write rolls the
      // void back. A financial reversal nobody can explain is exactly what
      // CLAUDE.md forbids of a correction, and this one cannot be re-made later
      // from the row alone.
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'payment.voided',
        entityType: 'payment',
        entityId: paymentId,
        before,
        after,
        metadata,
      });

      return { payment: await readPaymentDetail(tx, paymentId) };
    });
  }

  /**
   * "Not after today" measured in the clinic's own calendar day.
   *
   * ASKED OF `clinic_date()`, WHICH IS THE SAME FUNCTION THE TRIGGER USES, so
   * this is not a second domain model of what today is — it is the one
   * authoritative answer, read early enough to name the refusal. Tehran rolls
   * over at 20:30 UTC, so the Node clock, the session timezone and UTC each
   * disagree with the clinic for three and a half hours of every day, and a
   * browser must not decide it either.
   *
   * `payment_enforce_received_on` REMAINS THE BACKSTOP and is not weakened by
   * this check: a caller that reaches the table another way still cannot record
   * money that has not arrived. What this adds is `PAYMENT_DATE_IN_FUTURE`
   * instead of a `check_violation` an operator cannot act on.
   *
   * BACK-DATING IS NOT BOUNDED HERE OR ANYWHERE. Money that arrived on Thursday
   * and is entered on Saturday arrived on Thursday (DECISION_LOG, 2026-08-15),
   * and `createdAt` on the response is what makes the back-date visible as one.
   */
  private async assertReceivedOnNotFuture(
    tx: Prisma.TransactionClient,
    receivedOn: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ future: boolean }[]>`
      SELECT ${receivedOn}::date > clinic_date() AS future
    `;

    if (rows[0]?.future === true) throw new AppError('PAYMENT_DATE_IN_FUTURE');
  }
}
