import { Prisma } from '@prisma/client';
import type { Payment, PaymentMethod, PaymentStatus } from '@clinic/contracts';
import { AppError } from '../common/app-error';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Reading a payment back as the wire carries it.
 *
 * ONE MAPPING FOR EVERY WRITE THAT TOUCHES A PAYMENT, exactly as
 * `charge-detail.ts` is the one mapping for a charge. Recording money answers
 * with it today; voiding one (A4) and the payment history (A5) answer with it
 * too, so `status` can never be derived one way on one route and another way on
 * the next.
 *
 * `status` IS DERIVED HERE AND STORED NOWHERE. `payment` has no status column
 * (frozen A1): a payment is `CONFIRMED` exactly while `voided_at` is null and
 * `VOIDED` otherwise. The word is put on the wire so no consumer re-derives it
 * from a null, and `paymentSchema`'s refinement refuses a response where the two
 * disagree — which is what makes deriving it in one place enough.
 *
 * `received_on` is read as `::text` rather than as a `date`, for the reason
 * `service_date` is: Prisma maps a PostgreSQL `DATE` onto a JavaScript `Date` at
 * UTC midnight, and every conversion back through a local timezone is a chance
 * for the clinic day the money arrived on to move by one. The digits are the
 * value.
 *
 * NO BALANCE, NO CREDIT AND NO TOTAL. What a family owes is the whole-family
 * position on the account read, computed over every valid charge and confirmed
 * payment; a number attached to one payment row would be a second answer to the
 * only question a family asks.
 */

/** Every column of a payment, in the order the table declares them. */
export const PAYMENT_COLUMNS = Prisma.sql`
  id, family_id, amount_toman, method::text AS method,
  received_on::text AS received_on, reference, note,
  created_at, created_by_user_id, voided_at, voided_by_user_id, void_reason
`;

export type PaymentRow = {
  id: string;
  family_id: string;
  amount_toman: bigint;
  method: PaymentMethod;
  received_on: string;
  reference: string | null;
  note: string | null;
  created_at: Date;
  created_by_user_id: string;
  voided_at: Date | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
};

export type PaymentClient = PrismaService | Prisma.TransactionClient;

export async function readPaymentRow(
  client: PaymentClient,
  paymentId: string,
): Promise<PaymentRow> {
  const rows = await client.$queryRaw<PaymentRow[]>`
    SELECT ${PAYMENT_COLUMNS} FROM payment WHERE id = ${paymentId}::uuid
  `;

  const row = rows[0];
  if (row === undefined) throw new AppError('PAYMENT_NOT_FOUND');
  return row;
}

/** The payment as the frozen `paymentResponse` carries it. */
export async function readPaymentDetail(
  client: PaymentClient,
  paymentId: string,
): Promise<Payment> {
  return toPayment(await readPaymentRow(client, paymentId));
}

/**
 * The row, mapped. Exported so a caller that already holds the row — the write
 * that just produced it, and the history page that reads many at once — maps it
 * with this function rather than with a second copy of the derivation.
 */
export function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    familyId: row.family_id,
    amountToman: row.amount_toman.toString(),
    method: row.method,
    receivedOn: row.received_on,
    reference: row.reference,
    note: row.note,
    status: paymentStatus(row),
    createdAt: row.created_at.toISOString(),
    createdByUserId: row.created_by_user_id,
    voidedAt: row.voided_at?.toISOString() ?? null,
    voidedByUserId: row.voided_by_user_id,
    voidReason: row.void_reason,
  };
}

/** The two-state derivation, in one expression, used by everything that reads a payment. */
export function paymentStatus(row: Pick<PaymentRow, 'voided_at'>): PaymentStatus {
  return row.voided_at === null ? 'CONFIRMED' : 'VOIDED';
}
