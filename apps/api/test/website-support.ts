import request from 'supertest';
import { CURRENT_PUBLIC_REQUEST_CONSENT_VERSION } from '@clinic/contracts';
import { internalHeaders, ownerPrisma, seedUser, TEST_PASSWORD, type Harness } from './harness';

/**
 * Shared fixtures for the Milestone 9 public-website suites.
 *
 * Everything here is synthetic. No real clinic name, address, telephone number,
 * colleague, biography or family testimonial appears in any fixture in this
 * repository, and none may.
 */

/** Signs a synthetic user in and returns the session token. */
export async function loginAs(harness: Harness, role: 'MANAGER' | 'RECEPTIONIST'): Promise<string> {
  const user = await seedUser(harness, { role });
  const response = await request(harness.app.getHttpServer())
    .post('/auth/login')
    .set(internalHeaders())
    .send({ username: user.username, password: TEST_PASSWORD });

  return response.body.sessionToken as string;
}

/** Headers for a request made as a signed-in user. */
export function as(sessionToken: string): Record<string, string> {
  return internalHeaders({ 'x-session-id': sessionToken });
}

/** Headers for a request from the web tier with no session — a visitor. */
export function asVisitor(): Record<string, string> {
  return internalHeaders();
}

/**
 * Reads the audit actions written against one entity, oldest first.
 *
 * The suites assert on this rather than on a count, because the point of the
 * A2 audit decisions is WHICH action was written — publishing and editing are
 * separate facts precisely so a reader can tell them apart.
 */
export async function auditActionsFor(
  harness: Harness,
  entityType: string,
  entityId: string | null,
): Promise<string[]> {
  const rows =
    entityId === null
      ? await harness.prisma.$queryRaw<{ action: string }[]>`
          SELECT action FROM audit_log
          WHERE entity_type = ${entityType} AND entity_id IS NULL
          ORDER BY id ASC
        `
      : await harness.prisma.$queryRaw<{ action: string }[]>`
          SELECT action FROM audit_log
          WHERE entity_type = ${entityType} AND entity_id = ${entityId}::uuid
          ORDER BY id ASC
        `;

  return rows.map((row) => row.action);
}

/** A synthetic article draft body. */
export function articleDraft(slug: string): Record<string, unknown> {
  return {
    publicSlug: slug,
    title: `Synthetic article ${slug}`,
    summary: 'Synthetic standfirst for an article that does not exist.',
    body: 'Synthetic body text. Nothing here describes a real child, family or session.',
  };
}

/**
 * A synthetic, anonymised testimonial.
 *
 * `kind` defaults to `TYPED`, which is the A2 case. The handwritten suite
 * overrides it — and NEVER supplies a photograph of anybody's real handwriting:
 * every image in these suites is generated in code by `media-support.ts`.
 */
export function testimonialDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    authorLabel: 'Synthetic parent label',
    body: 'Synthetic testimonial text written for a test. It names nobody and describes nothing.',
    kind: 'TYPED',
    ...overrides,
  };
}

/**
 * A synthetic public-space draft.
 *
 * IT NAMES NO ROOM, AND THERE IS NO FIELD ON THE REQUEST THAT COULD. That is
 * the checkpoint's boundary, visible in the fixture: a public space is a
 * paragraph about the building, not a reference to a bookable room.
 */
export function spaceDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Synthetic waiting area',
    description: 'Synthetic description of a space that does not exist. It names nobody.',
    displayOrder: 0,
    ...overrides,
  };
}

// --- website requests (Milestone 9, checkpoint A4) --------------------------

/** A complete, valid anonymous submission. Every field is synthetic. */
export function submission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contactName: 'سرپرست نمونه',
    contactMobile: '09120000001',
    serviceSlug: null,
    childName: 'کودک نمونه',
    childAgeYears: 6,
    childSex: 'UNSPECIFIED',
    preferredContactTime: 'MORNING',
    note: 'متن نمونه برای آزمون. دربارهٔ هیچ کودک واقعی نیست.',
    consent: true,
    consentVersion: CURRENT_PUBLIC_REQUEST_CONSENT_VERSION,
    ...overrides,
  };
}

/**
 * Submits a request through the real anonymous endpoint and returns its id.
 *
 * THE ID COMES OUT OF THE DATABASE AND NOT OUT OF THE RESPONSE, deliberately:
 * the accepted A3 response carries no identifier at all, so that an anonymous
 * caller holds no handle it could quote back. A test that could read one from
 * the body would be testing a contract this product does not have.
 */
export async function submitRequest(
  harness: Harness,
  overrides: Record<string, unknown> = {},
  ip = '203.0.113.10',
): Promise<string> {
  const response = await request(harness.app.getHttpServer())
    .post('/public/requests')
    // A synthetic caller address, so the row carries the keyed submitter digest
    // a real submission would. The suites that assert the digest is never SERVED
    // need one to exist in the first place.
    .set({ ...asVisitor(), 'x-client-ip': ip })
    .send(submission(overrides));

  if (response.status !== 202) {
    throw new Error(`Expected 202 submitting a request, got ${String(response.status)}`);
  }

  const rows = await harness.prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM website_request ORDER BY received_at DESC, id DESC LIMIT 1
  `;

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('no website_request row was written');
  return id;
}

/**
 * Backdates a request's closure so the ninety-day retention deadline has passed.
 *
 * Written with the triggers disabled, because `closed_at` is write-once by
 * design and moving it is exactly what a test must not be able to do through
 * any ordinary path. Only the owner can, which is why this runs on the owner's
 * connection; the runtime role the application uses cannot perform it.
 */
export async function backdateClosure(harness: Harness, id: string, days: number): Promise<void> {
  await ownerPrisma().$executeRawUnsafe('ALTER TABLE website_request DISABLE TRIGGER USER');
  try {
    await ownerPrisma().$executeRaw`
      UPDATE website_request
      SET closed_at = transaction_timestamp() - ${`${days} days`}::interval
      WHERE id = ${id}::uuid
    `;
  } finally {
    await ownerPrisma().$executeRawUnsafe('ALTER TABLE website_request ENABLE TRIGGER USER');
  }
}

/** Reads one request row straight out of PostgreSQL. */
export async function readRequestRow(
  harness: Harness,
  id: string,
): Promise<Record<string, unknown>> {
  const rows = await harness.prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM website_request WHERE id = ${id}::uuid
  `;

  const row = rows[0];
  if (row === undefined) throw new Error('website_request row is missing');
  return row;
}

/** The audit payloads written against one request, oldest first. */
export async function auditPayloadsFor(
  harness: Harness,
  entityId: string,
): Promise<{ action: string; before: unknown; after: unknown; metadata: unknown }[]> {
  return harness.prisma.$queryRaw`
    SELECT action, before, after, metadata FROM audit_log
    WHERE entity_type = 'website_request' AND entity_id = ${entityId}::uuid
    ORDER BY id ASC
  `;
}
