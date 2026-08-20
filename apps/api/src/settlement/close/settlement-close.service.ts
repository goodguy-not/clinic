import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CloseSettlementPeriodRequest,
  CloseSettlementPeriodResult,
  RatedVia,
  SettlementLineType,
  SettlementPeriod,
  SettlementPeriodDetailResponse,
  SettlementPeriodLine,
  SettlementPeriodListQuery,
  SettlementPeriodListResponse,
  TariffPriceMode,
} from '@clinic/contracts';
import { AuditService } from '../../audit/audit.service';
import { actorContext } from '../../catalog/catalog-support';
import { AppError } from '../../common/app-error';
import { violatesConstraint } from '../../common/pg-error';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { uuidv7 } from '../../common/uuid';
import { PrismaService } from '../../prisma/prisma.service';
import {
  currentAmounts,
  isZeroAmounts,
  readSettlementFacts,
  settledAmounts,
  subtractAmounts,
  type SettlementAmounts,
  type SettlementFactRow,
} from '../settlement-facts';

/**
 * CLOSING A SETTLEMENT PERIOD: drawing a permanent line under one therapist's
 * earnings for one explicit inclusive range of clinic days.
 *
 * ------------------------------------------------------------------------
 * WHAT A CLOSE ACTUALLY DOES, AND WHY IT IS THE FIRST WRITE IN THIS MILESTONE
 * THAT MATERIALISES ANYTHING.
 *
 * Every settlement figure before this checkpoint was DERIVED on the request that
 * asked for it, and legitimately changed when a concession was granted the next
 * day. A close is the act that makes a set of those figures FINAL: it copies
 * them out of the live rows into `settlement_line`, records the totals on a
 * `settlement_period`, and from that instant nothing can rewrite either. Both
 * tables refuse every UPDATE, carry no-delete and no-truncate triggers, and have
 * no reopen path in this service, in the controller, or in the frozen contract.
 *
 * WHAT IT IS NOT. It records no payout. No money leaves the clinic in Milestone
 * 8, there is no therapist ledger, no payable and no receivable, and
 * `settled_toman` means "closed off in a period" and never "paid". A NEGATIVE
 * period is a net settlement figure — a month whose carried-in corrections
 * outweighed its own work — and is not a debt the therapist owes.
 * ------------------------------------------------------------------------
 * ONE THERAPIST, ONE EXPLICIT RANGE, AND NO CALENDAR SHORTHAND. There is no
 * "close Mordad" and no clinic-wide sweep: a period whose boundaries are
 * computed by whoever asks is a period two callers can disagree about, and the
 * disagreement surfaces as a session settled twice or not at all.
 * ------------------------------------------------------------------------
 * OPTION A — A CLOSE SUCCEEDS WITH UNRATED SESSIONS IN THE RANGE, AND SAYS SO.
 *
 * A clinic that cannot close a month until every last session is decided is a
 * clinic that stops paying people over one forgotten appointment. So an unrated
 * session does not block the close and does not receive a line — it is NOT
 * settled, and it is emphatically NOT settled at zero, which would be a
 * permanent assertion that somebody earned nothing. What the close does instead
 * is COUNT them, on the period, permanently: `excluded_unrated_session_count` is
 * stored rather than recomputed, because recomputing gives a different answer
 * the moment one of them is rated, and the answer that matters is the one that
 * was true when the manager closed.
 *
 * AN OTHERWISE EMPTY CLOSE IS STILL A REAL CLOSE. A range in which the therapist
 * did no work at all produces a period with zero counts and zero amounts, which
 * is a true and useful fact — the range was reviewed and contained nothing — and
 * refusing it would leave a gap indistinguishable from a month nobody got round
 * to.
 * ------------------------------------------------------------------------
 * A HISTORICAL CARRY-IN IS A `PRIMARY` SETTLEMENT, NOT A CORRECTION.
 *
 * A session excluded from an earlier close because nobody had rated it is later
 * rated explicitly. It has never been settled, so when a later close picks it up
 * it gets the `PRIMARY` line it always should have had — with its ORIGINAL
 * service date, which is what makes it identifiable as a carry-in and what stops
 * it being misrepresented as work performed in the later period. The earlier
 * period is not reopened, not rewritten and not consulted for anything except
 * the question below.
 *
 * WHICH EARLIER SESSIONS QUALIFY, AND THE ANSWER IS DELIBERATELY NARROW: only
 * those whose clinic day falls inside a range this therapist has ALREADY HAD
 * CLOSED. A session sitting in a GAP — a range nobody has closed — is left
 * exactly where it is. Gaps are permitted, and sweeping work out of one into a
 * period the manager did not ask for would settle days they never reviewed.
 *
 * `settlement_line_one_primary_per_charge_uq` is what makes "exactly once" a
 * property of the database rather than of this routine being right.
 * ------------------------------------------------------------------------
 * A CORRECTION IS A SIGNED DELTA, DERIVED BY SUBTRACTION, AND NEVER INFERRED
 * FROM CONFIGURATION.
 *
 * For a session a closed `PRIMARY` already carries, the close asks two questions
 * of the SAME row: what is this session worth now, and how much of that do the
 * closed lines already carry? The difference is the correction, column by
 * column. That derivation has three consequences worth stating:
 *
 *   * A LATER SHARE-RULE CHANGE PRODUCES NOTHING. The applied percentage lives
 *     on the rating as a number and is never re-resolved, so editing, voiding or
 *     replacing the agreement moves no figure and therefore creates no line.
 *     `therapist_share_rule` is not joined anywhere in this file or in
 *     `settlement-facts.ts`.
 *   * EVERY CATEGORY THAT CAN LEGITIMATELY MOVE THE VALUE IS COVERED WITHOUT
 *     BEING ENUMERATED — a charge withdrawn, a concession granted or withdrawn,
 *     an applied rating corrected. The close does not ask WHY the number moved;
 *     it asks WHETHER it moved, which is a question with one answer.
 *   * NOTHING HISTORICAL IS MUTATED. The old `PRIMARY` line, the old rating and
 *     the charge are all untouched; the correction is a NEW row in the period
 *     being closed now, naming the `PRIMARY` line it reconciles.
 *
 * THE INVARIANT, WHICH IS THE HEADLINE CLAIM OF THE CHECKPOINT: for every
 * session ever settled, its `PRIMARY` line plus every later `CORRECTION` line
 * equals its current authoritative settlement figures. It holds by construction
 * — a correction is defined as the residual — and
 * `settlement_line_therapist_net_floor` refuses any set of lines that would sum
 * below zero on the therapist side.
 * ------------------------------------------------------------------------
 * CONCURRENCY, IN THREE LAYERS.
 *
 *   1. A TRANSACTION-SCOPED ADVISORY LOCK ON THE THERAPIST. Two closes for one
 *      therapist serialise here, so the second one sees what the first committed
 *      rather than racing it — which is what makes the idempotent answer
 *      correct rather than lucky. It is keyed on the therapist, so closes for
 *      different people never wait for each other.
 *   2. `FOR UPDATE` ON EVERY CANDIDATE CHARGE, IN ID ORDER. This project has one
 *      lock order and it starts at `session_charge`: every rating write and
 *      every concession takes that row first. Taking it here too means a
 *      concession, a charge void or a rating correction committing mid-close
 *      either lands entirely before the close reads or waits entirely until
 *      after it commits — never half in the figures and half out. The id order
 *      is what stops two closes of overlapping candidate sets deadlocking.
 *   3. `settlement_period_no_overlap_excl`, WHICH IS THE FINAL AUTHORITY. Read
 *      -then-write cannot prevent an overlap on its own; the constraint can, and
 *      its violation is translated into `SETTLEMENT_PERIOD_OVERLAP` rather than
 *      recovered from.
 * ------------------------------------------------------------------------
 * IDEMPOTENCE IS EXACT-MATCH ONLY, AND OVERLAP IS NOT IDEMPOTENCE. Repeating the
 * IDENTICAL request — same therapist, same two dates, which is what a
 * double-submitted form produces — answers `ALREADY_CLOSED` with the period that
 * already exists, writes no row and, importantly, WRITES NO SECOND AUDIT EVENT:
 * nothing happened the second time. A range that merely OVERLAPS an existing
 * period is a different request with a different meaning and is refused whole;
 * trimming or merging it silently is how somebody is paid for one session in two
 * months.
 */

