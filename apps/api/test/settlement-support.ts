import request from 'supertest';
import { shareRuleResponseSchema } from '@clinic/contracts';
import type { Harness } from './harness';
import {
  asUser,
  bookId,
  bookingPayload,
  complete,
  makeTariff,
  recordAttendance,
  seedClinic,
  signIn,
  SATURDAY,
} from './appointments-support';

/**
 * Shared fixtures for the Milestone 8 checkpoint C3 suites — the applied
 * therapist share snapshot.
 *
 * EVERYTHING HERE IS SYNTHETIC. No real family, child, therapist, price,
 * percentage or agreement appears in any fixture; the percentages are round
 * numbers chosen to be obviously invented.
 *
 * NOTHING IS SEEDED WITH RAW SQL. Every fixture below is built over HTTP by a
 * manager, through the real endpoints, so every state under test is one the
 * application itself can produce — including the rating, which is written by the
 * posting path rather than by the test.
 */

export type SettlementFixture = {
  managerId: string;
  managerToken: string;
  therapistId: string;
  serviceId: string;
  familyId: string;
  childId: string;
  appointmentId: string;
  participantId: string;
  chargeId: string;
  /** The clinic calendar day the session happened on. */
  serviceDate: string;
  amountToman: string;
};

export function makeShareRule(
  harness: Harness,
  token: string,
  body: Record<string, unknown>,
): request.Test {
  return request(harness.app.getHttpServer())
    .post('/settlement/share-rules')
    .set(asUser(token))
    .send(body);
}

export async function shareRuleId(
  harness: Harness,
  token: string,
  therapistId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await makeShareRule(harness, token, {
    therapistId,
    shareBasisPoints: 4000,
    effectiveStart: '2020-01-01',
    effectiveEnd: null,
    ...overrides,
  });

  if (response.status !== 201) {
    throw new Error(`Expected 201 seeding a share rule, got ${String(response.status)}`);
  }

  return shareRuleResponseSchema.parse(response.body).shareRule.id;
}

export function voidShareRule(
  harness: Harness,
  token: string,
  id: string,
  reason = 'اصلاح آزمایشی سهم',
): request.Test {
  return request(harness.app.getHttpServer())
    .post(`/settlement/share-rules/${id}/void`)
    .set(asUser(token))
    .send({ reason });
}

/**
 * A completed, attended, charged session — with or without a share rule
 * covering the therapist on the day it happened.
 *
 * THE ORDER IS LOAD-BEARING. The tariff and, when asked for, the share rule are
 * both recorded BEFORE the session is completed, because completion is what
 * posts the charge and posting is what rates it. A fixture that recorded the
 * rule afterwards would be testing the backfill this checkpoint refuses to do.
 *
 * `shareBasisPoints: null` seeds NO RULE AT ALL, which is the unrated case: the
 * charge exists and no settlement row does.
 */
export async function seedChargedSession(
  harness: Harness,
  options: {
    shareBasisPoints?: number | null;
    priceToman?: string;
    priceMode?: 'PAID' | 'FREE';
    ruleStart?: string;
    ruleEnd?: string | null;
  } = {},
): Promise<SettlementFixture> {
  const manager = await signIn(harness, 'MANAGER');
  const clinic = await seedClinic(harness, manager.token);
  const appointmentId = await bookId(harness, manager.token, bookingPayload(clinic));

  const participant = await harness.prisma.appointmentParticipant.findFirstOrThrow({
    where: { appointmentId },
  });

  const amountToman = options.priceToman ?? '250000';

  if (options.priceMode === 'FREE') {
    await makeFreeTariff(harness, manager.token, clinic.serviceId);
  } else {
    await makeTariff(harness, manager.token, {
      serviceId: clinic.serviceId,
      durationMinutes: 45,
      priceToman: amountToman,
    });
  }

  const share = options.shareBasisPoints === undefined ? 4000 : options.shareBasisPoints;
  if (share !== null) {
    await shareRuleId(harness, manager.token, clinic.therapistId, {
      shareBasisPoints: share,
      effectiveStart: options.ruleStart ?? '2020-01-01',
      effectiveEnd: options.ruleEnd ?? null,
    });
  }

  await recordAttendance(harness, manager.token, appointmentId, participant.id, 'ATTENDED').expect(
    200,
  );
  await complete(harness, manager.token, appointmentId).expect(200);

  const charge = await harness.prisma.sessionCharge.findFirstOrThrow({
    where: { appointmentParticipantId: participant.id, voidedAt: null },
  });

  return {
    managerId: manager.id,
    managerToken: manager.token,
    therapistId: clinic.therapistId,
    serviceId: clinic.serviceId,
    familyId: clinic.familyId,
    childId: clinic.childId,
    appointmentId,
    participantId: participant.id,
    chargeId: charge.id,
    serviceDate: SATURDAY,
    amountToman: charge.amountToman.toString(),
  };
}

/**
 * A priced session that costs nothing — which is a DIFFERENT THING from a
 * session nobody priced, and a different thing again from a session nobody
 * rated.
 */
async function makeFreeTariff(harness: Harness, token: string, serviceId: string): Promise<void> {
  const response = await request(harness.app.getHttpServer())
    .post('/catalog/tariffs')
    .set(asUser(token))
    .send({
      serviceId,
      durationMinutes: 45,
      therapistId: null,
      priceMode: 'FREE',
      freeReason: 'برنامه رایگان آزمایشی',
      confirmFreePrice: true,
      effectiveStart: '2020-01-01',
      effectiveEnd: null,
    });

  if (response.status !== 201) {
    throw new Error(`Expected 201 seeding a FREE tariff, got ${String(response.status)}`);
  }
}

export function rateOverHttp(
  harness: Harness,
  token: string,
  chargeId: string,
  body: Record<string, unknown> = { reason: 'قاعده سهم پس از ثبت هزینه وارد شد' },
): request.Test {
  return request(harness.app.getHttpServer())
    .post(`/settlement/session-charges/${chargeId}/rating`)
    .set(asUser(token))
    .send(body);
}

export function readRatingOverHttp(
  harness: Harness,
  token: string,
  chargeId: string,
): request.Test {
  return request(harness.app.getHttpServer())
    .get(`/settlement/session-charges/${chargeId}/rating`)
    .set(asUser(token));
}

export function voidRatingOverHttp(
  harness: Harness,
  token: string,
  ratingId: string,
  reason = 'ابطال آزمایشی سهم جلسه',
): request.Test {
  return request(harness.app.getHttpServer())
    .post(`/settlement/session-ratings/${ratingId}/void`)
    .set(asUser(token))
    .send({ reason });
}

export function correctRatingOverHttp(
  harness: Harness,
  token: string,
  body: Record<string, unknown>,
): request.Test {
  return request(harness.app.getHttpServer())
    .post('/settlement/rating-corrections')
    .set(asUser(token))
    .send(body);
}

/**
 * Every rating of one charge, withdrawn rows included, oldest first.
 *
 * Read straight from the table, because "exactly one row exists" is a claim
 * about the database and a read that hid withdrawn rows could not tell one
 * rating from three.
 */
export function ratingRowsFor(harness: Harness, chargeId: string) {
  return harness.prisma.sessionSettlement.findMany({
    where: { sessionChargeId: chargeId },
    orderBy: { createdAt: 'asc' },
  });
}

export function ratingAuditRows(harness: Harness) {
  return harness.prisma.auditLog.findMany({
    where: { entityType: 'session_settlement' },
    orderBy: { occurredAt: 'asc' },
  });
}
