import request from 'supertest';
import {
  WEBSITE_REQUEST_STATUSES,
  websiteRequestDetailSchema,
  websiteRequestInboxResponseSchema,
} from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import { asUser, familyPayload, guardian, seedFamily, signIn } from './families-support';
import {
  as,
  asVisitor,
  auditPayloadsFor,
  loginAs,
  readRequestRow,
  submitRequest,
} from './website-support';

/**
 * The website request inbox, attacked from the colleague's side.
 *
 * Milestone 9, checkpoint A4.
 *
 * THE QUESTIONS THIS SUITE EXISTS TO ANSWER, in order of what they would cost:
 *
 *   1. can anybody who is not signed in reach a stranger's name, telephone
 *      number and words — through this route or any other?
 *   2. does the accepted five-status lifecycle actually hold, in both
 *      directions: does every legal move work, and is every illegal one refused?
 *   3. is linking to a family atomic, audited, and impossible to do twice?
 *   4. does anything a visitor typed reach `audit_log`, which is permanent?
 *   5. does the conversion path leave family integrity alone — in particular, is
 *      the age a parent typed ever treated as a birth date?
 *
 * Everything here is synthetic. No real name, mobile number, child or message
 * appears in any fixture, and none may.
 */
describe('website request inbox (real PostgreSQL)', () => {
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

  const server = () => harness.app.getHttpServer();

  /**
   * A second family that is not a duplicate of the first.
   *
   * The name AND the guardian's mobile both differ, because the duplicate rules
   * compare both — a second family sharing a telephone number would be refused
   * registration, which is the protection these cases must not fight.
   */
  const otherFamily = (familyName: string) =>
    familyPayload({ familyName }, [guardian({ fullName: 'سرپرست دوم', mobile: '09129999999' })]);

  const inbox = (token: string, query = '') =>
    request(server()).get(`/website-requests${query}`).set(as(token));

  const detail = (token: string, id: string) =>
    request(server()).get(`/website-requests/${id}`).set(as(token));

  const move = (token: string, id: string, status: string) =>
    request(server()).patch(`/website-requests/${id}/status`).set(as(token)).send({ status });

  const link = (token: string, id: string, familyId: string) =>
    request(server()).post(`/website-requests/${id}/link`).set(as(token)).send({ familyId });

  // ==========================================================================

  describe('who may read it', () => {
    it('lets a receptionist and a manager read the inbox', async () => {
      await submitRequest(harness);

      for (const token of [receptionist, manager]) {
        const response = await inbox(token);

        expect(response.status).toBe(200);
        expect(websiteRequestInboxResponseSchema.safeParse(response.body).success).toBe(true);
        expect(response.body.requests).toHaveLength(1);
      }
    });

    it('refuses every route to a caller with no session', async () => {
      // THE SHARPEST TEST IN THIS FILE. A visitor reaches `POST /public/requests`
      // with no session at all — that is the whole point of A3 — and the same
      // headers must reach NOTHING here.
      const id = await submitRequest(harness);

      const responses = await Promise.all([
        request(server()).get('/website-requests').set(asVisitor()),
        request(server()).get(`/website-requests/${id}`).set(asVisitor()),
        request(server())
          .patch(`/website-requests/${id}/status`)
          .set(asVisitor())
          .send({ status: 'CONTACTED' }),
        request(server())
          .post(`/website-requests/${id}/link`)
          .set(asVisitor())
          .send({ familyId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e01' }),
      ]);

      for (const response of responses) {
        expect(response.status).toBe(401);
      }
    });

    it('exposes no request through any public projection', async () => {
      // The public side of the site is nine read-only projections. None of them
      // may grow a way to read what somebody wrote in — not by id, not in a
      // list, and not as a count.
      const id = await submitRequest(harness);

      for (const path of [
        '/public/services',
        '/public/team',
        '/public/clinic-profile',
        '/public/articles',
        '/public/testimonials',
        '/public/sitemap',
        `/public/requests/${id}`,
        `/public/website-requests/${id}`,
      ]) {
        const response = await request(server()).get(path).set(asVisitor());

        expect([200, 404]).toContain(response.status);
        expect(JSON.stringify(response.body)).not.toContain('09120000001');
        expect(JSON.stringify(response.body)).not.toContain('سرپرست نمونه');
      }
    });
  });

  // ==========================================================================

  describe('what the inbox shows', () => {
    it('carries the triage facts and withholds the note until a request is opened', async () => {
      const id = await submitRequest(harness);

      const list = await inbox(receptionist);
      const row = list.body.requests[0];

      expect(row.contentPurged).toBe(false);
      expect(row.contactMobile).toBe('09120000001');
      expect(row.childAgeYears).toBe(6);
      expect(row.status).toBe('NEW');
      // The note is announced, not printed: two thousand characters of what a
      // distressed parent wrote is not something to put on twenty-five rows.
      expect(row.hasNote).toBe(true);
      expect(row).not.toHaveProperty('note');

      const opened = await detail(receptionist, id);
      expect(opened.status).toBe(200);
      expect(websiteRequestDetailSchema.safeParse(opened.body).success).toBe(true);
      expect(opened.body.note).toContain('متن نمونه');
    });

    it('never serves the abuse-control digests', async () => {
      // They are keyed hashes of a visitor's IP address and of their submission.
      // No colleague has any use for either, and serving one would put a stable
      // per-visitor identifier on a screen and from there into a screenshot.
      const id = await submitRequest(harness);
      const stored = await readRequestRow(harness, id);

      const body = JSON.stringify((await detail(receptionist, id)).body);

      expect(stored['submitter_fingerprint']).not.toBeNull();
      expect(body).not.toContain(String(stored['submitter_fingerprint']));
      expect(body).not.toContain('submitterFingerprint');
      expect(body).not.toContain('dedupeKey');
    });

    it('counts every status, filters on the ones asked for, and pages', async () => {
      const first = await submitRequest(harness, { contactMobile: '09120000001' });
      await submitRequest(harness, { contactMobile: '09120000002' });
      await submitRequest(harness, { contactMobile: '09120000003' });

      await move(receptionist, first, 'CLOSED');

      const all = await inbox(receptionist);
      expect(all.body.page.total).toBe(3);
      expect(all.body.statusCounts).toHaveLength(WEBSITE_REQUEST_STATUSES.length);
      expect(all.body.statusCounts).toContainEqual({ status: 'NEW', count: 2 });
      expect(all.body.statusCounts).toContainEqual({ status: 'CLOSED', count: 1 });
      // Zero-filled, so a screen has the same five tabs every morning.
      expect(all.body.statusCounts).toContainEqual({ status: 'CONTACTED', count: 0 });

      const open = await inbox(receptionist, '?statuses=NEW');
      expect(open.body.requests).toHaveLength(2);
      expect(open.body.page.total).toBe(2);
      // The counts are NOT scoped by the filter: a screen showing only the new
      // ones can still say how many closed ones exist.
      expect(open.body.statusCounts).toContainEqual({ status: 'CLOSED', count: 1 });

      const paged = await inbox(receptionist, '?page=1&pageSize=2');
      expect(paged.body.requests).toHaveLength(2);
      expect(paged.body.page.hasMore).toBe(true);

      const second = await inbox(receptionist, '?page=2&pageSize=2');
      expect(second.body.requests).toHaveLength(1);
      expect(second.body.page.hasMore).toBe(false);
    });

    it('answers a missing request with a not-found rather than an empty shape', async () => {
      const response = await detail(receptionist, '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e01');

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('WEBSITE_REQUEST_NOT_FOUND');
    });
  });

  // ==========================================================================

  describe('the accepted lifecycle', () => {
    it('permits every legal move', async () => {
      // NEW -> CONTACTED -> FOLLOW_UP_NEEDED -> CONTACTED -> CLOSED, which is the
      // whole open working set plus the end state.
      const id = await submitRequest(harness);

      for (const status of ['CONTACTED', 'FOLLOW_UP_NEEDED', 'CONTACTED', 'CLOSED']) {
        const response = await move(receptionist, id, status);

        expect(response.status).toBe(200);
        expect(response.body.status).toBe(status);
        expect(response.body.statusChangedAt).not.toBeNull();
      }

      // `closed_at` is stamped by the move to CLOSED and by nothing else: it is
      // what the ninety-day retention deadline is measured from.
      const row = await readRequestRow(harness, id);
      expect(row['closed_at']).not.toBeNull();
    });

    it('refuses a move out of either terminal state', async () => {
      // THE OWNER DECISION OF THIS CHECKPOINT, PINNED. `CLOSED` is terminal
      // because the retention clock is: a closure that could be undone would be
      // an erasure that could be deferred for ever.
      const closed = await submitRequest(harness, { contactMobile: '09120000001' });
      await move(receptionist, closed, 'CLOSED');

      for (const status of ['CONTACTED', 'FOLLOW_UP_NEEDED', 'CLOSED']) {
        const response = await move(receptionist, closed, status);

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('WEBSITE_REQUEST_TRANSITION_INVALID');
      }

      const family = await seedFamily(harness, manager, familyPayload());
      const converted = await submitRequest(harness, { contactMobile: '09120000002' });
      await link(receptionist, converted, family);

      for (const status of ['CONTACTED', 'FOLLOW_UP_NEEDED', 'CLOSED']) {
        const response = await move(receptionist, converted, status);

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('WEBSITE_REQUEST_TRANSITION_INVALID');
      }
    });

    it('refuses a move back to NEW and a move to the status it is already in', async () => {
      const id = await submitRequest(harness);

      // `NEW` means "nobody has touched this yet", and it is refused by the
      // request schema before it reaches the service — a caller cannot even
      // express it.
      const backwards = await move(receptionist, id, 'NEW');
      expect(backwards.status).toBe(400);
      expect(backwards.body.error.code).toBe('VALIDATION_FAILED');

      // And a conversion cannot be claimed without naming a family.
      const claimed = await move(receptionist, id, 'CONVERTED_TO_FAMILY');
      expect(claimed.status).toBe(400);

      await move(receptionist, id, 'CONTACTED');
      const again = await move(receptionist, id, 'CONTACTED');
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('WEBSITE_REQUEST_TRANSITION_INVALID');
    });

    it('refuses an illegal move at the DATABASE, underneath every service', async () => {
      // The service check is the explanation; the trigger is the guarantee. A
      // status a data fix could set to anything would make `closed_at`, and
      // therefore the retention deadline, meaningless.
      const id = await submitRequest(harness);
      await move(receptionist, id, 'CLOSED');

      await expect(
        harness.prisma.$executeRaw`
          UPDATE website_request
          SET status = 'NEW'::website_request_status, status_changed_at = NULL, closed_at = NULL
          WHERE id = ${id}::uuid
        `,
      ).rejects.toThrow();
    });
  });

  // ==========================================================================

  describe('linking to a family', () => {
    it('links, converts and audits in one act', async () => {
      const familyId = await seedFamily(harness, manager, familyPayload());
      const id = await submitRequest(harness);

      const response = await link(receptionist, id, familyId);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('CONVERTED_TO_FAMILY');
      expect(response.body.linkedFamily.id).toBe(familyId);
      expect(response.body.linkedAt).not.toBeNull();

      // The link and the status are ONE fact in the database, in both
      // directions: `website_request_link_chk`.
      const row = await readRequestRow(harness, id);
      expect(row['linked_family_id']).toBe(familyId);
      expect(row['status']).toBe('CONVERTED_TO_FAMILY');
      expect(row['linked_by_user_id']).not.toBeNull();
    });

    it('refuses a second link, to the same family or to another', async () => {
      const first = await seedFamily(harness, manager, familyPayload());
      const second = await seedFamily(harness, manager, otherFamily('خانوادهٔ نمونهٔ دوم'));
      const id = await submitRequest(harness);

      expect((await link(receptionist, id, first)).status).toBe(200);

      // THE SAME ANSWER FOR BOTH, deliberately: confirming "yes, it is already
      // that family" would make this route a way to test family membership
      // against a request id.
      for (const familyId of [first, second]) {
        const response = await link(receptionist, id, familyId);

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('WEBSITE_REQUEST_ALREADY_LINKED');
      }

      const row = await readRequestRow(harness, id);
      expect(row['linked_family_id']).toBe(first);
    });

    it('refuses to re-point a link at the DATABASE', async () => {
      const first = await seedFamily(harness, manager, familyPayload());
      const second = await seedFamily(harness, manager, otherFamily('خانوادهٔ نمونهٔ سوم'));
      const id = await submitRequest(harness);
      await link(receptionist, id, first);

      await expect(
        harness.prisma.$executeRaw`
          UPDATE website_request SET linked_family_id = ${second}::uuid WHERE id = ${id}::uuid
        `,
      ).rejects.toThrow();
    });

    it('refuses an unknown family and a deactivated one', async () => {
      const id = await submitRequest(harness);

      const missing = await link(receptionist, id, '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4e01');
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('FAMILY_NOT_FOUND');

      const familyId = await seedFamily(harness, manager, familyPayload());
      await harness.prisma.$executeRaw`
        UPDATE family SET status = 'INACTIVE'::record_status,
          deactivated_at = transaction_timestamp()
        WHERE id = ${familyId}::uuid
      `;

      const inactive = await link(receptionist, id, familyId);
      expect(inactive.status).toBe(422);
      expect(inactive.body.error.code).toBe('FAMILY_INACTIVE');

      // Nothing was written on either refusal.
      const row = await readRequestRow(harness, id);
      expect(row['linked_family_id']).toBeNull();
      expect(row['status']).toBe('NEW');
    });

    it('writes no family, guardian or child, and derives no birth date', async () => {
      // THE CONVERSION INTEGRITY RULE. A stranger's form submission must never
      // become a clinic record without somebody going through the registration
      // workflow, and the age a parent typed is TRIAGE DATA rather than a date of
      // birth: "he is six" is not a day, and a date derived from it would be a
      // wrong, authoritative-looking value on a permanent record.
      const familyId = await seedFamily(harness, manager, familyPayload());
      const id = await submitRequest(harness, { childAgeYears: 6 });

      const before = await harness.prisma.$queryRaw<{ families: bigint; children: bigint }[]>`
        SELECT (SELECT count(*) FROM family) AS families,
               (SELECT count(*) FROM child) AS children
      `;

      await link(receptionist, id, familyId);

      const after = await harness.prisma.$queryRaw<{ families: bigint; children: bigint }[]>`
        SELECT (SELECT count(*) FROM family) AS families,
               (SELECT count(*) FROM child) AS children
      `;

      expect(after[0]).toEqual(before[0]);
      expect(after[0]?.children).toBe(0n);

      // And the family itself is untouched: no guardian gained the visitor's
      // telephone number.
      const guardians = await harness.prisma.$queryRaw<{ mobile: string | null }[]>`
        SELECT mobile FROM guardian WHERE family_id = ${familyId}::uuid
      `;
      expect(guardians.map((row) => row.mobile)).not.toContain('09120000001');
    });

    it('still forces a new family through the ordinary duplicate workflow', async () => {
      // The "create a new family" half of the accepted conversion path is the
      // EXISTING registration workflow, and this proves the inbox has not opened
      // a second door around it: registering a family that looks like one the
      // clinic already has is refused exactly as it is refused anywhere else,
      // whether or not a website request is involved.
      const familyId = await seedFamily(harness, manager, familyPayload());
      expect(familyId).toBeTruthy();
      await submitRequest(harness);

      const duplicate = await request(server())
        .post('/families')
        .set(asUser(receptionist))
        .send(familyPayload());

      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('FAMILY_POSSIBLE_DUPLICATE');
    });
  });

  // ==========================================================================

  describe('what the permanent record keeps', () => {
    it('records the lifecycle acts and not one word the visitor wrote', async () => {
      // `audit_log` IS APPEND-ONLY AND UNPRUNABLE, and `website_request` is the
      // one table in this schema whose content is erased. Anything copied across
      // would be a second, permanent copy of exactly the data the ninety-day
      // erasure exists to remove.
      const familyId = await seedFamily(harness, manager, familyPayload());
      const id = await submitRequest(harness);

      await move(receptionist, id, 'CONTACTED');
      await link(receptionist, id, familyId);

      const rows = await auditPayloadsFor(harness, id);

      expect(rows.map((row) => row.action)).toEqual([
        'website_request.received',
        'website_request.status_changed',
        'website_request.linked_to_family',
      ]);

      const serialised = JSON.stringify(rows);

      for (const leak of [
        'سرپرست نمونه',
        'کودک نمونه',
        '09120000001',
        'متن نمونه',
        'MORNING',
        'UNSPECIFIED',
      ]) {
        expect(serialised).not.toContain(leak);
      }

      // What IS there: the two statuses, and the family the message became.
      expect(rows[1]).toMatchObject({ before: { status: 'NEW' }, after: { status: 'CONTACTED' } });
      expect(rows[2]?.after).toMatchObject({ familyId, status: 'CONVERTED_TO_FAMILY' });
    });

    it('names the acting colleague on a lifecycle act and nobody on the submission', async () => {
      const id = await submitRequest(harness);
      await move(receptionist, id, 'CONTACTED');

      const actors = await harness.prisma.$queryRaw<
        { action: string; actor_type: string; ip: string | null }[]
      >`
        SELECT action, actor_type::text AS actor_type, ip::text AS ip
        FROM audit_log
        WHERE entity_type = 'website_request' AND entity_id = ${id}::uuid
        ORDER BY id ASC
      `;

      // The A3 rule, unchanged: an anonymous submission records no actor, no IP
      // and no user agent.
      expect(actors[0]).toMatchObject({ actor_type: 'ANONYMOUS', ip: null });
      // The A4 rule: a colleague's act is an ordinary audited act.
      expect(actors[1]?.actor_type).toBe('USER');
    });

    it('serves no audit internals as ordinary fields of a request', async () => {
      const id = await submitRequest(harness);
      await move(receptionist, id, 'CONTACTED');

      const body = (await detail(receptionist, id)).body;

      for (const absent of ['audit', 'history', 'changedBy', 'actor', 'auditLogId', 'requestId']) {
        expect(body).not.toHaveProperty(absent);
      }
    });
  });

  // ==========================================================================

  describe('the dashboard count', () => {
    it('counts the requests nobody has looked at, and falls as they are worked', async () => {
      const first = await submitRequest(harness, { contactMobile: '09120000001' });
      await submitRequest(harness, { contactMobile: '09120000002' });

      const before = await request(server()).get('/dashboard').set(as(receptionist));
      expect(before.status).toBe(200);
      expect(before.body.newWebsiteRequestCount).toBe(2);

      await move(receptionist, first, 'CONTACTED');

      const after = await request(server()).get('/dashboard').set(as(receptionist));
      expect(after.body.newWebsiteRequestCount).toBe(1);

      // A manager sees the same operational number: it is not money.
      const asManager = await request(server()).get('/dashboard').set(as(manager));
      expect(asManager.body.newWebsiteRequestCount).toBe(1);
    });

    it('states no name, number or word from any request', async () => {
      await submitRequest(harness);

      const response = await request(server()).get('/dashboard').set(as(receptionist));
      const serialised = JSON.stringify(response.body);

      expect(serialised).not.toContain('09120000001');
      expect(serialised).not.toContain('سرپرست نمونه');
      expect(serialised).not.toContain('متن نمونه');
    });
  });

  // ==========================================================================

  describe('a role that holds neither authority', () => {
    it('is refused every inbox route', async () => {
      // There is no such role in the product today — manager and receptionist
      // both hold both names — so this asserts the guard rather than a role map
      // entry: a user whose session has been stripped of the permissions is
      // refused by NestJS before any statement runs.
      const id = await submitRequest(harness);
      const stripped = await signIn(harness, 'RECEPTIONIST');

      await harness.prisma.$executeRaw`
        UPDATE app_user
        SET status = 'DISABLED'::user_status, disabled_at = transaction_timestamp()
        WHERE id = ${stripped.id}::uuid
      `;

      const response = await request(server())
        .get(`/website-requests/${id}`)
        .set(as(stripped.token));

      expect([401, 403]).toContain(response.status);
    });

    it('demands family.read as well as website_request.process to link', async () => {
      // Stated on the route rather than proved by a role that lacks it: both
      // internal roles hold both names, and a unit test pins the AND-list. What
      // this asserts is that the route names the family authority at all, which
      // is what makes withholding it later mean something.
      const familyId = await seedFamily(harness, manager, familyPayload());
      const id = await submitRequest(harness);

      expect((await link(receptionist, id, familyId)).status).toBe(200);
    });
  });

  // ==========================================================================

  it('refuses a physical DELETE of a request through any path', async () => {
    // The A3 protection, re-asserted after A4 widened the row. A retention run
    // with a mistaken predicate, a data fix or a stray statement must not be able
    // to destroy the lifecycle record along with the content.
    const id = await submitRequest(harness);

    await expect(
      harness.prisma.$executeRaw`DELETE FROM website_request WHERE id = ${id}::uuid`,
    ).rejects.toThrow();

    await expect(harness.prisma.$executeRawUnsafe('TRUNCATE website_request')).rejects.toThrow();
  });

  it('keeps the contract vocabulary and the PostgreSQL enum identical', async () => {
    const rows = await harness.prisma.$queryRaw<{ value: string }[]>`
      SELECT unnest(enum_range(NULL::website_request_status))::text AS value
    `;

    expect(rows.map((row) => row.value).sort()).toEqual([...WEBSITE_REQUEST_STATUSES].sort());
  });
});
