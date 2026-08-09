import {
  APPOINTMENT_STATUSES,
  ATTENDANCE_OUTCOMES,
  PERMISSIONS,
  RECURRENCE_ENDS,
  weekdaySchema,
} from '@clinic/contracts';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../src/audit/audit-actions';
import { permissionsForRole } from '../src/auth/permissions';
import { createHarness, type Harness } from './harness';

/**
 * Pins the hand-written half of the Milestone 4 migration.
 *
 * `prisma migrate diff` compares the datamodel with the database and sees
 * tables, columns, indexes and foreign keys. It does not see CHECK constraints,
 * exclusion constraints or triggers — so the objects that make this a scheduling
 * schema rather than a set of rows are exactly the ones drift detection would
 * let disappear silently. This asserts each one exists by name.
 *
 * It also pins the checkpoint's SCOPE: five tables, no financial column
 * anywhere, and no lifecycle value the plan did not approve. Behaviour is proved
 * separately in `appointments-constraints.int-spec.ts`.
 */
describe('appointment schema objects', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  // No resetDatabase: nothing here writes rows, and the catalogue is unaffected
  // by table contents.

  const M4_TABLES = [
    'appointment',
    'appointment_participant',
    'appointment_series',
    'therapist_availability',
    'therapist_availability_exception',
  ];

  it('creates exactly the five approved tables', async () => {
    const rows = await harness.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('appointment', 'appointment_participant', 'appointment_series',
                           'therapist_availability', 'therapist_availability_exception')
    `;

    expect(rows.map((row) => row.table_name).sort()).toEqual([...M4_TABLES].sort());
  });

  it('carries no financial column on any of them', async () => {
    // The single most important assertion in this file. Pricing a session is
    // Milestone 5's, and a column named here would be an amount stored before
    // the rules that produce it are approved. Matched on the name rather than
    // the type, because the mistake would arrive as `tariff_id` or
    // `price_toman`, not as "a bigint".
    const rows = await harness.prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('appointment', 'appointment_participant', 'appointment_series',
                           'therapist_availability', 'therapist_availability_exception')
        AND (column_name ~ '(tariff|price|amount|toman|charge|discount|fee)')
    `;

    expect(rows).toEqual([]);
  });

  it('holds no foreign key from an appointment or a seat into the tariff table', async () => {
    const rows = await harness.prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'f'
        AND conrelid::regclass::text IN ('appointment', 'appointment_participant')
        AND confrelid::regclass::text = 'tariff'
    `;

    expect(rows).toEqual([]);
  });

  it('holds every hand-written CHECK constraint', async () => {
    const rows = await harness.prisma.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'c'
        AND conrelid::regclass::text IN ('appointment', 'appointment_participant',
                                         'appointment_series', 'therapist_availability',
                                         'therapist_availability_exception')
    `;

    expect(rows.map((row) => row.conname).sort()).toEqual(
      [
        'appointment_duration_chk',
        'appointment_window_chk',
        'appointment_note_chk',
        'appointment_completed_consistency_chk',
        'appointment_cancellation_consistency_chk',
        'appointment_participant_attendance_consistency_chk',
        'appointment_series_end_chk',
        'appointment_series_occurrence_count_chk',
        'appointment_series_range_chk',
        'appointment_series_interval_chk',
        'therapist_availability_weekday_chk',
        'therapist_availability_window_chk',
        // `therapist_availability_effective_range_chk` is deliberately absent:
        // the availability migration drops it along with the two columns it
        // constrained, because effective-dated availability is not approved.
        'therapist_availability_exception_window_chk',
        'therapist_availability_exception_reason_chk',
        // Added by the availability checkpoint: the product contract is `HH:MM`,
        // so a stored second would make the row and the response disagree
        // without either being wrong on its own.
        'therapist_availability_time_precision_chk',
        'therapist_availability_exception_time_precision_chk',
      ].sort(),
    );
  });

  it('holds the two resource-overlap exclusion constraints and no third', async () => {
    const rows = await harness.prisma.$queryRaw<{ conname: string; definition: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE contype = 'x'
        AND conrelid::regclass::text IN ('appointment', 'appointment_participant')
    `;

    const byName = new Map(rows.map((row) => [row.conname, row.definition]));

    // A child's own overlap is deliberately NOT a constraint: the child is on
    // the seat and the time is on the booking, so no single-row constraint can
    // compare them. It is recomputed under an advisory lock when a seat is
    // written, in the booking checkpoint.
    expect([...byName.keys()].sort()).toEqual([
      'appointment_no_room_overlap_excl',
      'appointment_no_therapist_overlap_excl',
    ]);

    expect(byName.get('appointment_no_therapist_overlap_excl')).toMatch(/therapist_id.*=/s);
    expect(byName.get('appointment_no_room_overlap_excl')).toMatch(/room_id.*=/s);

    for (const definition of byName.values()) {
      // Half-open bounds: back-to-back sessions are the normal shape of a
      // clinic day and must not conflict.
      expect(definition).toContain("'[)'");

      // Held for the two statuses that occupy the resource, released by both
      // cancellations. A no-show does not appear at all: it is the seat's
      // attendance, and the room and the hour were still consumed.
      for (const occupying of ['SCHEDULED', 'COMPLETED']) {
        expect(definition).toContain(occupying);
      }
      for (const released of ['CANCELLED_BY_FAMILY', 'CANCELLED_BY_CLINIC']) {
        expect(definition).not.toContain(released);
      }
      expect(definition).not.toContain('NO_SHOW');
    }
  });

  it('adds no booking mirror to the participant table', async () => {
    // The seat carries its child and its attendance and nothing about the
    // booking's window or status. Mirroring those would be a second copy of a
    // fact the appointment already owns.
    const rows = await harness.prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'appointment_participant'
    `;

    expect(rows.map((row) => row.column_name).sort()).toEqual([
      'appointment_id',
      'attendance',
      'attendance_recorded_at',
      'child_id',
      'id',
    ]);
  });

  it('holds the two identity-immutability functions and no others', async () => {
    const rows = await harness.prisma.$queryRaw<{ proname: string }[]>`
      SELECT p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE '%appointment%'
    `;

    expect(rows.map((row) => row.proname).sort()).toEqual([
      'enforce_appointment_identity_immutability',
      'enforce_appointment_participant_identity_immutability',
    ]);
  });

  it('protects the three history tables from deletion and leaves availability alone', async () => {
    const rows = await harness.prisma.$queryRaw<{ tgname: string; table_name: string }[]>`
      SELECT tgname, tgrelid::regclass::text AS table_name FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgrelid::regclass::text IN ('appointment', 'appointment_participant',
                                        'appointment_series', 'therapist_availability',
                                        'therapist_availability_exception')
    `;

    expect(rows.map((row) => row.tgname).sort()).toEqual([
      'appointment_enforce_identity_immutability',
      'appointment_no_delete',
      'appointment_no_truncate',
      'appointment_participant_enforce_identity_immutability',
      'appointment_participant_no_delete',
      'appointment_participant_no_truncate',
      'appointment_series_no_delete',
      'appointment_series_no_truncate',
    ]);

    // Availability is current configuration, replaced as a therapist's hours
    // change and recorded in `audit_log` as values — exactly like
    // `therapist_service` and `guardian`, neither of which is protected either.
    for (const table of ['therapist_availability', 'therapist_availability_exception']) {
      expect(rows.filter((row) => row.table_name === table)).toHaveLength(0);
    }
  });

  it('does not make a participant unique per appointment', async () => {
    // "An individual appointment has exactly one participant" is a service
    // invariant, exactly as "a family has at least one guardian" is. A unique
    // index would state it and would also collapse the two-level model into a
    // one-to-one relation.
    const rows = await harness.prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'appointment_participant'
        AND indexdef LIKE '%UNIQUE%'
        AND indexdef LIKE '%appointment_id%'
    `;

    expect(rows).toHaveLength(0);
  });

  describe('the contract enums match the PostgreSQL enums exactly', () => {
    async function enumValues(name: string): Promise<string[]> {
      const rows = await harness.prisma.$queryRaw<{ label: string }[]>`
        SELECT e.enumlabel AS label
        FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = ${name}
        ORDER BY e.enumsortorder
      `;
      return rows.map((row) => row.label);
    }

    it('appointment_status: four values, with no VOIDED and no NO_SHOW', async () => {
      const values = await enumValues('appointment_status');

      expect(values).toEqual([...APPOINTMENT_STATUSES]);
      expect(values).toEqual([
        'SCHEDULED',
        'COMPLETED',
        'CANCELLED_BY_FAMILY',
        'CANCELLED_BY_CLINIC',
      ]);

      // A no-show is a seat's outcome, not a state of the booking. Neither this
      // nor a void is a lifecycle value here.
      expect(values).not.toContain('NO_SHOW');
      expect(values).not.toContain('VOIDED');
      expect(values).not.toContain('RESCHEDULED');
    });

    it('attendance_outcome carries the no-show, and no ABSENT', async () => {
      const values = await enumValues('attendance_outcome');

      expect(values).toEqual([...ATTENDANCE_OUTCOMES]);
      expect(values).toEqual(['PENDING', 'ATTENDED', 'NO_SHOW']);
      expect(values).not.toContain('ABSENT');
    });

    it('recurrence_end', async () => {
      expect(await enumValues('recurrence_end')).toEqual([...RECURRENCE_ENDS]);
    });
  });

  describe('the weekday convention is the clinic’s, not PostgreSQL’s', () => {
    it('translates native DOW to 0 = Saturday through 6 = Friday', async () => {
      // The expression the availability check will use, proved against real
      // dates rather than asserted in a comment. 2026-09-05 is a Saturday.
      const rows = await harness.prisma.$queryRaw<{ label: string; weekday: number }[]>`
        SELECT to_char(d, 'Dy') AS label,
               (EXTRACT(DOW FROM d AT TIME ZONE 'Asia/Tehran')::int + 1) % 7 AS weekday
        FROM generate_series(
          TIMESTAMPTZ '2026-09-05 12:00+03:30',
          TIMESTAMPTZ '2026-09-11 12:00+03:30',
          INTERVAL '1 day'
        ) AS d
      `;

      expect(rows.map((row) => [row.label.trim(), Number(row.weekday)])).toEqual([
        ['Sat', 0],
        ['Sun', 1],
        ['Mon', 2],
        ['Tue', 3],
        ['Wed', 4],
        ['Thu', 5],
        ['Fri', 6],
      ]);
    });

    it('accepts the whole range in the shared contract and refuses anything else', () => {
      for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
        expect(weekdaySchema.safeParse(weekday).success).toBe(true);
      }

      expect(weekdaySchema.safeParse(7).success).toBe(false);
      expect(weekdaySchema.safeParse(-1).success).toBe(false);
    });
  });

  describe('audit vocabulary', () => {
    it('names the booking, the seat and the series as entity types', () => {
      expect(AUDIT_ENTITY_TYPES).toContain('appointment');
      expect(AUDIT_ENTITY_TYPES).toContain('appointment_participant');
      expect(AUDIT_ENTITY_TYPES).toContain('appointment_series');
    });

    it('names no availability entity type, because a window is not a record', () => {
      expect(AUDIT_ENTITY_TYPES).not.toContain('therapist_availability');
      expect(AUDIT_ENTITY_TYPES).not.toContain('therapist_availability_exception');
    });

    it('gives each outcome its own action, and names no void or booking no-show', () => {
      for (const action of [
        'appointment.created',
        'appointment.updated',
        'appointment.completed',
        'appointment.cancelled',
        'appointment.attendance_recorded',
      ]) {
        expect(AUDIT_ACTIONS).toContain(action);
      }

      expect(AUDIT_ACTIONS).not.toContain('appointment.status_changed');
      // A no-show is recorded as one child's attendance, so there is no
      // booking-level action for it.
      expect(AUDIT_ACTIONS).not.toContain('appointment.no_show_recorded');
      expect(AUDIT_ACTIONS).not.toContain('appointment.rescheduled');
      for (const action of AUDIT_ACTIONS) {
        expect(action).not.toMatch(/^appointment.*void/);
      }
    });

    it('every action still satisfies the audit_log format CHECK', async () => {
      const rows = await harness.prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT bool_and(a ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$') AS ok
        FROM unnest(${[...AUDIT_ACTIONS]}::text[]) AS a
      `;

      expect(rows[0]?.ok).toBe(true);
    });
  });

  describe('permission vocabulary', () => {
    it('declares the seven appointment and availability permissions', () => {
      expect(
        PERMISSIONS.filter((permission) =>
          /^(?:appointment|availability)\./.test(permission),
        ).sort(),
      ).toEqual([
        'appointment.cancel',
        'appointment.create',
        'appointment.read',
        'appointment.record_outcome',
        'appointment.update',
        'availability.manage',
        'availability.read',
      ]);
    });

    it('declares no appointment void permission', () => {
      expect(PERMISSIONS).not.toContain('appointment.void');
    });

    it('grants none of them to any role in this checkpoint', () => {
      // A1 fixes the vocabulary; the grants belong to the checkpoints that build
      // the surfaces using them. `ROLE_PERMISSIONS` is unchanged here, so the
      // receptionist still holds exactly the Milestone 3 family and child set.
      const granted = permissionsForRole('RECEPTIONIST');

      for (const permission of granted) {
        expect(permission).toMatch(/^(?:family|child)\./);
      }
    });
  });
});
