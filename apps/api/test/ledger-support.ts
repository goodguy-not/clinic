import { Prisma } from '@prisma/client';
import request from 'supertest';
import { childWriteResponseSchema, sessionChargeResponseSchema } from '@clinic/contracts';
import { uuidv7 } from '../src/common/uuid';
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
  SATURDAY_10_00,
  SATURDAY_11_00,
  SATURDAY_MORNING,
} from './appointments-support';

/**
 * Shared fixtures for the Milestone 5 ledger schema suites.
 *
 * EVERYTHING HERE IS SYNTHETIC. No real family, child, therapist, price or
 * amount appears in any fixture in this project.
 *
 * Checkpoint A1 builds the SCHEMA and no behaviour, so there is no charge
 * endpoint and no posting service to seed through. Every charge and adjustment
 * below is written with raw SQL — which is also the honest test of what this
 * checkpoint claims: the rules must hold against a caller that is not the
 * service, because in A1 there is no service to hold them.
 *
 * The clinic side of the fixture is built over HTTP by a manager, exactly as the
 * Milestone 4 suites do, so every appointment charged here is a state the
 * application itself can produce.
 */

export type LedgerFixture = {
  managerId: string;
  managerToken: string;
  familyId: string;
  childId: string;
  serviceId: string;
  therapistId: string;
  roomId: string;
  appointmentId: string;
  participantId: string;
  tariffId: string;
  /** The clinic calendar day the fixture's session happens on. */
  serviceDate: string;
  /** 45 minutes, matching `bookingPayload`. */
  durationMinutes: number;
};

/**
 * A completed appointment with one attended child, and a price that covers it.
 *
 * The whole precondition of a primary session charge, in one call.
 *
 * THE TARIFF IS RECORDED LAST, AFTER THE SESSION IS COMPLETE, and the order is
 * load-bearing rather than incidental. From checkpoint A3 the completion posts
 * the charge automatically, and a fixture that arrived already charged would
 * collide with every schema suite below — all of which insert their own charge
 * with raw SQL, because what those suites test is that the rules hold against a
 * caller that is not the service. Completing an unpriced session writes nothing
 * and leaves the seat chargeable, so the fixture still means exactly what it
 * meant in A1: a session that MAY be charged and has not been.
 *
 * `seedPostedSession` below is the fixture for the other question — a session
 * the application itself has charged.
 */
export async function seedChargeableSession(harness: Harness): Promise<LedgerFixture> {
  const manager = await signIn(harness, 'MANAGER');
  const clinic = await seedClinic(harness, manager.token);

  const appointmentId = await bookId(harness, manager.token, bookingPayload(clinic));

  const participant = await harness.prisma.appointmentParticipant.findFirstOrThrow({
    where: { appointmentId },
  });

  await recordAttendance(harness, manager.token, appointmentId, participant.id, 'ATTENDED');
  await complete(harness, manager.token, appointmentId);

  const tariffId = await makeTariff(harness, manager.token, {
    serviceId: clinic.serviceId,
    durationMinutes: 45,
    priceToman: '250000',
  });

  return {
    managerId: manager.id,
    managerToken: manager.token,
    familyId: clinic.familyId,
    childId: clinic.childId,
    serviceId: clinic.serviceId,
    therapistId: clinic.therapistId,
    roomId: clinic.roomId,
    appointmentId,
    participantId: participant.id,
    tariffId,
    serviceDate: SATURDAY,
    durationMinutes: 45,
  };
}

/**
 * A session the application itself has charged, and the charge it raised.
 *
 * The tariff is recorded FIRST here, which is the whole difference from
 * `seedChargeableSession` above: attendance and completion then run in the order
 * a receptionist works in, and the completion posts the charge through the real
 * A3 path. Nothing in this fixture writes a financial row with SQL — the charge
 * under test is one the endpoints produced.
 */
