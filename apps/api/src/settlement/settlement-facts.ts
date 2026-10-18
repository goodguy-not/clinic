import { Prisma } from '@prisma/client';
import type { RatedVia, SessionChargeKind, TariffPriceMode } from '@clinic/contracts';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * THE ONE RECONCILIATION MODEL. What one session is worth to each side RIGHT
 * NOW, and how much of that a closed period already carries.
 *
 * ------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL. Checkpoint C5 derived a therapist's earnings by
 * reading three kinds of row; checkpoint C6 MATERIALISES those figures when a
 * period is closed, and then has to reconcile the materialised history against
 * the live rows for ever afterwards. Two pieces of code deriving "what is this
 * session worth" would be two answers to one question, and the day they
 * disagreed would be the day a correction was written for an amount nobody could
 * account for. So there is one statement, here, and both the statement read and
 * the close write ask it — differing only in WHICH SESSIONS they ask about.
 * ------------------------------------------------------------------------
 * THE CURRENT AUTHORITATIVE FIGURES, AND THE THREE ROWS THEY COME FROM.
 *
 *   * `session_settlement` — the APPLIED share, frozen when somebody rated the
 *     session (C3), read as stored. `therapist_share_rule` IS NOT JOINED IN THIS
 *     FILE and `resolveShareRuleRow` is not imported: a later change to the
 *     agreement restates nothing, which is the single failure this milestone
 *     exists to make impossible — and it is also why a share-rule change ALONE
 *     can never produce a settlement correction.
 *   * `session_charge` — whether the session still counts. A WITHDRAWN CHARGE
 *     ZEROES EVERY CURRENT FIGURE rather than dropping the row, because a
 *     session that was settled before its charge was withdrawn still has closed
 *     history to reconcile against, and the reconciliation needs the zero
 *     stated, not the row missing.
 *   * `charge_adjustment` — the family's concessions and how each was allocated
 *     between the two sides (C4). Only ACTIVE rows reduce anything.
 *
 * NO PAYMENT, PROMISE OR BALANCE IS READ. Settlement is completed-session value
 * and is independent of whether or when a family pays (CLAUDE.md).
 * ------------------------------------------------------------------------
 * THE SETTLED FIGURES, WHICH ARE THE C6 HALF.
 *
 * `settled_*` is the sum of the session's materialised `settlement_line` rows —
 * its one `PRIMARY` plus every later `CORRECTION` — and `primary_line_id` names
 * the `PRIMARY` if there is one. THE INVARIANT THE WHOLE CHECKPOINT RESTS ON is
 * that after every close those sums equal the current figures above; the gap
 * between them, when there is one, is exactly the correction the NEXT close must
 * carry. Both are read in one row precisely so the gap is a subtraction rather
 * than a reconciliation.
 *
 * The lateral is unfiltered — every line of the charge, from every period —
 * because a closed line is never voided, never edited and never deleted. There
 * is no `voided_at IS NULL` to apply and no column that could carry one.
 * ------------------------------------------------------------------------
 * `service_date` AND `price_mode` ARE READ AS `::text`. Prisma maps a PostgreSQL
 * `DATE` onto a JavaScript `Date` at UTC midnight, and every conversion back
 * through a local timezone is a chance for the clinic day to move by one. The
 * digits are the value.
 */

/** One session, as both the statement and the close need to see it. */
export type SettlementFactRow = {
  session_settlement_id: string;
  session_charge_id: string;
  appointment_participant_id: string;
  /** The session the charge belongs to (M10.5): lines of one session group by it. */
  appointment_id: string;
  /** `SESSION` or `NO_SHOW_PENALTY`, with the penalty's percent (null otherwise). */
  charge_kind: SessionChargeKind;
  penalty_percent: number | null;
  therapist_id: string;
  service_date: string;
  service_id: string;
  service_name: string;
  duration_minutes: number;
  price_mode: TariffPriceMode;
  applied_share_basis_points: number;
  rated_via: RatedVia;
  charge_voided: boolean;
  /** What the session is worth NOW. Zeroed throughout for a withdrawn charge. */
  base_amount_toman: bigint;
  therapist_gross_toman: bigint;
  therapist_discount_toman: bigint;
  clinic_gross_toman: bigint;
  clinic_discount_toman: bigint;
  /** What closed periods already carry. Zero for a session never settled. */
  settled_base_toman: bigint;
  settled_therapist_gross_toman: bigint;
  settled_therapist_discount_toman: bigint;
  settled_therapist_net_toman: bigint;
  settled_clinic_gross_toman: bigint;
  settled_clinic_discount_toman: bigint;
  settled_clinic_net_toman: bigint;
  primary_line_id: string | null;
  correction_line_count: number;
};

