import request from 'supertest';
import {
  availabilityExceptionListResponseSchema,
  availabilityExceptionResponseSchema,
  availabilityWindowListResponseSchema,
  loginResponseSchema,
  resolveAvailabilityResponseSchema,
  therapistResponseSchema,
} from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
import {
  createHarness,
  internalHeaders,
  resetDatabase,
  seedUser,
  TEST_PASSWORD,
  type Harness,
} from './harness';

/**
 * Therapist availability over real HTTP against real PostgreSQL.
 *
 * Everything is synthetic: no real therapist, schedule or day off appears in any
 * fixture. The dates are ordinary Gregorian days chosen for their weekday.
 *
 * WEEKDAY REFERENCE, used throughout and asserted directly below:
 * 2026-09-05 is a Saturday, so it is weekday 0 in the clinic's numbering.
 * 2026-09-06 is a Sunday and weekday 1; 2026-09-11 is a Friday and weekday 6.
 */
describe('therapist availability (real PostgreSQL)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  const server = () => harness.app.getHttpServer();
  const asUser = (token: string) => internalHeaders({ 'x-session-id': token });

  const SATURDAY = '2026-09-05';
  const SUNDAY = '2026-09-06';
  const FRIDAY = '2026-09-11';

  async function signIn(role: 'MANAGER' | 'RECEPTIONIST') {
    const user = await seedUser(harness, { role });
    const response = await request(server())
      .post('/auth/login')
      .set(internalHeaders())
      .send({ username: user.username, password: TEST_PASSWORD });

    return { user, token: loginResponseSchema.parse(response.body).sessionToken };
  }

  async function makeTherapist(token: string, fullName = 'Synthetic Therapist') {
    const response = await request(server())
      .post('/catalog/therapists')
      .set(asUser(token))
      .send({ fullName, specialty: 'Synthetic Specialty', supportedServiceIds: [] });

    return therapistResponseSchema.parse(response.body).therapist.id;
  }

  function window(overrides: Record<string, unknown> = {}) {
    return { weekday: 0, startTime: '09:00', endTime: '13:00', ...overrides };
  }

  const putWindows = (token: string, therapistId: string, windows: unknown[]) =>
    request(server())
      .put(`/availability/therapists/${therapistId}/windows`)
      .set(asUser(token))
      .send({ windows });

  const postException = (token: string, therapistId: string, body: Record<string, unknown>) =>
    request(server())
      .post(`/availability/therapists/${therapistId}/exceptions`)
      .set(asUser(token))
      .send(body);

  const resolve = (token: string, therapistId: string, date: string) =>
    request(server())
      .get('/availability/resolution')
      .query({ therapistId, date })
      .set(asUser(token));

  describe('managing the recurring week', () => {
    it('stores a week and reads it back in the shape the contract promises', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const written = await putWindows(token, therapistId, [
        window({ weekday: 1, startTime: '16:00', endTime: '19:00' }),
        window(),
      ]);

      expect(written.status).toBe(200);

      const body = availabilityWindowListResponseSchema.parse(written.body);

      // Ordered by weekday then start, which is the order a schedule is read in.
      expect(body.windows.map((entry) => [entry.weekday, entry.startTime])).toEqual([
        [0, '09:00'],
        [1, '16:00'],
      ]);

      // Wall-clock values, never instants: a `T` here would mean a `Date`
      // escaped the service.
      expect(body.windows[0]?.startTime).toBe('09:00');

      // A window is a weekday, two times and its own provenance. No date of any
      // kind: current configuration has no start and no end.
      expect(Object.keys(body.windows[0] ?? {}).sort()).toEqual([
        'createdAt',
        'endTime',
        'id',
        'startTime',
        'therapistId',
        'weekday',
      ]);

      const listed = await request(server())
        .get(`/availability/therapists/${therapistId}/windows`)
        .set(asUser(token));

      expect(availabilityWindowListResponseSchema.parse(listed.body).windows).toHaveLength(2);
    });

    it('replaces the set wholesale, so an omitted window is gone', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      await putWindows(token, therapistId, [window(), window({ weekday: 1 })]);
      const replaced = await putWindows(token, therapistId, [window({ weekday: 2 })]);

      const body = availabilityWindowListResponseSchema.parse(replaced.body);

      expect(body.windows.map((entry) => entry.weekday)).toEqual([2]);
    });

    it('accepts an empty week, which clears the standing hours', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      await putWindows(token, therapistId, [window()]);
      const cleared = await putWindows(token, therapistId, []);

      expect(cleared.status).toBe(200);
      expect(availabilityWindowListResponseSchema.parse(cleared.body).windows).toEqual([]);
    });

    it('refuses a window that tries to carry an effective date', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      // Recurring availability is current configuration. A dated window would be
      // effective-dated availability history, which is not approved — the strict
      // request shape refuses it here, and there is no column left to store one
      // in even if it were let through.
      for (const dated of [
        { effectiveFrom: '2026-01-01' },
        { effectiveTo: '2026-06-30' },
        { validFrom: '2026-01-01' },
      ]) {
        const response = await putWindows(token, therapistId, [window(dated)]);

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('refuses a submission that contradicts itself, before writing anything', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      await putWindows(token, therapistId, [window({ startTime: '08:00', endTime: '09:00' })]);

      const refused = await putWindows(token, therapistId, [
        window(),
        window({ startTime: '12:00', endTime: '15:00' }),
      ]);

      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('AVAILABILITY_WINDOW_OVERLAP');

      // The previous week survived: a refused replacement must leave the
      // schedule as it was, not half-applied and not empty.
      const listed = await request(server())
        .get(`/availability/therapists/${therapistId}/windows`)
        .set(asUser(token));

      expect(availabilityWindowListResponseSchema.parse(listed.body).windows).toHaveLength(1);
      expect(availabilityWindowListResponseSchema.parse(listed.body).windows[0]?.startTime).toBe(
        '08:00',
      );
    });

    it('allows two blocks on one day, and the same hours on another weekday', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const response = await putWindows(token, therapistId, [
        window({ startTime: '09:00', endTime: '13:00' }),
        // Back-to-back, which is the normal shape of a clinic day.
        window({ startTime: '13:00', endTime: '17:00' }),
        window({ weekday: 1 }),
      ]);

      expect(response.status).toBe(200);
      expect(availabilityWindowListResponseSchema.parse(response.body).windows).toHaveLength(3);
    });

    it('refuses the same hours twice, which no date can now excuse', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const response = await putWindows(token, therapistId, [window(), window()]);

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('AVAILABILITY_WINDOW_OVERLAP');
    });

    it('refuses a window that ends before it starts, as a validation error', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const response = await putWindows(token, therapistId, [window({ endTime: '08:00' })]);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('refuses seconds in a working hour, which the contract cannot express', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const response = await putWindows(token, therapistId, [window({ startTime: '09:00:30' })]);

      expect(response.status).toBe(400);
    });

    it('refuses a weekday outside the Saturday-first range', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      expect((await putWindows(token, therapistId, [window({ weekday: 7 })])).status).toBe(400);
      expect((await putWindows(token, therapistId, [window({ weekday: -1 })])).status).toBe(400);
      expect((await putWindows(token, therapistId, [window({ weekday: 6 })])).status).toBe(200);
    });

    it('refuses an unknown therapist and an inactive one differently', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const unknown = await putWindows(token, uuidv7(), [window()]);
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('THERAPIST_NOT_FOUND');

      await request(server())
        .patch(`/catalog/therapists/${therapistId}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });

      const inactive = await putWindows(token, therapistId, [window()]);
      expect(inactive.status).toBe(422);
      expect(inactive.body.error.code).toBe('THERAPIST_INACTIVE');

      // Reading stays open: hours a past appointment was booked against were
      // real at the time, and deactivation does not make them unreadable.
      const listed = await request(server())
        .get(`/availability/therapists/${therapistId}/windows`)
        .set(asUser(token));

      expect(listed.status).toBe(200);
    });
  });

  describe('dated exceptions', () => {
    it('records a closed day and an extra window on the same therapist', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const closed = await postException(token, therapistId, {
        isAvailable: false,
        exceptionDate: SATURDAY,
        reason: 'مرخصی',
      });

      expect(closed.status).toBe(201);

      const closedBody = availabilityExceptionResponseSchema.parse(closed.body);
      expect(closedBody.exception.isAvailable).toBe(false);
      expect(closedBody.exception.startTime).toBeNull();
      expect(closedBody.exception.exceptionDate).toBe(SATURDAY);

      const extra = await postException(token, therapistId, {
        isAvailable: true,
        exceptionDate: SUNDAY,
        startTime: '16:00',
        endTime: '19:00',
        reason: null,
      });

      expect(extra.status).toBe(201);
      expect(availabilityExceptionResponseSchema.parse(extra.body).exception.startTime).toBe(
        '16:00',
      );
    });

    it('refuses a second exception that collides on one date', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      await postException(token, therapistId, {
        isAvailable: true,
        exceptionDate: SATURDAY,
        startTime: '16:00',
        endTime: '19:00',
        reason: null,
      });

      const overlapping = await postException(token, therapistId, {
        isAvailable: true,
        exceptionDate: SATURDAY,
        startTime: '18:00',
        endTime: '20:00',
        reason: null,
      });

      expect(overlapping.status).toBe(409);
      expect(overlapping.body.error.code).toBe('AVAILABILITY_EXCEPTION_CONFLICT');

      // A closure alongside an extra window is the arrangement "not my usual
      // hours this Saturday, these instead", and is deliberately allowed.
      const closing = await postException(token, therapistId, {
        isAvailable: false,
        exceptionDate: SATURDAY,
        reason: null,
      });

      expect(closing.status).toBe(201);

      // A second closure of the same date is not: a day is suspended once or
      // not at all.
      const closedAgain = await postException(token, therapistId, {
        isAvailable: false,
        exceptionDate: SATURDAY,
        reason: null,
      });

      expect(closedAgain.status).toBe(409);
      expect(closedAgain.body.error.code).toBe('AVAILABILITY_EXCEPTION_CONFLICT');

      // Back-to-back extra windows on one date are legitimate, as they are for
      // recurring blocks.
      const adjacent = await postException(token, therapistId, {
        isAvailable: true,
        exceptionDate: SATURDAY,
        startTime: '19:00',
        endTime: '21:00',
        reason: null,
      });

      expect(adjacent.status).toBe(201);
    });

    it('lets a day be closed twice for two different therapists', async () => {
      const { token } = await signIn('MANAGER');
      const first = await makeTherapist(token, 'Synthetic Therapist One');
      const second = await makeTherapist(token, 'Synthetic Therapist Two');

      const body = { isAvailable: false, exceptionDate: SATURDAY, reason: null };

      expect((await postException(token, first, body)).status).toBe(201);
      expect((await postException(token, second, body)).status).toBe(201);
    });

    it('lists exceptions in a date range, closed days first within a date', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      await postException(token, therapistId, {
        isAvailable: true,
        exceptionDate: SUNDAY,
        startTime: '16:00',
        endTime: '19:00',
        reason: null,
      });
      await postException(token, therapistId, {
        isAvailable: false,
        exceptionDate: SATURDAY,
        reason: null,
      });
      await postException(token, therapistId, {
        isAvailable: false,
        exceptionDate: FRIDAY,
        reason: null,
      });

      const listed = await request(server())
        .get(`/availability/therapists/${therapistId}/exceptions`)
        .query({ from: SATURDAY, to: SUNDAY })
        .set(asUser(token));

      const body = availabilityExceptionListResponseSchema.parse(listed.body);

      expect(body.exceptions.map((entry) => entry.exceptionDate)).toEqual([SATURDAY, SUNDAY]);
    });

    it('removes an exception, and refuses one belonging to another therapist', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token, 'Synthetic Therapist One');
      const other = await makeTherapist(token, 'Synthetic Therapist Two');

      const created = await postException(token, therapistId, {
        isAvailable: false,
        exceptionDate: SATURDAY,
        reason: null,
      });

      const { id } = availabilityExceptionResponseSchema.parse(created.body).exception;

      // Another therapist's exception is indistinguishable from one that does
      // not exist, so the route cannot be used to probe for ids.
      const wrongOwner = await request(server())
        .delete(`/availability/therapists/${other}/exceptions/${id}`)
        .set(asUser(token));

      expect(wrongOwner.status).toBe(404);
      expect(wrongOwner.body.error.code).toBe('AVAILABILITY_EXCEPTION_NOT_FOUND');

      const removed = await request(server())
        .delete(`/availability/therapists/${therapistId}/exceptions/${id}`)
        .set(asUser(token));

      expect(removed.status).toBe(204);

      const listed = await request(server())
        .get(`/availability/therapists/${therapistId}/exceptions`)
        .set(asUser(token));

      expect(availabilityExceptionListResponseSchema.parse(listed.body).exceptions).toEqual([]);
    });
  });

  describe('resolving one date', () => {
    it('numbers the weekday from Saturday', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const saturday = await resolve(token, therapistId, SATURDAY);
      const sunday = await resolve(token, therapistId, SUNDAY);
      const friday = await resolve(token, therapistId, FRIDAY);

      expect(resolveAvailabilityResponseSchema.parse(saturday.body).availability.weekday).toBe(0);
      expect(resolveAvailabilityResponseSchema.parse(sunday.body).availability.weekday).toBe(1);
      expect(resolveAvailabilityResponseSchema.parse(friday.body).availability.weekday).toBe(6);
    });

    it('returns the whole weekday, because every window is in force', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      await putWindows(token, therapistId, [
        window({ weekday: 0 }),
        window({ weekday: 0, startTime: '14:00', endTime: '18:00' }),
      ]);

      const body = resolveAvailabilityResponseSchema.parse(
        (await resolve(token, therapistId, SATURDAY)).body,
      );

      expect(body.availability.isClosed).toBe(false);
      expect(body.availability.windows).toEqual([
        { startTime: '09:00', endTime: '13:00' },
        { startTime: '14:00', endTime: '18:00' },
      ]);
    });

    it('answers a past date and a far-future date identically', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      await putWindows(token, therapistId, [window({ weekday: 0 })]);

      // Current configuration has no start and no end, so the same Saturday
      // hours are the answer for a Saturday last year and one in ten years.
      // A dated model would silently answer "nothing" for the past one.
      for (const saturday of ['2019-09-07', SATURDAY, '2036-09-06']) {
        const body = resolveAvailabilityResponseSchema.parse(
          (await resolve(token, therapistId, saturday)).body,
        );

        expect(body.availability.windows).toEqual([{ startTime: '09:00', endTime: '13:00' }]);
      }
    });

    it('reads an empty day and a closed day as different facts', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const empty = resolveAvailabilityResponseSchema.parse(
        (await resolve(token, therapistId, SATURDAY)).body,
      );

      expect(empty.availability.isClosed).toBe(false);
      expect(empty.availability.windows).toEqual([]);

      await putWindows(token, therapistId, [window()]);
      await postException(token, therapistId, {
        isAvailable: false,
        exceptionDate: SATURDAY,
        reason: 'مرخصی',
      });

      const closed = resolveAvailabilityResponseSchema.parse(
        (await resolve(token, therapistId, SATURDAY)).body,
      );

      // A closure suspends the recurring week, and says why.
      expect(closed.availability.isClosed).toBe(true);
      expect(closed.availability.closedReason).toBe('مرخصی');
      expect(closed.availability.windows).toEqual([]);
    });

    it('keeps a dated window on a day whose ordinary week was suspended', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      // "Not my usual Saturday morning this week, but I will come in for 15:00
      // to 18:00." The closure and the extra window together are the only way to
      // record that, which is why the database permits the pair.
      await putWindows(token, therapistId, [window({ weekday: 0 })]);
      await postException(token, therapistId, {
        isAvailable: false,
        exceptionDate: SATURDAY,
        reason: 'ساعت کاری متفاوت',
      });
      await postException(token, therapistId, {
        isAvailable: true,
        exceptionDate: SATURDAY,
        startTime: '15:00',
        endTime: '18:00',
        reason: null,
      });

      const body = resolveAvailabilityResponseSchema.parse(
        (await resolve(token, therapistId, SATURDAY)).body,
      );

      // The recurring 09:00-13:00 is gone; the dated window stands. `isClosed`
      // explains why the day differs and is not the bookability test.
      expect(body.availability.isClosed).toBe(true);
      expect(body.availability.windows).toEqual([{ startTime: '15:00', endTime: '18:00' }]);
    });

    it('adds a dated extra window to the recurring week and merges what touches', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      await putWindows(token, therapistId, [window({ weekday: 0 })]);

      await postException(token, therapistId, {
        isAvailable: true,
        exceptionDate: SATURDAY,
        startTime: '13:00',
        endTime: '17:00',
        reason: null,
      });
      await postException(token, therapistId, {
        isAvailable: true,
        exceptionDate: SATURDAY,
        startTime: '19:00',
        endTime: '21:00',
        reason: null,
      });

      const body = resolveAvailabilityResponseSchema.parse(
        (await resolve(token, therapistId, SATURDAY)).body,
      );

      // 09:00-13:00 recurring plus 13:00-17:00 dated is one unbroken stretch;
      // the evening window is genuinely separate and stays so.
      expect(body.availability.windows).toEqual([
        { startTime: '09:00', endTime: '17:00' },
        { startTime: '19:00', endTime: '21:00' },
      ]);
    });

    it('does not leak another weekday’s hours into the date', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      await putWindows(token, therapistId, [window({ weekday: 1 })]);

      const body = resolveAvailabilityResponseSchema.parse(
        (await resolve(token, therapistId, SATURDAY)).body,
      );

      expect(body.availability.windows).toEqual([]);
    });

    it('refuses to resolve an unknown therapist rather than reporting an empty day', async () => {
      const { token } = await signIn('MANAGER');

      const response = await resolve(token, uuidv7(), SATURDAY);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('THERAPIST_NOT_FOUND');
    });
  });

  describe('who may do this', () => {
    it('lets a receptionist read availability and refuses every write', async () => {
      const manager = await signIn('MANAGER');
      const therapistId = await makeTherapist(manager.token);
      const { token } = await signIn('RECEPTIONIST');

      // From the Milestone 4 booking checkpoint a receptionist holds
      // `availability.read`: a booking screen has to show when a therapist works.
      // Maintaining that schedule is `availability.manage` and stays with the
      // manager (PROJECT_SPEC.md 4).
      const reads = await Promise.all([
        request(server()).get(`/availability/therapists/${therapistId}/windows`).set(asUser(token)),
        request(server())
          .get(`/availability/therapists/${therapistId}/exceptions`)
          .set(asUser(token)),
        resolve(token, therapistId, SATURDAY),
      ]);

      for (const response of reads) {
        expect(response.status).toBe(200);
      }

      const writes = await Promise.all([
        putWindows(token, therapistId, [window()]),
        postException(token, therapistId, {
          isAvailable: false,
          exceptionDate: SATURDAY,
          reason: null,
        }),
      ]);

      for (const response of writes) {
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
      }
    });

    it('refuses an unauthenticated caller', async () => {
      const manager = await signIn('MANAGER');
      const therapistId = await makeTherapist(manager.token);

      const response = await request(server())
        .get(`/availability/therapists/${therapistId}/windows`)
        .set(internalHeaders());

      expect(response.status).toBe(401);
    });
  });

  describe('the audit trail', () => {
    type AuditRow = {
      action: string;
      entity_type: string;
      entity_id: string;
      before: unknown;
      after: unknown;
      metadata: unknown;
    };

    const readAudit = (): Promise<AuditRow[]> =>
      harness.prisma.$queryRaw<AuditRow[]>`
        SELECT action, entity_type, entity_id, before, after, metadata
        FROM audit_log
        WHERE action = 'therapist_availability.updated'
        ORDER BY occurred_at ASC, id ASC
      `;

    it('records a replacement as the two sets, against the therapist', async () => {
      const { token, user } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      await putWindows(token, therapistId, [window()]);
      await putWindows(token, therapistId, [window({ startTime: '10:00', endTime: '12:00' })]);

      const rows = await readAudit();

      expect(rows).toHaveLength(2);

      // Named against the therapist, never against a window id: the rows are
      // replaced as a set and an id would name nothing after the write.
      expect(rows[0]?.entity_type).toBe('therapist');
      expect(rows[0]?.entity_id).toBe(therapistId);
      expect(rows[0]?.metadata).toEqual({ change: 'windows_replaced' });

      // The two sets, as weekday and hours. No effective dates: they are the
      // same constant on every row and record nothing about what changed.
      expect(rows[0]?.before).toEqual({ windows: [] });
      expect(rows[1]?.before).toEqual({
        windows: [{ weekday: 0, startTime: '09:00', endTime: '13:00' }],
      });
      expect(rows[1]?.after).toEqual({
        windows: [{ weekday: 0, startTime: '10:00', endTime: '12:00' }],
      });

      const actors = await harness.prisma.$queryRaw<{ actor_user_id: string }[]>`
        SELECT actor_user_id FROM audit_log WHERE action = 'therapist_availability.updated'
      `;

      for (const actor of actors) expect(actor.actor_user_id).toBe(user.id);
    });

    it('records an exception being added and removed, keeping what it said', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      const created = await postException(token, therapistId, {
        isAvailable: false,
        exceptionDate: SATURDAY,
        reason: 'مرخصی',
      });

      const { id } = availabilityExceptionResponseSchema.parse(created.body).exception;

      await request(server())
        .delete(`/availability/therapists/${therapistId}/exceptions/${id}`)
        .set(asUser(token));

      const rows = await readAudit();

      expect(rows.map((row) => row.metadata)).toEqual([
        { change: 'exception_added' },
        { change: 'exception_removed' },
      ]);

      // The removed row is physically gone, so the audit entry is the only
      // remaining record of what it said — which is why it carries the values.
      expect(rows[1]?.before).toEqual({
        exception: {
          id,
          exceptionDate: SATURDAY,
          isAvailable: false,
          startTime: null,
          endTime: null,
          reason: 'مرخصی',
        },
      });
    });

    it('writes no audit row when the write is refused', async () => {
      const { token } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      await putWindows(token, therapistId, [window(), window()]);
      await postException(token, uuidv7(), {
        isAvailable: false,
        exceptionDate: SATURDAY,
        reason: null,
      });

      expect(await readAudit()).toEqual([]);
    });
  });

  describe('the database is the authority, not the service', () => {
    it('holds the two availability exclusion constraints by name', async () => {
      const rows = await harness.prisma.$queryRaw<{ conname: string; definition: string }[]>`
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE contype = 'x'
          AND conrelid::regclass::text IN (
            'therapist_availability', 'therapist_availability_exception'
          )
      `;

      const byName = new Map(rows.map((row) => [row.conname, row.definition]));

      expect([...byName.keys()].sort()).toEqual([
        'therapist_availability_exception_no_overlap_excl',
        'therapist_availability_no_overlap_excl',
      ]);

      // Half-open hours, so back-to-back blocks do not collide.
      expect(byName.get('therapist_availability_no_overlap_excl')).toContain("'[)'");

      // Therapist, Saturday-first weekday and hours. No date term, and no column
      // left to build one from.
      expect(byName.get('therapist_availability_no_overlap_excl')).toContain('therapist_id');
      expect(byName.get('therapist_availability_no_overlap_excl')).toContain('weekday');
      expect(byName.get('therapist_availability_no_overlap_excl')).not.toContain('daterange');
      expect(byName.get('therapist_availability_no_overlap_excl')).not.toContain('effective');

      // Extra windows only. A closure is one row per date, enforced by a partial
      // unique index, and may legitimately sit alongside a dated window.
      expect(byName.get('therapist_availability_exception_no_overlap_excl')).toContain(
        'is_available = true',
      );

      const closure = await harness.prisma.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
        WHERE indexname = 'therapist_availability_exception_one_closure_idx'
      `;

      expect(closure[0]?.indexdef).toMatch(/UNIQUE.*is_available = false/s);
    });

    it('refuses an overlapping window written straight to SQL', async () => {
      const { token, user } = await signIn('MANAGER');
      const therapistId = await makeTherapist(token);

      await putWindows(token, therapistId, [window()]);

      const insert = harness.prisma.$executeRaw`
        INSERT INTO therapist_availability (
          id, therapist_id, weekday, start_time, end_time, created_by_user_id
        ) VALUES (
          ${uuidv7()}::uuid, ${therapistId}::uuid, 0, '12:00'::time, '15:00'::time,
          ${user.id}::uuid
        )
      `;

      // SQLSTATE 23P01, exclusion_violation: the guarantee holds for a data-fix
      // script and for somebody at a psql prompt, not only for the service.
      await expect(insert).rejects.toThrow(/23P01/);
    });
  });
});
