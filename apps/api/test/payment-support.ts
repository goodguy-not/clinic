import { Prisma } from '@prisma/client';
import request from 'supertest';
import { uuidv7 } from '../src/common/uuid';
import type { Harness } from './harness';
import { asUser, makeFamilyWithChild, signIn } from './appointments-support';

/**
 * Shared fixtures for the Milestone 6 payment and promise schema suites.
 *
 * EVERYTHING HERE IS SYNTHETIC. No real family, guardian, amount, bank
 * reference or note appears in any fixture in this project.
 *
 * Checkpoint A1 builds the SCHEMA and no behaviour, so there is no payment
 * service and no endpoint to write through. Every payment and promise below is
 * written with RAW SQL — which is also the honest test of what this checkpoint
 * claims: the rules must hold against a caller that is not the service, because
 * in A1 there is no service to hold them.
 *
 * The family side of the fixture is built over HTTP by a manager, exactly as the
 * Milestone 5 suites do, so every family paying here is one the application
 * itself can produce.
 */

export type PaymentFixture = {
  managerId: string;
  managerToken: string;
  familyId: string;
};

/** A manager and one family: the whole precondition of a payment. */
export async function seedPayingFamily(harness: Harness): Promise<PaymentFixture> {
  const manager = await signIn(harness, 'MANAGER');
  const { familyId } = await makeFamilyWithChild(harness, manager.token);

  return { managerId: manager.id, managerToken: manager.token, familyId };
}

/** Another family under the same manager, for the cross-family refusals. */
export async function seedAnotherFamily(
  harness: Harness,
  fixture: PaymentFixture,
): Promise<string> {
  const { familyId } = await makeFamilyWithChild(harness, fixture.managerToken, {
    firstName: 'کودک خانوادهٔ دیگر',
  });

  return familyId;
}

/**
 * Recording a payment the way an operator does: over HTTP, against the frozen
 * route, with the family named by the path and never by the body.
 *
 * Added in checkpoint A3, when the endpoint began to exist. The raw-SQL inserts
 * below stay exactly as they were — the schema suites test that the database
 * rules hold against a caller that is NOT the service, which is a different
 * claim from this one and is not weakened by the service arriving.
 */
export function recordPaymentOverHttp(
  harness: Harness,
  token: string,
  familyId: string,
  body: Record<string, unknown>,
): request.Test {
  return request(harness.app.getHttpServer())
    .post(`/families/${familyId}/payments`)
    .set(asUser(token))
    .send(body);
}

/**
 * Voiding a payment the way a manager does: over HTTP, against the frozen route,
 * with the payment named by the path and the mandatory reason in the body.
 *
 * Added in checkpoint A4. `body` is passed straight through so a test can omit
 * the reason, blank it or overlong it and watch the request be refused.
 */
export function voidPaymentOverHttp(
  harness: Harness,
  token: string,
  paymentId: string,
  body: Record<string, unknown> = { reason: 'ثبت اشتباه مبلغ' },
): request.Test {
  return request(harness.app.getHttpServer())
    .post(`/payments/${paymentId}/void`)
    .set(asUser(token))
    .send(body);
}

/** Every `payment.voided` audit row for one payment, oldest first. */
export async function voidedPaymentAuditRows(
  harness: Harness,
  paymentId: string,
): Promise<
  {
    action: string;
    entity_type: string;
    entity_id: string;
    actor_user_id: string | null;
    occurred_at: Date;
    before: unknown;
    after: unknown;
    metadata: unknown;
  }[]
> {
  return harness.prisma.$queryRaw`
    SELECT action, entity_type, entity_id, actor_user_id, occurred_at, before, after, metadata
    FROM audit_log
    WHERE action = 'payment.voided' AND entity_id = ${paymentId}::uuid
    ORDER BY occurred_at ASC
  `;
}

/**
 * A clinic calendar day, offset from today.
 *
 * Read from `clinic_date()` rather than computed in Node, for the reason
 * Milestone 3 gave when it wrote that function: "today" means today in Tehran,
 * and the Node host, the session timezone and the clinic disagree for three and
 * a half hours of every day. A test that built its own dates would pass or fail
 * depending on the hour it ran at.
 */