/** One line the close is about to materialise, before it has an id. */
type LineDraft = {
  readonly type: SettlementLineType;
  readonly fact: SettlementFactRow;
  readonly amounts: SettlementAmounts;
  readonly correctsSettlementLineId: string | null;
};

type PeriodRow = {
  id: string;
  therapist_id: string;
  period_start: string;
  period_end: string;
  settled_session_count: number;
  carried_in_correction_count: number;
  excluded_unrated_session_count: number;
  therapist_gross_toman: bigint;
  therapist_discount_toman: bigint;
  carried_in_correction_toman: bigint;
  settled_toman: bigint;
  closed_at: Date;
  closed_by_user_id: string;
};

/**
 * One `settlement_line` as stored, plus the two facts a reader needs that the
 * row itself does not carry: the service it was for, and whether its clinic day
 * falls outside the period that settled it.
 *
 * EVERY AMOUNT IS SELECTED, NOT DERIVED. `therapist_net_toman` and
 * `clinic_net_toman` are read from the columns C6 wrote; the subtraction that
 * produced them is not repeated here, and `therapist_share_rule` is not joined,
 * for the reason `settlement-facts.ts` gives at length — a second derivation is
 * a second answer.
 */
type PeriodLineRow = {
  id: string;
  settlement_period_id: string;
  line_type: SettlementLineType;
  corrects_settlement_line_id: string | null;
  session_charge_id: string;
  session_settlement_id: string;
  appointment_participant_id: string;
  therapist_id: string;
  service_date: string;
  carried_in: boolean;
  service_id: string;
  service_name: string;
  duration_minutes: number;
  price_mode: TariffPriceMode;
  applied_share_basis_points: number;
  rated_via: RatedVia;
  base_amount_toman: bigint;
  therapist_gross_toman: bigint;
  therapist_discount_toman: bigint;
  therapist_net_toman: bigint;
  clinic_gross_toman: bigint;
  clinic_discount_toman: bigint;
  clinic_net_toman: bigint;
  created_at: Date;
};