export async function seedPostedSession(harness: Harness): Promise<PostedSession> {
  const manager = await signIn(harness, 'MANAGER');
  const clinic = await seedClinic(harness, manager.token);
  const appointmentId = await bookId(harness, manager.token, bookingPayload(clinic));

  const participant = await harness.prisma.appointmentParticipant.findFirstOrThrow({
    where: { appointmentId },
  });

  const tariffId = await makeTariff(harness, manager.token, {
    serviceId: clinic.serviceId,
    durationMinutes: 45,
    priceToman: '250000',
  });

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
    familyId: clinic.familyId,
    childId: clinic.childId,
    serviceId: clinic.serviceId,
    therapistId: clinic.therapistId,
    roomId: clinic.roomId,
    appointmentId,
    participantId: participant.id,
    tariffId,
    serviceDate: SATURDAY,
    durationMinutes: 45,
    chargeId: charge.id,
    amountToman: '250000',
  };
}

export type PostedSession = LedgerFixture & {
  /** The charge the completion raised, still valid. */
  chargeId: string;
  amountToman: string;
};

/** The manager-only void: the charge is named by the path, the reason is required. */
export function voidChargeOverHttp(
  harness: Harness,
  token: string,
  chargeId: string,
  reason = 'ابطال آزمایشی هزینه',
): request.Test {
  return request(harness.app.getHttpServer())
    .post(`/session-charges/${chargeId}/void`)
    .set(asUser(token))
    .send({ reason });
}

/**
 * The manager-only concession, borne wholly by the clinic. Since M10.5 (D10)
 * the manager states both portions, so "clinic-borne" is sent explicitly: the
 * therapist bears 0 and the clinic the whole amount.
 */
export function adjustOverHttp(
  harness: Harness,
  token: string,
  chargeId: string,
  amountToman: string,
  reason = 'تخفیف آزمایشی',
): request.Test {
  return request(harness.app.getHttpServer())
    .post(`/session-charges/${chargeId}/adjustments`)
    .set(asUser(token))
    .send({ amountToman, reason, therapistDiscountToman: '0', clinicDiscountToman: amountToman });
}

/** Withdrawing a concession: both ids in the path, the reason required. */
export function voidAdjustmentOverHttp(
  harness: Harness,
  token: string,
  chargeId: string,
  adjustmentId: string,
  reason = 'ابطال تخفیف آزمایشی',
): request.Test {
  return request(harness.app.getHttpServer())
    .post(`/session-charges/${chargeId}/adjustments/${adjustmentId}/void`)
    .set(asUser(token))
    .send({ reason });
}

/**
 * Every adjustment against one charge, voided rows included, oldest first.
 *
 * Read straight from the table, for the reason `chargeRowsFor` is: "exactly one
 * row exists" is a claim about the database, and a read that hid voided rows
 * could not tell one concession from three.
 */
export function adjustmentRowsFor(harness: Harness, chargeId: string) {
  return harness.prisma.chargeAdjustment.findMany({
    where: { sessionChargeId: chargeId },
    orderBy: { createdAt: 'asc' },
  });
}

/** The `charge_adjustment.*` rows written for one adjustment. */
export function adjustmentAuditRowsFor(
  harness: Harness,
  action: 'charge_adjustment.created' | 'charge_adjustment.voided',
  adjustmentId: string,
) {
  return harness.prisma.auditLog.findMany({ where: { action, entityId: adjustmentId } });
}

/** The `session_charge.voided` rows written for one charge. */
export function voidedAuditRowsFor(harness: Harness, chargeId: string) {
  return harness.prisma.auditLog.findMany({
    where: { action: 'session_charge.voided', entityId: chargeId },
  });
}

/**
 * A booked session and nothing else: no attendance, no completion, no price.
 *
 * The starting point for every A3 test that cares about the ORDER the two facts
 * arrive in, which the higher-level fixture above has already fixed.
 */
export async function seedBookedSession(harness: Harness): Promise<BookedSession> {
  const manager = await signIn(harness, 'MANAGER');
  const clinic = await seedClinic(harness, manager.token);
  const appointmentId = await bookId(harness, manager.token, bookingPayload(clinic));

  const participant = await harness.prisma.appointmentParticipant.findFirstOrThrow({
    where: { appointmentId },
  });

  return {
    managerId: manager.id,
    managerToken: manager.token,
    ...clinic,
    appointmentId,
    participantId: participant.id,
    serviceDate: SATURDAY,
  };
}

export type BookedSession = {
  managerId: string;
  managerToken: string;
  serviceId: string;
  therapistId: string;
  roomId: string;
  familyId: string;
  childId: string;
  appointmentId: string;
  participantId: string;
  serviceDate: string;
};

