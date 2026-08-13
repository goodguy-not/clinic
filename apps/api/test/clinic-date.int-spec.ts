import { createHarness, type Harness } from './harness';

/**
 * The clinic's own calendar day.
 *
 * A birth date is refused when it is after today — and "today" has three
 * plausible wrong answers: UTC, the timezone the Node process happens to run
 * under, and whatever the database session's `TimeZone` is set to. Tehran is
 * UTC+03:30 with no daylight saving, so its date rolls over at 20:30 UTC. For
 * three and a half hours of every evening the wrong answer differs from the
 * right one, which is long enough for a receptionist entering today's date to
 * be told it is in the future.
 *
 * `clinic_date()` uses `AT TIME ZONE 'Asia/Tehran'` explicitly, so it depends on
 * none of those three. These tests state that as a property rather than trusting
 * the implementation to read correctly.
 */
describe('clinic_date (real PostgreSQL)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  // No resetDatabase: this touches no table.

  /** 20:30 UTC is exactly midnight in Tehran. */
  const JUST_BEFORE_TEHRAN_MIDNIGHT = '2026-08-06 20:29:00+00';
  const JUST_AFTER_TEHRAN_MIDNIGHT = '2026-08-06 20:31:00+00';

  async function clinicDate(instant: string): Promise<string> {
    const rows = await harness.prisma.$queryRaw<{ result: string }[]>`
      SELECT clinic_date(${instant}::timestamptz)::text AS result
    `;
    return rows[0]?.result ?? '';
  }

  it('rolls over at Tehran midnight, not UTC midnight', async () => {
    expect(await clinicDate(JUST_BEFORE_TEHRAN_MIDNIGHT)).toBe('2026-08-06');
    expect(await clinicDate(JUST_AFTER_TEHRAN_MIDNIGHT)).toBe('2026-08-07');
  });

  it('gives the same answer whatever the session TimeZone is', async () => {
    // The failure this rules out is a deployment where the database session
    // timezone is set from the host rather than left alone.
    for (const zone of ['UTC', 'America/New_York', 'Asia/Tehran', 'Pacific/Kiritimati']) {
      await harness.prisma.$executeRawUnsafe(`SET TimeZone = '${zone}'`);

      expect(await clinicDate(JUST_BEFORE_TEHRAN_MIDNIGHT)).toBe('2026-08-06');
      expect(await clinicDate(JUST_AFTER_TEHRAN_MIDNIGHT)).toBe('2026-08-07');
    }

    await harness.prisma.$executeRawUnsafe('RESET TimeZone');
  });

  it('does not consult the Node process timezone', async () => {
    // The date is computed entirely inside PostgreSQL, so `process.env.TZ` is
    // not an input. Changing it must change nothing.
    const original = process.env['TZ'];

    try {
      for (const zone of ['UTC', 'America/New_York', 'Pacific/Kiritimati']) {
        process.env['TZ'] = zone;

        expect(await clinicDate(JUST_BEFORE_TEHRAN_MIDNIGHT)).toBe('2026-08-06');
        expect(await clinicDate(JUST_AFTER_TEHRAN_MIDNIGHT)).toBe('2026-08-07');
      }
    } finally {
      if (original === undefined) delete process.env['TZ'];
      else process.env['TZ'] = original;
    }
  });

  it('defaults to the transaction clock', async () => {
    // Production calls it with no argument. It must agree with the same
    // transaction's own timestamp, so a state change and the date it is
    // measured against cannot come from two different instants.
    const rows = await harness.prisma.$queryRaw<{ same: boolean }[]>`
      SELECT clinic_date() = (transaction_timestamp() AT TIME ZONE 'Asia/Tehran')::date AS same
    `;

    expect(rows[0]?.same).toBe(true);
  });

  it('is STABLE rather than IMMUTABLE, which is why the rule is not a CHECK', async () => {
    // A timezone definition can change, so PostgreSQL will not accept this in a
    // CHECK constraint. The future-birth-date rule therefore lives in the
    // service, and this test records why rather than leaving it to a comment.
    const rows = await harness.prisma.$queryRaw<{ volatility: string }[]>`
      SELECT p.provolatile::text AS volatility
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'clinic_date'
    `;

    expect(rows[0]?.volatility).toBe('s');
  });

  /**
   * The other direction: a clinic day and a wall clock back to the instant.
   *
   * Recurrence repeats "Saturdays at ten", so it needs the inverse of
   * `clinic_date` and `clinic_clock_time` rather than arithmetic on a timestamp.
   * `Asia/Tehran` is written in this function and nowhere in the appointment
   * module, which is the property these assertions are really about.
   */
  describe('clinic_moment', () => {
    async function clinicMoment(day: string, wallClock: string): Promise<string> {
      const rows = await harness.prisma.$queryRaw<{ moment: Date }[]>`
        SELECT clinic_moment(${day}::date, ${wallClock}::time) AS moment
      `;
      return rows[0]?.moment.toISOString() ?? '';
    }

    it('reads a wall-clock time as Tehran, not as UTC', async () => {
      // 10:00 Tehran is 06:30 UTC: the offset is +03:30 and there is no DST.
      expect(await clinicMoment('2026-09-05', '10:00')).toBe('2026-09-05T06:30:00.000Z');
    });

    it('agrees with clinic_day_start at midnight', async () => {
      const rows = await harness.prisma.$queryRaw<{ same: boolean }[]>`
        SELECT clinic_moment('2026-09-05'::date, '00:00'::time)
             = clinic_day_start('2026-09-05'::date) AS same
      `;

      expect(rows[0]?.same).toBe(true);
    });

    it('round-trips with clinic_date and clinic_clock_time', async () => {
      const rows = await harness.prisma.$queryRaw<{ day: string; wall: string }[]>`
        WITH moment AS (SELECT clinic_moment('2026-09-05'::date, '23:45'::time) AS ts)
        SELECT clinic_date(ts)::text AS day, clinic_clock_time(ts) AS wall FROM moment
      `;

      expect(rows[0]).toEqual({ day: '2026-09-05', wall: '23:45' });
    });

    it('keeps the hour when a week is added to the day, which is what a series repeats', async () => {
      const first = await clinicMoment('2026-09-05', '10:00');
      const eighth = await clinicMoment('2026-09-12', '10:00');

      expect(first.slice(11)).toBe(eighth.slice(11));
    });

    it('is STABLE, for the reason clinic_date is', async () => {
      const rows = await harness.prisma.$queryRaw<{ volatility: string }[]>`
        SELECT p.provolatile::text AS volatility
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'clinic_moment'
      `;

      expect(rows[0]?.volatility).toBe('s');
    });
  });
});