export async function clinicDay(harness: Harness, offsetDays = 0): Promise<string> {
  const rows = await harness.prisma.$queryRaw<{ day: Date }[]>`
    SELECT (clinic_date() + ${offsetDays}::int)::date AS day
  `;

  const day = rows[0]?.day;
  if (day === undefined) throw new Error('clinic_date() returned nothing');

  return day.toISOString().slice(0, 10);
}

export type PaymentOverrides = {
  id?: string;
  familyId?: string;
  amountToman?: string;
  method?: 'CASH' | 'CARD' | 'TRANSFER';
  /** Defaults to `clinic_date()` — the business day the fixture runs on. */
  receivedOn?: string;
  reference?: string | null;
  note?: string | null;
  voided?: boolean;
};

/**
 * Inserts a payment with raw SQL and returns its id.
 *
 * `transaction_timestamp()` for `created_at`, as every service in this project
 * writes it, so a fixture and a production row come from the same clock.
 */
export async function insertPayment(
  harness: Harness,
  fixture: PaymentFixture,
  overrides: PaymentOverrides = {},
): Promise<string> {
  const id = overrides.id ?? uuidv7();
  const voided = overrides.voided ?? false;
  const reference = overrides.reference ?? null;
  const note = overrides.note ?? null;

  await harness.prisma.$executeRaw`
    INSERT INTO payment (
      id, family_id, amount_toman, method, received_on, reference, note,
      created_at, created_by_user_id, voided_at, voided_by_user_id, void_reason
    ) VALUES (
      ${id}::uuid,
      ${overrides.familyId ?? fixture.familyId}::uuid,
      ${overrides.amountToman ?? '250000'}::bigint,
      ${overrides.method ?? 'CASH'}::payment_method,
      ${
        overrides.receivedOn === undefined
          ? Prisma.sql`clinic_date()`
          : Prisma.sql`${overrides.receivedOn}::date`
      },
      ${reference},
      ${note},
      transaction_timestamp(),
      ${fixture.managerId}::uuid,
      ${voided ? Prisma.sql`transaction_timestamp()` : Prisma.sql`NULL`},
      ${voided ? Prisma.sql`${fixture.managerId}::uuid` : Prisma.sql`NULL`},
      ${voided ? Prisma.sql`'ابطال آزمایشی'` : Prisma.sql`NULL`}
    )
  `;

  return id;
}

/**
 * Voids a payment the way the A3 service will: one UPDATE setting the three
 * void columns together, and nothing else.
 *
 * It names no promise and locks no promise, which is the approved lock order
 * holding in the fixture as well as in the trigger.
 */
export async function voidPayment(
  harness: Harness,
  fixture: { managerId: string },
  paymentId: string,
): Promise<void> {
  await harness.prisma.$executeRaw`
    UPDATE payment
       SET voided_at = transaction_timestamp(),
           voided_by_user_id = ${fixture.managerId}::uuid,
           void_reason = 'ابطال آزمایشی'
     WHERE id = ${paymentId}::uuid
  `;
}

export type PromiseOverrides = {
  id?: string;
  familyId?: string;
  amountToman?: string;
  /** Defaults to `clinic_date()`. A past date is legitimate on an initial promise. */
  dueOn?: string;
  note?: string | null;
  /** Only for the born-terminal refusals; the database refuses every one. */
  status?: 'OPEN' | 'FULFILLED' | 'RESCHEDULED' | 'CANCELLED';
  fulfillingPaymentId?: string;
  rescheduledToPromiseId?: string;
  /** Only for the born-terminal refusals; a promise is born without one. */
  resolutionReason?: string | null;
};