/** The explicit, idempotent re-post: the seat is named by the path, the body is empty. */
export function postCharge(harness: Harness, token: string, participantId: string): request.Test {
  return request(harness.app.getHttpServer())
    .post(`/session-charges/participants/${participantId}`)
    .set(asUser(token))
    .send({});
}

/**
 * A genuinely complimentary programme, which is a different fact from a priced
 * session discounted to nothing (DECISION_LOG, 2026-08-06).
 */
export async function makeFreeTariff(
  harness: Harness,
  token: string,
  serviceId: string,
  durationMinutes = 45,
): Promise<string> {
  const response = await request(harness.app.getHttpServer())
    .post('/catalog/tariffs')
    .set(asUser(token))
    .send({
      serviceId,
      durationMinutes,
      therapistId: null,
      priceMode: 'FREE',
      freeReason: 'برنامهٔ رایگان آزمایشی',
      confirmFreePrice: true,
      effectiveStart: '2020-01-01',
      effectiveEnd: null,
    });

  if (response.status !== 201) {
    throw new Error(
      `Expected 201 seeding a free tariff, got ${String(response.status)} ` +
        `(${String(response.body?.error?.code ?? 'no code')})`,
    );
  }

  return response.body.tariff.id as string;
}

/**
 * Every charge a seat has ever had, voided rows included, oldest first.
 *
 * Read straight from the table rather than through an endpoint: "exactly one row
 * exists" is a claim about the database, and a read that filtered voided rows
 * could not distinguish "one charge" from "three, two of them withdrawn".
 */
export function chargeRowsFor(harness: Harness, participantId: string) {
  return harness.prisma.sessionCharge.findMany({
    where: { appointmentParticipantId: participantId },
    orderBy: { createdAt: 'asc' },
  });
}

/** The `session_charge.posted` rows written for one charge. */
export function postedAuditRowsFor(harness: Harness, chargeId: string) {
  return harness.prisma.auditLog.findMany({
    where: { action: 'session_charge.posted', entityId: chargeId },
  });
}

export type ChargeOverrides = {
  id?: string;
  familyId?: string;
  childId?: string;
  appointmentId?: string;
  participantId?: string;
  serviceId?: string;
  therapistId?: string;
  durationMinutes?: number;
  serviceDate?: string;
  tariffId?: string;
  priceMode?: 'PAID' | 'FREE';
  amountToman?: string;
  voided?: boolean;
};

/**
 * Inserts a session charge with raw SQL and returns its id.
 *
 * `transaction_timestamp()` for `created_at`, as every service in this project
 * writes it, so a fixture and a production row come from the same clock.
 */
export async function insertCharge(
  harness: Harness,
  fixture: LedgerFixture,
  overrides: ChargeOverrides = {},
): Promise<string> {
  const id = overrides.id ?? uuidv7();
  const voided = overrides.voided ?? false;

  await harness.prisma.$executeRaw`
    INSERT INTO session_charge (
      id, family_id, child_id, appointment_id, appointment_participant_id,
      service_id, therapist_id, duration_minutes, service_date,
      tariff_id, price_mode, amount_toman,
      created_at, created_by_user_id, voided_at, voided_by_user_id, void_reason
    ) VALUES (
      ${id}::uuid,
      ${overrides.familyId ?? fixture.familyId}::uuid,
      ${overrides.childId ?? fixture.childId}::uuid,
      ${overrides.appointmentId ?? fixture.appointmentId}::uuid,
      ${overrides.participantId ?? fixture.participantId}::uuid,
      ${overrides.serviceId ?? fixture.serviceId}::uuid,
      ${overrides.therapistId ?? fixture.therapistId}::uuid,
      ${overrides.durationMinutes ?? fixture.durationMinutes},
      ${overrides.serviceDate ?? fixture.serviceDate}::date,
      ${overrides.tariffId ?? fixture.tariffId}::uuid,
      ${overrides.priceMode ?? 'PAID'}::tariff_price_mode,
      ${overrides.amountToman ?? '250000'}::bigint,
      transaction_timestamp(),
      ${fixture.managerId}::uuid,
      ${voided ? Prisma.sql`transaction_timestamp()` : Prisma.sql`NULL`},
      ${voided ? Prisma.sql`${fixture.managerId}::uuid` : Prisma.sql`NULL`},
      ${voided ? Prisma.sql`'اصلاح آزمایشی'` : Prisma.sql`NULL`}
    )
  `;

  return id;
}

