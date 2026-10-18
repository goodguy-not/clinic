import { Prisma } from '@prisma/client';
import type { ChargeAdjustment, SessionChargeDetail, TariffPriceMode } from '@clinic/contracts';
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

export type AdjustmentRow = {
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

/**
 * The one charge that represents a seat right now: the valid one if there is
 * one, otherwise the most recently withdrawn.
 *
 * A READ-ONLY REPRESENTATION AND NOT A FINANCIAL FACT. Returning a voided row
 * here does not make it owed — every total in this system is computed from
 * `voided_at IS NULL` and none of them consults this function. What it answers is
 * "what should a screen say about this seat", and for a seat whose charge was
 * withdrawn the honest answer is "there was a charge and it was taken back",
 * not silence. `findValidChargeForParticipant` above is the financial predicate
 * and is unchanged; the posting path still uses that one.
 *
 * THE ORDER IS TOTAL, SO THE ANSWER IS ONE ROW AND ALWAYS THE SAME ROW:
 * 1. `voided_at IS NULL` first — a standing charge always outranks history, and
 *    the partial unique index guarantees there is at most one of them;
 * 2. then `voided_at` descending — of several withdrawn charges, the one
 *    withdrawn last is the one that describes the seat's current situation;
 * 3. then `created_at` descending, for two rows voided in the same transaction
 *    timestamp;
 * 4. then `id` descending, which is a uuidv7 and therefore breaks the last tie by
 *    creation order rather than arbitrarily.
 * The final key alone would settle it; the earlier ones are what make the choice
 * mean something to a reader instead of merely being repeatable.
 */
export async function findCurrentOrLatestChargeForParticipant(
  client: LedgerClient,
  participantId: string,
): Promise<ChargeRow | undefined> {
  const rows = await client.$queryRaw<ChargeRow[]>`
    SELECT ${CHARGE_COLUMNS} FROM session_charge
    WHERE appointment_participant_id = ${participantId}::uuid
    ORDER BY (voided_at IS NULL) DESC, voided_at DESC, created_at DESC, id DESC
    LIMIT 1
  `;

  return rows[0];
}

/**
 * The charge, held `FOR UPDATE` for the rest of the transaction.
 *
 * THE SERIALISATION POINT OF EVERY WRITE TO ONE CHARGE. Two voids of the same row
 * queue here, and the second one re-reads `voided_at` after the first commits —
 * so it reports `CHARGE_ALREADY_VOIDED` against the void that actually happened
 * rather than racing it. The re-read is what makes that true, not the lock alone.
 *
 * A TRANSACTION CLIENT, NOT `LedgerClient`. `FOR UPDATE` outside a transaction
 * takes a lock that is released by the next statement, which reads as protection
 * and is none; requiring the narrower type means that mistake does not compile.
 */
export async function lockChargeRow(
  tx: Prisma.TransactionClient,
  chargeId: string,
): Promise<ChargeRow> {
  const rows = await tx.$queryRaw<ChargeRow[]>`
    SELECT ${CHARGE_COLUMNS} FROM session_charge WHERE id = ${chargeId}::uuid
    FOR UPDATE
  `;

  const row = rows[0];
  if (row === undefined) throw new AppError('CHARGE_NOT_FOUND');
  return row;
}

/**
 * What the active adjustments against one charge already take off it.
 *
 * ONLY MEANINGFUL UNDER `lockChargeRow`. The number it returns is the basis of
 * the affordability decision, and a total read without the parent lock is a
 * total another transaction may already have invalidated — which is the exact
 * race `enforce_charge_adjustment_bounds` was written to survive. The predicate
 * matches that trigger's: voided adjustments have no financial effect and are
 * not counted, whatever they still say.
 */
export async function sumActiveAdjustments(
  tx: Prisma.TransactionClient,
  chargeId: string,
): Promise<bigint> {
  const rows = await tx.$queryRaw<{ total: bigint }[]>`
    SELECT coalesce(sum(amount_toman), 0)::bigint AS total FROM charge_adjustment
    WHERE session_charge_id = ${chargeId}::uuid AND voided_at IS NULL
  `;

  return rows[0]?.total ?? 0n;
}

/**
 * What the active concessions against one charge take off the THERAPIST — the
 * other side of `sumActiveAdjustments`, over the same rows.
 *
 * THE ONE STATEMENT OF "HOW MUCH OF THIS SESSION'S SHARE IS ALREADY GIVEN
 * AWAY", and it is deliberately one rather than three. It bounds a new
 * therapist-borne portion (`ChargeAdjustmentsService.create`), it is what
 * `enforce_charge_adjustment_bounds` re-computes in SQL under the same lock, and
 * it is what tells `SessionRatingService` whether a rating still has
 * allocations standing against it. A second implementation would be a second
 * answer to "what does this therapist net", and the two would disagree on
 * exactly the row somebody disputes.
 *
 * THE PREDICATE IS THE SAME `voided_at IS NULL` EVERY TOTAL HERE USES.
 * Withdrawing a concession gives the share back, in full, by the read — no
 * number is written anywhere that could disagree.
 *
 * ONLY MEANINGFUL UNDER `lockChargeRow`, for the reason `sumActiveAdjustments`
 * is: it is the basis of a decision, and a total read without the parent lock is
 * one another transaction may already have invalidated.
 */
export async function sumActiveTherapistAllocations(
  tx: Prisma.TransactionClient,
  chargeId: string,
): Promise<bigint> {
  const rows = await tx.$queryRaw<{ total: bigint }[]>`
    SELECT coalesce(sum(therapist_discount_toman), 0)::bigint AS total FROM charge_adjustment
    WHERE session_charge_id = ${chargeId}::uuid AND voided_at IS NULL
  `;

  return rows[0]?.total ?? 0n;
}

/**
 * One adjustment of one charge, held `FOR UPDATE`.
 *
 * NAMED BY BOTH IDS, and the parent is part of the predicate rather than
 * checked afterwards: an adjustment id that belongs to a different charge is not
 * "found and rejected", it is simply not this charge's adjustment, and
 * `ADJUSTMENT_NOT_FOUND` is the honest answer. It also means the route cannot be
 * used to void an arbitrary adjustment by guessing a charge.
 *
 * THE CALLER MUST ALREADY HOLD THE PARENT CHARGE'S LOCK. Every write in this
 * module takes `session_charge` first and `charge_adjustment` second, so two
 * transactions touching the same charge can never hold one another's next lock.
 */
export async function lockAdjustmentRow(
  tx: Prisma.TransactionClient,
  chargeId: string,
  adjustmentId: string,
): Promise<AdjustmentRow> {
  const rows = await tx.$queryRaw<AdjustmentRow[]>`
    SELECT ${ADJUSTMENT_COLUMNS} FROM charge_adjustment
    WHERE id = ${adjustmentId}::uuid AND session_charge_id = ${chargeId}::uuid
    FOR UPDATE
  `;

  const row = rows[0];
  if (row === undefined) throw new AppError('ADJUSTMENT_NOT_FOUND');
  return row;
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

/**
 * The charge, its history and its two sums, from rows the caller already has.
 *
 * EXPORTED SO THE FAMILY ACCOUNT USES THIS ARITHMETIC AND NOT ITS OWN. That read
 * fetches a page of charges and their adjustments in two statements rather than
 * one detail lookup per row, so it cannot call `readChargeDetail`; what it must
 * not do is recompute `effectiveAmountToman`, because a second implementation is
 * a second answer to the only question a family asks.
 */
export function toChargeDetail(
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
    // M10.5 P1.0: the contract freezes the kind before the column exists; every
    // row of a pre-phase-1 database is a session charge. P1.1 reads the column.
    kind: 'SESSION' as const,
    penaltyPercent: null,
    sessionPriceToman: null,
    noShowDecisionId: null,
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

/**
 * WHICH OF THESE SEATS CARRY A VALID CHARGE — the plural of
 * `findValidChargeForParticipant`, and deliberately the SAME predicate.
 *
 * `voided_at IS NULL` is the whole of "valid" in this system: it is what
 * `session_charge_one_valid_per_participant_uq` is partial on, what
 * `ChargeLifecycleGuard` refuses on, and what makes a re-post idempotent rather
 * than blocked. The Milestone 7 dashboard has to answer "which completed,
 * attended seats of this clinic day are unbilled?", which is that predicate
 * asked of a set instead of a row.
 *
 * IT RETURNS THE CHARGED SEATS, NOT A COUNT OF THE UNCHARGED ONES. The caller
 * knows which seats it asked about; deriving "uncharged" here would put a
 * dashboard's reading of eligibility inside the ledger, and eligibility —
 * `COMPLETED` and `ATTENDED` — is the appointment's fact, not this file's.
 *
 * ONE STATEMENT FOR THE WHOLE DAY. Calling the singular form per seat is an N+1
 * on the screen the clinic keeps open all morning.
 *
 * IT IS A READ AND CREATES NOTHING. No lock is taken: the dashboard decides
 * nothing, so a charge posted a millisecond later is simply the next refresh's
 * answer.
 */
export async function findParticipantsWithValidCharge(
  client: LedgerClient,
  participantIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (participantIds.length === 0) return new Set();

  const rows = await client.$queryRaw<{ appointment_participant_id: string }[]>`
    SELECT appointment_participant_id FROM session_charge
    WHERE appointment_participant_id = ANY(${[...participantIds]}::uuid[])
      AND voided_at IS NULL
  `;

  return new Set(rows.map((row) => row.appointment_participant_id));
}

/** What a set of charges is worth, before and after the concessions against them. */
export type ChargeTotalsRow = {
  charged_total: bigint;
  adjustment_total: bigint;
  charge_count: number;
  voided_charge_count: number;
};

/**
 * THE FOUR AGGREGATES, AND THE ROWS THEY ARE TAKEN OVER, AS TWO FRAGMENTS.
 *
 * SPLIT OUT OF `readChargeTotals` BELOW WITHOUT CHANGING A CHARACTER OF THE SQL,
 * so that a caller needing the same arithmetic PER FAMILY rather than over one
 * set — the Milestone 7 family-accounts report, which has to order and page
 * families by what each of them owes — adds a narrowing of its own and reuses
 * these, instead of writing a second `FILTER (WHERE c.voided_at IS NULL)` that a
 * later correction could forget to apply twice.
 *
 * THIS IS NOT A QUERY BUILDER. Two fragments exist because there are exactly two
 * shapes of this question in the system — over a set, and once per family — and
 * both are answered from one statement of what a valid charge and an active
 * concession are.
 *
 * WRITTEN AGAINST THE ALIAS `c`, exactly as `narrowing` always has been;
 * `active` is the lateral the adjustment sum rides on.
 */
export const CHARGE_TOTALS_COLUMNS = Prisma.sql`
  coalesce(sum(c.amount_toman) FILTER (WHERE c.voided_at IS NULL), 0)::bigint
    AS charged_total,
  coalesce(sum(active.total) FILTER (WHERE c.voided_at IS NULL), 0)::bigint
    AS adjustment_total,
  count(*) FILTER (WHERE c.voided_at IS NULL)::int AS charge_count,
  count(*) FILTER (WHERE c.voided_at IS NOT NULL)::int AS voided_charge_count
`;

export const CHARGE_TOTALS_SOURCE = Prisma.sql`
  FROM session_charge c
  JOIN LATERAL (
    SELECT coalesce(sum(a.amount_toman), 0)::bigint AS total
    FROM charge_adjustment a
    WHERE a.session_charge_id = c.id AND a.voided_at IS NULL
  ) active ON TRUE
`;

/**
 * WHAT A SET OF CHARGES IS WORTH, IN ONE STATEMENT AND ONE PLACE.
 *
 * Lifted out of `FamilyAccountService` unchanged when Milestone 7 needed the
 * same arithmetic over a clinic day rather than over one family. "Which charges
 * count, and which concessions reduce them" now has ONE implementation in this
 * system: the family account's filtered totals, the whole-family position and
 * the dashboard's clinic-wide charge block cannot disagree about what a voided
 * charge or a withdrawn concession means, because they are the same SQL.
 *
 * `FILTER (WHERE c.voided_at IS NULL)` on both sums is the whole of "a voided
 * charge contributes nothing": it removes the charge from `charged_total` and,
 * because the lateral total rides on the same row, removes every concession
 * against it from `adjustment_total` in the same breath. The lateral sums only
 * unvoided adjustments, so a withdrawn concession stays in the history and
 * reduces nothing here.
 *
 * `narrowing` IS THE CALLER'S WHOLE PREDICATE, written against the alias `c`.
 * It is the one thing that differs between a family's account and a clinic's
 * day, and it is a `Prisma.Sql` fragment the caller builds from parameterised
 * values — never string concatenation.
 *
 * Counted and summed in `BIGINT`, because an amount above 2^53 is storable and
 * is not representable as a JavaScript number. The two COUNTs are cast to `int`
 * because they are row counts, not money.
 */
export async function readChargeTotals(
  client: LedgerClient,
  narrowing: Prisma.Sql,
): Promise<ChargeTotalsRow> {
  const rows = await client.$queryRaw<ChargeTotalsRow[]>`
    SELECT ${CHARGE_TOTALS_COLUMNS}
    ${CHARGE_TOTALS_SOURCE}
    WHERE ${narrowing}
  `;

  return (
    rows[0] ?? {
      charged_total: 0n,
      adjustment_total: 0n,
      charge_count: 0,
      voided_charge_count: 0,
    }
  );
}
