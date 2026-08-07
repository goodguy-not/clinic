import { createHash } from 'node:crypto';
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
  options: { mustChangePassword?: boolean } = {},
): Promise<{ id: string; token: string }> {
  const user = await seedUser(harness, {
    role,
    mustChangePassword: options.mustChangePassword ?? false,
  });
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

// --- registration drafts ----------------------------------------------------

export const withDraft = (token: string, draftToken: string) =>
  internalHeaders({ 'x-session-id': token, 'x-draft-token': draftToken });

export function resolveDraft(harness: Harness, token: string, draftToken: string): request.Test {
  return request(harness.app.getHttpServer())
    .get('/registration-drafts/current')
    .set(withDraft(token, draftToken));
}

export function discardDraft(harness: Harness, token: string, draftToken: string): request.Test {
  return request(harness.app.getHttpServer())
    .post('/registration-drafts/discard')
    .set(withDraft(token, draftToken));
}

export function confirmRegistration(
  harness: Harness,
  token: string,
  draftToken: string,
  acknowledgedDuplicateIds: readonly string[],
): request.Test {
  return request(harness.app.getHttpServer())
    .post('/families/confirm-registration')
    .set(withDraft(token, draftToken))
    .send({ acknowledgedDuplicateIds: [...acknowledgedDuplicateIds] });
}

/**
 * Registers a family, expects the duplicate block, and returns the draft token
 * plus the candidate ids the caller was shown.
 */
export async function blockOn(
  harness: Harness,
  token: string,
  body: Record<string, unknown>,
): Promise<{ draftToken: string; candidateIds: string[] }> {
  const response = await createFamily(harness, token, body);

  if (response.status !== 409) {
    throw new Error(
      `Expected a 409 duplicate block, got ${String(response.status)} ` +
        `(${String(response.body?.error?.code ?? 'no code')})`,
    );
  }

  const details = response.body.error.details as {
    draftToken: string;
    candidates: { familyId: string; blocking: boolean }[];
  };

  return {
    draftToken: details.draftToken,
    candidateIds: details.candidates
      .filter((candidate) => candidate.blocking)
      .map((candidate) => candidate.familyId),
  };
}

/**
 * Ages a draft past its expiry by moving its timestamps backwards.
 *
 * The alternative is waiting ten minutes. Both columns move together so
 * `registration_draft_expiry_chk` still holds.
 */
export async function expireDraft(harness: Harness, draftToken: string): Promise<void> {
  const hash = createHash('sha256').update(draftToken).digest();

  await harness.prisma.$executeRaw`
    UPDATE registration_draft
    SET created_at = transaction_timestamp() - interval '20 minutes',
        expires_at = transaction_timestamp() - interval '10 minutes'
    WHERE token_hash = ${hash}
  `;
}

/**
 * Inserts a family and one guardian directly.
 *
 * Needed to stage "a new duplicate appeared while somebody was deciding": going
 * through the endpoint would itself be blocked by the family already there,
 * which is the very situation being set up.
 */
export async function insertFamilyDirect(
  harness: Harness,
  actorId: string,
  familyName: string,
  mobile: string | null,
  /** Defaults to a landline only when there is no mobile, so the row stays reachable. */
  landline?: string | null,
): Promise<string> {
  const rows = await harness.prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO family (
      id, family_name, search_family_name, address, note, status,
      deactivated_at, created_at, created_by_user_id
    ) VALUES (
      gen_random_uuid(), ${familyName}, fa_normalize(${familyName}), NULL, NULL,
      'ACTIVE'::record_status, NULL, transaction_timestamp(), ${actorId}::uuid
    )
    RETURNING id
  `;

  const familyId = rows[0]?.id ?? '';

  await harness.prisma.$executeRaw`
    INSERT INTO guardian (
      id, family_id, full_name, search_full_name, relationship,
      relationship_note, mobile, landline, is_primary_contact
    ) VALUES (
      gen_random_uuid(), ${familyId}::uuid, 'سرپرست تازه', fa_normalize('سرپرست تازه'),
      'MOTHER'::guardian_relationship, NULL, ${mobile},
      ${landline ?? (mobile === null ? '02112345678' : null)}, true
    )
  `;

  return familyId;
}

/** Deactivates a family directly; there is no status endpoint until Checkpoint E. */
export async function deactivateFamily(harness: Harness, familyId: string): Promise<void> {
  await harness.prisma.$executeRaw`
    UPDATE family
    SET status = 'INACTIVE'::record_status, deactivated_at = transaction_timestamp()
    WHERE id = ${familyId}::uuid
  `;
}

// --- children ---------------------------------------------------------------

export function childPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstName: 'علی',
    lastName: 'رضایی',
    birthDate: '2020-03-21',
    sex: 'UNSPECIFIED',
    nationalId: null,
    legacyPaperFileNumber: null,
    referralSource: null,
    note: null,
    ...overrides,
  };
}

export function createChild(
  harness: Harness,
  token: string,
  familyId: string,
  body: Record<string, unknown>,
): request.Test {
  return request(harness.app.getHttpServer())
    .post(`/families/${familyId}/children`)
    .set(asUser(token))
    .send(body);
}

export function getChild(harness: Harness, token: string, id: string): request.Test {
  return request(harness.app.getHttpServer()).get(`/children/${id}`).set(asUser(token));
}

export function updateChild(
  harness: Harness,
  token: string,
  id: string,
  body: Record<string, unknown>,
): request.Test {
  return request(harness.app.getHttpServer())
    .patch(`/children/${id}`)
    .set(asUser(token))
    .send(body);
}

export function setChildStatus(
  harness: Harness,
  token: string,
  id: string,
  status: 'ACTIVE' | 'INACTIVE',
): request.Test {
  return request(harness.app.getHttpServer())
    .patch(`/children/${id}/status`)
    .set(asUser(token))
    .send({ status });
}

export function updateFamily(
  harness: Harness,
  token: string,
  id: string,
  body: Record<string, unknown>,
): request.Test {
  return request(harness.app.getHttpServer())
    .patch(`/families/${id}`)
    .set(asUser(token))
    .send(body);
}

export function setFamilyStatus(
  harness: Harness,
  token: string,
  id: string,
  status: 'ACTIVE' | 'INACTIVE',
): request.Test {
  return request(harness.app.getHttpServer())
    .patch(`/families/${id}/status`)
    .set(asUser(token))
    .send({ status });
}

export function confirmFamilyUpdate(
  harness: Harness,
  token: string,
  draftToken: string,
  acknowledgedDuplicateIds: readonly string[],
): request.Test {
  return request(harness.app.getHttpServer())
    .post('/families/confirm-update')
    .set(withDraft(token, draftToken))
    .send({ acknowledgedDuplicateIds: [...acknowledgedDuplicateIds] });
}

export function confirmChildRegistration(
  harness: Harness,
  token: string,
  draftToken: string,
  acknowledgedDuplicateIds: readonly string[],
): request.Test {
  return request(harness.app.getHttpServer())
    .post('/children/confirm-registration')
    .set(withDraft(token, draftToken))
    .send({ acknowledgedDuplicateIds: [...acknowledgedDuplicateIds] });
}

export function confirmChildUpdate(
  harness: Harness,
  token: string,
  draftToken: string,
  acknowledgedDuplicateIds: readonly string[],
): request.Test {
  return request(harness.app.getHttpServer())
    .post('/children/confirm-update')
    .set(withDraft(token, draftToken))
    .send({ acknowledgedDuplicateIds: [...acknowledgedDuplicateIds] });
}

/** Registers a child through the endpoint and returns its id, failing loudly otherwise. */
export async function seedChildViaApi(
  harness: Harness,
  token: string,
  familyId: string,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await createChild(harness, token, familyId, body);

  if (response.status !== 201) {
    throw new Error(
      `Expected 201 registering a child, got ${String(response.status)} ` +
        `(${String(response.body?.error?.code ?? 'no code')})`,
    );
  }

  return response.body.child.id as string;
}

/** Blocks a child registration and returns the draft token plus blocking ids. */
export async function blockOnChild(
  harness: Harness,
  token: string,
  familyId: string,
  body: Record<string, unknown>,
): Promise<{ draftToken: string; candidateIds: string[] }> {
  const response = await createChild(harness, token, familyId, body);

  if (response.status !== 409) {
    throw new Error(
      `Expected a 409 child duplicate block, got ${String(response.status)} ` +
        `(${String(response.body?.error?.code ?? 'no code')})`,
    );
  }

  const details = response.body.error.details as {
    draftToken: string;
    candidates: { familyId: string; childId: string | null; blocking: boolean }[];
  };

  return {
    draftToken: details.draftToken,
    candidateIds: details.candidates
      .filter((candidate) => candidate.blocking)
      .map((candidate) => candidate.childId ?? candidate.familyId),
  };
}