/**
 * The seven figures a `PRIMARY` line records and a `CORRECTION` line moves.
 *
 * The two nets are DERIVED HERE AND NOWHERE ELSE, by the one subtraction this
 * application performs on settlement money. `therapistNet` is never clamped
 * because it is unclampable — `charge_adjustment_therapist_net_floor` refuses a
 * borne portion that would take it below zero — and `clinicNet` is never clamped
 * because CLAUDE.md requires an explicit clinic subsidy to be VISIBLE as the
 * negative number it is.
 */
export type SettlementAmounts = {
  readonly baseAmountToman: bigint;
  readonly therapistGrossToman: bigint;
  readonly therapistDiscountToman: bigint;
  readonly therapistNetToman: bigint;
  readonly clinicGrossToman: bigint;
  readonly clinicDiscountToman: bigint;
  readonly clinicNetToman: bigint;
};

export function currentAmounts(row: SettlementFactRow): SettlementAmounts {
  return amountsOf(
    row.base_amount_toman,
    row.therapist_gross_toman,
    row.therapist_discount_toman,
    row.clinic_gross_toman,
    row.clinic_discount_toman,
  );
}

export function settledAmounts(row: SettlementFactRow): SettlementAmounts {
  return {
    baseAmountToman: row.settled_base_toman,
    therapistGrossToman: row.settled_therapist_gross_toman,
    therapistDiscountToman: row.settled_therapist_discount_toman,
    therapistNetToman: row.settled_therapist_net_toman,
    clinicGrossToman: row.settled_clinic_gross_toman,
    clinicDiscountToman: row.settled_clinic_discount_toman,
    clinicNetToman: row.settled_clinic_net_toman,
  };
}

/**
 * Current less settled: the movement no closed period carries yet.
 *
 * Subtracted column by column rather than only on the net, because a
 * `CORRECTION` line has to state WHY the net moved — a concession granted and a
 * charge withdrawn produce the same net delta from completely different columns,
 * and a reader of the closed record has to be able to tell them apart.
 */
export function subtractAmounts(
  left: SettlementAmounts,
  right: SettlementAmounts,
): SettlementAmounts {
  return {
    baseAmountToman: left.baseAmountToman - right.baseAmountToman,
    therapistGrossToman: left.therapistGrossToman - right.therapistGrossToman,
    therapistDiscountToman: left.therapistDiscountToman - right.therapistDiscountToman,
    therapistNetToman: left.therapistNetToman - right.therapistNetToman,
    clinicGrossToman: left.clinicGrossToman - right.clinicGrossToman,
    clinicDiscountToman: left.clinicDiscountToman - right.clinicDiscountToman,
    clinicNetToman: left.clinicNetToman - right.clinicNetToman,
  };
}

export function isZeroAmounts(amounts: SettlementAmounts): boolean {
  return (
    amounts.baseAmountToman === 0n &&
    amounts.therapistGrossToman === 0n &&
    amounts.therapistDiscountToman === 0n &&
    amounts.therapistNetToman === 0n &&
    amounts.clinicGrossToman === 0n &&
    amounts.clinicDiscountToman === 0n &&
    amounts.clinicNetToman === 0n
  );
}

function amountsOf(
  base: bigint,
  therapistGross: bigint,
  therapistDiscount: bigint,
  clinicGross: bigint,
  clinicDiscount: bigint,
): SettlementAmounts {
  return {
    baseAmountToman: base,
    therapistGrossToman: therapistGross,
    therapistDiscountToman: therapistDiscount,
    therapistNetToman: therapistGross - therapistDiscount,
    clinicGrossToman: clinicGross,
    clinicDiscountToman: clinicDiscount,
    clinicNetToman: clinicGross - clinicDiscount,
  };
}

/**
 * Every session of one therapist that the caller's scope selects, with both
 * halves of the reconciliation on each row.
 *
 * IT IS DRIVEN FROM THE STANDING RATING, NOT FROM THE CHARGE. A session with no
 * standing rating is UNRATED — the absence of a row, never a zero — and has no
 * settlement figures of any kind; it is reported as an exception count by the
 * statement and as `excludedUnratedSessionCount` by a close, and it is never
 * given a line. `session_settlement_one_valid_per_charge_uq` makes
 * `voided_at IS NULL` yield at most one rating per charge, so no `DISTINCT` is
 * needed and a therapist cannot appear twice for one session.
 *
 * THE SCOPE IS A PREDICATE OVER THE FINISHED ROW, applied outside the derivation
 * so that a caller can filter on `primary_line_id` and on the settled sums as
 * easily as on the clinic day. That is what lets the close ask for "sessions
 * never settled" and "sessions already settled" with the same statement the
 * statement read uses, instead of a second one that could drift from it.
 *
 * A SCOPE THAT FILTERS ON THE CLINIC DAY MUST CAST IT: `service_date` is
 * selected as `::text` for the reason given above, so `fact.service_date::date`
 * is what a range predicate compares. Stated here because the alternative — a
 * second `date` column in the row purely to be filtered on — is a `DATE` Prisma
 * would hand back as a JavaScript `Date` at UTC midnight, which is the exact
 * timezone trap the `::text` exists to close.
 *
 * THE ORDER IS TOTAL: the clinic day, then the charge id, which is a uuidv7 and
 * therefore breaks the tie by the order the charges were posted. Ordering the
 * text form is ordering the dates, because an ISO calendar day sorts
 * lexicographically exactly as it sorts chronologically.
 */