const PERIOD_COLUMNS = Prisma.sql`
  id, therapist_id, period_start::text AS period_start, period_end::text AS period_end,
  settled_session_count, carried_in_correction_count, excluded_unrated_session_count,
  therapist_gross_toman, therapist_discount_toman, carried_in_correction_toman,
  settled_toman, closed_at, closed_by_user_id
`;

@Injectable()
export class SettlementCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Close one therapist's period, or report that the identical one is already
   * closed.
   *
   * EVERYTHING HAPPENS IN ONE TRANSACTION — the period, every line, and the
   * audit fact. A close whose audit row was rolled back would be a permanent
   * financial materialisation nobody is recorded as having decided, and a close
   * whose lines were rolled back would be a total with nothing beneath it. A
   * refusal at any point leaves no period, no line and no audit history at all.
   */
  async close(
    body: CloseSettlementPeriodRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<CloseSettlementPeriodResult> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTherapist(tx, body.therapistId);

      const existing = await this.findExactPeriod(tx, body);
      // Idempotence, and it is decided under the advisory lock so a
      // double-submitted form cannot have both halves believe the range is free.
      // No row is written and no audit event is produced: nothing happened.
      if (existing !== undefined) {
        return { outcome: 'ALREADY_CLOSED' as const, period: toSettlementPeriod(existing) };
      }

      await this.assertNoOverlap(tx, body);
      await this.lockCandidateCharges(tx, body);

      const drafts = [
        ...(await this.primaryDrafts(tx, body)),
        ...(await this.correctionDrafts(tx, body)),
      ];
      const excludedUnratedSessionCount = await this.unratedCount(tx, body);

      const period = await this.insertPeriod(tx, body, drafts, excludedUnratedSessionCount, actor);
      await this.insertLines(tx, period.id, drafts);
      await this.auditClosed(tx, period, actor, context);

      return { outcome: 'CLOSED' as const, period: toSettlementPeriod(period) };
    });
  }

  /**
   * The closed periods of one therapist.
   *
   * NEWEST FIRST, AND NOT PAGED: a therapist accumulates twelve of these a year
   * at a monthly cadence. When both ends of the optional range are given they
   * select periods that INTERSECT it — a period straddling the boundary is still
   * a fact about the range.
   *
   * A READ, taking no lock and writing nothing, including no audit row: audit
   * records financial ACTS, and copying a financial read into an append-only
   * table would build a second undeletable record of who looked at whose
   * earnings.
   */
  async list(query: SettlementPeriodListQuery): Promise<SettlementPeriodListResponse> {
    const filters: Prisma.Sql[] = [Prisma.sql`p.therapist_id = ${query.therapistId}::uuid`];

    if (query.from !== undefined) filters.push(Prisma.sql`p.period_end >= ${query.from}::date`);
    if (query.to !== undefined) filters.push(Prisma.sql`p.period_start <= ${query.to}::date`);

    const therapist = await this.readTherapist(query.therapistId);

    const rows = await this.prisma.$queryRaw<PeriodRow[]>`
      SELECT ${PERIOD_COLUMNS} FROM settlement_period p
      WHERE ${Prisma.join(filters, ' AND ')}
      ORDER BY p.period_start DESC, p.period_end DESC
    `;

    return { therapist, periods: rows.map(toSettlementPeriod) };
  }

  /**
   * ONE CLOSED PERIOD AND THE IMMUTABLE LINES UNDER IT.
   *
   * A PURE READ. It opens no write, records no audit entry and touches no
   * settlement state: reading what a manager already closed is not an act on it,
   * and a read that wrote would put a row in the audit log every time somebody
   * scrolled a screen. Nothing in this method inserts, updates or deletes, and
   * the period and its lines are equally beyond reach of it — a closed period is
   * never reopened and a closed line is never voided, edited or deleted, so
   * there is no state here that a read could even be tempted to repair.
   *
   * THE FIGURES ARE THE ONES C6 MATERIALISED. `readSettlementFacts` — which
   * derives what a session is worth NOW — is deliberately not called: this
   * answers what the period RECORDED, and the two are the same only until the
   * next concession or re-rating, at which point the live derivation would show
   * a detail that no longer added up to the total above it.
   *
   * ONE TRANSACTION AT `RepeatableRead`, matching the statement read, so the
   * period header and its lines are read from one snapshot. A concurrent close
   * of a LATER period cannot alter either — it writes its own rows — but reading
   * the pair atomically is what makes "these lines sum to this period" a claim
   * about the response rather than about timing.
   */
  async detail(periodId: string): Promise<SettlementPeriodDetailResponse> {
    return this.prisma.$transaction(
      async (tx) => {
        const periods = await tx.$queryRaw<PeriodRow[]>`
          SELECT ${PERIOD_COLUMNS} FROM settlement_period p WHERE p.id = ${periodId}::uuid
        `;
        const period = periods[0];
        if (period === undefined) throw new AppError('SETTLEMENT_PERIOD_NOT_FOUND');

        const lines = await tx.$queryRaw<PeriodLineRow[]>`
          SELECT
            l.id,
            l.settlement_period_id,
            l.line_type::text AS line_type,
            l.corrects_settlement_line_id,
            l.session_charge_id,
            l.session_settlement_id,
            l.appointment_participant_id,
            l.therapist_id,
            l.service_date::text AS service_date,
            (l.service_date < p.period_start OR l.service_date > p.period_end) AS carried_in,
            c.service_id,
            s.name AS service_name,
            c.duration_minutes,
            c.price_mode::text AS price_mode,
            l.applied_share_basis_points,
            l.rated_via::text AS rated_via,
            l.base_amount_toman,
            l.therapist_gross_toman,
            l.therapist_discount_toman,
            l.therapist_net_toman,
            l.clinic_gross_toman,
            l.clinic_discount_toman,
            l.clinic_net_toman,
            l.created_at
          FROM settlement_line l
          JOIN settlement_period p ON p.id = l.settlement_period_id
          JOIN session_charge c ON c.id = l.session_charge_id
          JOIN service s ON s.id = c.service_id
          WHERE l.settlement_period_id = ${periodId}::uuid
          ORDER BY l.line_type ASC, l.service_date ASC, l.session_charge_id ASC
        `;

        return {
          therapist: await this.readTherapist(period.therapist_id, tx),
          period: toSettlementPeriod(period),
          lines: lines.map(toPeriodLine),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * The advisory lock, and the existence check that goes with it.
   *
   * `pg_advisory_xact_lock` RATHER THAN A ROW LOCK ON `therapist`, because what
   * is being serialised is not a change to the therapist — it is the decision
   * "does a period already cover these days?", which is a statement about rows
   * that do not exist yet and which therefore no row lock can protect. It is
   * released at commit or rollback by PostgreSQL, never by this code.
   *
   * A THERAPIST WHO HAS LEFT THE CLINIC CAN STILL HAVE A PERIOD CLOSED. Nothing
   * filters on `status`, for the reason `ShareRulesService.lockTherapist` and
   * the statement read both record: they earned what they earned, and the month
   * they worked their notice is exactly the one somebody needs to close after
   * they go.
   */
  private async lockTherapist(tx: Prisma.TransactionClient, therapistId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM therapist WHERE id = ${therapistId}::uuid
    `;

    if (rows[0] === undefined) throw new AppError('THERAPIST_NOT_FOUND');

    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext('settlement_period:' || ${therapistId}::text))
    `;
  }

  private async findExactPeriod(
    tx: Prisma.TransactionClient,
    body: CloseSettlementPeriodRequest,
  ): Promise<PeriodRow | undefined> {
    const rows = await tx.$queryRaw<PeriodRow[]>`
      SELECT ${PERIOD_COLUMNS} FROM settlement_period
      WHERE therapist_id = ${body.therapistId}::uuid
        AND period_start = ${body.from}::date
        AND period_end = ${body.to}::date
    `;

    return rows[0];
  }

  /**
   * A partial overlap is refused, and the named refusal is produced here so the
   * caller learns which act to take rather than reading a constraint name.
   *
   * THE CONSTRAINT REMAINS THE AUTHORITY. This check runs under the advisory
   * lock and so cannot be raced in practice, but `insertPeriod` still translates
   * `settlement_period_no_overlap_excl`, because "cannot happen" and "is refused
   * if it does" are different guarantees.
   */
  private async assertNoOverlap(
    tx: Prisma.TransactionClient,
    body: CloseSettlementPeriodRequest,
  ): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM settlement_period
      WHERE therapist_id = ${body.therapistId}::uuid
        AND daterange(period_start, period_end, '[]')
            && daterange(${body.from}::date, ${body.to}::date, '[]')
      LIMIT 1
    `;

    if (rows[0] !== undefined) throw new AppError('SETTLEMENT_PERIOD_OVERLAP');
  }

  /**
   * Every charge this close could possibly touch, held `FOR UPDATE` in id order.
   *
   * THE SUPERSET IS DELIBERATE AND IS THE CHEAP HALF OF THE GUARANTEE: the range
   * itself, every charge already carrying a settlement line, and every charge
   * inside a range this therapist has already had closed. Locking a charge that
   * turns out not to be a candidate costs a row lock for the length of one
   * transaction; missing one would let a concession commit between the read and
   * the write and produce a closed line that never equalled anything.
   *
   * ID ORDER because two overlapping closes — different ranges, shared carry-in
   * candidates — would otherwise be able to hold each other's rows.
   */
  private async lockCandidateCharges(
    tx: Prisma.TransactionClient,
    body: CloseSettlementPeriodRequest,
  ): Promise<void> {
    await tx.$executeRaw`
      SELECT c.id FROM session_charge c
      WHERE c.therapist_id = ${body.therapistId}::uuid
        AND (
          c.service_date BETWEEN ${body.from}::date AND ${body.to}::date
          OR EXISTS (SELECT 1 FROM settlement_line l WHERE l.session_charge_id = c.id)
          OR EXISTS (
            SELECT 1 FROM settlement_period p
            WHERE p.therapist_id = ${body.therapistId}::uuid
              AND c.service_date BETWEEN p.period_start AND p.period_end
          )
        )
      ORDER BY c.id
      FOR UPDATE
    `;
  }

  /**
   * Sessions being settled for the first time: this range's own work, plus the
   * historical carry-ins described in the header.
   *
   * `charge_voided = false` because a session whose charge was withdrawn before
   * anybody settled it has nothing to settle — there is no basis, and a line of
   * zeroes would assert that the clinic reviewed and finalised a session it had
   * taken back. Once a session HAS been settled the opposite applies, and that
   * case is `correctionDrafts` below.
   */
  private async primaryDrafts(
    tx: Prisma.TransactionClient,
    body: CloseSettlementPeriodRequest,
  ): Promise<LineDraft[]> {
    const facts = await readSettlementFacts(
      tx,
      body.therapistId,
      Prisma.sql`
        fact.primary_line_id IS NULL
        AND fact.charge_voided = false
        AND (
          fact.service_date::date BETWEEN ${body.from}::date AND ${body.to}::date
          OR EXISTS (
            SELECT 1 FROM settlement_period p
            WHERE p.therapist_id = ${body.therapistId}::uuid
              AND fact.service_date::date BETWEEN p.period_start AND p.period_end
          )
        )
      `,
    );

    return facts.map((fact) => ({
      type: 'PRIMARY' as const,
      fact,
      amounts: currentAmounts(fact),
      correctsSettlementLineId: null,
    }));
  }

  /**
   * Sessions a closed `PRIMARY` already carries, whose current value has moved.
   *
   * `service_date <= to` KEEPS A CLOSE FROM REACHING FORWARD. A pending movement
   * against a session dated after this range belongs to a period covering later
   * work; pulling it back would put a correction in a period that ends before the
   * session it corrects happened.
   *
   * THE RESIDUAL IS THE WHOLE TEST. A session whose figures have not moved has a
   * zero delta in all seven columns and produces no line — closing the same
   * range twice over an unchanged clinic writes no corrections, and neither does
   * a share rule edited in between.
   */
  private async correctionDrafts(
    tx: Prisma.TransactionClient,
    body: CloseSettlementPeriodRequest,
  ): Promise<LineDraft[]> {
    const facts = await readSettlementFacts(
      tx,
      body.therapistId,
      Prisma.sql`
        fact.primary_line_id IS NOT NULL
        AND fact.service_date::date <= ${body.to}::date
      `,
    );

    return facts
      .map((fact) => ({
        type: 'CORRECTION' as const,
        fact,
        amounts: subtractAmounts(currentAmounts(fact), settledAmounts(fact)),
        // Never null on a `CORRECTION` line, and the scope above is what
        // guarantees it; `settlement_line_type_linkage_chk` refuses the row if
        // this ever became untrue.
        correctsSettlementLineId: fact.primary_line_id,
      }))
      .filter((draft) => !isZeroAmounts(draft.amounts));
  }

  /**
   * Charged sessions in the range that no standing rating covers.
   *
   * THE SAME `NOT EXISTS` OVER THE SAME PARTIAL-UNIQUE PREDICATE the statement's
   * `unratedSessionCount` uses, so the number a manager reads before closing and
   * the number the close records cannot drift apart. It is counted at the moment
   * of closing and stored, never recomputed afterwards.
   *
   * SCOPED TO THE RANGE AND NOT TO THE CARRY-INS. A session still unrated inside
   * an EARLIER closed period was already counted by that period; counting it
   * again here would make the same omission appear twice in a year's records.
   */
  private async unratedCount(
    tx: Prisma.TransactionClient,
    body: CloseSettlementPeriodRequest,
  ): Promise<number> {
    const rows = await tx.$queryRaw<{ total: number }[]>`
      SELECT count(*)::int AS total
      FROM session_charge c
      WHERE c.therapist_id = ${body.therapistId}::uuid
        AND c.voided_at IS NULL
        AND c.service_date BETWEEN ${body.from}::date AND ${body.to}::date
        AND NOT EXISTS (
          SELECT 1 FROM session_settlement ss
          WHERE ss.session_charge_id = c.id AND ss.voided_at IS NULL
        )
    `;

    return rows[0]?.total ?? 0;
  }

  /**
   * The period row, with its totals computed from the drafts that are about to
   * become its lines.
   *
   * THE GROSS AND THE BORNE PORTION DESCRIBE THIS PERIOD'S OWN `PRIMARY` LINES
   * AND NOTHING ELSE, which is why both are unsigned; the corrections are stated
   * separately and signed, so the closed record itself distinguishes this
   * period's work from last period's movement. `settled_toman` is the two
   * together and is re-derived by `settlement_period_totals_chk`, so the stated
   * total cannot drift from its own components.
   *
   * SUMMED IN `bigint`. A month of sessions is nowhere near 2^53, but the day a
   * figure here is quietly wrong is the day somebody's earnings are quietly
   * wrong, and `number` is the only reason that could happen.
   *
   * `closed_at` comes from `transaction_timestamp()` rather than from Node, so
   * the period and the audit row recording it carry the same instant.
   */
  private async insertPeriod(
    tx: Prisma.TransactionClient,
    body: CloseSettlementPeriodRequest,
    drafts: readonly LineDraft[],
    excludedUnratedSessionCount: number,
    actor: ResolvedSession,
  ): Promise<PeriodRow> {
    const primaries = drafts.filter((draft) => draft.type === 'PRIMARY');
    const corrections = drafts.filter((draft) => draft.type === 'CORRECTION');

    const sum = (of: readonly LineDraft[], pick: (a: SettlementAmounts) => bigint): bigint =>
      of.reduce((running, draft) => running + pick(draft.amounts), 0n);

    const therapistGross = sum(primaries, (a) => a.therapistGrossToman);
    const therapistDiscount = sum(primaries, (a) => a.therapistDiscountToman);
    const carriedIn = sum(corrections, (a) => a.therapistNetToman);
    const id = uuidv7();

    try {
      const rows = await tx.$queryRaw<PeriodRow[]>`
        INSERT INTO settlement_period (
          id, therapist_id, period_start, period_end,
          settled_session_count, carried_in_correction_count, excluded_unrated_session_count,
          therapist_gross_toman, therapist_discount_toman, carried_in_correction_toman,
          settled_toman, closed_at, closed_by_user_id
        ) VALUES (
          ${id}::uuid,
          ${body.therapistId}::uuid,
          ${body.from}::date,
          ${body.to}::date,
          ${primaries.length},
          ${corrections.length},
          ${excludedUnratedSessionCount},
          ${therapistGross.toString()}::bigint,
          ${therapistDiscount.toString()}::bigint,
          ${carriedIn.toString()}::bigint,
          ${(therapistGross - therapistDiscount + carriedIn).toString()}::bigint,
          transaction_timestamp(),
          ${actor.userId}::uuid
        )
        RETURNING ${PERIOD_COLUMNS}
      `;

      const inserted = rows[0];
      if (inserted === undefined) throw new AppError('INTERNAL_ERROR');
      return inserted;
    } catch (error) {
      // Translated rather than recovered from: a failed statement aborts the
      // PostgreSQL transaction, so there is nothing to retry inside it.
      if (violatesConstraint(error, 'settlement_period_no_overlap_excl')) {
        throw new AppError('SETTLEMENT_PERIOD_OVERLAP');
      }

      throw error;
    }
  }

  /**
   * The lines, in the order they will be read: this period's work and its
   * carry-ins by clinic day, then the corrections.
   *
   * `session_settlement_id` NAMES THE RATING THE LINE WAS MATERIALISED FROM,
   * which on a `CORRECTION` is the rating that STANDS NOW — the replacement,
   * after a rating correction. The `PRIMARY` keeps naming the rating it was
   * built from, withdrawn or not, and `corrects_settlement_line_id` is what ties
   * the two together. That is the traceability the closed record needs: from any
   * correction, the historical settlement fact it reconciles.
   */
  private async insertLines(
    tx: Prisma.TransactionClient,
    periodId: string,
    drafts: readonly LineDraft[],
  ): Promise<void> {
    for (const draft of drafts) {
      await tx.$executeRaw`
        INSERT INTO settlement_line (
          id, settlement_period_id, line_type, session_charge_id, session_settlement_id,
          appointment_participant_id, therapist_id, service_date,
          applied_share_basis_points, rated_via,
          base_amount_toman, therapist_gross_toman, therapist_discount_toman,
          therapist_net_toman, clinic_gross_toman, clinic_discount_toman, clinic_net_toman,
          corrects_settlement_line_id, created_at
        ) VALUES (
          ${uuidv7()}::uuid,
          ${periodId}::uuid,
          ${draft.type}::settlement_line_type,
          ${draft.fact.session_charge_id}::uuid,
          ${draft.fact.session_settlement_id}::uuid,
          ${draft.fact.appointment_participant_id}::uuid,
          ${draft.fact.therapist_id}::uuid,
          ${draft.fact.service_date}::date,
          ${draft.fact.applied_share_basis_points},
          ${draft.fact.rated_via}::session_rated_via,
          ${draft.amounts.baseAmountToman.toString()}::bigint,
          ${draft.amounts.therapistGrossToman.toString()}::bigint,
          ${draft.amounts.therapistDiscountToman.toString()}::bigint,
          ${draft.amounts.therapistNetToman.toString()}::bigint,
          ${draft.amounts.clinicGrossToman.toString()}::bigint,
          ${draft.amounts.clinicDiscountToman.toString()}::bigint,
          ${draft.amounts.clinicNetToman.toString()}::bigint,
          ${draft.correctsSettlementLineId}::uuid,
          transaction_timestamp()
        )
      `;
    }
  }

  /**
   * The permanent audit fact, written in the same transaction as the close.
   *
   * ONE ACTION, `settlement_period.closed`, and there is deliberately no
   * `settlement_period.reopened` or `settlement_period.updated` in the
   * vocabulary — an action naming an act the product refuses to have reads as a
   * capability it has.
   *
   * NO PER-LINE AUDIT ROW. A line is not independently decided: it exists
   * because the close materialised it, it can never be edited or withdrawn, and
   * it is permanent in a table with its own no-delete trigger. A row per line
   * would multiply an append-only table by the size of a therapist's month to
   * record facts already permanently readable at their source.
   *
   * WHAT IS IN THE PAYLOAD: the range, the three counts and the four amounts —
   * the fact being recorded, in full, which DECISION_LOG 2026-08-09 requires
   * precisely so the trail is usable for the corrections it exists to explain.
   * WHAT IS NOT: no family, child, name or file number. A settlement question is
   * about a therapist and a range of days.
   */
  private async auditClosed(
    tx: Prisma.TransactionClient,
    period: PeriodRow,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<void> {
    await this.audit.record(tx, actorContext(actor, context), {
      action: 'settlement_period.closed',
      entityType: 'settlement_period',
      entityId: period.id,
      after: {
        therapistId: period.therapist_id,
        from: period.period_start,
        to: period.period_end,
        settledSessionCount: period.settled_session_count,
        carriedInCorrectionCount: period.carried_in_correction_count,
        excludedUnratedSessionCount: period.excluded_unrated_session_count,
        therapistGrossToman: period.therapist_gross_toman.toString(),
        therapistDiscountToman: period.therapist_discount_toman.toString(),
        carriedInCorrectionToman: period.carried_in_correction_toman.toString(),
        settledToman: period.settled_toman.toString(),
      },
    });
  }

  private async readTherapist(
    therapistId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<{ id: string; fullName: string }> {
    const rows = await client.$queryRaw<{ id: string; full_name: string }[]>`
      SELECT id, full_name FROM therapist WHERE id = ${therapistId}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('THERAPIST_NOT_FOUND');

    return { id: row.id, fullName: row.full_name };
  }
}

/**
 * `period_start` and `period_end` are selected as `::text`, so they arrive as
 * the digits they are; `toIsoDate` is deliberately not applied to them. Every
 * amount crosses as a canonical decimal string, and `bigint.toString()` produces
 * exactly that form with no negative zero.
 */
export function toSettlementPeriod(row: PeriodRow): SettlementPeriod {
  return {
    id: row.id,
    therapistId: row.therapist_id,
    from: row.period_start,
    to: row.period_end,
    settledSessionCount: row.settled_session_count,
    carriedInCorrectionCount: row.carried_in_correction_count,
    excludedUnratedSessionCount: row.excluded_unrated_session_count,
    therapistGrossToman: row.therapist_gross_toman.toString(),
    therapistDiscountToman: row.therapist_discount_toman.toString(),
    carriedInCorrectionToman: row.carried_in_correction_toman.toString(),
    settledToman: row.settled_toman.toString(),
    closedAt: row.closed_at.toISOString(),
    closedByUserId: row.closed_by_user_id,
  };
}

/**
 * The stored row, as the contract states it.
 *
 * `service_date` and `price_mode` arrive as `::text` and the amounts as
 * `bigint`, both for the reasons `settlement-facts.ts` sets out: a `DATE`
 * through a local timezone can move the clinic day by one, and toman is integer
 * money that JSON cannot carry as a number.
 */
function toPeriodLine(row: PeriodLineRow): SettlementPeriodLine {
  return {
    id: row.id,
    settlementPeriodId: row.settlement_period_id,
    lineType: row.line_type,
    correctsSettlementLineId: row.corrects_settlement_line_id,
    sessionChargeId: row.session_charge_id,
    sessionSettlementId: row.session_settlement_id,
    appointmentParticipantId: row.appointment_participant_id,
    therapistId: row.therapist_id,
    serviceDate: row.service_date,
    carriedIn: row.carried_in,
    serviceId: row.service_id,
    serviceName: row.service_name,
    durationMinutes: row.duration_minutes,
    priceMode: row.price_mode,
    appliedShareBasisPoints: row.applied_share_basis_points,
    ratedVia: row.rated_via,
    baseAmountToman: row.base_amount_toman.toString(),
    therapistGrossToman: row.therapist_gross_toman.toString(),
    therapistDiscountToman: row.therapist_discount_toman.toString(),
    therapistNetToman: row.therapist_net_toman.toString(),
    clinicGrossToman: row.clinic_gross_toman.toString(),
    clinicDiscountToman: row.clinic_discount_toman.toString(),
    clinicNetToman: row.clinic_net_toman.toString(),
    createdAt: row.created_at.toISOString(),
  };
}
