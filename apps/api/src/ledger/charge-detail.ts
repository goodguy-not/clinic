import { Prisma } from '@prisma/client';
import type {
  ChargeAdjustment,
  SessionChargeDetail,
  TariffPriceMode,
} from '@clinic/contracts';
import { AppError } from '../common/app-error';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Reading a charge back as the wire carries it.
 *
 * ONE READ SHAPE FOR EVERY LEDGER WRITE. `chargePostResult` and
 * `sessionChargeResponse` both carry a `sessionChargeDetail`, so posting a
 * charge, voiding one and adjusting one all answer with the same object built by
 * the same function. Two builders would eventually disagree about what
 * `effectiveAmountToman` means on a voided charge, and the disagreement would be
 * a number a family is shown.
 *
 * THE TWO TOTALS ARE COMPUTED HERE AND NOWHERE ELSE. CLAUDE.md forbids the web
 * tier from calculating charges at all, and `adjustments` deliberately carries
 * the voided rows too — so the array cannot be summed naively to recover them.
 * They are computed in `BigInt` rather than `number`: an amount above 2^53 is
 * storable in `BIGINT` and is not representable as a JavaScript number, and
 * "silently" is the part that matters for money.
 *
 * `service_date` is read as `::text` rather than as a `date`. Prisma maps a
 * PostgreSQL `DATE` onto a JavaScript `Date` at UTC midnight, and every
 * conversion back through a local timezone is a chance for the clinic day a
 * charge belongs to to move by one. The digits are the value.
 */

/** Every column of a charge, in the order the table declares them. */
export const CHARGE_COLUMNS = Prisma.sql`
  id, family_id, child_id, appointment_id, appointment_participant_id,
  service_id, therapist_id, duration_minutes, service_date::text AS service_date,
  tariff_id, price_mode::text AS price_mode, amount_toman,
  created_at, created_by_user_id, voided_at, voided_by_user_id, void_reason
`;

export type ChargeRow = {
  id: string;
  family_id: string;
  child_id: string;
  appointment_id: string;
  appointment_participant_id: string;
  service_id: string;
  therapist_id: string;
  duration_minutes: number;
  service_date: string;
  tariff_id: string;
  price_mode: TariffPriceMode;
  amount_toman: bigint;
  created_at: Date;
  created_by_user_id: string;
  voided_at: Date | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
};

const ADJUSTMENT_COLUMNS = Prisma.sql`
  id, session_charge_id, amount_toman, therapist_discount_toman, clinic_discount_toman,
  reason, created_at, created_by_user_id, voided_at, voided_by_user_id, void_reason
`;

type AdjustmentRow = {
  id: string;
  session_charge_id: string;
  amount_toman: bigint;
  therapist_discount_toman: bigint;
  clinic_discount_toman: bigint;
  reason: string;
  created_at: Date;
  created_by_user_id: string;
  voided_at: Date | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
};

export type LedgerClient = PrismaService | Prisma.TransactionClient;

/**
 * The valid — that is, unvoided — charge for one seat, if there is one.
 *
 * The predicate matches `session_charge_one_valid_per_participant_uq` exactly,
 * which is what makes "at most one row can come back" a property of the database
 * rather than of this query. A seat's voided charges stay in the table and are
 * deliberately not returned: they are history, not what the family owes.
 */
export async function findValidChargeForParticipant(
  client: LedgerClient,
  participantId: string,
): Promise<ChargeRow | undefined> {
  const rows = await client.$queryRaw<ChargeRow[]>`
    SELECT ${CHARGE_COLUMNS} FROM session_charge
    WHERE appointment_participant_id = ${participantId}::uuid AND voided_at IS NULL
  `;

  return rows[0];
}

export async function readChargeRow(client: LedgerClient, chargeId: string): Promise<ChargeRow> {
  const rows = await client.$queryRaw<ChargeRow[]>`
    SELECT ${CHARGE_COLUMNS} FROM session_charge WHERE id = ${chargeId}::uuid
  `;

  const row = rows[0];
  if (row === undefined) throw new AppError('CHARGE_NOT_FOUND');
  return row;
}

/** The charge, its whole adjustment history, and the two sums nobody should compute twice. */
export async function readChargeDetail(
  client: LedgerClient,
  chargeId: string,
): Promise<SessionChargeDetail> {
  const charge = await readChargeRow(client, chargeId);

  const adjustments = await client.$queryRaw<AdjustmentRow[]>`
    SELECT ${ADJUSTMENT_COLUMNS} FROM charge_adjustment
    WHERE session_charge_id = ${chargeId}::uuid
    ORDER BY created_at ASC, id ASC
  `;

  return toChargeDetail(charge, adjustments);
}

function toChargeDetail(
  charge: ChargeRow,
  adjustments: readonly AdjustmentRow[],
): SessionChargeDetail {
  const activeTotal = adjustments
    .filter((one) => one.voided_at === null)
    .reduce((total, one) => total + one.amount_toman, 0n);

  // Never negative: the cumulative bound in `enforce_charge_adjustment_bounds`
  // refuses an adjustment that would take it there, under a lock on this row.
  const effective = charge.amount_toman - activeTotal;

  return {
    ...toSessionCharge(charge),
    adjustments: adjustments.map(toAdjustment),
    activeAdjustmentTotalToman: activeTotal.toString(),
    effectiveAmountToman: effective.toString(),
  };
}

function toSessionCharge(row: ChargeRow) {
  return {
    id: row.id,
    familyId: row.family_id,
    childId: row.child_id,
    appointmentId: row.appointment_id,
    appointmentParticipantId: row.appointment_participant_id,
    serviceId: row.service_id,
    therapistId: row.therapist_id,
    durationMinutes: row.duration_minutes,
    serviceDate: row.service_date,
    tariffId: row.tariff_id,
    priceMode: row.price_mode,
    amountToman: row.amount_toman.toString(),
    createdAt: row.created_at.toISOString(),
    createdByUserId: row.created_by_user_id,
    voidedAt: row.voided_at?.toISOString() ?? null,
    voidedByUserId: row.voided_by_user_id,
    voidReason: row.void_reason,
  };
}

function toAdjustment(row: AdjustmentRow): ChargeAdjustment {
  return {
    id: row.id,
    sessionChargeId: row.session_charge_id,
    amountToman: row.amount_toman.toString(),
    therapistDiscountToman: row.therapist_discount_toman.toString(),
    clinicDiscountToman: row.clinic_discount_toman.toString(),
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
    createdByUserId: row.created_by_user_id,
    voidedAt: row.voided_at?.toISOString() ?? null,
    voidedByUserId: row.voided_by_user_id,
    voidReason: row.void_reason,
  };
}
