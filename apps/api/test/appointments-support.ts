import request from 'supertest';
import {
  childWriteResponseSchema,
  loginResponseSchema,
  roomResponseSchema,
  serviceResponseSchema,
  therapistResponseSchema,
} from '@clinic/contracts';
import { internalHeaders, seedUser, TEST_PASSWORD, type Harness } from './harness';

/**
 * Shared fixtures for the booking suites.
 *
 * EVERYTHING HERE IS SYNTHETIC. No real therapist, room, family, child or
 * schedule appears in any fixture in this project.
 *
 * WEEKDAY AND TIMEZONE REFERENCE, relied on by every time in these suites:
 * 2026-09-05 is a Saturday, weekday 0 in the clinic's Saturday-first numbering.
 * Tehran is UTC+03:30 with no DST, so `2026-09-05T06:30:00.000Z` is 10:00 on
 * that Saturday in the clinic — inside a 09:00–13:00 working window.
 */

export const asUser = (token: string) => internalHeaders({ 'x-session-id': token });

/** 10:00 Tehran on Saturday 2026-09-05. */
export const SATURDAY_10_00 = '2026-09-05T06:30:00.000Z';
/** 11:00 Tehran, the same day: a slot that touches the 10:00–11:00 one but never overlaps it. */
export const SATURDAY_11_00 = '2026-09-05T07:30:00.000Z';
/** 10:30 Tehran, the same day: half an hour into the 10:00 session. */
export const SATURDAY_10_30 = '2026-09-05T07:00:00.000Z';
/** 20:00 Tehran, the same day: outside a 09:00–13:00 week. */
export const SATURDAY_20_00 = '2026-09-05T16:30:00.000Z';

export const SATURDAY = '2026-09-05';

export async function signIn(
  harness: Harness,
  role: 'MANAGER' | 'RECEPTIONIST',
): Promise<{ id: string; token: string }> {
  const user = await seedUser(harness, { role });
  const response = await request(harness.app.getHttpServer())
    .post('/auth/login')
    .set(internalHeaders())
    .send({ username: user.username, password: TEST_PASSWORD });

  return { id: user.id, token: loginResponseSchema.parse(response.body).sessionToken };
}

function expectCreated(response: request.Response, what: string): void {
  if (response.status !== 201) {
    throw new Error(
      `Expected 201 seeding ${what}, got ${String(response.status)} ` +
        `(${String(response.body?.error?.code ?? 'no code')})`,
    );
  }
}

export async function makeService(
  harness: Harness,
  token: string,
  overrides: { name?: string; allowedDurationsMinutes?: number[] } = {},
): Promise<string> {
  const response = await request(harness.app.getHttpServer())
    .post('/catalog/services')
    .set(asUser(token))
    .send({
      name: overrides.name ?? `Synthetic Service ${Math.floor(Math.random() * 1e9)}`,
      publicDescription: null,
      isPublic: false,
      allowedDurationsMinutes: overrides.allowedDurationsMinutes ?? [45, 60],
    });

  expectCreated(response, 'a service');
  return serviceResponseSchema.parse(response.body).service.id;
}

export async function makeTherapist(
  harness: Harness,
  token: string,
  supportedServiceIds: string[] = [],
): Promise<string> {
  const response = await request(harness.app.getHttpServer())
    .post('/catalog/therapists')
    .set(asUser(token))
    .send({
      fullName: `Synthetic Therapist ${Math.floor(Math.random() * 1e9)}`,
      specialty: 'Synthetic Specialty',
      supportedServiceIds,
    });

  expectCreated(response, 'a therapist');
  return therapistResponseSchema.parse(response.body).therapist.id;
}

export async function makeRoom(
  harness: Harness,
  token: string,
  allowedServiceIds: string[] = [],
): Promise<string> {
  const response = await request(harness.app.getHttpServer())
    .post('/catalog/rooms')
    .set(asUser(token))
    .send({
      name: `Synthetic Room ${Math.floor(Math.random() * 1e9)}`,
      allowedServiceIds,
    });

  expectCreated(response, 'a room');
  return roomResponseSchema.parse(response.body).room.id;
}

