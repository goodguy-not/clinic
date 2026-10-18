import request from 'supertest';
import { publicServiceListResponseSchema, serviceResponseSchema } from '@clinic/contracts';
import { createHarness, internalHeaders, resetDatabase, type Harness } from './harness';
import { as, auditActionsFor, loginAs } from './website-support';

/**
 * A service's public face, maintained through the manager form that already
 * existed.
 *
 * Milestone 9, checkpoint A2. A1 added `public_slug` and
 * `public_first_published_at` to the catalog row and left them with no writer;
 * the accepted decision was that they belong on the EXISTING service form under
 * the EXISTING `service.update`, because publishing a service is not a separate
 * authority from editing one (DECISION_LOG, 2026-08-21). This suite is the
 * proof that the whole loop closes without SQL.
 *
 * Everything is synthetic.
 */
describe('service public presentation (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: string;
  let receptionist: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    manager = await loginAs(harness, 'MANAGER');
    receptionist = await loginAs(harness, 'RECEPTIONIST');
  });

  const server = () => harness.app.getHttpServer();

  const serviceBody = (overrides: Record<string, unknown> = {}) => ({
    name: `خدمت نمونه ${Math.floor(Math.random() * 1e6)}`,
    publicDescription: null,
    isPublic: false,
    allowedDurationsMinutes: [30, 45],
    ...overrides,
  });

  async function createService(overrides: Record<string, unknown> = {}): Promise<string> {
    const response = await request(server())
      .post('/catalog/services')
      .set(as(manager))
      .send(serviceBody(overrides));

    expect(response.status).toBe(201);
    return serviceResponseSchema.parse(response.body).service.id;
  }

  const update = (id: string, body: Record<string, unknown>) =>
    request(server()).patch(`/catalog/services/${id}`).set(as(manager)).send(body);

  const read = async (id: string) =>
    serviceResponseSchema.parse(
      (await request(server()).get(`/catalog/services/${id}`).set(as(manager))).body,
    ).service;

  describe('publishing without SQL', () => {
    it('takes a private service onto the website at its assigned address, and off again', async () => {
      const id = await createService();
      const { name, publicSlug } = await read(id);

      const publishedResponse = await update(id, {
        name,
        publicDescription: 'شرح عمومی نمونه.',
        isPublic: true,
        allowedDurationsMinutes: [30, 45],
      });

      const listed = await request(server()).get('/public/services').set(internalHeaders());

      expect(publishedResponse.status).toBe(200);
      expect(publicServiceListResponseSchema.parse(listed.body).services).toEqual([
        { slug: publicSlug, name, description: 'شرح عمومی نمونه.', image: null },
      ]);

      await update(id, {
        name,
        publicDescription: 'شرح عمومی نمونه.',
        isPublic: false,
        allowedDurationsMinutes: [30, 45],
      });

      const afterWithdrawal = await request(server())
        .get('/public/services')
        .set(internalHeaders());

      expect(publicServiceListResponseSchema.parse(afterWithdrawal.body).services).toEqual([]);
    });
  });

  describe('the address (M10-A10, T-010)', () => {
    it('is assigned at creation, distinct per service, and never typed', async () => {
      const first = await read(await createService());
      const second = await read(await createService());

      expect(first.publicSlug).toMatch(/^[2-9bcdfghjkmnpqrstvwxz]{8}$/);
      expect(second.publicSlug).toMatch(/^[2-9bcdfghjkmnpqrstvwxz]{8}$/);
      expect(first.publicSlug).not.toBe(second.publicSlug);

      const typed = await update(first.id, {
        name: first.name,
        publicDescription: null,
        isPublic: true,
        publicSlug: 'a-typed-address',
        allowedDurationsMinutes: [30, 45],
      });
      expect(typed.status).toBe(400);
      expect(typed.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('is the same before, during and after publication', async () => {
      const id = await createService();
      const { name, publicSlug } = await read(id);
      const edit = (isPublic: boolean) =>
        update(id, { name, publicDescription: null, isPublic, allowedDurationsMinutes: [30, 45] });

      await edit(true);
      await edit(false);
      await edit(true);

      expect((await read(id)).publicSlug).toBe(publicSlug);
    });

    it('is refused a change by the database, published or not', async () => {
      const id = await createService();

      await expect(
        harness.prisma.$executeRaw`UPDATE service SET public_slug = 'moved' WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/public_slug is immutable once assigned/);
      await expect(
        harness.prisma.$executeRaw`UPDATE service SET public_slug = NULL WHERE id = ${id}::uuid`,
      ).rejects.toThrow();
    });
  });

  describe('authority and audit', () => {
    it('still refuses a receptionist, exactly as it did before the public columns existed', async () => {
      const id = await createService();

      const attempt = await request(server())
        .patch(`/catalog/services/${id}`)
        .set(as(receptionist))
        .send(serviceBody({ isPublic: true }));

      expect(attempt.status).toBe(403);
      expect(attempt.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('records the publication as `service.updated`, with both sides of every public column', async () => {
      // ONE ACTION, NOT TWO. Publishing a service is the same form, the same
      // authority and the same state change as editing one.
      const id = await createService();
      const created = await read(id);

      await update(id, {
        name: created.name,
        publicDescription: 'شرح عمومی نمونه.',
        isPublic: true,
        allowedDurationsMinutes: [30, 45],
      });

      expect(await auditActionsFor(harness, 'service', id)).toEqual([
        'service.created',
        'service.updated',
      ]);

      const rows = await harness.prisma.$queryRaw<
        { before: Record<string, unknown>; after: Record<string, unknown> }[]
      >`
        SELECT before, after FROM audit_log
        WHERE entity_type = 'service' AND entity_id = ${id}::uuid AND action = 'service.updated'
      `;

      expect(rows[0]!.before).toMatchObject({ isPublic: false, publicSlug: created.publicSlug });
      expect(rows[0]!.after).toMatchObject({ isPublic: true, publicSlug: created.publicSlug });
    });
  });
});
