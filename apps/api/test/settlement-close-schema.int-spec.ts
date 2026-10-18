import request from 'supertest';
import { asUser } from './appointments-support';
import { createHarness, resetDatabase, type Harness, ownerPrisma } from './harness';
import {
  closePeriodOverHttp,
  seedCloseClinic,
  MONTH_ONE,
  type CloseFixture,
} from './settlement-support';

/**
 * MILESTONE 8, CHECKPOINT C6 — the closed period and its lines, as PostgreSQL
 * itself enforces them.
 *
 * WHAT THIS SUITE IS FOR, AND WHY IT IS SEPARATE FROM THE BEHAVIOUR SUITE. The
 * behaviour suite proves the close routine does the right thing. This proves
 * that NOTHING ELSE CAN DO THE WRONG THING: every statement below goes straight
 * at the tables, past the service, past the guards, from a connection with the
 * table owner's rights — which is what a repair script, a migration or a
 * debugging session at a psql prompt has. A closed financial figure that is only
 * immutable because the application declines to write it is not immutable.
 *
 * Nothing here is seeded with raw SQL. The one closed period every case starts
 * from is produced by the real endpoint.
 */
describe('the closed settlement period schema (real PostgreSQL)', () => {
  let harness: Harness;
  let fixture: CloseFixture;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    fixture = await seedCloseClinic(harness);
  });

  /** One closed month, with real lines under it. */
  async function closedMonthOne(): Promise<{ periodId: string; lineIds: string[] }> {
    const response = await closePeriodOverHttp(harness, fixture.managerToken, {
      therapistId: fixture.therapistId,
      ...MONTH_ONE,
    });
    expect(response.status).toBe(200);

    const periodId = response.body.period.id as string;
    const lines = await harness.prisma.settlementLine.findMany({
      where: { settlementPeriodId: periodId },
    });

    expect(lines.length).toBeGreaterThan(0);

    return { periodId, lineIds: lines.map((line) => line.id) };
  }

  // -------------------------------------------------------------------------
  // The hand-written objects exist
  // -------------------------------------------------------------------------

  it('carries every hand-written constraint, index and trigger by name', async () => {
    const periodConstraints = await harness.prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE conrelid = 'settlement_period'::regclass
    `;

    expect(periodConstraints.map((row) => row.conname).sort()).toEqual(
      [
        'settlement_period_pkey',
        'settlement_period_therapist_id_fkey',
        'settlement_period_closed_by_user_id_fkey',
        'settlement_period_range_chk',
        'settlement_period_counts_chk',
        'settlement_period_totals_chk',
        // The whole checkpoint rests on this one: no two closed periods of one
        // therapist may cover the same day.
        'settlement_period_no_overlap_excl',
      ].sort(),
    );

    const lineConstraints = await harness.prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE conrelid = 'settlement_line'::regclass
    `;

    expect(lineConstraints.map((row) => row.conname).sort()).toEqual(
      [
        'settlement_line_pkey',
        'settlement_line_period_scope_fkey',
        'settlement_line_charge_snapshot_fkey',
        'settlement_line_rating_scope_fkey',
        'settlement_line_corrects_settlement_line_id_fkey',
        'settlement_line_type_linkage_chk',
        'settlement_line_self_correct_chk',
        'settlement_line_basis_points_chk',
        'settlement_line_split_chk',
        'settlement_line_primary_signs_chk',
        // Two DEFERRED constraint triggers, which PostgreSQL records in
        // `pg_constraint` as well as in `pg_trigger`.
        'settlement_line_enforce_therapist_floor',
        'settlement_line_closed_line_rating_present',
      ].sort(),
    );

    const indexes = await harness.prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'settlement_line'
    `;
    expect(indexes.map((row) => row.indexname)).toContain(
      'settlement_line_one_primary_per_charge_uq',
    );

    // The targets the two composite keys need. Both are keyed on their table's
    // primary key first, so neither can refuse a row the primary key would have
    // accepted.
    const periodIndexes = await harness.prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'settlement_period'
    `;
    expect(periodIndexes.map((row) => row.indexname)).toContain(
      'settlement_period_therapist_scope_uq',
    );

    const periodTriggers = await harness.prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'settlement_period'::regclass AND NOT tgisinternal
    `;
    expect(periodTriggers.map((row) => row.tgname).sort()).toEqual([
      'settlement_period_enforce_immutability',
      'settlement_period_no_delete',
      'settlement_period_no_truncate',
    ]);

    const lineTriggers = await harness.prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'settlement_line'::regclass AND NOT tgisinternal
    `;
    expect(lineTriggers.map((row) => row.tgname).sort()).toEqual([
      'settlement_line_closed_line_rating_present',
      'settlement_line_enforce_immutability',
      'settlement_line_enforce_therapist_floor',
      'settlement_line_no_delete',
      'settlement_line_no_truncate',
    ]);
  });

  // -------------------------------------------------------------------------
  // Immutability, and there is no permitted transition at all
  // -------------------------------------------------------------------------

  describe('a closed period is immutable and is never reopened', () => {
    it('refuses every update to the period, including a harmless-looking one', async () => {
      const { periodId } = await closedMonthOne();

      // Not "refuses a change to the totals" — refuses ANY update. Every other
      // financial table in this schema permits exactly one transition, standing
      // to withdrawn; this one permits none, because a closed period cannot be
      // taken back.
      await expect(
        ownerPrisma().$executeRaw`
          UPDATE settlement_period SET settled_toman = 1 WHERE id = ${periodId}::uuid
        `,
      ).rejects.toThrow(/immutable/);

      await expect(
        ownerPrisma().$executeRaw`
          UPDATE settlement_period SET period_end = period_end WHERE id = ${periodId}::uuid
        `,
      ).rejects.toThrow(/immutable/);
    });

    it('refuses every update to a line', async () => {
      const { lineIds } = await closedMonthOne();
      const lineId = lineIds[0];

      await expect(
        ownerPrisma().$executeRaw`
          UPDATE settlement_line SET therapist_net_toman = 0 WHERE id = ${lineId}::uuid
        `,
      ).rejects.toThrow(/immutable/);
    });

    it('refuses a delete and a truncate of either table', async () => {
      const { periodId, lineIds } = await closedMonthOne();

      await expect(
        ownerPrisma().$executeRaw`DELETE FROM settlement_line WHERE id = ${lineIds[0]}::uuid`,
      ).rejects.toThrow();

      await expect(
        ownerPrisma().$executeRaw`DELETE FROM settlement_period WHERE id = ${periodId}::uuid`,
      ).rejects.toThrow();

      await expect(ownerPrisma().$executeRawUnsafe('TRUNCATE settlement_line')).rejects.toThrow();
      await expect(ownerPrisma().$executeRawUnsafe('TRUNCATE settlement_period')).rejects.toThrow();
    });

    it('exposes no reopen, edit or delete route anywhere in the API', async () => {
      // A capability the product refuses to have must not be reachable by
      // guessing a verb. The contract has no un-close request, the service has
      // no method, and these are the shapes somebody would try.
      const { periodId } = await closedMonthOne();
      const server = () => harness.app.getHttpServer();

      const reopen = await request(server())
        .post(`/settlement/periods/${periodId}/reopen`)
        .set(asUser(fixture.managerToken))
        .send({});
      expect(reopen.status).toBe(404);

      const withdraw = await request(server())
        .post(`/settlement/periods/${periodId}/void`)
        .set(asUser(fixture.managerToken))
        .send({});
      expect(withdraw.status).toBe(404);

      const patched = await request(server())
        .patch(`/settlement/periods/${periodId}`)
        .set(asUser(fixture.managerToken))
        .send({});
      expect(patched.status).toBe(404);

      const removed = await request(server())
        .delete(`/settlement/periods/${periodId}`)
        .set(asUser(fixture.managerToken));
      expect(removed.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // The two structural guarantees a close depends on
  // -------------------------------------------------------------------------

  describe('the constraints the close routine is not trusted to remember', () => {
    it('refuses a second PRIMARY line for one session, whatever wrote it', async () => {
      const { periodId } = await closedMonthOne();

      const line = await harness.prisma.settlementLine.findFirstOrThrow({
        where: { settlementPeriodId: periodId, lineType: 'PRIMARY' },
      });

      // A duplicate PRIMARY is a therapist paid twice for one session. The
      // partial unique index is what makes "exactly once" a property of the
      // database rather than of the routine above it being right.
      await expect(
        harness.prisma.$executeRaw`
          INSERT INTO settlement_line (
            id, settlement_period_id, line_type, session_charge_id, session_settlement_id,
            appointment_participant_id, therapist_id, service_date,
            applied_share_basis_points, rated_via,
            base_amount_toman, therapist_gross_toman, therapist_discount_toman,
            therapist_net_toman, clinic_gross_toman, clinic_discount_toman, clinic_net_toman,
            corrects_settlement_line_id, created_at
          )
          SELECT gen_random_uuid(), settlement_period_id, line_type, session_charge_id,
                 session_settlement_id, appointment_participant_id, therapist_id, service_date,
                 applied_share_basis_points, rated_via,
                 base_amount_toman, therapist_gross_toman, therapist_discount_toman,
                 therapist_net_toman, clinic_gross_toman, clinic_discount_toman, clinic_net_toman,
                 corrects_settlement_line_id, transaction_timestamp()
            FROM settlement_line WHERE id = ${line.id}::uuid
        `,
        // 23505, unique_violation, on `(session_charge_id) WHERE line_type =
        // 'PRIMARY'`. PostgreSQL names the columns rather than the index in the
        // detail line, which is why the code is what is matched.
      ).rejects.toThrow(/23505/);
    });

    it('refuses a second closed period overlapping one that exists', async () => {
      await closedMonthOne();

      // Straight at the table, so this is the constraint and not the service's
      // pre-check. One day of overlap is enough.
      await expect(
        harness.prisma.$executeRaw`
          INSERT INTO settlement_period (
            id, therapist_id, period_start, period_end,
            settled_session_count, carried_in_correction_count, excluded_unrated_session_count,
            therapist_gross_toman, therapist_discount_toman, carried_in_correction_toman,
            settled_toman, closed_at, closed_by_user_id
          ) VALUES (
            gen_random_uuid(), ${fixture.therapistId}::uuid,
            '2026-09-30'::date, '2026-10-31'::date,
            0, 0, 0, 0, 0, 0, 0, transaction_timestamp(), ${fixture.managerId}::uuid
          )
        `,
      ).rejects.toThrow(/settlement_period_no_overlap_excl/);
    });

    it('permits a gap, and permits another therapist to cover the same days', async () => {
      await closedMonthOne();

      // A gap is not an error: a clinic that has not closed a month yet simply
      // has not closed it.
      const gapped = await closePeriodOverHttp(harness, fixture.managerToken, {
        therapistId: fixture.therapistId,
        from: '2026-11-01',
        to: '2026-11-30',
      });
      expect(gapped.status).toBe(200);

      // And a period belongs to ONE therapist: the same days for somebody else
      // is a completely different fact.
      const other = await closePeriodOverHttp(harness, fixture.managerToken, {
        therapistId: fixture.otherTherapistId,
        ...MONTH_ONE,
      });
      expect(other.status).toBe(200);
    });

    it('refuses a period whose stated total disagrees with its own components', async () => {
      await expect(
        harness.prisma.$executeRaw`
          INSERT INTO settlement_period (
            id, therapist_id, period_start, period_end,
            settled_session_count, carried_in_correction_count, excluded_unrated_session_count,
            therapist_gross_toman, therapist_discount_toman, carried_in_correction_toman,
            settled_toman, closed_at, closed_by_user_id
          ) VALUES (
            gen_random_uuid(), ${fixture.therapistId}::uuid,
            '2027-01-01'::date, '2027-01-31'::date,
            1, 0, 0, 100000, 0, 0, 999999, transaction_timestamp(), ${fixture.managerId}::uuid
          )
        `,
      ).rejects.toThrow(/settlement_period_totals_chk/);
    });

    it('refuses a PRIMARY line with a negative therapist net', async () => {
      const { periodId } = await closedMonthOne();
      const line = await harness.prisma.settlementLine.findFirstOrThrow({
        where: { settlementPeriodId: periodId, lineType: 'PRIMARY' },
      });

      // CLAUDE.md states outright that a therapist net share is never negative.
      // On a PRIMARY line — which is a LEVEL rather than a delta — the database
      // refuses one.
      await expect(
        harness.prisma.$executeRaw`
          INSERT INTO settlement_line (
            id, settlement_period_id, line_type, session_charge_id, session_settlement_id,
            appointment_participant_id, therapist_id, service_date,
            applied_share_basis_points, rated_via,
            base_amount_toman, therapist_gross_toman, therapist_discount_toman,
            therapist_net_toman, clinic_gross_toman, clinic_discount_toman, clinic_net_toman,
            corrects_settlement_line_id, created_at
          ) VALUES (
            gen_random_uuid(), ${periodId}::uuid, 'PRIMARY',
            ${line.sessionChargeId}::uuid, ${line.sessionSettlementId}::uuid,
            ${line.appointmentParticipantId}::uuid, ${fixture.therapistId}::uuid,
            ${line.serviceDate.toISOString().slice(0, 10)}::date,
            4000, 'AUTOMATIC',
            0, 0, 5000, -5000, 0, 0, 0,
            NULL, transaction_timestamp()
          )
        `,
      ).rejects.toThrow(/settlement_line_primary_signs_chk|settlement_line_split_chk/);
    });

    it('refuses a CORRECTION line that names no line it corrects', async () => {
      const { periodId } = await closedMonthOne();
      const line = await harness.prisma.settlementLine.findFirstOrThrow({
        where: { settlementPeriodId: periodId, lineType: 'PRIMARY' },
      });

      await expect(
        harness.prisma.$executeRaw`
          INSERT INTO settlement_line (
            id, settlement_period_id, line_type, session_charge_id, session_settlement_id,
            appointment_participant_id, therapist_id, service_date,
            applied_share_basis_points, rated_via,
            base_amount_toman, therapist_gross_toman, therapist_discount_toman,
            therapist_net_toman, clinic_gross_toman, clinic_discount_toman, clinic_net_toman,
            corrects_settlement_line_id, created_at
          ) VALUES (
            gen_random_uuid(), ${periodId}::uuid, 'CORRECTION',
            ${line.sessionChargeId}::uuid, ${line.sessionSettlementId}::uuid,
            ${line.appointmentParticipantId}::uuid, ${fixture.therapistId}::uuid,
            ${line.serviceDate.toISOString().slice(0, 10)}::date,
            4000, 'AUTOMATIC',
            0, 0, 0, 0, 0, 0, 0,
            NULL, transaction_timestamp()
          )
        `,
      ).rejects.toThrow(/settlement_line_type_linkage_chk/);
    });

    it('refuses a set of lines that would sum below zero on the therapist side', async () => {
      const { periodId } = await closedMonthOne();
      const line = await harness.prisma.settlementLine.findFirstOrThrow({
        where: { settlementPeriodId: periodId, lineType: 'PRIMARY', therapistNetToman: { gt: 0 } },
      });

      // A correction may legitimately be negative — a withdrawn charge produces
      // one — but the RUNNING TOTAL is what a session is worth, and a session is
      // never worth a negative amount to the therapist. That would be a closed
      // record asserting the therapist owes the clinic, which is precisely the
      // receivable this milestone refuses to model.
      const excessive = -(line.therapistNetToman + 1n);

      await expect(
        harness.prisma.$executeRaw`
          INSERT INTO settlement_line (
            id, settlement_period_id, line_type, session_charge_id, session_settlement_id,
            appointment_participant_id, therapist_id, service_date,
            applied_share_basis_points, rated_via,
            base_amount_toman, therapist_gross_toman, therapist_discount_toman,
            therapist_net_toman, clinic_gross_toman, clinic_discount_toman, clinic_net_toman,
            corrects_settlement_line_id, created_at
          ) VALUES (
            gen_random_uuid(), ${periodId}::uuid, 'CORRECTION',
            ${line.sessionChargeId}::uuid, ${line.sessionSettlementId}::uuid,
            ${line.appointmentParticipantId}::uuid, ${fixture.therapistId}::uuid,
            ${line.serviceDate.toISOString().slice(0, 10)}::date,
            4000, 'AUTOMATIC',
            ${excessive.toString()}::bigint, ${excessive.toString()}::bigint, 0,
            ${excessive.toString()}::bigint, 0, 0, 0,
            ${line.id}::uuid, transaction_timestamp()
          )
        `,
      ).rejects.toThrow(/settlement_line_therapist_net_floor/);
    });
  });
});
