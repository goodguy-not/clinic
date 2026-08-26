import request from 'supertest';
import { internalHeaders, seedUser, TEST_PASSWORD, type Harness } from './harness';

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

/** A synthetic, anonymised testimonial. */
export function testimonialDraft(): Record<string, unknown> {
  return {
    authorLabel: 'Synthetic parent label',
    body: 'Synthetic testimonial text written for a test. It names nobody and describes nothing.',
  };
}