/**
 * Voids a charge the way the A3 service will: one UPDATE setting the three void
 * columns together, and nothing else.
 */
export async function voidCharge(
  harness: Harness,
  /** Only the actor is needed; both fixture shapes carry one. */
  fixture: { managerId: string },
  chargeId: string,
): Promise<void> {
  await harness.prisma.$executeRaw`
    UPDATE session_charge
       SET voided_at = transaction_timestamp(),
           voided_by_user_id = ${fixture.managerId}::uuid,
           void_reason = 'اصلاح آزمایشی'
     WHERE id = ${chargeId}::uuid
  `;
}

/**
 * Withdraws an adjustment with one UPDATE, the way the A5 service will.
 *
 * Separate from `insertAdjustment`'s `voided` override because the database
 * refuses a row created already void — `charge_adjustment` records a concession
 * that was granted and then taken back, and "granted and withdrawn in the same
 * statement" is not a history that happened.
 */
export async function voidAdjustment(
  harness: Harness,
  fixture: { managerId: string },
  adjustmentId: string,
): Promise<void> {
  await harness.prisma.$executeRaw`
    UPDATE charge_adjustment
       SET voided_at = transaction_timestamp(),
           voided_by_user_id = ${fixture.managerId}::uuid,
           void_reason = 'ابطال تخفیف آزمایشی'
     WHERE id = ${adjustmentId}::uuid
  `;
}

export type AdjustmentOverrides = {
  id?: string;
  amountToman?: string;
  therapistDiscountToman?: string;
  clinicDiscountToman?: string;
  reason?: string;
  voided?: boolean;
};

/** Inserts a charge adjustment with raw SQL and returns its id. */
export async function insertAdjustment(
  harness: Harness,
  fixture: LedgerFixture,
  chargeId: string,
  overrides: AdjustmentOverrides = {},
): Promise<string> {
  const id = overrides.id ?? uuidv7();
  const amount = overrides.amountToman ?? '50000';
  const voided = overrides.voided ?? false;

  await harness.prisma.$executeRaw`
    INSERT INTO charge_adjustment (
      id, session_charge_id, amount_toman,
      therapist_discount_toman, clinic_discount_toman, reason,
      created_at, created_by_user_id, voided_at, voided_by_user_id, void_reason
    ) VALUES (
      ${id}::uuid,
      ${chargeId}::uuid,
      ${amount}::bigint,
      ${overrides.therapistDiscountToman ?? '0'}::bigint,
      ${overrides.clinicDiscountToman ?? amount}::bigint,
      ${overrides.reason ?? 'تخفیف آزمایشی'},
      transaction_timestamp(),
      ${fixture.managerId}::uuid,
      ${voided ? Prisma.sql`transaction_timestamp()` : Prisma.sql`NULL`},
      ${voided ? Prisma.sql`${fixture.managerId}::uuid` : Prisma.sql`NULL`},
      ${voided ? Prisma.sql`'اصلاح آزمایشی'` : Prisma.sql`NULL`}
    )
  `;

  return id;
}

/**
 * Runs a statement that must fail, and returns the PostgreSQL SQLSTATE it failed
 * with.
 *
 * Asserting on the code rather than on a message is what makes these tests
 * survive a reworded exception, and 23001 (`restrict_violation`) is the single
 * code every "the database refuses to rewrite this" failure in this project
 * raises.
 */
export async function sqlStateOf(attempt: Promise<unknown>): Promise<string> {
  try {
    await attempt;
  } catch (error) {
    const meta = error as { meta?: { code?: string }; code?: string };
    const state = meta.meta?.code ?? meta.code;

    if (typeof state === 'string') return state;

    throw new Error('Statement failed without a SQLSTATE', { cause: error });
  }

  throw new Error('Statement was expected to fail and did not');
}

