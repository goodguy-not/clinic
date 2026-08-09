import { Prisma } from '@prisma/client';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, seedUser, type Harness } from './harness';

/**
 * What the Milestone 4 schema refuses, proved against a real PostgreSQL.
 *
 * These tests write raw SQL and bypass the service layer entirely — there is no
 * appointment service yet, and that is the point: every guarantee here has to
 * hold without one. A future endpoint, a data-fix script or somebody at a psql
 * prompt is subject to the same constraints as the booking code that arrives in
 * the next checkpoint.
 *
 * Everything is synthetic. No real child, therapist, room or appointment appears
 * in any fixture.
 */

/** SQLSTATE 23001, restrict_violation: what both protective triggers raise. */
const RESTRICT_VIOLATION = '23001';
/** SQLSTATE 23514, check_violation. */
const CHECK_VIOLATION = '23514';
/** SQLSTATE 23P01, exclusion_violation. */
const EXCLUSION_VIOLATION = '23P01';
/** SQLSTATE 23503, foreign_key_violation. */
const FOREIGN_KEY_VIOLATION = '23503';

const DURATION = 45;

describe('appointment database constraints', () => {
  let harness: Harness;
  let actorId: string;
  let serviceId: string;
  let therapistId: string;
  let roomId: string;
  let childId: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);

    const actor = await seedUser(harness, { role: 'MANAGER' });
    actorId = actor.id;
    serviceId = uuidv7();
    therapistId = uuidv7();
    roomId = uuidv7();
    childId = uuidv7();

    const familyId = uuidv7();

    await harness.prisma.$executeRaw`
      INSERT INTO service (id, name, is_public, created_by_user_id)
      VALUES (${serviceId}::uuid, 'Synthetic Service', false, ${actorId}::uuid)
    `;
    await harness.prisma.$executeRaw`
      INSERT INTO service_duration (id, service_id, duration_minutes)
      VALUES (${uuidv7()}::uuid, ${serviceId}::uuid, ${DURATION})
    `;
    await harness.prisma.$executeRaw`
      INSERT INTO therapist (id, full_name, specialty, created_by_user_id)
      VALUES (${therapistId}::uuid, 'Synthetic Therapist', 'Synthetic Specialty', ${actorId}::uuid)
    `;
    await harness.prisma.$executeRaw`
      INSERT INTO room (id, name, created_by_user_id)
      VALUES (${roomId}::uuid, 'Synthetic Room', ${actorId}::uuid)
    `;
    await harness.prisma.$executeRaw`
      INSERT INTO family (id, family_name, search_family_name, created_by_user_id)
      VALUES (${familyId}::uuid, 'خانوادهٔ آزمایشی', fa_normalize('خانوادهٔ آزمایشی'), ${actorId}::uuid)
    `;
    await harness.prisma.$executeRaw`
      INSERT INTO child (
        id, family_id, first_name, last_name, search_first_name, search_last_name,
        birth_date, file_number, created_by_user_id
      ) VALUES (
        ${childId}::uuid, ${familyId}::uuid, 'کودک', 'آزمایشی',
        fa_normalize('کودک'), fa_normalize('آزمایشی'),
        DATE '2019-05-01', nextval('child_file_number_seq')::text, ${actorId}::uuid
      )
    `;
  });

  /**
   * Asserts the statement failed, and failed for the stated reason.
   *
   * Matching on SQLSTATE and the constraint name rather than "it threw" is what
   * stops a test passing because of an unrelated typo in the fixture.
   */
  async function expectRejection(
    statement: Promise<unknown>,
    sqlState: string,
    detail: RegExp,
  ): Promise<void> {
    let error: unknown;
    try {
      await statement;
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeDefined();

    const raw = error as Prisma.PrismaClientKnownRequestError;
    const meta = (raw.meta ?? {}) as { code?: string; message?: string };
    const text = `${meta.code ?? ''} ${meta.message ?? ''} ${raw.message}`;

    expect(text).toContain(sqlState);
    expect(text).toMatch(detail);
  }

  type AppointmentInput = {
    id?: string;
    startsAt?: string;
    endsAt?: string;
    durationMinutes?: number;
    therapistId?: string;
    roomId?: string;
  };

  /**
   * A SCHEDULED booking with a coherent window unless a test breaks one.
   *
   * `ends_at` is derived in SQL when a test has not deliberately supplied a
   * wrong one. Deriving it in JavaScript would make the window CHECK a test of
   * Node's date arithmetic.
   */
  function createAppointment(values: AppointmentInput = {}): Promise<unknown> {
    const startsAt = values.startsAt ?? '2026-09-01T08:00:00Z';
    const duration = values.durationMinutes ?? DURATION;

    return harness.prisma.$executeRaw`
      INSERT INTO appointment (
        id, service_id, duration_minutes, therapist_id, room_id,
        starts_at, ends_at, created_by_user_id
      ) VALUES (
        ${values.id ?? uuidv7()}::uuid,
        ${serviceId}::uuid,
        ${duration},
        ${values.therapistId ?? therapistId}::uuid,
        ${values.roomId ?? roomId}::uuid,
        ${startsAt}::timestamptz,
        COALESCE(
          ${values.endsAt ?? null}::timestamptz,
          ${startsAt}::timestamptz + make_interval(mins => ${duration}::int)
        ),
        ${actorId}::uuid
      )
    `;
  }

  function addParticipant(appointmentId: string, id = uuidv7()): Promise<unknown> {
    return harness.prisma.$executeRaw`
      INSERT INTO appointment_participant (id, appointment_id, child_id)
      VALUES (${id}::uuid, ${appointmentId}::uuid, ${childId}::uuid)
    `;
  }

  describe('the window is one fact, not three', () => {
    it('refuses an end that does not match the start plus the duration', async () => {
      await expectRejection(
        createAppointment({ endsAt: '2026-09-01T09:30:00Z' }),
        CHECK_VIOLATION,
        /appointment_window_chk/,
      );
    });

    it('refuses an end before its start', async () => {
      await expectRejection(
        createAppointment({ endsAt: '2026-09-01T07:00:00Z' }),
        CHECK_VIOLATION,
        /appointment_window_chk/,
      );
    });

    it('refuses a duration outside the allowed range', async () => {
      await expectRejection(
        createAppointment({ durationMinutes: 0 }),
        CHECK_VIOLATION,
        /appointment_duration_chk/,
      );
    });

    it('refuses a session length the service does not offer', async () => {
      // The composite foreign key to `service_duration`, seen from the booking
      // end. Prisma generates it, so drift detection sees it too.
      await expectRejection(
        createAppointment({ durationMinutes: 30 }),
        FOREIGN_KEY_VIOLATION,
        /service_id_duration_minutes_fkey|service_duration/,
      );
    });
  });

  describe('resource overlap', () => {
    it('refuses a second booking for the same therapist at the same time', async () => {
      await createAppointment();

      await expectRejection(
        createAppointment({ roomId: await otherRoom(), startsAt: '2026-09-01T08:30:00Z' }),
        EXCLUSION_VIOLATION,
        /appointment_no_therapist_overlap_excl/,
      );
    });

    it('refuses a second booking in the same room at the same time', async () => {
      await createAppointment();

      await expectRejection(
        createAppointment({
          therapistId: await otherTherapist(),
          startsAt: '2026-09-01T08:30:00Z',
        }),
        EXCLUSION_VIOLATION,
        /appointment_no_room_overlap_excl/,
      );
    });

    it('allows back-to-back sessions, which are the normal shape of a clinic day', async () => {
      await createAppointment({ startsAt: '2026-09-01T08:00:00Z' });

      await expect(createAppointment({ startsAt: '2026-09-01T08:45:00Z' })).resolves.toBe(1);
    });

    it('releases the slot when the booking is cancelled', async () => {
      const first = uuidv7();
      await createAppointment({ id: first });

      await harness.prisma.$executeRaw`
        UPDATE appointment
           SET status = 'CANCELLED_BY_FAMILY',
               cancelled_at = transaction_timestamp(),
               cancellation_reason = 'synthetic reason'
         WHERE id = ${first}::uuid
      `;

      await expect(createAppointment()).resolves.toBe(1);
    });

    it('does not refuse the same child in two overlapping bookings', async () => {
      // Deliberately permitted BY THE SCHEMA. The child is on the seat and the
      // time is on the booking, so no single-row constraint can compare them.
      // The rule is real and is recomputed under a transaction-scoped advisory
      // lock when a seat is written, in the booking checkpoint. This test states
      // the boundary so that "the database allows it" is a recorded fact rather
      // than an assumption somebody makes later.
      const first = uuidv7();
      const second = uuidv7();

      await createAppointment({ id: first });
      await addParticipant(first);

      await createAppointment({
        id: second,
        therapistId: await otherTherapist(),
        roomId: await otherRoom(),
        startsAt: '2026-09-01T08:30:00Z',
      });

      await expect(addParticipant(second)).resolves.toBe(1);
    });
  });

  describe('one status, one outcome record', () => {
    it('refuses a completion timestamp on a scheduled booking', async () => {
      const appointmentId = uuidv7();
      await createAppointment({ id: appointmentId });

      await expectRejection(
        harness.prisma.$executeRaw`
          UPDATE appointment SET completed_at = transaction_timestamp()
           WHERE id = ${appointmentId}::uuid
        `,
        CHECK_VIOLATION,
        /appointment_completed_consistency_chk/,
      );
    });

    it('refuses a cancellation with no reason', async () => {
      const appointmentId = uuidv7();
      await createAppointment({ id: appointmentId });

      await expectRejection(
        harness.prisma.$executeRaw`
          UPDATE appointment
             SET status = 'CANCELLED_BY_FAMILY', cancelled_at = transaction_timestamp()
           WHERE id = ${appointmentId}::uuid
        `,
        CHECK_VIOLATION,
        /appointment_cancellation_consistency_chk/,
      );
    });

    it('has no NO_SHOW booking status to set at all', async () => {
      // A no-show is one child's outcome and lives on the seat. The enum does
      // not carry the value, so the attempt fails as an invalid input rather
      // than as a constraint violation.
      const appointmentId = uuidv7();
      await createAppointment({ id: appointmentId });

      await expect(
        harness.prisma.$executeRawUnsafe(
          `UPDATE appointment SET status = 'NO_SHOW' WHERE id = '${appointmentId}'::uuid`,
        ),
      ).rejects.toThrow(/invalid input value for enum appointment_status/);
    });
  });

  describe('attendance is the seat’s own fact', () => {
    it('refuses a recorded attendance with no time, and a pending one with a time', async () => {
      const appointmentId = uuidv7();
      const participantId = uuidv7();
      await createAppointment({ id: appointmentId });
      await addParticipant(appointmentId, participantId);

      await expectRejection(
        harness.prisma.$executeRaw`
          UPDATE appointment_participant SET attendance = 'ATTENDED'
           WHERE id = ${participantId}::uuid
        `,
        CHECK_VIOLATION,
        /appointment_participant_attendance_consistency_chk/,
      );

      await expectRejection(
        harness.prisma.$executeRaw`
          UPDATE appointment_participant SET attendance_recorded_at = transaction_timestamp()
           WHERE id = ${participantId}::uuid
        `,
        CHECK_VIOLATION,
        /appointment_participant_attendance_consistency_chk/,
      );
    });

    it('lets a seat be NO_SHOW inside a COMPLETED booking, which is two separate facts', async () => {
      const appointmentId = uuidv7();
      const participantId = uuidv7();
      await createAppointment({ id: appointmentId });
      await addParticipant(appointmentId, participantId);

      await harness.prisma.$executeRaw`
        UPDATE appointment SET status = 'COMPLETED', completed_at = transaction_timestamp()
         WHERE id = ${appointmentId}::uuid
      `;

      await expect(
        harness.prisma.$executeRaw`
          UPDATE appointment_participant
             SET attendance = 'NO_SHOW', attendance_recorded_at = transaction_timestamp()
           WHERE id = ${participantId}::uuid
        `,
      ).resolves.toBe(1);
    });
  });

  describe('a series states exactly one bound', () => {
    function createSeries(values: {
      endMode?: 'OCCURRENCE_COUNT' | 'END_DATE';
      occurrenceCount?: number | null;
      endsOn?: string | null;
      intervalWeeks?: number;
      startsOn?: string;
    }): Promise<unknown> {
      return harness.prisma.$executeRaw`
        INSERT INTO appointment_series (
          id, interval_weeks, starts_on, end_mode, occurrence_count, ends_on, created_by_user_id
        ) VALUES (
          ${uuidv7()}::uuid,
          ${values.intervalWeeks ?? 1},
          ${values.startsOn ?? '2026-09-01'}::date,
          ${values.endMode ?? 'OCCURRENCE_COUNT'}::recurrence_end,
          ${values.occurrenceCount ?? null},
          ${values.endsOn ?? null}::date,
          ${actorId}::uuid
        )
      `;
    }

    it('accepts an occurrence count', async () => {
      await expect(
        createSeries({ endMode: 'OCCURRENCE_COUNT', occurrenceCount: 12 }),
      ).resolves.toBe(1);
    });

    it('accepts an end date', async () => {
      await expect(createSeries({ endMode: 'END_DATE', endsOn: '2026-12-01' })).resolves.toBe(1);
    });

    it('refuses a series carrying both bounds', async () => {
      await expectRejection(
        createSeries({ endMode: 'END_DATE', endsOn: '2026-12-01', occurrenceCount: 12 }),
        CHECK_VIOLATION,
        /appointment_series_end_chk/,
      );
    });

    it('refuses a series carrying neither', async () => {
      await expectRejection(
        createSeries({ endMode: 'OCCURRENCE_COUNT' }),
        CHECK_VIOLATION,
        /appointment_series_end_chk/,
      );
    });

    it('refuses an end date before the start', async () => {
      await expectRejection(
        createSeries({ endMode: 'END_DATE', endsOn: '2026-08-01' }),
        CHECK_VIOLATION,
        /appointment_series_range_chk/,
      );
    });

    it('leaves a one-off appointment with no series', async () => {
      const appointmentId = uuidv7();
      await createAppointment({ id: appointmentId });

      const rows = await harness.prisma.$queryRaw<{ series_id: string | null }[]>`
        SELECT series_id FROM appointment WHERE id = ${appointmentId}::uuid
      `;

      expect(rows[0]?.series_id).toBeNull();
    });
  });

  describe('therapist availability', () => {
    // A weekday and two times. The effective-dating columns this table was
    // created with are dropped by the availability migration: recurring
    // availability is current configuration, and that capability is not
    // approved (see that migration for the reasoning).
    function createWindow(values: {
      weekday?: number;
      startTime?: string;
      endTime?: string;
    }): Promise<unknown> {
      return harness.prisma.$executeRaw`
        INSERT INTO therapist_availability (
          id, therapist_id, weekday, start_time, end_time, created_by_user_id
        ) VALUES (
          ${uuidv7()}::uuid,
          ${therapistId}::uuid,
          ${values.weekday ?? 0},
          ${values.startTime ?? '09:00'}::time,
          ${values.endTime ?? '13:00'}::time,
          ${actorId}::uuid
        )
      `;
    }

    it('accepts a recurring window on Saturday, which is weekday 0', async () => {
      // 0 is Saturday in the clinic's numbering, not Sunday. The default in the
      // helper is deliberately 0 so a reader sees the convention in use.
      await expect(createWindow({})).resolves.toBe(1);

      const rows = await harness.prisma.$queryRaw<{ weekday: number }[]>`
        SELECT weekday FROM therapist_availability
      `;

      expect(Number(rows[0]?.weekday)).toBe(0);
    });

    it('refuses a weekday outside the PostgreSQL DOW range', async () => {
      await expectRejection(
        createWindow({ weekday: 7 }),
        CHECK_VIOLATION,
        /therapist_availability_weekday_chk/,
      );
    });

    it('refuses a window that ends before it starts', async () => {
      await expectRejection(
        createWindow({ startTime: '13:00', endTime: '09:00' }),
        CHECK_VIOLATION,
        /therapist_availability_window_chk/,
      );
    });

    it('has no effective-dating column to state a range with', async () => {
      // The availability migration drops `effective_from` and `effective_to`,
      // and `therapist_availability_effective_range_chk` with them. A window is
      // current configuration: it applies whenever it is asked about.
      const columns = await harness.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'therapist_availability'
      `;

      const names = columns.map((column) => column.column_name);

      expect(names).not.toContain('effective_from');
      expect(names).not.toContain('effective_to');
      expect(names.sort()).toEqual([
        'created_at',
        'created_by_user_id',
        'end_time',
        'id',
        'start_time',
        'therapist_id',
        'weekday',
      ]);
    });

    it('accepts a closed day and an extra window, and refuses a half-stated exception', async () => {
      const insertException = (
        isAvailable: boolean,
        startTime: string | null,
        endTime: string | null,
      ) => harness.prisma.$executeRaw`
        INSERT INTO therapist_availability_exception (
          id, therapist_id, exception_date, is_available, start_time, end_time,
          reason, created_by_user_id
        ) VALUES (
          ${uuidv7()}::uuid, ${therapistId}::uuid, DATE '2026-09-05', ${isAvailable},
          ${startTime}::time, ${endTime}::time, 'synthetic reason', ${actorId}::uuid
        )
      `;

      await expect(insertException(false, null, null)).resolves.toBe(1);
      await expect(insertException(true, '15:00', '18:00')).resolves.toBe(1);

      // A closed day carrying times, and an extra window carrying none.
      await expectRejection(
        insertException(false, '09:00', '12:00'),
        CHECK_VIOLATION,
        /therapist_availability_exception_window_chk/,
      );
      await expectRejection(
        insertException(true, null, null),
        CHECK_VIOLATION,
        /therapist_availability_exception_window_chk/,
      );
    });
  });

  describe('permanence', () => {
    it('refuses to delete an appointment or a seat', async () => {
      const appointmentId = uuidv7();
      await createAppointment({ id: appointmentId });
      await addParticipant(appointmentId);

      await expectRejection(
        harness.prisma.$executeRaw`DELETE FROM appointment_participant`,
        RESTRICT_VIOLATION,
        /is protected; DELETE is not permitted/,
      );

      await expectRejection(
        harness.prisma.$executeRaw`DELETE FROM appointment`,
        RESTRICT_VIOLATION,
        /is protected; DELETE is not permitted/,
      );
    });

    it('refuses TRUNCATE, which bypasses row-level triggers', async () => {
      await expectRejection(
        harness.prisma.$executeRawUnsafe('TRUNCATE appointment CASCADE'),
        RESTRICT_VIOLATION,
        /is protected; TRUNCATE is not permitted/,
      );
    });

    it('lets an availability window be deleted, because it is configuration', async () => {
      await harness.prisma.$executeRaw`
        INSERT INTO therapist_availability (
          id, therapist_id, weekday, start_time, end_time, created_by_user_id
        ) VALUES (
          ${uuidv7()}::uuid, ${therapistId}::uuid, 6, '09:00'::time, '13:00'::time,
          ${actorId}::uuid
        )
      `;

      await expect(harness.prisma.$executeRaw`DELETE FROM therapist_availability`).resolves.toBe(1);
    });

    it('refuses to re-attribute a booking', async () => {
      const appointmentId = uuidv7();
      await createAppointment({ id: appointmentId });

      const other = await seedUser(harness, { role: 'MANAGER' });

      await expectRejection(
        harness.prisma.$executeRaw`
          UPDATE appointment SET created_by_user_id = ${other.id}::uuid
           WHERE id = ${appointmentId}::uuid
        `,
        RESTRICT_VIOLATION,
        /provenance is immutable/,
      );
    });

    it('refuses to move a seat to another child', async () => {
      const appointmentId = uuidv7();
      const participantId = uuidv7();
      await createAppointment({ id: appointmentId });
      await addParticipant(appointmentId, participantId);

      await expectRejection(
        harness.prisma.$executeRaw`
          UPDATE appointment_participant SET child_id = ${uuidv7()}::uuid
           WHERE id = ${participantId}::uuid
        `,
        RESTRICT_VIOLATION,
        /identity is immutable/,
      );
    });
  });

  /** A second room, so a therapist conflict can be provoked without a room one. */
  async function otherRoom(): Promise<string> {
    const id = uuidv7();
    await harness.prisma.$executeRaw`
      INSERT INTO room (id, name, created_by_user_id)
      VALUES (${id}::uuid, ${`Synthetic Room ${id.slice(0, 8)}`}, ${actorId}::uuid)
    `;
    return id;
  }

  /** A second therapist, for the mirror image of the same test. */
  async function otherTherapist(): Promise<string> {
    const id = uuidv7();
    await harness.prisma.$executeRaw`
      INSERT INTO therapist (id, full_name, specialty, created_by_user_id)
      VALUES (${id}::uuid, 'Synthetic Therapist Two', 'Synthetic Specialty', ${actorId}::uuid)
    `;
    return id;
  }
});
