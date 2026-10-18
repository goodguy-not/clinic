import request from 'supertest';
import { backupStatusResponseSchema } from '@clinic/contracts';
import { asUser, signIn } from './appointments-support';
import { createHarness, internalHeaders, resetDatabase, type Harness } from './harness';

/**
 * `GET /operations/backup-status` (Milestone 10, checkpoint A2) — the manager's
 * view of whether a recent backup exists off the server.
 *
 * What is proved here is the boundary: a manager reads it, a receptionist and a
 * caller without a session do not, and nothing about it needs a new permission.
 * The reading of the collector's status file is BackupStatusService's unit
 * suite; this harness has no collector configured, which is itself the
 * `NOT_CONFIGURED` warning a real deployment without one would show.
 */
describe('backup status (real PostgreSQL)', () => {
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

  const read = () => request(harness.app.getHttpServer()).get('/operations/backup-status');

  it('lets a manager read it, and warns when no collector is configured', async () => {
    const manager = await signIn(harness, 'MANAGER');

    const response = await read().set(asUser(manager.token));

    expect(response.status).toBe(200);
    expect(backupStatusResponseSchema.parse(response.body)).toMatchObject({
      state: 'NOT_CONFIGURED',
      warning: true,
      warningAfterHours: 72,
      offsiteCopy: null,
    });
  });

  it('refuses a receptionist: it widens no staff permission', async () => {
    const receptionist = await signIn(harness, 'RECEPTIONIST');

    const response = await read().set(asUser(receptionist.token));

    expect(response.status).toBe(403);
  });

  it('refuses a caller with no session', async () => {
    const response = await read().set(internalHeaders());

    expect(response.status).toBe(401);
  });
});
