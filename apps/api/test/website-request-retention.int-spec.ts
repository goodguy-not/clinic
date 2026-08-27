import request from 'supertest';
import { runCli } from '../src/cli/run-cli';
import { createHarness, resetDatabase, type Harness } from './harness';
import { familyPayload, seedFamily } from './families-support';
import { as, backdateClosure, loginAs, readRequestRow, submitRequest } from './website-support';
import type { CliIo } from '../src/cli/cli-io';

/**
 * The ninety-day erasure, run as the operator runs it.
 *
 * Milestone 9, checkpoint A4.
 *
 * IT DRIVES `runCli` RATHER THAN THE SERVICE, exactly as `cli.int-spec.ts` does,
 * because the command is the product: an erasure that only works when called
 * from a test is an erasure nobody can run on a Friday afternoon.
 *
 * THE FOUR QUESTIONS, in order of what getting them wrong would cost:
 *
 *   1. does it erase anything it must not — an open request, a converted one, or
 *      one closed last week?
 *   2. does it erase EVERYTHING it must, leaving no half-erased row whose
 *      remaining telephone number nobody would notice?
 *   3. does the lifecycle row survive, so the clinic can still say a consented
 *      request arrived and was dealt with?
 *   4. is it safe to run again?
 *
 * Everything here is synthetic.
 */
