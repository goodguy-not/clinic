import request from 'supertest';
import {
  loginResponseSchema,
  roomListResponseSchema,
  roomResponseSchema,
  serviceResponseSchema,
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
 * Treatment rooms over real HTTP against real PostgreSQL.
 *
 * The restriction semantics are the point of most of this file: an empty
 * allow-list means "any service", so the tests have to distinguish "no
 * restriction" from "restricted to nothing" at every step.
 *
 * Everything is synthetic. No real room or service name appears in any fixture.
 */
describe('catalog rooms (real PostgreSQL)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
  });

  const server = () => harness.app.getHttpServer();
  const asUser = (token: string) => internalHeaders({ 'x-session-id': token });

  async function signIn(role: 'MANAGER' | 'RECEPTIONIST') {
    const user = await seedUser(harness, { role });
    const response = await request(server())
      .post('/auth/login')
      .set(internalHeaders())
      .send({ username: user.username, password: TEST_PASSWORD });

    return { user, token: loginResponseSchema.parse(response.body).sessionToken };
  }

  async function createServiceFixture(token: string, name: string): Promise<string> {
    const response = await request(server())
      .post('/catalog/services')
      .set(asUser(token))
      .send({
        name,
        publicDescription: null,
        isPublic: false,
        allowedDurationsMinutes: [45],
      });

    return serviceResponseSchema.parse(response.body).service.id;
  }

  async function createRoom(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<request.Response> {
    return request(server())
      .post('/catalog/rooms')
      .set(asUser(token))
      .send({ name: 'Synthetic Room', allowedServiceIds: [], ...overrides });
  }

  describe('authorization', () => {
    const routes: Array<[string, 'get' | 'post' | 'patch', string, object | undefined]> = [
      // Reading is granted to a receptionist from the booking checkpoint; every
      // write below stays with the manager.
      ['create', 'post', '/catalog/rooms', { name: 'X', allowedServiceIds: [] }],
      ['update', 'patch', '/catalog/rooms/:id', { name: 'X', allowedServiceIds: [] }],
      ['status', 'patch', '/catalog/rooms/:id/status', { status: 'INACTIVE' }],
    ];

    it('lets a receptionist read, which booking requires', async () => {
      const manager = await signIn('MANAGER');
      const created = await createRoom(manager.token);
      const id = roomResponseSchema.parse(created.body).room.id;

      const { token } = await signIn('RECEPTIONIST');

      expect((await request(server()).get('/catalog/rooms').set(asUser(token))).status).toBe(200);
      expect((await request(server()).get(`/catalog/rooms/${id}`).set(asUser(token))).status).toBe(
        200,
      );
    });

    it.each(routes)('refuses a receptionist on %s', async (_label, method, path, body) => {
      const manager = await signIn('MANAGER');
      const created = await createRoom(manager.token);
      const id = roomResponseSchema.parse(created.body).room.id;

      const { token } = await signIn('RECEPTIONIST');
      const url = path.replace(':id', id);

      const response = await request(server())
        [method](url)
        .set(asUser(token))
        .send(body ?? {});

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
    });
  });

  describe('restriction semantics', () => {
    it('represents an unrestricted room as zero RoomService rows', async () => {
      const { token } = await signIn('MANAGER');

      const response = await createRoom(token, { allowedServiceIds: [] });

      expect(response.status).toBe(201);
      const { room } = roomResponseSchema.parse(response.body);
      expect(room.allowedServiceIds).toEqual([]);

      expect(await harness.prisma.roomService.count({ where: { roomId: room.id } })).toBe(0);
    });

    it('stores one row per service for a restricted room', async () => {
      const { token } = await signIn('MANAGER');
      const first = await createServiceFixture(token, 'Service A');
      const second = await createServiceFixture(token, 'Service B');

      const response = await createRoom(token, { allowedServiceIds: [first, second] });

      expect(response.status).toBe(201);
      const { room } = roomResponseSchema.parse(response.body);
      expect(room.allowedServiceIds).toHaveLength(2);
      expect(room.allowedServiceIds).toEqual(expect.arrayContaining([first, second]));

      expect(await harness.prisma.roomService.count({ where: { roomId: room.id } })).toBe(2);
    });

    it('replaces the whole restriction set atomically', async () => {
      const { token } = await signIn('MANAGER');
      const first = await createServiceFixture(token, 'Service A');
      const second = await createServiceFixture(token, 'Service B');
      const third = await createServiceFixture(token, 'Service C');

      const created = await createRoom(token, { allowedServiceIds: [first, second] });
      const id = roomResponseSchema.parse(created.body).room.id;

      const response = await request(server())
        .patch(`/catalog/rooms/${id}`)
        .set(asUser(token))
        .send({ name: 'Synthetic Room', allowedServiceIds: [third] });

      expect(response.status).toBe(200);
      const { room } = roomResponseSchema.parse(response.body);
      expect(room.allowedServiceIds).toEqual([third]);

      const rows = await harness.prisma.roomService.findMany({ where: { roomId: id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.serviceId).toBe(third);
    });

    it('can be narrowed to unrestricted by clearing the list', async () => {
      const { token } = await signIn('MANAGER');
      const service = await createServiceFixture(token, 'Service A');

      const created = await createRoom(token, { allowedServiceIds: [service] });
      const id = roomResponseSchema.parse(created.body).room.id;

      const response = await request(server())
        .patch(`/catalog/rooms/${id}`)
        .set(asUser(token))
        .send({ name: 'Synthetic Room', allowedServiceIds: [] });

      expect(response.status).toBe(200);
      expect(roomResponseSchema.parse(response.body).room.allowedServiceIds).toEqual([]);
      expect(await harness.prisma.roomService.count({ where: { roomId: id } })).toBe(0);
    });

    it('deduplicates a repeated service id', async () => {
      const { token } = await signIn('MANAGER');
      const service = await createServiceFixture(token, 'Service A');

      const response = await createRoom(token, { allowedServiceIds: [service, service] });

      expect(response.status).toBe(201);
      expect(roomResponseSchema.parse(response.body).room.allowedServiceIds).toEqual([service]);
    });

    it('rejects an unknown service id and writes nothing', async () => {
      const { token } = await signIn('MANAGER');

      const response = await createRoom(token, { allowedServiceIds: [uuidv7()] });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('SERVICE_NOT_FOUND');
      expect(await harness.prisma.room.count()).toBe(0);
      expect(await harness.prisma.auditLog.count({ where: { entityType: 'room' } })).toBe(0);
    });

    it('leaves the previous restrictions intact when an update names an unknown service', async () => {
      const { token } = await signIn('MANAGER');
      const service = await createServiceFixture(token, 'Service A');

      const created = await createRoom(token, { allowedServiceIds: [service] });
      const id = roomResponseSchema.parse(created.body).room.id;
      const auditBefore = await harness.prisma.auditLog.count();

      const response = await request(server())
        .patch(`/catalog/rooms/${id}`)
        .set(asUser(token))
        .send({ name: 'Renamed Room', allowedServiceIds: [uuidv7()] });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('SERVICE_NOT_FOUND');

      // The rename in the same request rolled back with the restriction change.
      const row = await harness.prisma.room.findUniqueOrThrow({ where: { id } });
      expect(row.name).toBe('Synthetic Room');

      const rows = await harness.prisma.roomService.findMany({ where: { roomId: id } });
      expect(rows.map((entry) => entry.serviceId)).toEqual([service]);

      expect(await harness.prisma.auditLog.count()).toBe(auditBefore);
    });

    it('keeps a restriction naming a service that was later deactivated', async () => {
      const { token } = await signIn('MANAGER');
      const service = await createServiceFixture(token, 'Service A');

      const created = await createRoom(token, { allowedServiceIds: [service] });
      const id = roomResponseSchema.parse(created.body).room.id;

      await request(server())
        .patch(`/catalog/services/${service}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });

      // Configuration somebody entered is not silently discarded because a
      // service was retired; reactivating the service must not have to restore
      // a decision nobody reversed.
      const response = await request(server()).get(`/catalog/rooms/${id}`).set(asUser(token));

      expect(response.status).toBe(200);
      expect(roomResponseSchema.parse(response.body).room.allowedServiceIds).toEqual([service]);
    });

    it('allows restricting to a service that is already inactive', async () => {
      const { token } = await signIn('MANAGER');
      const service = await createServiceFixture(token, 'Service A');

      await request(server())
        .patch(`/catalog/services/${service}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });

      // No approved rule forbids it, so none is invented here.
      const response = await createRoom(token, { allowedServiceIds: [service] });

      expect(response.status).toBe(201);
      expect(roomResponseSchema.parse(response.body).room.allowedServiceIds).toEqual([service]);
    });
  });

  describe('names', () => {
    it('persists a padded name in trimmed canonical form', async () => {
      const { token } = await signIn('MANAGER');

      const response = await createRoom(token, { name: '   Padded Room   ' });

      expect(response.status).toBe(201);
      const { room } = roomResponseSchema.parse(response.body);
      expect(room.name).toBe('Padded Room');

      const row = await harness.prisma.room.findUniqueOrThrow({ where: { id: room.id } });
      expect(row.name).toBe('Padded Room');
    });

    it('refuses to let "Name" and " Name " become two rooms', async () => {
      const { token } = await signIn('MANAGER');

      expect((await createRoom(token, { name: 'Duplicate Target' })).status).toBe(201);

      const padded = await createRoom(token, { name: '  Duplicate Target  ' });

      expect(padded.status).toBe(409);
      expect(padded.body.error.code).toBe('ROOM_NAME_TAKEN');
      expect(await harness.prisma.room.count()).toBe(1);
    });

    it('maps a duplicate name to ROOM_NAME_TAKEN', async () => {
      const { token } = await signIn('MANAGER');

      await createRoom(token);
      const duplicate = await createRoom(token);

      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('ROOM_NAME_TAKEN');
    });

    it.each(['', '   '])('rejects a blank name %j', async (name) => {
      const { token } = await signIn('MANAGER');

      const response = await createRoom(token, { name });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('enforces the maximum name length', async () => {
      const { token } = await signIn('MANAGER');

      expect((await createRoom(token, { name: 'x'.repeat(120) })).status).toBe(201);

      const tooLong = await createRoom(token, { name: 'y'.repeat(121) });
      expect(tooLong.status).toBe(400);
    });

    it('maps a duplicate rename to ROOM_NAME_TAKEN', async () => {
      const { token } = await signIn('MANAGER');
      await createRoom(token, { name: 'Existing Room' });
      const other = await createRoom(token, { name: 'Other Room' });
      const id = roomResponseSchema.parse(other.body).room.id;

      const response = await request(server())
        .patch(`/catalog/rooms/${id}`)
        .set(asUser(token))
        .send({ name: 'Existing Room', allowedServiceIds: [] });

      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('ROOM_NAME_TAKEN');
    });
  });

  describe('reading', () => {
    it('lists rooms by name and records the creator', async () => {
      const { user, token } = await signIn('MANAGER');

      await createRoom(token, { name: 'Beta Room' });
      await createRoom(token, { name: 'Alpha Room' });

      const response = await request(server()).get('/catalog/rooms').set(asUser(token));

      const { rooms } = roomListResponseSchema.parse(response.body);
      expect(rooms.map((room) => room.name)).toEqual(['Alpha Room', 'Beta Room']);

      const row = await harness.prisma.room.findFirstOrThrow({ where: { name: 'Alpha Room' } });
      expect(row.createdByUserId).toBe(user.id);
    });

    it('returns ROOM_NOT_FOUND for an unknown id', async () => {
      const { token } = await signIn('MANAGER');

      const response = await request(server()).get(`/catalog/rooms/${uuidv7()}`).set(asUser(token));

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('ROOM_NOT_FOUND');
    });

    it('returns ROOM_NOT_FOUND when updating an unknown id', async () => {
      const { token } = await signIn('MANAGER');

      const response = await request(server())
        .patch(`/catalog/rooms/${uuidv7()}`)
        .set(asUser(token))
        .send({ name: 'Anything', allowedServiceIds: [] });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('ROOM_NOT_FOUND');
    });
  });

  describe('activation', () => {
    it('deactivates, records the time, and reactivates clearing it', async () => {
      const { token } = await signIn('MANAGER');
      const created = await createRoom(token);
      const id = roomResponseSchema.parse(created.body).room.id;

      const off = await request(server())
        .patch(`/catalog/rooms/${id}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });

      expect(off.status).toBe(200);
      const deactivated = roomResponseSchema.parse(off.body).room;
      expect(deactivated.status).toBe('INACTIVE');
      expect(deactivated.deactivatedAt).not.toBeNull();

      const on = await request(server())
        .patch(`/catalog/rooms/${id}/status`)
        .set(asUser(token))
        .send({ status: 'ACTIVE' });

      const reactivated = roomResponseSchema.parse(on.body).room;
      expect(reactivated.status).toBe('ACTIVE');
      expect(reactivated.deactivatedAt).toBeNull();
    });

    it('keeps restrictions across deactivation and reactivation', async () => {
      const { token } = await signIn('MANAGER');
      const service = await createServiceFixture(token, 'Service A');
      const created = await createRoom(token, { allowedServiceIds: [service] });
      const id = roomResponseSchema.parse(created.body).room.id;

      await request(server())
        .patch(`/catalog/rooms/${id}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });
      const on = await request(server())
        .patch(`/catalog/rooms/${id}/status`)
        .set(asUser(token))
        .send({ status: 'ACTIVE' });

      expect(roomResponseSchema.parse(on.body).room.allowedServiceIds).toEqual([service]);
    });
  });

  describe('audit', () => {
    it('writes one row per mutation, naming the actor', async () => {
      const { user, token } = await signIn('MANAGER');

      const created = await createRoom(token);
      const id = roomResponseSchema.parse(created.body).room.id;

      await request(server())
        .patch(`/catalog/rooms/${id}`)
        .set(asUser(token))
        .send({ name: 'Renamed Room', allowedServiceIds: [] });

      await request(server())
        .patch(`/catalog/rooms/${id}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });

      const rows = await harness.prisma.auditLog.findMany({
        where: { entityType: 'room' },
        orderBy: { occurredAt: 'asc' },
      });

      expect(rows.map((row) => row.action)).toEqual([
        'room.created',
        'room.updated',
        'room.status_changed',
      ]);

      for (const row of rows) {
        expect(row.actorUserId).toBe(user.id);
        expect(row.entityId).toBe(id);
      }
    });

    it('shares one instant between the state change and its audit row', async () => {
      const { token } = await signIn('MANAGER');
      const created = await createRoom(token);
      const id = roomResponseSchema.parse(created.body).room.id;

      await request(server())
        .patch(`/catalog/rooms/${id}/status`)
        .set(asUser(token))
        .send({ status: 'INACTIVE' });

      const row = await harness.prisma.room.findUniqueOrThrow({ where: { id } });
      const audit = await harness.prisma.auditLog.findFirstOrThrow({
        where: { entityId: id, action: 'room.status_changed' },
      });

      expect(row.deactivatedAt?.toISOString()).toBe(audit.occurredAt.toISOString());
    });

    it('records whether the room is unrestricted', async () => {
      const { token } = await signIn('MANAGER');

      await createRoom(token);

      const row = await harness.prisma.auditLog.findFirstOrThrow({
        where: { action: 'room.created' },
      });

      expect((row.after as { unrestricted?: boolean }).unrestricted).toBe(true);
    });

    it('leaves no audit row when the mutation fails', async () => {
      const { token } = await signIn('MANAGER');
      await createRoom(token, { name: 'Taken Room' });

      const before = await harness.prisma.auditLog.count();

      expect((await createRoom(token, { name: 'Taken Room' })).status).toBe(409);

      expect(await harness.prisma.auditLog.count()).toBe(before);
    });
  });
});
