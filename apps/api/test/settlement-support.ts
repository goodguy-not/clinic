import request from 'supertest';
import { shareRuleResponseSchema } from '@clinic/contracts';
import type { Harness } from './harness';
import {
  asUser,
  bookId,
  bookingPayload,
  complete,
  makeFamilyWithChild,
  makeRoom,
  makeService,
  makeTariff,
  makeTherapist,
  putWindows,
  recordAttendance,
  seedClinic,
  signIn,
  SATURDAY,
  SATURDAY_MORNING,
} from './appointments-support';
import {
  adjustOverHttp,
  adjustmentRowsFor,
  makeFreeTariff,
  voidAdjustmentOverHttp,
  voidChargeOverHttp,
} from './ledger-support';

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
 * A concession with an EXPLICIT therapist/clinic allocation (checkpoint C4).
 *
 * Deliberately separate from `adjustOverHttp` in `ledger-support.ts` rather than
 * an extra parameter on it: that helper is what every Milestone 5 and 6 suite
 * calls to state a clinic-borne concession, and its body must keep OMITTING the
 * field so those suites go on proving that the default is unchanged. The clinic
 * portion is never sent — it is the server's residual, and the request schema
 * refuses it.
 */
export function allocateOverHttp(
  harness: Harness,
  token: string,
  chargeId: string,
  amountToman: string,
  therapistDiscountToman: string,
  reason = 'تخفیف با سهم درمانگر',
): request.Test {
  return request(harness.app.getHttpServer())
    .post(`/session-charges/${chargeId}/adjustments`)
    .set(asUser(token))
    .send({ amountToman, reason, therapistDiscountToman });
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

/**
 * ---------------------------------------------------------------------------
 * THE CHECKPOINT C5 RECONCILIATION CLINIC — a synthetic month built to contain
 * every fact a settlement statement has to tell apart.
 *
 * ONE FIXTURE RATHER THAN SEVEN SMALL ONES, because the claim under test is
 * that the statement RECONCILES: that the lines, the totals and the three
 * exception counts describe one coherent set of rows. A suite of isolated cases
 * can prove each figure separately and still miss a session counted twice, or
 * counted in two categories at once.
 *
 * WHAT IS DELIBERATELY IN IT:
 *
 *   * TWO THERAPISTS, so scoping is proved rather than assumed.
 *   * A SHARE RULE THAT CHANGES MID-MONTH — 40% to the 11th, 50% from the 12th —
 *     so the statement has to read two different applied percentages out of two
 *     snapshots rather than one percentage out of today's configuration.
 *   * A RATED SESSION WITH NO CONCESSION, the ordinary case.
 *   * A CONCESSION SPLIT BETWEEN THE TWO SIDES.
 *   * A CONCESSION LARGER THAN THE CLINIC OWN GROSS SHARE, borne entirely by the
 *     clinic, which is how a NEGATIVE CLINIC NET happens in real life.
 *   * A WITHDRAWN CONCESSION, which must give the share back by the read.
 *   * A `FREE` SESSION: rated, worth nothing, and NOT unrated.
 *   * A CHARGED SESSION WHOSE RATING WAS WITHDRAWN, which is unrated again.
 *   * A COMPLETED, ATTENDED SESSION WHOSE CHARGE WAS WITHDRAWN, which has no
 *     basis to settle from at all.
 *
 * EVERY AMOUNT IS ROUND AND SYNTHETIC, and every state is built over HTTP by a
 * manager through the real endpoints — including the ratings, which are written
 * by the posting path. No raw SQL seeds any row here.
 * ---------------------------------------------------------------------------
 */

/** The three Saturdays this fixture spends, and 10:00, 11:00 and 12:00 Tehran in UTC. */
const WEEK_ONE = '2026-09-05';
const WEEK_TWO = '2026-09-12';
const WEEK_THREE = '2026-09-19';
const AT_10 = 'T06:30:00.000Z';
const AT_11 = 'T07:30:00.000Z';
const AT_12 = 'T08:30:00.000Z';

export type StatementSession = {
  appointmentId: string;
  participantId: string;
  chargeId: string;
  serviceDate: string;
};

export type StatementFixture = {
  managerId: string;
  managerToken: string;
  therapistId: string;
  otherTherapistId: string;
  paidServiceId: string;
  freeServiceId: string;
  familyId: string;
  /** 40%, up to and including the 11th. */
  earlyRuleId: string;
  /** 50%, from the 12th onwards. */
  lateRuleId: string;
  /** Rated at 40%, no concession. */
  plain: StatementSession;
  /** Rated at 50%, concession split between the two sides. */
  split: StatementSession;
  /** Rated at 50%, concession larger than the clinic gross share, clinic-borne. */
  subsidised: StatementSession;
  /** Rated at 50%, concession granted and then withdrawn. */
  restored: StatementSession;
  /** A `FREE` session: rated, worth nothing. */
  free: StatementSession;
  /** Charged, and its rating withdrawn: unrated again. */
  unrated: StatementSession;
  /** Completed and attended, and its charge withdrawn: nothing to settle from. */
  uncharged: StatementSession;
  /** The other therapist session, which must appear on no statement of the first. */
  otherTherapist: StatementSession;
};

/**
 * The whole month, in the order the acts actually happen.
 *
 * THE ORDER IS LOAD-BEARING IN TWO PLACES. The tariffs and the share rules are
 * recorded BEFORE any session is completed, because completion posts the charge
 * and posting rates it; and the sessions are completed oldest-first within each
 * day, so the charge ids — uuidv7, and therefore ordered by creation — put the
 * lines in the order the statement claims to return them.
 */
export async function seedStatementClinic(harness: Harness): Promise<StatementFixture> {
  const manager = await signIn(harness, 'MANAGER');
  const token = manager.token;

  const paidServiceId = await makeService(harness, token);
  const freeServiceId = await makeService(harness, token);
  const therapistId = await makeTherapist(harness, token, [paidServiceId, freeServiceId]);
  const otherTherapistId = await makeTherapist(harness, token, [paidServiceId]);
  const roomId = await makeRoom(harness, token);
  const otherRoomId = await makeRoom(harness, token);
  const family = await makeFamilyWithChild(harness, token);
  const otherFamily = await makeFamilyWithChild(harness, token);

  for (const id of [therapistId, otherTherapistId]) {
    const windows = await putWindows(harness, token, id, [SATURDAY_MORNING]);
    if (windows.status !== 200) {
      throw new Error(`Expected 200 seeding availability, got ${String(windows.status)}`);
    }
  }

  await makeTariff(harness, token, { serviceId: paidServiceId, priceToman: '250000' });
  await makeFreeTariff(harness, token, freeServiceId);

  // 40% to the day before the change, 50% from it: two non-overlapping
  // agreements, which is how a percentage changes over time.
  const earlyRuleId = await shareRuleId(harness, token, therapistId, {
    shareBasisPoints: 4000,
    effectiveStart: '2020-01-01',
    effectiveEnd: '2026-09-11',
  });
  const lateRuleId = await shareRuleId(harness, token, therapistId, {
    shareBasisPoints: 5000,
    effectiveStart: WEEK_TWO,
    effectiveEnd: null,
  });
  await shareRuleId(harness, token, otherTherapistId, {
    shareBasisPoints: 3000,
    effectiveStart: '2020-01-01',
    effectiveEnd: null,
  });

  const run = (
    serviceId: string,
    startsAt: string,
    serviceDate: string,
    overrides: { therapistId?: string; roomId?: string; childId?: string } = {},
  ) =>
    completedSession(harness, token, {
      serviceId,
      therapistId: overrides.therapistId ?? therapistId,
      roomId: overrides.roomId ?? roomId,
      childId: overrides.childId ?? family.childId,
      startsAt,
      serviceDate,
    });

  const plain = await run(paidServiceId, `${WEEK_ONE}${AT_10}`, WEEK_ONE);
  const free = await run(freeServiceId, `${WEEK_ONE}${AT_11}`, WEEK_ONE);
  const unrated = await run(paidServiceId, `${WEEK_ONE}${AT_12}`, WEEK_ONE);
  const split = await run(paidServiceId, `${WEEK_TWO}${AT_10}`, WEEK_TWO);
  const restored = await run(paidServiceId, `${WEEK_TWO}${AT_11}`, WEEK_TWO);
  const subsidised = await run(paidServiceId, `${WEEK_THREE}${AT_10}`, WEEK_THREE);
  const uncharged = await run(paidServiceId, `${WEEK_THREE}${AT_11}`, WEEK_THREE);
  const otherTherapistSession = await run(paidServiceId, `${WEEK_TWO}${AT_10}`, WEEK_TWO, {
    therapistId: otherTherapistId,
    roomId: otherRoomId,
    childId: otherFamily.childId,
  });

  // A concession the therapist agreed to bear part of: 60,000 off the family,
  // 20,000 of it out of the therapist 125,000 share.
  await allocateOverHttp(harness, token, split.chargeId, '60000', '20000').expect(200);

  // A concession larger than the clinic 125,000 gross share, borne entirely by
  // the clinic — which is what makes a clinic net negative.
  await adjustOverHttp(harness, token, subsidised.chargeId, '200000').expect(200);

  // Granted, then withdrawn. Both sides must be whole again by the read.
  await allocateOverHttp(harness, token, restored.chargeId, '40000', '10000').expect(200);
  const granted = await adjustmentRowsFor(harness, restored.chargeId);
  const grantedId = granted[0]?.id;
  if (grantedId === undefined) throw new Error('the concession to withdraw was not recorded');
  await voidAdjustmentOverHttp(harness, token, restored.chargeId, grantedId).expect(200);

  // Rated on posting, then withdrawn: the charge stands and nobody has decided
  // the share, which is UNRATED and is not a share of zero.
  const rating = (await ratingRowsFor(harness, unrated.chargeId))[0];
  if (rating === undefined) throw new Error('the rating to withdraw was not recorded');
  await voidRatingOverHttp(harness, token, rating.id).expect(200);

  // The charge withdrawn, the rating left exactly as it was written.
  await voidChargeOverHttp(harness, token, uncharged.chargeId).expect(200);

  return {
    managerId: manager.id,
    managerToken: token,
    therapistId,
    otherTherapistId,
    paidServiceId,
    freeServiceId,
    familyId: family.familyId,
    earlyRuleId,
    lateRuleId,
    plain,
    split,
    subsidised,
    restored,
    free,
    unrated,
    uncharged,
    otherTherapist: otherTherapistSession,
  };
}

/** Book it, mark the child present, complete it — which posts the charge and rates it. */
async function completedSession(
  harness: Harness,
  token: string,
  booking: {
    serviceId: string;
    therapistId: string;
    roomId: string;
    childId: string;
    startsAt: string;
    serviceDate: string;
  },
): Promise<StatementSession> {
  const appointmentId = await bookId(
    harness,
    token,
    bookingPayload(booking, { startsAt: booking.startsAt }),
  );

  const participant = await harness.prisma.appointmentParticipant.findFirstOrThrow({
    where: { appointmentId },
  });

  await recordAttendance(harness, token, appointmentId, participant.id, 'ATTENDED').expect(200);
  await complete(harness, token, appointmentId).expect(200);

  const charge = await harness.prisma.sessionCharge.findFirstOrThrow({
    where: { appointmentParticipantId: participant.id, voidedAt: null },
  });

  return {
    appointmentId,
    participantId: participant.id,
    chargeId: charge.id,
    serviceDate: booking.serviceDate,
  };
}

/** The statement, as a manager reads it. */
export function statementOverHttp(
  harness: Harness,
  token: string,
  query: Record<string, string>,
): request.Test {
  return request(harness.app.getHttpServer())
    .get('/settlement/statement')
    .query(query)
    .set(asUser(token));
}

/**
 * ---------------------------------------------------------------------------
 * CHECKPOINT C6 — closing a settlement period.
 * ---------------------------------------------------------------------------
 */

/** Close one therapist's period over an explicit inclusive range. */
export function closePeriodOverHttp(
  harness: Harness,
  token: string,
  body: { therapistId: string; from: string; to: string },
): request.Test {
  return request(harness.app.getHttpServer())
    .post('/settlement/periods')
    .set(asUser(token))
    .send(body);
}

/** The closed periods of one therapist, as a manager reads them. */
export function listPeriodsOverHttp(
  harness: Harness,
  token: string,
  query: Record<string, string>,
): request.Test {
  return request(harness.app.getHttpServer())
    .get('/settlement/periods')
    .query(query)
    .set(asUser(token));
}

/**
 * Every materialised settlement line of one charge, oldest first.
 *
 * Read straight from the table, because "exactly one PRIMARY exists" is a claim
 * about the database rather than about any response shape.
 */
export function settlementLinesFor(harness: Harness, chargeId: string) {
  return harness.prisma.settlementLine.findMany({
    where: { sessionChargeId: chargeId },
    orderBy: { createdAt: 'asc' },
  });
}

export function periodAuditRows(harness: Harness) {
  return harness.prisma.auditLog.findMany({
    where: { entityType: 'settlement_period' },
    orderBy: { occurredAt: 'asc' },
  });
}

/**
 * ---------------------------------------------------------------------------
 * THE CHECKPOINT C6 MULTI-PERIOD CLINIC — a synthetic three-month clinic built
 * to contain every fact a sequence of closes has to survive.
 *
 * ONE FIXTURE RATHER THAN A DOZEN SMALL ONES, because the claim under test is
 * that closed history RECONCILES against live rows over TIME: that a session is
 * settled exactly once, that a session excluded from one close arrives in a
 * later one as the carry-in it is, and that every later movement surfaces as a
 * signed correction whose sum with the primary is what the session is worth now.
 * Isolated cases can prove each figure separately and still miss a session
 * settled twice across two periods.
 *
 * WHAT IS DELIBERATELY IN IT, month by month:
 *
 *   MONTH ONE — an ordinary rated session; a `FREE` session (rated, worth
 *   nothing, and NOT an unrated exclusion); a session whose therapist had no
 *   share rule on the day, so it is UNRATED and excluded from the first close;
 *   and a session that will have its charge withdrawn AFTER the close.
 *   MONTH TWO — a concession split between the two sides; a concession larger
 *   than the clinic's own gross share, borne entirely by the clinic, which is
 *   how a negative clinic net happens; and a session whose applied rating will
 *   be corrected AFTER the close.
 *   MONTH THREE — one ordinary session, so the third close has work of its own
 *   to carry the corrections alongside.
 *
 * A SECOND THERAPIST works throughout, so scoping is proved rather than assumed.
 *
 * NOTHING IS CLOSED BY THIS FIXTURE. The closes are the acts under test and each
 * suite performs its own, in its own order.
 *
 * Every amount is round and synthetic, every percentage obviously invented, and
 * every state is built over HTTP by a manager through the real endpoints — the
 * ratings included, which the posting path writes. No raw SQL seeds any row.
 * ---------------------------------------------------------------------------
 */

export const MONTH_ONE_DAY = '2026-09-05';
/** The second Saturday of month one. The availability window is 09:00-13:00 and a
 * session is 45 minutes, so a fourth month-one session needs another day rather
 * than a fourth hour. */
export const MONTH_ONE_DAY_TWO = '2026-09-12';
export const MONTH_TWO_DAY = '2026-10-03';
export const MONTH_THREE_DAY = '2026-10-31';

/** The three closes the suites perform, as inclusive ranges. */
export const MONTH_ONE = { from: '2026-09-01', to: '2026-09-30' };
export const MONTH_TWO = { from: '2026-10-01', to: '2026-10-15' };
export const MONTH_THREE = { from: '2026-10-16', to: '2026-11-15' };

export type CloseFixture = {
  managerId: string;
  managerToken: string;
  therapistId: string;
  otherTherapistId: string;
  paidServiceId: string;
  freeServiceId: string;
  /** 40%, effective for ever. Corrected by one suite to prove a rule change moves nothing. */
  ruleId: string;
  /** Month one: rated at 40%, 250,000 base, no concession. */
  plain: StatementSession;
  /** Month one: a `FREE` session — rated, worth nothing. */
  free: StatementSession;
  /** Month one: no share rule covered the day, so UNRATED and excluded. */
  unrated: StatementSession;
  /** Month one, second Saturday: its charge is withdrawn after the first close. */
  withdrawn: StatementSession;
  /** Month two: a concession split between the two sides. */
  split: StatementSession;
  /** Month two: a clinic-borne concession larger than the clinic gross share. */
  subsidised: StatementSession;
  /** Month two: its applied rating is corrected after the second close. */
  reRated: StatementSession;
  /** Month three: an ordinary session. */
  later: StatementSession;
  /** The other therapist's month-one session, which must appear on no period of the first. */
  otherTherapist: StatementSession;
};

export async function seedCloseClinic(harness: Harness): Promise<CloseFixture> {
  const manager = await signIn(harness, 'MANAGER');
  const token = manager.token;

  const paidServiceId = await makeService(harness, token);
  const freeServiceId = await makeService(harness, token);
  const therapistId = await makeTherapist(harness, token, [paidServiceId, freeServiceId]);
  const otherTherapistId = await makeTherapist(harness, token, [paidServiceId]);
  const roomId = await makeRoom(harness, token);
  const otherRoomId = await makeRoom(harness, token);
  const family = await makeFamilyWithChild(harness, token);
  const otherFamily = await makeFamilyWithChild(harness, token);

  for (const id of [therapistId, otherTherapistId]) {
    const windows = await putWindows(harness, token, id, [SATURDAY_MORNING]);
    if (windows.status !== 200) {
      throw new Error(`Expected 200 seeding availability, got ${String(windows.status)}`);
    }
  }

  await makeTariff(harness, token, { serviceId: paidServiceId, priceToman: '250000' });
  await makeFreeTariff(harness, token, freeServiceId);

  await shareRuleId(harness, token, otherTherapistId, {
    shareBasisPoints: 3000,
    effectiveStart: '2020-01-01',
    effectiveEnd: null,
  });

  const run = (
    serviceId: string,
    startsAt: string,
    serviceDate: string,
    overrides: { therapistId?: string; roomId?: string; childId?: string } = {},
  ) =>
    completedSession(harness, token, {
      serviceId,
      therapistId: overrides.therapistId ?? therapistId,
      roomId: overrides.roomId ?? roomId,
      childId: overrides.childId ?? family.childId,
      startsAt,
      serviceDate,
    });

  // THE ORDER IS LOAD-BEARING. This session is completed BEFORE any rule covers
  // the therapist, so the posting path finds none and leaves it UNRATED — the
  // state a close excludes and counts, and the one a later close carries in.
  const unrated = await run(paidServiceId, `${MONTH_ONE_DAY}${AT_10}`, MONTH_ONE_DAY);

  const ruleId = await shareRuleId(harness, token, therapistId, {
    shareBasisPoints: 4000,
    effectiveStart: '2020-01-01',
    effectiveEnd: null,
  });

  const plain = await run(paidServiceId, `${MONTH_ONE_DAY}${AT_11}`, MONTH_ONE_DAY);
  const free = await run(freeServiceId, `${MONTH_ONE_DAY}${AT_12}`, MONTH_ONE_DAY);
  const withdrawn = await run(paidServiceId, `${MONTH_ONE_DAY_TWO}${AT_10}`, MONTH_ONE_DAY_TWO);

  const split = await run(paidServiceId, `${MONTH_TWO_DAY}${AT_10}`, MONTH_TWO_DAY);
  const subsidised = await run(paidServiceId, `${MONTH_TWO_DAY}${AT_11}`, MONTH_TWO_DAY);
  const reRated = await run(paidServiceId, `${MONTH_TWO_DAY}${AT_12}`, MONTH_TWO_DAY);

  const later = await run(paidServiceId, `${MONTH_THREE_DAY}${AT_10}`, MONTH_THREE_DAY);

  const otherTherapistSession = await run(
    paidServiceId,
    `${MONTH_ONE_DAY}${AT_10}`,
    MONTH_ONE_DAY,
    { therapistId: otherTherapistId, roomId: otherRoomId, childId: otherFamily.childId },
  );

  // 60,000 off the family, 20,000 of it out of the therapist's 100,000 share.
  await allocateOverHttp(harness, token, split.chargeId, '60000', '20000').expect(200);

  // 200,000 off the family, borne entirely by the clinic, whose gross share is
  // 150,000 — so the clinic net is -50,000 and the therapist keeps 100,000.
  await adjustOverHttp(harness, token, subsidised.chargeId, '200000').expect(200);

  return {
    managerId: manager.id,
    managerToken: token,
    therapistId,
    otherTherapistId,
    paidServiceId,
    freeServiceId,
    ruleId,
    plain,
    free,
    unrated,
    withdrawn,
    split,
    subsidised,
    reRated,
    later,
    otherTherapist: otherTherapistSession,
  };
}
