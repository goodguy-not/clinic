import request from 'supertest';
import { CURRENT_PUBLIC_REQUEST_CONSENT_VERSION } from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import { asVisitor } from './website-support';

/**
 * What happens when a stranger's browser sends the same form twice at once.
 *
 * Milestone 9, checkpoint A3.
 *
 * THE INVARIANT UNDER TEST IS THAT DEDUPLICATION AND THROTTLING CANNOT LEAVE
 * INCONSISTENT STATE. Both are read-then-write rules, and an application that
 * reads before it writes cannot hold either on its own: two simultaneous
 * submissions each find no duplicate and each find a count below the limit, and
 * both are stored. A rolling window is not expressible as a unique index — a
 * calendar bucket would suppress the wrong pairs — so the authority is a
 * transaction-scoped advisory lock, and these tests exercise THAT rather than
 * the service's own reads.
 *
 * THE CASE THAT MATTERS MOST IS THE ORDINARY ONE. A double submission is not an
 * attack: it is a parent on a slow connection who pressed the button twice, and
 * it is by far the commonest way this endpoint will ever be called twice.
 *
 * Everything here is synthetic.
 */
describe('public request concurrency (real PostgreSQL)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
  });

  const server = () => harness.app.getHttpServer();

  const submission = (overrides: Record<string, unknown> = {}) => ({
    contactName: 'سرپرست نمونه',
    contactMobile: '09120000001',
    serviceSlug: null,
    childAgeYears: 6,
    childSex: 'UNSPECIFIED',
    consent: true,
    consentVersion: CURRENT_PUBLIC_REQUEST_CONSENT_VERSION,
    ...overrides,
  });

  const submit = (body: Record<string, unknown>, ip: string) =>
    request(server())
      .post('/public/requests')
      .set({ ...asVisitor(), 'x-client-ip': ip })
      .send(body);

  const storedCount = async (): Promise<number> => {
    const rows = await harness.prisma.$queryRaw<{ stored: bigint }[]>`
      SELECT count(*) AS stored FROM website_request
    `;
    return Number(rows[0]?.stored ?? 0n);
  };

  const receivedAuditCount = async (): Promise<number> => {
    const rows = await harness.prisma.$queryRaw<{ written: bigint }[]>`
      SELECT count(*) AS written FROM audit_log WHERE action = 'website_request.received'
    `;
    return Number(rows[0]?.written ?? 0n);
  };

  it('stores one row when the same form is submitted twice simultaneously', async () => {
    const [first, second] = await Promise.all([
      submit(submission(), '203.0.113.10'),
      submit(submission(), '203.0.113.10'),
    ]);

    // BOTH SUCCEED, AND IDENTICALLY. The loser of the race is not told it lost:
    // any observable difference would make this endpoint an oracle answering
    // "has this person already written in?" for anybody who cared to ask.
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body).toEqual(first.body);

    expect(await storedCount()).toBe(1);
    // And exactly one act was recorded, because exactly one thing happened.
    expect(await receivedAuditCount()).toBe(1);
  });

  it('holds under a burst of six identical submissions', async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => submit(submission(), '203.0.113.10')),
    );

    expect(responses.map((response) => response.status)).toEqual([202, 202, 202, 202, 202, 202]);
    expect(await storedCount()).toBe(1);
    expect(await receivedAuditCount()).toBe(1);
  });

  it('lets genuinely different simultaneous submissions through', async () => {
    // The lock is per-subject, not global. Two unrelated families writing in at
    // the same instant must not block or absorb one another.
    const responses = await Promise.all([
      submit(submission({ contactMobile: '09120000001' }), '203.0.113.10'),
      submit(submission({ contactMobile: '09120000002' }), '198.51.100.4'),
      submit(submission({ contactMobile: '09120000003' }), '198.51.100.5'),
    ]);

    expect(responses.every((response) => response.status === 202)).toBe(true);
    expect(await storedCount()).toBe(3);
  });

  it('does not let a simultaneous burst walk past the throttle', async () => {
    // The count is read UNDER the submitter's lock, which is what stops eight
    // requests each seeing a count of zero. Every one of them is a distinct
    // submission, so deduplication absorbs none of them.
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        submit(submission({ contactMobile: `0912500${String(1000 + index)}` }), '203.0.113.99'),
      ),
    );

    const accepted = responses.filter((response) => response.status === 202);
    const throttled = responses.filter((response) => response.status === 429);

    expect(accepted).toHaveLength(6);
    expect(throttled).toHaveLength(4);
    expect(
      throttled.every((response) => response.body.error.code === 'PUBLIC_REQUEST_THROTTLED'),
    ).toBe(true);

    // The refusals wrote nothing at all — not a row, and not an audit entry in
    // an append-only table an anonymous caller could otherwise grow by asking.
    expect(await storedCount()).toBe(6);
    expect(await receivedAuditCount()).toBe(6);
  });

  it('never leaves a request row without its audit row, or the reverse', async () => {
    await Promise.all([
      submit(submission({ contactMobile: '09120000001' }), '203.0.113.10'),
      submit(submission({ contactMobile: '09120000001' }), '203.0.113.10'),
      submit(submission({ contactMobile: '09120000002' }), '203.0.113.10'),
      submit(submission({ contactMobile: '09120000002' }), '198.51.100.4'),
    ]);

    // The row and its audit entry are written in ONE transaction, so the two
    // counts cannot disagree however the race resolved.
    const rows = await harness.prisma.$queryRaw<{ orphans: bigint }[]>`
      SELECT count(*) AS orphans
      FROM website_request r
      WHERE NOT EXISTS (
        SELECT 1 FROM audit_log a
        WHERE a.entity_type = 'website_request' AND a.entity_id = r.id
      )
    `;

    expect(Number(rows[0]?.orphans ?? 0n)).toBe(0);
    expect(await receivedAuditCount()).toBe(await storedCount());
  });
});
