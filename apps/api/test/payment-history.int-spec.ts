import {
  paymentListResponseSchema,
  paymentSchema,
  type PaymentListResponse,
} from '@clinic/contracts';
import { signIn } from './appointments-support';
import { uuidv7 } from '../src/common/uuid';
import { createHarness, resetDatabase, type Harness } from './harness';
import {
  clinicDay,
  familyPayments,
  recordPaymentOverHttp,
  seedAnotherFamily,
  seedPayingFamily,
  voidPaymentOverHttp,
  type PaymentFixture,
} from './payment-support';

/**
 * A family's payment history: what arrived, when, and what was withdrawn.
 *
 * WHAT THIS LIST IS FOR is answering "you say we paid less than we did — show
 * us". That is why a withdrawn payment is on it by default: a reversal that
 * vanished from the history would let this screen silently disagree with the
 * audit trail, and a family asking what happened to a receipt they hold would be
 * told the money was never recorded.
 *
 * IT IS FAMILY-LEVEL AND HAS NO CHILD IN IT. A payment names no charge, no
 * session and no child (DECISION_LOG, 2026-08-15 — A payment is a family fact),
 * so the frozen query offers no such filter and the strict schema refuses one.
 *
 * IT CARRIES NO TOTAL. What the family has paid altogether is the account
 * position's, where this list's date window does not narrow it; a filter-scoped
 * total here is the second number people would quote as the balance.
 *
 * Every fixture is synthetic: no real family, amount, bank reference or note
 * appears anywhere in this file.
 */
