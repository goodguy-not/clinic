import request from 'supertest';
import { loginResponseSchema } from '@clinic/contracts';
import { internalHeaders, seedUser, TEST_PASSWORD, type Harness } from './harness';

/**
 * Shared fixtures for the Milestone 3 integration specs.
 *
 * EVERYTHING HERE IS SYNTHETIC. `0912…`, `1234567891` and «خانوادهٔ آزمایشی» are
 * shapes and placeholders, never anybody's details. No real clinic data appears
 * in any fixture in this project.
 */

export const asUser = (token: string) => internalHeaders({ 'x-session-id': token });

export async function signIn(
  harness: Harness,
  role: 'MANAGER' | 'RECEPTIONIST' = 'RECEPTIONIST',
): Promise<{ id: string; token: string }> {
  const user = await seedUser(harness, { role });
  const response = await request(harness.app.getHttpServer())
    .post('/auth/login')
    .set(internalHeaders())
    .send({ username: user.username, password: TEST_PASSWORD });

  return { id: user.id, token: loginResponseSchema.parse(response.body).sessionToken };
}

export type GuardianInput = {
  fullName?: string;
  relationship?: string;
  relationshipNote?: string | null;
  mobile?: string | null;
  landline?: string | null;
  isPrimaryContact?: boolean;
};

export function guardian(overrides: GuardianInput = {}): Record<string, unknown> {
  return {
    fullName: 'سرپرست آزمایشی',
    relationship: 'MOTHER',
    relationshipNote: null,
    mobile: '09121234567',
    landline: null,
    isPrimaryContact: true,
    ...overrides,
  };
}

export function familyPayload(
  overrides: { familyName?: string; address?: string | null; note?: string | null } = {},
  guardians: Record<string, unknown>[] = [guardian()],
): Record<string, unknown> {
  return {
    familyName: 'رضایی',
    address: null,
    note: null,
    ...overrides,
    guardians,
  };
}

export function createFamily(
  harness: Harness,
  token: string,
  body: Record<string, unknown>,
): request.Test {
  return request(harness.app.getHttpServer()).post('/families').set(asUser(token)).send(body);
}

export function searchFamilies(
  harness: Harness,
  token: string,
  body: Record<string, unknown> = {},
): request.Test {
  return request(harness.app.getHttpServer())
    .post('/families/search')
    .set(asUser(token))
    .send(body);
}

export function getFamily(harness: Harness, token: string, id: string): request.Test {
  return request(harness.app.getHttpServer()).get(`/families/${id}`).set(asUser(token));
}

/**
 * Registers a family and returns its id, failing loudly if it did not.
 *
 * A helper that quietly returned `undefined` on a 409 would make every test
 * built on it fail somewhere else, several assertions later.
 */
export async function seedFamily(
  harness: Harness,
  token: string,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await createFamily(harness, token, body);

  if (response.status !== 201) {
    throw new Error(
      `Expected 201 seeding a family, got ${String(response.status)} ` +
        `(${String(response.body?.error?.code ?? 'no code')})`,
    );
  }

  return response.body.family.id as string;
}

/**
 * Inserts a child directly.
 *
 * There is no child endpoint until a later checkpoint, but search must rank on
 * child names and file numbers, and family detail must list them. Raw SQL is the
 * only way to have one at this checkpoint, and it exercises exactly the columns
 * the future service will write.
 */
export async function seedChild(
  harness: Harness,
  familyId: string,
  actorId: string,
  overrides: {
    firstName?: string;
    lastName?: string;
    birthDate?: string;
    legacyPaperFileNumber?: string | null;
  } = {},
): Promise<string> {
  const rows = await harness.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO child (
      id, family_id, first_name, last_name, search_first_name, search_last_name,
      birth_date, file_number, legacy_paper_file_number, national_id, sex,
      referral_source, note, status, deactivated_at, created_at, created_by_user_id
    ) VALUES (
      gen_random_uuid(), ${familyId}::uuid,
      ${overrides.firstName ?? 'کودک'}, ${overrides.lastName ?? 'آزمایشی'},
      fa_normalize(${overrides.firstName ?? 'کودک'}), fa_normalize(${overrides.lastName ?? 'آزمایشی'}),
      ${overrides.birthDate ?? '2020-03-21'}::date,
      lpad(nextval('child_file_number_seq')::text, 5, '0'),
      ${overrides.legacyPaperFileNumber ?? null},
      NULL, 'UNSPECIFIED'::child_sex, NULL, NULL, 'ACTIVE'::record_status, NULL,
      transaction_timestamp(), ${actorId}::uuid
    )
    RETURNING id
  `;

  return rows[0]?.id ?? '';
}

/** Deactivates a family directly; there is no status endpoint until Checkpoint D. */
export async function deactivateFamily(harness: Harness, familyId: string): Promise<void> {
  await harness.prisma.$executeRaw`
    UPDATE family
    SET status = 'INACTIVE'::record_status, deactivated_at = transaction_timestamp()
    WHERE id = ${familyId}::uuid
  `;
}