/**
 * The two Saturdays the family-account fixture spends, in UTC.
 *
 * The clinic runs on `Asia/Tehran` (+03:30), so 06:30Z is 10:00 local — the same
 * arithmetic `SATURDAY_10_00` is built on, restated for the following week so the
 * fixture has two distinct `service_date` values to filter and to page across.
 */
export const NEXT_SATURDAY = '2026-09-12';
const SATURDAY_12_00 = '2026-09-05T08:30:00.000Z';
const NEXT_SATURDAY_10_00 = '2026-09-12T06:30:00.000Z';
const NEXT_SATURDAY_11_00 = '2026-09-12T07:30:00.000Z';

/** Registers another child under a family that already exists. */
export async function makeChild(
  harness: Harness,
  token: string,
  familyId: string,
  firstName: string,
): Promise<string> {
  const response = await request(harness.app.getHttpServer())
    .post(`/families/${familyId}/children`)
    .set(asUser(token))
    .send({
      firstName,
      lastName: 'آزمایشی',
      birthDate: '2019-05-22',
      sex: 'UNSPECIFIED',
      nationalId: null,
      legacyPaperFileNumber: null,
      referralSource: null,
      note: null,
    });

  if (response.status !== 201) {
    throw new Error(
      `Expected 201 seeding a second child, got ${String(response.status)} ` +
        `(${String(response.body?.error?.code ?? 'no code')})`,
    );
  }

  return childWriteResponseSchema.parse(response.body).child.id;
}

/** Books one session, marks the child attended, completes it, and returns the charge it raised. */
async function chargeSession(
  harness: Harness,
  token: string,
  booking: {
    serviceId: string;
    therapistId: string;
    roomId: string;
    childId: string;
    startsAt: string;
  },
): Promise<{ appointmentId: string; participantId: string; chargeId: string }> {
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

  return { appointmentId, participantId: participant.id, chargeId: charge.id };
}

export type FamilyLedgerFixture = {
  managerId: string;
  managerToken: string;
  familyId: string;
  /** Two children of ONE family, which is what makes the account a family-level read. */
  childAId: string;
  childBId: string;
  /** Child A, first Saturday: 250000 reduced by an active 50000 concession. */
  reducedChargeId: string;
  reducedParticipantId: string;
  /** Child A, second Saturday: adjusted by 30000 and then WITHDRAWN. */
  voidedChargeId: string;
  voidedParticipantId: string;
  /** The concession on the voided charge. Still active; its parent is not. */
  adjustmentOnVoidedChargeId: string;
  /** Child B, first Saturday: 250000 with a concession that was itself withdrawn. */
  restoredChargeId: string;
  restoredParticipantId: string;
  voidedAdjustmentId: string;
  /** Child B, second Saturday: PAID 250000 waived in full — effective zero, still PAID. */
  waivedChargeId: string;
  waivedParticipantId: string;
  /** Child B, first Saturday: a genuinely complimentary session. Zero at source. */
  freeChargeId: string;
  freeParticipantId: string;
};

/**
 * One family, two children, five sessions, and every financial state the account
 * has to tell apart.
 *
 * EVERY ROW HERE WAS PRODUCED BY THE APPLICATION. The sessions are booked,
 * attended and completed over HTTP, the charges are raised by the real A3
 * posting path, and the concessions and voids go through the real A4/A5
 * endpoints. Nothing is written with SQL — a read model tested against
 * hand-inserted rows would prove only that the SQL matched the SQL.
 *
 * WHAT THE FAMILY IS OWED, IF THE READ IS RIGHT:
 * - charged   250000 + 250000 + 250000 + 0 = 750000 over four valid charges;
 * - reduced   50000 (child A) + 250000 (the waiver) = 300000;
 * - net       450000;
 * - and one withdrawn charge, whose own 30000 concession reduces nothing.
 */
