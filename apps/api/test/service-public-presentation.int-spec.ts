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
    await resetDatabase(harness.prisma);
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

  describe('publishing without SQL', () => {
    it('takes a private service onto the website and off again', async () => {
      const id = await createService();
      const name = serviceResponseSchema.parse(
        (await request(server()).get(`/catalog/services/${id}`).set(as(manager))).body,
      ).service.name;

      const publishedResponse = await update(id, {
        name,
        publicDescription: 'شرح عمومی نمونه.',
        isPublic: true,
        publicSlug: 'a-published-service',
        allowedDurationsMinutes: [30, 45],
      });

      const listed = await request(server()).get('/public/services').set(internalHeaders());

      expect(publishedResponse.status).toBe(200);
      expect(publicServiceListResponseSchema.parse(listed.body).services).toEqual([
        { slug: 'a-published-service', name, description: 'شرح عمومی نمونه.' },
      ]);

      await update(id, {
        name,
        publicDescription: 'شرح عمومی نمونه.',
        isPublic: false,
        publicSlug: 'a-published-service',
        allowedDurationsMinutes: [30, 45],
      });

      const afterWithdrawal = await request(server())
        .get('/public/services')
        .set(internalHeaders());

      expect(publicServiceListResponseSchema.parse(afterWithdrawal.body).services).toEqual([]);
    });

    it('leaves the slug alone when the request omits it', async () => {
      // Every caller written before Milestone 9 sends a body with no
      // `publicSlug`. Omitted means UNCHANGED, so those callers keep working and
      // cannot accidentally clear a published address.
      const id = await createService();
      const created = serviceResponseSchema.parse(
        (await request(server()).get(`/catalog/services/${id}`).set(as(manager))).body,
      ).service;

      await update(id, {
        name: created.name,
        publicDescription: null,
        isPublic: true,
        publicSlug: 'omitted-slug-test',
        allowedDurationsMinutes: [30, 45],
      });

      const legacyShapedEdit = await update(id, {
        name: created.name,
        publicDescription: 'شرح تازه.',
        isPublic: true,
        allowedDurationsMinutes: [30, 45],
      });

      expect(legacyShapedEdit.status).toBe(200);
      expect(serviceResponseSchema.parse(legacyShapedEdit.body).service.publicSlug).toBe(
        'omitted-slug-test',
      );
    });

    it('accepts an edit to a service flagged public with no address', async () => {
      // The state every Milestone 2 row was left in: `isPublic` true, no slug,
      // and therefore not on the website at all. Editing one must not be an
      // error, and must not claim its published content was revised — there is
      // none.
      const id = await createService({ isPublic: true });
      const created = serviceResponseSchema.parse(
        (await request(server()).get(`/catalog/services/${id}`).set(as(manager))).body,
      ).service;

      const edited = await update(id, {
        name: created.name,
        publicDescription: 'شرح داخلی نمونه.',
        isPublic: true,
        allowedDurationsMinutes: [30, 45],
      });

      const listed = await request(server()).get('/public/services').set(internalHeaders());

      expect(edited.status).toBe(200);
      expect(serviceResponseSchema.parse(edited.body).service.publicFirstPublishedAt).toBeNull();
      expect(publicServiceListResponseSchema.parse(listed.body).services).toEqual([]);
    });
  });

  describe('the slug', () => {
    it('is refused a rename once the URL has been reachable', async () => {
      const id = await createService();
      const created = serviceResponseSchema.parse(
        (await request(server()).get(`/catalog/services/${id}`).set(as(manager))).body,
      ).service;

      await update(id, {
        name: created.name,
        publicDescription: null,
        isPublic: true,
        publicSlug: 'promised-service-address',
        allowedDurationsMinutes: [30, 45],
      });

      const renamed = await update(id, {
        name: created.name,
        publicDescription: null,
        isPublic: true,
        publicSlug: 'a-different-service-address',
        allowedDurationsMinutes: [30, 45],
      });

      expect(renamed.status).toBe(409);
      expect(renamed.body.error.code).toBe('PUBLIC_SLUG_IMMUTABLE');
    });

    it('refuses one another service already holds', async () => {
      const first = await createService();
      const second = await createService();
      const firstName = serviceResponseSchema.parse(
        (await request(server()).get(`/catalog/services/${first}`).set(as(manager))).body,
      ).service.name;
      const secondName = serviceResponseSchema.parse(
        (await request(server()).get(`/catalog/services/${second}`).set(as(manager))).body,
      ).service.name;

      await update(first, {
        name: firstName,
        publicDescription: null,
        isPublic: false,
        publicSlug: 'contested-address',
        allowedDurationsMinutes: [30],
      });

      const collision = await update(second, {
        name: secondName,
        publicDescription: null,
        isPublic: false,
        publicSlug: 'contested-address',
        allowedDurationsMinutes: [30],
      });

      // Not `SERVICE_NAME_TAKEN`: the names differ, and the conflicting record
      // may be one the manager cannot see in the list they are looking at.
      expect(collision.status).toBe(409);
      expect(collision.body.error.code).toBe('PUBLIC_SLUG_TAKEN');
    });
  });

  describe('authority and audit', () => {
    it('still refuses a receptionist, exactly as it did before the public columns existed', async () => {
      const id = await createService();

      const attempt = await request(server())
        .patch(`/catalog/services/${id}`)
        .set(as(receptionist))
        .send(serviceBody({ isPublic: true, publicSlug: 'receptionist-attempt' }));

      expect(attempt.status).toBe(403);
      expect(attempt.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('records the publication as `service.updated`, with both sides of every public column', async () => {
      // ONE ACTION, NOT TWO. Publishing a service is the same form, the same
      // authority and the same state change as editing one.
      const id = await createService();
      const created = serviceResponseSchema.parse(
        (await request(server()).get(`/catalog/services/${id}`).set(as(manager))).body,
      ).service;

      await update(id, {
        name: created.name,
        publicDescription: 'شرح عمومی نمونه.',
        isPublic: true,
        publicSlug: 'audited-service',
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

      expect(rows[0]!.before).toMatchObject({ isPublic: false, publicSlug: null });
      expect(rows[0]!.after).toMatchObject({ isPublic: true, publicSlug: 'audited-service' });
    });
  });
});
