import request from 'supertest';
import {
  appointmentResponseSchema,
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

/**
 * A Saturday a year either side of whenever the suite runs, at 10:00 Tehran.
 *
 * The fixed dates above are chosen for their weekday and say nothing about
 * "before now" or "after now". The day view's unresolved-outcome flag is a
 * comparison against the database clock, so the suites that assert it need a
 * session that is certainly over and one that is certainly not — and a
 * hard-coded date would quietly stop meaning that as the calendar moves past it.
 *
 * Saturday is weekday 6 in JavaScript's `getUTCDay`, and 10:00 Tehran is 06:30
 * UTC on the same calendar day.
 */
function saturdayNear(offsetDays: number): { date: string; startsAt: string } {
  const moment = new Date(Date.now() + offsetDays * 86_400_000);

  while (moment.getUTCDay() !== 6) moment.setUTCDate(moment.getUTCDate() + 1);

  const date = moment.toISOString().slice(0, 10);

  return { date, startsAt: `${date}T06:30:00.000Z` };
}

/** A Saturday whose 10:00 session has certainly finished. */
export const pastSaturday = (): { date: string; startsAt: string } => saturdayNear(-400);

/** A Saturday whose 10:00 session is certainly still ahead. */
export const futureSaturday = (): { date: string; startsAt: string } => saturdayNear(365);

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

/** Books and returns the appointment id, failing loudly if the booking was refused. */
export async function bookId(
  harness: Harness,
  token: string,
  body: Record<string, unknown>,
): Promise<string> {
  const response = await book(harness, token, body);
  expectCreated(response, 'an appointment');

  return appointmentResponseSchema.parse(response.body).appointment.id;
}

/** The complete new placement a move submits, defaulting to where the fixture booked. */
export function movePayload(
  base: { therapistId: string; roomId: string },
  overrides: BookingOverrides = {},
): Record<string, unknown> {
  return {
    durationMinutes: 45,
    therapistId: base.therapistId,
    roomId: base.roomId,
    startsAt: SATURDAY_10_00,
    note: null,
    availabilityOverrideReason: null,
    ...overrides,
  };
}

export function move(
  harness: Harness,
  token: string,
  id: string,
  body: Record<string, unknown>,
): request.Test {
  return request(harness.app.getHttpServer())
    .patch(`/appointments/${id}`)
    .set(asUser(token))
    .send(body);
}

export function cancel(
  harness: Harness,
  token: string,
  id: string,
  body: Record<string, unknown>,
): request.Test {
  return request(harness.app.getHttpServer())
    .post(`/appointments/${id}/cancel`)
    .set(asUser(token))
    .send(body);
}

export function complete(harness: Harness, token: string, id: string): request.Test {
  return request(harness.app.getHttpServer())
    .post(`/appointments/${id}/complete`)
    .set(asUser(token))
    .send({});
}

export function reopen(harness: Harness, token: string, id: string, reason: string): request.Test {
  return request(harness.app.getHttpServer())
    .post(`/appointments/${id}/reopen`)
    .set(asUser(token))
    .send({ reason });
}

export function recordAttendance(
  harness: Harness,
  token: string,
  id: string,
  participantId: string,
  attendance: string,
): request.Test {
  return request(harness.app.getHttpServer())
    .put(`/appointments/${id}/participants/${participantId}/attendance`)
    .set(asUser(token))
    .send({ attendance });
}

export function readDay(
  harness: Harness,
  token: string,
  query: Record<string, string>,
): request.Test {
  return request(harness.app.getHttpServer())
    .get('/appointment-day')
    .query(query)
    .set(asUser(token));
}

export function readView(harness: Harness, token: string, id: string): request.Test {
  return request(harness.app.getHttpServer()).get(`/appointments/${id}/view`).set(asUser(token));
}

/**
 * A price for a service, so the day view has something to suggest.
 *
 * Synthetic, like every fixture here, and effective from long before the
 * Saturday these suites book into.
 */
export async function makeTariff(
  harness: Harness,
  token: string,
  tariff: {
    serviceId: string;
    durationMinutes?: number;
    therapistId?: string | null;
    priceToman?: string;
    effectiveStart?: string;
    /** Voids the named tariff in the same transaction, which is how a price changes. */
    supersedesTariffId?: string;
  },
): Promise<string> {
  const response = await request(harness.app.getHttpServer())
    .post('/catalog/tariffs')
    .set(asUser(token))
    .send({
      serviceId: tariff.serviceId,
      durationMinutes: tariff.durationMinutes ?? 45,
      therapistId: tariff.therapistId ?? null,
      priceMode: 'PAID',
      priceToman: tariff.priceToman ?? '250000',
      effectiveStart: tariff.effectiveStart ?? '2020-01-01',
      effectiveEnd: null,
      ...(tariff.supersedesTariffId === undefined
        ? {}
        : { supersedesTariffId: tariff.supersedesTariffId }),
    });

  expectCreated(response, 'a tariff');
  return response.body.tariff.id as string;
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