describe('family payment history', () => {
  let harness: Harness;
  let fixture: PaymentFixture;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    fixture = await seedPayingFamily(harness);
  });

  /** Reads the history and parses it against the frozen contract, which is half the assertion. */
  async function read(
    query: Record<string, string | number> = {},
    token = fixture.managerToken,
    familyId = fixture.familyId,
  ): Promise<PaymentListResponse> {
    const response = await familyPayments(harness, token, familyId, query).expect(200);
    return paymentListResponseSchema.parse(response.body);
  }

  /** Money over the counter, on a named clinic day. */
  async function pay(
    amountToman: string,
    receivedOn: string,
    overrides: Record<string, unknown> = {},
    familyId = fixture.familyId,
  ): Promise<string> {
    const response = await recordPaymentOverHttp(harness, fixture.managerToken, familyId, {
      amountToman,
      method: 'CASH',
      receivedOn,
      ...overrides,
    }).expect(200);

    return response.body.payment.id as string;
  }

  /** Four payments over three clinic days, the newest of them withdrawn. */
  async function seedHistory(): Promise<{
    ids: string[];
    voidedId: string;
    days: { old: string; middle: string; recent: string };
  }> {
    const days = {
      old: await clinicDay(harness, -20),
      middle: await clinicDay(harness, -10),
      recent: await clinicDay(harness, -1),
    };

    const oldest = await pay('100000', days.old);
    const middle = await pay('150000', days.middle);
    const alsoMiddle = await pay('50000', days.middle, { method: 'CARD' });
    const newest = await pay('900000', days.recent, { method: 'TRANSFER' });

    await voidPaymentOverHttp(harness, fixture.managerToken, newest).expect(200);

    return { ids: [oldest, middle, alsoMiddle, newest], voidedId: newest, days };
  }

  describe('what the list shows', () => {
    it('returns the family it was asked about and every payment on it', async () => {
      const { ids } = await seedHistory();
      const history = await read();

      expect(history.familyId).toBe(fixture.familyId);
      expect(history.payments).toHaveLength(4);
      expect(history.payments.map((one) => one.id).sort()).toEqual([...ids].sort());
      expect(history.page).toStrictEqual({ page: 1, pageSize: 25, total: 4, hasMore: false });
    });

    it('carries each payment exactly as the write that recorded it did', async () => {
      const receivedOn = await clinicDay(harness, -2);

      const recorded = await recordPaymentOverHttp(
        harness,
        fixture.managerToken,
        fixture.familyId,
        {
          amountToman: '175000',
          method: 'TRANSFER',
          receivedOn,
          reference: 'TRX-SYNTHETIC-1',
          note: 'یادداشت آزمایشی',
        },
      ).expect(200);

      const written = paymentSchema.parse(recorded.body.payment);
      const [listed] = (await read()).payments;

      // One mapping for every read of a payment (`payment-detail.ts`): the row a
      // receptionist just recorded reads identically here, `status` included.
      expect(listed).toStrictEqual(written);
      expect(listed?.reference).toBe('TRX-SYNTHETIC-1');
      expect(listed?.createdByUserId).toBe(fixture.managerId);
    });

    it('shows a withdrawn payment as history, marked', async () => {
      const { voidedId } = await seedHistory();

      const voided = (await read()).payments.find((one) => one.id === voidedId);

      expect(voided?.status).toBe('VOIDED');
      expect(voided?.voidedAt).not.toBeNull();
      expect(voided?.voidedByUserId).toBe(fixture.managerId);
      expect(voided?.voidReason).not.toBeNull();
      // The record survives whole: what was recorded is still what is shown.
      expect(voided?.amountToman).toBe('900000');
    });

    it('shows no payment of another family', async () => {
      await seedHistory();
      const other = await seedAnotherFamily(harness, fixture);

      await pay('300000', await clinicDay(harness, -3), {}, other);

      const mine = await read();
      const theirs = await read({}, fixture.managerToken, other);

      expect(mine.payments).toHaveLength(4);
      expect(theirs.payments).toHaveLength(1);
      expect(theirs.payments[0]?.familyId).toBe(other);
      expect(mine.payments.every((one) => one.familyId === fixture.familyId)).toBe(true);
    });

    it('answers with an empty history for a family that has never paid', async () => {
      const history = await read();

      expect(history.payments).toHaveLength(0);
      expect(history.page).toStrictEqual({ page: 1, pageSize: 25, total: 0, hasMore: false });
    });
  });

  describe('withdrawn payments are visible unless somebody hides them', () => {
    it('includes them by default', async () => {
      const { voidedId } = await seedHistory();

      // The approved default: financial history is visible unless somebody asks
      // to hide it (frozen F1).
      expect((await read()).payments.map((one) => one.id)).toContain(voidedId);
      expect((await read({ includeVoided: 'true' })).payments).toHaveLength(4);
    });

    it('excludes them on request, and says so in the page count', async () => {
      const { voidedId } = await seedHistory();

      const hidden = await read({ includeVoided: 'false' });

      expect(hidden.payments).toHaveLength(3);
      expect(hidden.payments.map((one) => one.id)).not.toContain(voidedId);
      expect(hidden.payments.every((one) => one.status === 'CONFIRMED')).toBe(true);
      // The count follows the list, because it IS the list's: this number is page
      // metadata and not money — the money lives on the account position, where
      // hiding a row changes nothing.
      expect(hidden.page.total).toBe(3);
    });

    it('refuses a spelling that is neither true nor false', async () => {
      // Not `z.coerce.boolean()`: `Boolean('no')` is `true`, and a default-true
      // filter written that way could never be turned off at all.
      await familyPayments(harness, fixture.managerToken, fixture.familyId, {
        includeVoided: 'no',
      }).expect(400);
    });
  });

  describe('filters', () => {
    it('bounds the history by the day the money arrived', async () => {
      const { days } = await seedHistory();

      const middle = await read({ from: days.middle, to: days.middle });

      expect(middle.payments).toHaveLength(2);
      expect(middle.payments.every((one) => one.receivedOn === days.middle)).toBe(true);
      expect(middle.page.total).toBe(2);
    });

    it('applies the date bounds inclusively at both ends', async () => {
      const { days } = await seedHistory();

      expect((await read({ from: days.old, to: days.recent })).payments).toHaveLength(4);
      expect((await read({ from: days.middle })).payments).toHaveLength(3);
      expect((await read({ to: days.middle })).payments).toHaveLength(3);
    });

    it('bounds on the day the money arrived and not the day it was entered', async () => {
      // Every payment in this suite is entered today and back-dated, so a filter
      // that compared against `created_at` would return all of them for today and
      // none for the days they arrived on.
      const today = await clinicDay(harness);
      const { days } = await seedHistory();

      expect((await read({ from: today })).payments).toHaveLength(0);
      expect((await read({ from: days.old, to: days.recent })).payments).toHaveLength(4);
    });

    it('combines the date window with the visibility filter', async () => {
      const { days } = await seedHistory();

      const recent = await read({ from: days.recent, includeVoided: 'false' });

      expect(recent.payments).toHaveLength(0);
      expect(recent.page.total).toBe(0);
    });

    it('refuses a filter the frozen query does not define', async () => {
      // `strictObject`: a payment names no child, so a `childId` here is a
      // question this system cannot answer and is refused rather than ignored.
      await familyPayments(harness, fixture.managerToken, fixture.familyId, {
        childId: uuidv7(),
      }).expect(400);

      await familyPayments(harness, fixture.managerToken, fixture.familyId, {
        status: 'CONFIRMED',
      }).expect(400);
    });
  });

  describe('pagination', () => {
    it('returns the newest received day first', async () => {
      const { days } = await seedHistory();

      const received = (await read()).payments.map((one) => one.receivedOn);

      expect(received).toStrictEqual([days.recent, days.middle, days.middle, days.old]);
    });

    it('states the page, the total and hasMore correctly', async () => {
      await seedHistory();

      const first = await read({ page: 1, pageSize: 3 });
      expect(first.page).toStrictEqual({ page: 1, pageSize: 3, total: 4, hasMore: true });
      expect(first.payments).toHaveLength(3);

      const last = await read({ page: 2, pageSize: 3 });
      expect(last.page).toStrictEqual({ page: 2, pageSize: 3, total: 4, hasMore: false });
      expect(last.payments).toHaveLength(1);

      const beyond = await read({ page: 3, pageSize: 3 });
      expect(beyond.payments).toHaveLength(0);
      expect(beyond.page.hasMore).toBe(false);
      expect(beyond.page.total).toBe(4);
    });

    it('pages deterministically, with every payment on exactly one page', async () => {
      await seedHistory();

      const paged = await Promise.all([1, 2].map(async (page) => read({ page, pageSize: 2 })));
      const ids = paged.flatMap((page) => page.payments.map((one) => one.id));

      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(4);

      // Two payments share a received day, which is exactly where a loose order
      // would let a row appear twice or not at all. The same request twice is the
      // same page, because the order falls through to the entry instant and the id.
      const again = await read({ page: 1, pageSize: 2 });
      expect(again.payments.map((one) => one.id)).toStrictEqual(
        paged[0]?.payments.map((one) => one.id),
      );
    });

    it('refuses a page size beyond the frozen ceiling', async () => {
      await familyPayments(harness, fixture.managerToken, fixture.familyId, {
        pageSize: 101,
      }).expect(400);
    });
  });

  describe('access and privacy', () => {
    it('lets a receptionist read the history', async () => {
      // `payment.read` is held by both roles: reading what a family paid is desk
      // work. `payment.void` is the manager's alone and is a different route.
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      await seedHistory();

      expect((await read({}, receptionist.token)).payments).toHaveLength(4);
    });

    it('refuses a caller without a session', async () => {
      await familyPayments(harness, 'not-a-session-token', fixture.familyId).expect(401);
    });

    it('answers 404 for a family that does not exist', async () => {
      const response = await familyPayments(harness, fixture.managerToken, uuidv7()).expect(404);

      expect(response.body.error.code).toBe('FAMILY_NOT_FOUND');
    });

    it('writes no audit row for a read', async () => {
      await seedHistory();
      const before = await harness.prisma.auditLog.count();

      await read();
      await read({ includeVoided: 'false' });

      // `audit_log` is append-only and permanent. Audit records financial ACTS —
      // recording money and withdrawing it — and this route performs none.
      expect(await harness.prisma.auditLog.count()).toBe(before);
    });

    it('forbids the response from being cached', async () => {
      const response = await familyPayments(harness, fixture.managerToken, fixture.familyId).expect(
        200,
      );

      expect(response.headers['cache-control']).toMatch(/no-store/);
    });
  });
});