/** Registers a family with one guardian and one child, and returns both ids. */
export async function makeFamilyWithChild(
  harness: Harness,
  token: string,
  overrides: { mobile?: string; firstName?: string } = {},
): Promise<{ familyId: string; childId: string }> {
  const family = await request(harness.app.getHttpServer())
    .post('/families')
    .set(asUser(token))
    .send({
      familyName: 'خانوادهٔ آزمایشی',
      address: null,
      note: null,
      guardians: [
        {
          fullName: 'سرپرست آزمایشی',
          relationship: 'MOTHER',
          relationshipNote: null,
          mobile: overrides.mobile ?? randomMobile(),
          landline: null,
          isPrimaryContact: true,
        },
      ],
    });

  expectCreated(family, 'a family');
  const familyId = family.body.family.id as string;

  const child = await request(harness.app.getHttpServer())
    .post(`/families/${familyId}/children`)
    .set(asUser(token))
    .send({
      firstName: overrides.firstName ?? 'کودک',
      lastName: 'آزمایشی',
      birthDate: '2020-03-21',
      sex: 'UNSPECIFIED',
      nationalId: null,
      legacyPaperFileNumber: null,
      referralSource: null,
      note: null,
    });

  expectCreated(child, 'a child');

  return { familyId, childId: childWriteResponseSchema.parse(child.body).child.id };
}

/** Synthetic, and unique per call so two fixtures never trip duplicate detection. */
function randomMobile(): string {
  return `09${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

export function putWindows(
  harness: Harness,
  token: string,
  therapistId: string,
  windows: unknown[],
): request.Test {
  return request(harness.app.getHttpServer())
    .put(`/availability/therapists/${therapistId}/windows`)
    .set(asUser(token))
    .send({ windows });
}

/** The ordinary Saturday week these suites book inside: 09:00 to 13:00. */
export const SATURDAY_MORNING = { weekday: 0, startTime: '09:00', endTime: '13:00' };

export type BookingOverrides = Record<string, unknown>;

export function bookingPayload(
  base: { serviceId: string; therapistId: string; roomId: string; childId: string },
  overrides: BookingOverrides = {},
): Record<string, unknown> {
  return {
    serviceId: base.serviceId,
    durationMinutes: 45,
    therapistId: base.therapistId,
    roomId: base.roomId,
    childId: base.childId,
    startsAt: SATURDAY_10_00,
    note: null,
    availabilityOverrideReason: null,
    ...overrides,
  };
}

export function book(harness: Harness, token: string, body: Record<string, unknown>): request.Test {
  return request(harness.app.getHttpServer()).post('/appointments').set(asUser(token)).send(body);
}

/**
 * A whole clinic in one call: an active service, therapist, room, family and
 * child, plus the therapist's Saturday morning.
 *
 * Built by a manager over HTTP rather than by raw SQL, so every fixture is a
 * state the application itself can produce.
 */
export async function seedClinic(
  harness: Harness,
  managerToken: string,
  options: { windows?: unknown[] } = {},
): Promise<{
  serviceId: string;
  therapistId: string;
  roomId: string;
  familyId: string;
  childId: string;
}> {
  const serviceId = await makeService(harness, managerToken);
  const therapistId = await makeTherapist(harness, managerToken, [serviceId]);
  const roomId = await makeRoom(harness, managerToken);
  const family = await makeFamilyWithChild(harness, managerToken);

  const windows = options.windows ?? [SATURDAY_MORNING];
  const response = await putWindows(harness, managerToken, therapistId, windows);

  if (response.status !== 200) {
    throw new Error(`Expected 200 seeding availability, got ${String(response.status)}`);
  }

  return { serviceId, therapistId, roomId, ...family };
}
