import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CreatePaymentRequest, PaymentResponse } from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import type { PaymentRecordedAudit } from '../audit/payment-audit';
import { assertPaymentAuditSafe } from '../audit/payment-audit';
import { actorContext, canonicalOptionalText } from '../catalog/catalog-support';
import { AppError } from '../common/app-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';
import { readPaymentDetail } from './payment-detail';

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
      await this.assertFamilyExists(tx, familyId);
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
   * A family that does not exist is 404, not a foreign-key error.
   *
   * A DEACTIVATED FAMILY MAY STILL PAY. Deactivation retires a record from the
   * working lists; it does not cancel what that family already owes, and money
   * handed over to settle an old debt has to be recordable — refusing it would
   * push the clinic into recording it against the wrong family or not at all.
   * This is the same reading `FamilyAccountService` takes of the account.
   */
  private async assertFamilyExists(tx: Prisma.TransactionClient, familyId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM family WHERE id = ${familyId}::uuid
    `;

    if (rows[0] === undefined) throw new AppError('FAMILY_NOT_FOUND');
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