export async function readSettlementFacts(
  client: PrismaService | Prisma.TransactionClient,
  therapistId: string,
  scope: Prisma.Sql,
): Promise<SettlementFactRow[]> {
  return client.$queryRaw<SettlementFactRow[]>`
    SELECT * FROM (
      SELECT
        ss.id AS session_settlement_id,
        ss.session_charge_id,
        ss.appointment_participant_id,
        c.appointment_id,
        -- M10.5 P1.0: no penalty can exist before the phase-1 migration.
        'SESSION'::text AS charge_kind,
        NULL::int AS penalty_percent,
        ss.therapist_id,
        ss.service_date::text AS service_date,
        c.service_id,
        s.name AS service_name,
        c.duration_minutes,
        c.price_mode::text AS price_mode,
        ss.applied_share_basis_points,
        ss.rated_via::text AS rated_via,
        (c.voided_at IS NOT NULL) AS charge_voided,
        CASE WHEN c.voided_at IS NULL THEN ss.base_amount_toman ELSE 0 END::bigint
          AS base_amount_toman,
        CASE WHEN c.voided_at IS NULL THEN ss.therapist_gross_toman ELSE 0 END::bigint
          AS therapist_gross_toman,
        CASE WHEN c.voided_at IS NULL THEN active.therapist_discount_toman ELSE 0 END::bigint
          AS therapist_discount_toman,
        CASE WHEN c.voided_at IS NULL THEN ss.clinic_gross_toman ELSE 0 END::bigint
          AS clinic_gross_toman,
        CASE WHEN c.voided_at IS NULL THEN active.clinic_discount_toman ELSE 0 END::bigint
          AS clinic_discount_toman,
        closed.settled_base_toman,
        closed.settled_therapist_gross_toman,
        closed.settled_therapist_discount_toman,
        closed.settled_therapist_net_toman,
        closed.settled_clinic_gross_toman,
        closed.settled_clinic_discount_toman,
        closed.settled_clinic_net_toman,
        closed.primary_line_id,
        closed.correction_line_count
      FROM session_settlement ss
      JOIN session_charge c ON c.id = ss.session_charge_id
      JOIN service s ON s.id = c.service_id
      JOIN LATERAL (
        SELECT
          coalesce(sum(a.therapist_discount_toman), 0)::bigint AS therapist_discount_toman,
          coalesce(sum(a.clinic_discount_toman), 0)::bigint AS clinic_discount_toman
        FROM charge_adjustment a
        WHERE a.session_charge_id = c.id AND a.voided_at IS NULL
      ) active ON TRUE
      JOIN LATERAL (
        SELECT
          coalesce(sum(l.base_amount_toman), 0)::bigint AS settled_base_toman,
          coalesce(sum(l.therapist_gross_toman), 0)::bigint AS settled_therapist_gross_toman,
          coalesce(sum(l.therapist_discount_toman), 0)::bigint AS settled_therapist_discount_toman,
          coalesce(sum(l.therapist_net_toman), 0)::bigint AS settled_therapist_net_toman,
          coalesce(sum(l.clinic_gross_toman), 0)::bigint AS settled_clinic_gross_toman,
          coalesce(sum(l.clinic_discount_toman), 0)::bigint AS settled_clinic_discount_toman,
          coalesce(sum(l.clinic_net_toman), 0)::bigint AS settled_clinic_net_toman,
          -- array_agg(...)[1] rather than max(...): PostgreSQL has no max for
          -- uuid, and there is at most one PRIMARY line per charge anyway
          -- (settlement_line_one_primary_per_charge_uq), so "the first" is
          -- "the only one".
          (array_agg(l.id) FILTER (WHERE l.line_type = 'PRIMARY'))[1] AS primary_line_id,
          count(*) FILTER (WHERE l.line_type = 'CORRECTION')::int AS correction_line_count
        FROM settlement_line l
        WHERE l.session_charge_id = c.id
      ) closed ON TRUE
      WHERE ss.therapist_id = ${therapistId}::uuid
        AND ss.voided_at IS NULL
    ) fact
    WHERE ${scope}
    ORDER BY fact.service_date ASC, fact.session_charge_id ASC
  `;
}