export async function seedFamilyLedger(harness: Harness): Promise<FamilyLedgerFixture> {
  const manager = await signIn(harness, 'MANAGER');
  const token = manager.token;

  const serviceId = await makeService(harness, token);
  const freeServiceId = await makeService(harness, token);
  const therapistId = await makeTherapist(harness, token, [serviceId]);
  const freeTherapistId = await makeTherapist(harness, token, [freeServiceId]);
  const roomId = await makeRoom(harness, token);

  await putWindows(harness, token, therapistId, [SATURDAY_MORNING]).expect(200);
  await putWindows(harness, token, freeTherapistId, [SATURDAY_MORNING]).expect(200);

  const { familyId, childId: childAId } = await makeFamilyWithChild(harness, token);
  const childBId = await makeChild(harness, token, familyId, 'کودک دوم');

  await makeTariff(harness, token, { serviceId, durationMinutes: 45, priceToman: '250000' });
  await makeFreeTariff(harness, token, freeServiceId, 45);

  const paid = { serviceId, therapistId, roomId };

  const reduced = await chargeSession(harness, token, {
    ...paid,
    childId: childAId,
    startsAt: SATURDAY_10_00,
  });
  const voided = await chargeSession(harness, token, {
    ...paid,
    childId: childAId,
    startsAt: NEXT_SATURDAY_10_00,
  });
  const restored = await chargeSession(harness, token, {
    ...paid,
    childId: childBId,
    startsAt: SATURDAY_11_00,
  });
  const waived = await chargeSession(harness, token, {
    ...paid,
    childId: childBId,
    startsAt: NEXT_SATURDAY_11_00,
  });
  const free = await chargeSession(harness, token, {
    serviceId: freeServiceId,
    therapistId: freeTherapistId,
    roomId,
    childId: childBId,
    startsAt: SATURDAY_12_00,
  });

  // An ordinary concession that still stands.
  await adjustOverHttp(harness, token, reduced.chargeId, '50000').expect(200);

  // Granted, then withdrawn: visible history that reduces nothing.
  const withdrawn = await adjustOverHttp(harness, token, restored.chargeId, '100000').expect(200);
  const voidedAdjustmentId = lastAdjustmentId(withdrawn.body);
  await voidAdjustmentOverHttp(harness, token, restored.chargeId, voidedAdjustmentId).expect(200);

  // The whole charge waived. Effective zero, and still PAID — a different fact
  // from the complimentary session above (DECISION_LOG, 2026-08-06).
  await adjustOverHttp(harness, token, waived.chargeId, '250000').expect(200);

  // A concession granted before its charge was withdrawn. It stays attached and
  // stays visible; the account counts neither.
  const orphaned = await adjustOverHttp(harness, token, voided.chargeId, '30000').expect(200);
  const adjustmentOnVoidedChargeId = lastAdjustmentId(orphaned.body);
  await voidChargeOverHttp(harness, token, voided.chargeId).expect(200);

  return {
    managerId: manager.id,
    managerToken: token,
    familyId,
    childAId,
    childBId,
    reducedChargeId: reduced.chargeId,
    reducedParticipantId: reduced.participantId,
    voidedChargeId: voided.chargeId,
    voidedParticipantId: voided.participantId,
    adjustmentOnVoidedChargeId,
    restoredChargeId: restored.chargeId,
    restoredParticipantId: restored.participantId,
    voidedAdjustmentId,
    waivedChargeId: waived.chargeId,
    waivedParticipantId: waived.participantId,
    freeChargeId: free.chargeId,
    freeParticipantId: free.participantId,
  };
}

/**
 * The adjustment just created, out of the charge the write answered with.
 *
 * Every ledger write returns the whole charge rather than the row it wrote
 * (frozen F1), and `adjustments` is ordered oldest first, so the newest is the
 * last one.
 */
function lastAdjustmentId(body: unknown): string {
  const charge = sessionChargeResponseSchema.parse(body).charge;
  const newest = charge.adjustments.at(-1);

  if (newest === undefined) throw new Error('Expected the charge to carry the adjustment');
  return newest.id;
}

/** The family account: filters travel in the query string, the family in the path. */
export function familyAccount(
  harness: Harness,
  token: string,
  familyId: string,
  query: Record<string, string | number> = {},
): request.Test {
  return request(harness.app.getHttpServer())
    .get(`/families/${familyId}/account`)
    .query(query)
    .set(asUser(token));
}

/** What one seat currently owes: the read `B2` renders an appointment's money from. */
export function readParticipantCharge(
  harness: Harness,
  token: string,
  participantId: string,
): request.Test {
  return request(harness.app.getHttpServer())
    .get(`/session-charges/participants/${participantId}`)
    .set(asUser(token));
}