/** Inserts a payment promise with raw SQL and returns its id. */
export async function insertPromise(
  harness: Harness,
  fixture: PaymentFixture,
  overrides: PromiseOverrides = {},
): Promise<string> {
  const id = overrides.id ?? uuidv7();
  const status = overrides.status ?? 'OPEN';
  const resolved = status !== 'OPEN';

  await harness.prisma.$executeRaw`
    INSERT INTO payment_promise (
      id, family_id, amount_toman, due_on, note, status,
      fulfilling_payment_id, rescheduled_to_promise_id,
      resolved_at, resolved_by_user_id, resolution_reason,
      created_at, created_by_user_id
    ) VALUES (
      ${id}::uuid,
      ${overrides.familyId ?? fixture.familyId}::uuid,
      ${overrides.amountToman ?? '250000'}::bigint,
      ${
        overrides.dueOn === undefined
          ? Prisma.sql`clinic_date()`
          : Prisma.sql`${overrides.dueOn}::date`
      },
      ${overrides.note ?? null},
      ${status}::payment_promise_status,
      ${
        overrides.fulfillingPaymentId === undefined
          ? Prisma.sql`NULL`
          : Prisma.sql`${overrides.fulfillingPaymentId}::uuid`
      },
      ${
        overrides.rescheduledToPromiseId === undefined
          ? Prisma.sql`NULL`
          : Prisma.sql`${overrides.rescheduledToPromiseId}::uuid`
      },
      ${resolved ? Prisma.sql`transaction_timestamp()` : Prisma.sql`NULL`},
      ${resolved ? Prisma.sql`${fixture.managerId}::uuid` : Prisma.sql`NULL`},
      ${
        overrides.resolutionReason === undefined
          ? Prisma.sql`${resolved && status !== 'FULFILLED' ? 'دلیل آزمایشی' : null}`
          : Prisma.sql`${overrides.resolutionReason}`
      },
      transaction_timestamp(),
      ${fixture.managerId}::uuid
    )
  `;

  return id;
}

/**
 * Fulfils a promise the way the A4 service will: one UPDATE naming the payment,
 * the status, the actor and the instant together.
 *
 * The UPDATE takes the promise row lock, and the trigger then takes `FOR SHARE`
 * on the payment — `payment_promise -> payment`, which is the approved order.
 */
export function fulfilPromise(
  harness: Harness,
  fixture: { managerId: string },
  promiseId: string,
  paymentId: string,
  /** Optional on a kept promise: the linked payment is the explanation. */
  reason: string | null = null,
): Promise<number> {
  return harness.prisma.$executeRaw`
    UPDATE payment_promise
       SET status = 'FULFILLED',
           fulfilling_payment_id = ${paymentId}::uuid,
           resolved_at = transaction_timestamp(),
           resolved_by_user_id = ${fixture.managerId}::uuid,
           resolution_reason = ${reason}
     WHERE id = ${promiseId}::uuid
  `;
}

/**
 * Closes a promise into its successor, in the one statement that does both.
 *
 * `reason` is passed straight through so a test can omit it (`null`) or malform
 * it and watch PostgreSQL refuse the transition.
 */
export function reschedulePromise(
  harness: Harness,
  fixture: { managerId: string },
  promiseId: string,
  successorId: string,
  reason: string | null = 'تغییر زمان به درخواست خانواده',
): Promise<number> {
  return harness.prisma.$executeRaw`
    UPDATE payment_promise
       SET status = 'RESCHEDULED',
           rescheduled_to_promise_id = ${successorId}::uuid,
           resolved_at = transaction_timestamp(),
           resolved_by_user_id = ${fixture.managerId}::uuid,
           resolution_reason = ${reason}
     WHERE id = ${promiseId}::uuid
  `;
}

/** Cancels a promise: a terminal state with no link of its own, and a mandatory reason. */
export function cancelPromise(
  harness: Harness,
  fixture: { managerId: string },
  promiseId: string,
  reason: string | null = 'انصراف خانواده از قول پرداخت',
): Promise<number> {
  return harness.prisma.$executeRaw`
    UPDATE payment_promise
       SET status = 'CANCELLED',
           resolved_at = transaction_timestamp(),
           resolved_by_user_id = ${fixture.managerId}::uuid,
           resolution_reason = ${reason}
     WHERE id = ${promiseId}::uuid
  `;
}