describe('website request retention (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: string;
  let receptionist: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase(harness.prisma);
    manager = await loginAs(harness, 'MANAGER');
    receptionist = await loginAs(harness, 'RECEPTIONIST');
  });

  /** Captures what the command printed, so the operator's own view is asserted. */
  function collectingIo(): { io: CliIo; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    return {
      io: {
        out: (line) => out.push(line),
        err: (line) => err.push(line),
        readStdin: () => Promise.reject(new Error('the retention run reads no input')),
      },
      out,
      err,
    };
  }

  const move = (id: string, status: string) =>
    request(harness.app.getHttpServer())
      .patch(`/website-requests/${id}/status`)
      .set(as(receptionist))
      .send({ status });

  /** A request closed `days` ago, by the ordinary route and then backdated. */
  async function closedDaysAgo(days: number, mobile: string): Promise<string> {
    const id = await submitRequest(harness, { contactMobile: mobile });
    await move(id, 'CLOSED');
    await backdateClosure(harness, id, days);
    return id;
  }

  const PURGEABLE_COLUMNS = [
    'contact_name',
    'contact_mobile',
    'requested_service_id',
    'child_name',
    'child_age_years',
    'child_sex',
    'preferred_contact_time',
    'note',
    'submitter_fingerprint',
    'dedupe_key',
  ];

  // ==========================================================================

  it('erases every purgeable column of an eligible request and nothing else', async () => {
    const id = await closedDaysAgo(91, '09120000001');

    const before = await readRequestRow(harness, id);
    expect(before['contact_mobile']).toBe('09120000001');
    expect(before['submitter_fingerprint']).not.toBeNull();

    const { io, out } = collectingIo();
    expect(await runCli(['purge-website-requests'], io)).toBe(0);
    expect(out.join('\n')).toContain('1 of 1');

    const after = await readRequestRow(harness, id);

    for (const column of PURGEABLE_COLUMNS) {
      expect(after[column]).toBeNull();
    }

    // THE MINIMAL LIFECYCLE ROW SURVIVES. Enough to say that a consented request
    // arrived on a day and was dealt with rather than quietly dropped, and not
    // enough to say anything about anybody.
    expect(after['id']).toBe(id);
    expect(after['received_at']).not.toBeNull();
    expect(after['consent_given']).toBe(true);
    expect(after['consent_version']).toBe('2026-08-27');
    expect(after['status']).toBe('CLOSED');
    expect(after['closed_at']).not.toBeNull();
    expect(after['purged_at']).not.toBeNull();
  });

  it('stamps the erasure instant, and never before the deadline', async () => {
    const id = await closedDaysAgo(91, '09120000001');

    const { io } = collectingIo();
    await runCli(['purge-website-requests'], io);

    const row = await readRequestRow(harness, id);
    const closedAt = new Date(String(row['closed_at'])).getTime();
    const purgedAt = new Date(String(row['purged_at'])).getTime();

    // `website_request_purge_eligibility_chk` enforces this in the database as
    // well; asserting it here is what proves the run does not depend on being
    // rescued by the constraint.
    expect(purgedAt - closedAt).toBeGreaterThanOrEqual(90 * 24 * 3600 * 1000);
  });

  it('ignores a request that is not closed', async () => {
    const open = await submitRequest(harness, { contactMobile: '09120000001' });
    const contacted = await submitRequest(harness, { contactMobile: '09120000002' });
    await move(contacted, 'CONTACTED');
    const followUp = await submitRequest(harness, { contactMobile: '09120000003' });
    await move(followUp, 'FOLLOW_UP_NEEDED');

    // Even backdated far past the window: the clock starts at CLOSURE, and these
    // have never been closed.
    const { io, out } = collectingIo();
    await runCli(['purge-website-requests'], io);
    expect(out.join('\n')).toContain('0 of 0');

    for (const id of [open, contacted, followUp]) {
      expect((await readRequestRow(harness, id))['contact_mobile']).not.toBeNull();
    }
  });

  it('ignores a closed request that is younger than ninety days', async () => {
    const yesterday = await closedDaysAgo(1, '09120000001');
    const almost = await closedDaysAgo(89, '09120000002');

    const { io, out } = collectingIo();
    await runCli(['purge-website-requests'], io);
    expect(out.join('\n')).toContain('0 of 0');

    for (const id of [yesterday, almost]) {
      const row = await readRequestRow(harness, id);
      expect(row['contact_mobile']).not.toBeNull();
      expect(row['purged_at']).toBeNull();
    }
  });

  it('never erases a request that became a family', async () => {
    // A converted request is part of a family's history. The ninety-day promise
    // was made about strangers the clinic never heard from again.
    const familyId = await seedFamily(harness, manager, familyPayload());
    const id = await submitRequest(harness, { contactMobile: '09120000001' });

    await request(harness.app.getHttpServer())
      .post(`/website-requests/${id}/link`)
      .set(as(receptionist))
      .send({ familyId })
      .expect(200);

    // IT CANNOT EVEN BE BACKDATED INTO ELIGIBILITY. A converted request has no
    // closure instant — `website_request_lifecycle_chk` permits one only on a
    // CLOSED row — and the lifecycle refuses a move out of `CONVERTED_TO_FAMILY`
    // in the first place. So "linked requests are never erased" holds twice over,
    // and this asserts the run agrees.
    const { io } = collectingIo();
    await runCli(['purge-website-requests'], io);

    const row = await readRequestRow(harness, id);
    expect(row['contact_mobile']).toBe('09120000001');
    expect(row['purged_at']).toBeNull();
    expect(row['linked_family_id']).toBe(familyId);
  });

  it('is safe to run again, and the second run erases nothing', async () => {
    const id = await closedDaysAgo(91, '09120000001');

    const first = collectingIo();
    await runCli(['purge-website-requests'], first.io);
    const stamped = (await readRequestRow(harness, id))['purged_at'];

    const second = collectingIo();
    expect(await runCli(['purge-website-requests'], second.io)).toBe(0);
    expect(second.out.join('\n')).toContain('0 of 0');

    // The erasure instant is written once and is not moved by a re-run.
    expect((await readRequestRow(harness, id))['purged_at']).toEqual(stamped);
  });

  it('writes one audit row per erasure, with a SYSTEM actor and an empty payload', async () => {
    const id = await closedDaysAgo(91, '09120000001');

    const { io } = collectingIo();
    await runCli(['purge-website-requests'], io);

    const rows = await harness.prisma.$queryRaw<
      { actor_type: string; before: unknown; after: unknown; metadata: unknown }[]
    >`
      SELECT actor_type::text AS actor_type, before, after, metadata
      FROM audit_log
      WHERE action = 'website_request.purged' AND entity_id = ${id}::uuid
    `;

    expect(rows).toHaveLength(1);
    // It says the content of this row was destroyed and, by its own timestamp,
    // when. A list of what was cleared would be a description of what was there.
    expect(rows[0]).toMatchObject({
      actor_type: 'SYSTEM',
      before: null,
      after: null,
      metadata: null,
    });
  });

  it('reports what a run would do without writing anything', async () => {
    const id = await closedDaysAgo(91, '09120000001');

    const { io, out } = collectingIo();
    expect(await runCli(['purge-website-requests', '--dry-run'], io)).toBe(0);

    expect(out.join('\n')).toContain('1 website request(s) are eligible');
    expect(out.join('\n')).toContain('Nothing was written');

    const row = await readRequestRow(harness, id);
    expect(row['contact_mobile']).toBe('09120000001');
    expect(row['purged_at']).toBeNull();

    const audited = await harness.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM audit_log WHERE action = 'website_request.purged'
    `;
    expect(audited[0]?.count).toBe(0n);
  });

  it('erases the eligible and leaves everything else in one run', async () => {
    // The whole policy in one statement, which is how it is actually run.
    const familyId = await seedFamily(harness, manager, familyPayload());

    const eligible = await closedDaysAgo(120, '09120000001');
    const tooYoung = await closedDaysAgo(10, '09120000002');
    const open = await submitRequest(harness, { contactMobile: '09120000003' });
    const converted = await submitRequest(harness, { contactMobile: '09120000004' });

    await request(harness.app.getHttpServer())
      .post(`/website-requests/${converted}/link`)
      .set(as(receptionist))
      .send({ familyId })
      .expect(200);

    const { io, out } = collectingIo();
    await runCli(['purge-website-requests'], io);
    expect(out.join('\n')).toContain('1 of 1');

    expect((await readRequestRow(harness, eligible))['contact_mobile']).toBeNull();

    for (const id of [tooYoung, open, converted]) {
      expect((await readRequestRow(harness, id))['contact_mobile']).not.toBeNull();
    }
  });

  it('leaves a purged request readable in the inbox, and says the content is gone', async () => {
    const id = await closedDaysAgo(91, '09120000001');

    const { io } = collectingIo();
    await runCli(['purge-website-requests'], io);

    const response = await request(harness.app.getHttpServer())
      .get(`/website-requests/${id}`)
      .set(as(receptionist));

    expect(response.status).toBe(200);
    expect(response.body.contentPurged).toBe(true);
    expect(response.body.purgedAt).not.toBeNull();
    expect(response.body.status).toBe('CLOSED');
    // A PURGED ROW IS A DIFFERENT KIND OF THING, not a live one with the words
    // missing: the shape cannot express "purged, and here is the number".
    expect(response.body).not.toHaveProperty('contactMobile');
    expect(response.body).not.toHaveProperty('note');
  });

  it('refuses to move or link a request whose content has been erased', async () => {
    const familyId = await seedFamily(harness, manager, familyPayload());
    const id = await closedDaysAgo(91, '09120000001');

    const { io } = collectingIo();
    await runCli(['purge-website-requests'], io);

    // A purged row is finished. Its content is gone and its lifecycle is over.
    expect((await move(id, 'CONTACTED')).status).toBe(409);

    const linked = await request(harness.app.getHttpServer())
      .post(`/website-requests/${id}/link`)
      .set(as(receptionist))
      .send({ familyId });
    expect(linked.status).toBe(409);
  });

  it('cannot restore erased content, at the database', async () => {
    const id = await closedDaysAgo(91, '09120000001');

    const { io } = collectingIo();
    await runCli(['purge-website-requests'], io);

    for (const statement of [
      harness.prisma
        .$executeRaw`UPDATE website_request SET contact_name = 'نام تازه' WHERE id = ${id}::uuid`,
      harness.prisma
        .$executeRaw`UPDATE website_request SET purged_at = NULL WHERE id = ${id}::uuid`,
      harness.prisma.$executeRaw`DELETE FROM website_request WHERE id = ${id}::uuid`,
    ]) {
      await expect(statement).rejects.toThrow();
    }
  });
});
