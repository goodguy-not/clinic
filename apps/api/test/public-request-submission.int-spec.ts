import request from 'supertest';
import {
  CURRENT_PUBLIC_REQUEST_CONSENT_VERSION,
  PUBLIC_REQUEST_CONTACT_TIMES,
  publicRequestSubmissionResponseSchema,
  serviceResponseSchema,
} from '@clinic/contracts';
import { createHarness, internalHeaders, resetDatabase, type Harness } from './harness';
import { as, asVisitor, loginAs } from './website-support';

/**
 * The one anonymous write in the product, attacked from the visitor's side.
 *
 * Milestone 9, checkpoint A3.
 *
 * THE QUESTIONS THIS SUITE EXISTS TO ANSWER, in order of how much they would
 * cost to get wrong:
 *
 *   1. can a stranger with no session submit at all?
 *   2. can the endpoint be used as an ORACLE — to learn whether a given person
 *      has already written in, or which services the clinic has but does not
 *      publish?
 *   3. is the consent evidence actually stored, and is it the version that was
 *      agreed rather than one the caller invented?
 *   4. does anything about who is submitting reach a row or an audit payload?
 *   5. is any eligibility policy hiding in the validation?
 *
 * Everything here is synthetic. No real name, mobile number, child or message
 * appears in any fixture, and none may.
 */
describe('public request submission (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    manager = await loginAs(harness, 'MANAGER');
  });

  const server = () => harness.app.getHttpServer();

  /**
   * A complete, valid submission. Every test starts here and changes one thing,
   * so what a case is actually about is the line that differs.
   */
  const submission = (overrides: Record<string, unknown> = {}) => ({
    contactName: 'سرپرست نمونه',
    contactMobile: '09120000001',
    serviceSlug: null,
    childName: 'کودک نمونه',
    childAgeYears: 6,
    childSex: 'UNSPECIFIED',
    preferredContactTime: 'EVENING',
    note: 'متن نمونه برای آزمون. دربارهٔ هیچ کودک واقعی نیست.',
    consent: true,
    consentVersion: CURRENT_PUBLIC_REQUEST_CONSENT_VERSION,
    ...overrides,
  });

  /**
   * A submission as a visitor: the internal key, no session, and a client
   * address the web tier would have forwarded.
   */
  const submit = (body: Record<string, unknown>, ip = '203.0.113.10') =>
    request(server())
      .post('/public/requests')
      .set({ ...asVisitor(), 'x-client-ip': ip })
      .send(body);

  // Labels name the services; a submission names a service by the address the
  // system assigned it (M10-A10, T-010).
  const slugs = new Map<string, string>();

  async function createPublishedService(label: string): Promise<string> {
    const created = await request(server())
      .post('/catalog/services')
      .set(as(manager))
      .send({
        name: `خدمت نمونه ${label}`,
        publicDescription: null,
        isPublic: false,
        allowedDurationsMinutes: [45],
      });

    const id = serviceResponseSchema.parse(created.body).service.id;
    const name = serviceResponseSchema.parse(created.body).service.name;

    const published = await request(server())
      .patch(`/catalog/services/${id}`)
      .set(as(manager))
      .send({
        name,
        publicDescription: 'شرح عمومی نمونه.',
        isPublic: true,
        allowedDurationsMinutes: [45],
      });

    expect(published.status).toBe(200);
    slugs.set(label, serviceResponseSchema.parse(published.body).service.publicSlug!);
    return id;
  }

  const storedRequests = () =>
    harness.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT * FROM website_request ORDER BY received_at ASC, id ASC
    `;

  const auditRows = () =>
    harness.prisma.$queryRaw<
      {
        action: string;
        actor_type: string;
        actor_user_id: string | null;
        entity_type: string;
        entity_id: string | null;
        before: unknown;
        after: unknown;
        metadata: unknown;
        ip: string | null;
        user_agent: string | null;
      }[]
    >`
      SELECT action, actor_type, actor_user_id, entity_type, entity_id,
             before, after, metadata, host(ip) AS ip, user_agent
      FROM audit_log ORDER BY id ASC
    `;

  describe('a stranger can write in', () => {
    it('accepts a complete submission with no session at all', async () => {
      const response = await submit(submission());

      // 202, not 201: see the route comment. The duplicate-suppressed path
      // creates nothing, and one status has to be true of both.
      expect(response.status).toBe(202);
      expect(publicRequestSubmissionResponseSchema.parse(response.body)).toEqual({
        received: true,
      });

      const rows = await storedRequests();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.['contact_mobile']).toBe('09120000001');
    });

    it('still requires the internal key, because nothing here is on the internet', async () => {
      // The A1 boundary decision, re-opened by this checkpoint and answered the
      // same way. A public WRITE does not make NestJS internet-reachable.
      const response = await request(server()).post('/public/requests').send(submission());

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('AUTH_INTERNAL_KEY_INVALID');
      expect(await storedRequests()).toHaveLength(0);
    });

    it('accepts a submission with every optional field omitted', async () => {
      // Including `preferredContactTime`: the vocabulary is frozen, the field
      // is not required, and a short form may simply not ask.
      const response = await submit({
        contactName: 'سرپرست نمونه',
        contactMobile: '09120000002',
        serviceSlug: null,
        childAgeYears: 4,
        childSex: 'FEMALE',
        consent: true,
        consentVersion: CURRENT_PUBLIC_REQUEST_CONSENT_VERSION,
      });

      expect(response.status).toBe(202);

      const row = (await storedRequests())[0];
      expect(row?.['child_name']).toBeNull();
      expect(row?.['preferred_contact_time']).toBeNull();
      expect(row?.['note']).toBeNull();
      expect(row?.['requested_service_id']).toBeNull();
    });

    it('stores the published service a visitor named, addressed by its slug', async () => {
      const serviceId = await createPublishedService('synthetic-service');

      const response = await submit(submission({ serviceSlug: slugs.get('synthetic-service') }));

      expect(response.status).toBe(202);
      expect((await storedRequests())[0]?.['requested_service_id']).toBe(serviceId);
    });
  });

  describe('the required fields are required', () => {
    const requiredKeys = [
      'contactName',
      'contactMobile',
      'serviceSlug',
      'childAgeYears',
      'childSex',
      'consent',
      'consentVersion',
    ];

    it.each(requiredKeys)('refuses a submission missing %s', async (key) => {
      const body = submission();
      delete (body as Record<string, unknown>)[key];

      const response = await submit(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await storedRequests()).toHaveLength(0);
    });

    it('refuses a malformed mobile number', async () => {
      for (const mobile of ['0912345678', '00989120000001', '+989120000001', '۰۹۱۲۰۰۰۰۰۰۱', '']) {
        const response = await submit(submission({ contactMobile: mobile }));
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }

      expect(await storedRequests()).toHaveLength(0);
    });

    it('refuses a submission from somebody who did not consent', async () => {
      const declined = await submit(submission({ consent: false }));
      const invented = await submit(submission({ consentVersion: 'whatever-they-liked' }));

      expect(declined.status).toBe(400);
      expect(invented.status).toBe(400);
      expect(await storedRequests()).toHaveLength(0);
    });

    it('refuses a field the contract does not name', async () => {
      // The submission schema is strict. A form that grows a field has to grow
      // the contract first, which is where the privacy conversation happens.
      const response = await submit(submission({ diagnosis: 'anything at all' }));

      expect(response.status).toBe(400);
      expect(await storedRequests()).toHaveLength(0);
    });

    it('refuses markup in every free-text field', async () => {
      for (const key of ['contactName', 'childName', 'note']) {
        const response = await submit(submission({ [key]: '<script>x</script>' }));
        expect(response.status).toBe(400);
      }

      expect(await storedRequests()).toHaveLength(0);
    });
  });

  describe('the preferred contact time', () => {
    // FOUR VALUES, OWNER-APPROVED AND FROZEN. It says when a parent would rather
    // be telephoned and NOTHING ELSE: no SLA, no promise the call happens then,
    // no clock ranges, and nothing in this application acts on it.

    it.each([...PUBLIC_REQUEST_CONTACT_TIMES])('accepts %s', async (preferredContactTime) => {
      const response = await submit(submission({ preferredContactTime }));

      expect(response.status).toBe(202);
      expect((await storedRequests())[0]?.['preferred_contact_time']).toBe(preferredContactTime);
    });

    it('remains valid when omitted, and NULL is not NO_PREFERENCE', async () => {
      // Two different facts. `NO_PREFERENCE` is a parent saying any time suits
      // them; NULL is a form that did not ask, which a short public form is
      // entitled to be.
      const body = submission();
      delete (body as Record<string, unknown>).preferredContactTime;
      const omitted = await submit(body);

      const stated = await submit(
        submission({ contactMobile: '09120000002', preferredContactTime: 'NO_PREFERENCE' }),
      );

      expect(omitted.status).toBe(202);
      expect(stated.status).toBe(202);

      const rows = await storedRequests();
      expect(rows[0]?.['preferred_contact_time']).toBeNull();
      expect(rows[1]?.['preferred_contact_time']).toBe('NO_PREFERENCE');
    });

    it('refuses free text, a clock time and an invented bucket', async () => {
      for (const preferredContactTime of ['عصرها', 'mornings', '09:00-12:00', 'LATE_NIGHT', '']) {
        const response = await submit(submission({ preferredContactTime }));
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }

      expect(await storedRequests()).toHaveLength(0);
    });

    it('matches the PostgreSQL enum exactly', async () => {
      const rows = await harness.prisma.$queryRaw<{ label: string }[]>`
        SELECT e.enumlabel AS label
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'website_request_contact_time'
        ORDER BY e.enumsortorder
      `;

      expect(rows.map((row) => row.label)).toEqual([...PUBLIC_REQUEST_CONTACT_TIMES]);
    });

    it('has no effect whatever on the duplicate identity', async () => {
      // THE FIELD IS NOT PART OF WHAT MAKES TWO SUBMISSIONS THE SAME REQUEST.
      // A parent who resubmits having changed their mind about when to be
      // telephoned has made the same request twice — and a contact preference
      // that could split a duplicate pair would be a way to defeat deduplication
      // by clicking a different radio button.
      await submit(submission({ preferredContactTime: 'MORNING' }));
      const changedMind = await submit(submission({ preferredContactTime: 'EVENING' }));
      const dropped = await submit(submission({ preferredContactTime: null }));

      expect(changedMind.status).toBe(202);
      expect(dropped.status).toBe(202);

      const rows = await storedRequests();
      expect(rows).toHaveLength(1);
      // The FIRST answer is what was stored; a resend rewrites nothing.
      expect(rows[0]?.['preferred_contact_time']).toBe('MORNING');
    });

    it('introduces no scheduling, no reminder and no response-time behaviour', async () => {
      // Nothing is queued, promised or measured. The only rows this write
      // creates anywhere are the request and its content-free audit entry, and
      // they are identical in kind whatever the parent chose.
      const morning = await submit(
        submission({ contactMobile: '09120000010', preferredContactTime: 'MORNING' }),
      );
      const evening = await submit(
        submission({ contactMobile: '09120000011', preferredContactTime: 'EVENING' }),
      );

      expect(morning.status).toBe(evening.status);
      expect(morning.body).toEqual(evening.body);

      const rows = await storedRequests();
      expect(rows).toHaveLength(2);

      // No due date, no follow-up instant, no priority — there is no column for
      // any of them, which is the strongest form this assertion can take.
      for (const row of rows) {
        expect(Object.keys(row)).toEqual(expect.not.arrayContaining(['due_at', 'callback_at']));
      }

      const received = (await auditRows()).filter(
        (row) => row.action === 'website_request.received',
      );
      expect(received).toHaveLength(2);
      expect(received.every((row) => row.metadata === null)).toBe(true);
    });
  });

  describe('the child gender vocabulary is frozen', () => {
    it.each(['FEMALE', 'MALE', 'UNSPECIFIED'])('accepts %s', async (childSex) => {
      const response = await submit(submission({ childSex }));

      expect(response.status).toBe(202);
      expect((await storedRequests())[0]?.['child_sex']).toBe(childSex);
    });

    it('refuses an omitted gender rather than defaulting it', async () => {
      // `child.sex` DEFAULTS to UNSPECIFIED, because a registration taken over
      // the telephone may not have reached the question. A form either asked or
      // did not, and a default here would record an answer nobody gave.
      const body = submission();
      delete (body as Record<string, unknown>).childSex;

      const response = await submit(body);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(await storedRequests()).toHaveLength(0);
    });

    it('refuses a null and an invented value', async () => {
      expect((await submit(submission({ childSex: null }))).status).toBe(400);
      expect((await submit(submission({ childSex: 'OTHER' }))).status).toBe(400);
      expect(await storedRequests()).toHaveLength(0);
    });
  });

  describe('the age bound carries no clinic policy', () => {
    // THE POINT OF THIS BLOCK. A rehabilitation clinic for children could
    // plausibly refuse an adult age, a teenager, or anybody over seven — and
    // every one of those would be an eligibility decision nobody has approved,
    // taken by a validation rule, delivered to a stranger as a 400. Who the
    // clinic can help is a conversation a colleague has.
    it.each([0, 1, 7, 14, 17, 18, 35, 99])('accepts an age of %i', async (childAgeYears) => {
      const response = await submit(
        submission({ childAgeYears, contactMobile: `0912000${String(1000 + childAgeYears)}` }),
      );

      expect(response.status).toBe(202);
    });

    it('refuses what is not an age at all, and anything past 99 (T-018)', async () => {
      for (const childAgeYears of [-1, 100, 120, 121, 6.5, '6', null]) {
        const response = await submit(submission({ childAgeYears }));
        expect(response.status).toBe(400);
      }
    });
  });

  describe('the endpoint is not an oracle', () => {
    it('gives the same answer for a private, retired and fictional service', async () => {
      const publishedId = await createPublishedService('synthetic-published');
      expect(publishedId).toBeTruthy();

      // A real service the clinic has decided NOT to publish.
      const privateService = await request(server())
        .post('/catalog/services')
        .set(as(manager))
        .send({
          name: 'خدمت خصوصی نمونه',
          publicDescription: null,
          isPublic: false,
          allowedDurationsMinutes: [30],
        });
      expect(privateService.status).toBe(201);
      // It has a real address from creation (M10-A10), and still is not public.
      const privateSlug = serviceResponseSchema.parse(privateService.body).service.publicSlug;

      const unpublished = await submit(submission({ serviceSlug: privateSlug }));
      const fictional = await submit(submission({ serviceSlug: 'no-such-service-anywhere' }));

      expect(unpublished.status).toBe(404);
      expect(unpublished.body.error.code).toBe('SERVICE_NOT_FOUND');
      expect(fictional.status).toBe(404);
      expect(fictional.body.error.code).toBe('SERVICE_NOT_FOUND');
      expect(await storedRequests()).toHaveLength(0);
    });

    it('exposes no read of what it wrote', async () => {
      await submit(submission());

      // No listing, no detail, no count — under a visitor's headers OR a
      // manager's. The inbox is checkpoint A4 and is a staff surface.
      for (const path of ['/public/requests', '/public/requests/inbox', '/content/requests']) {
        const anonymous = await request(server()).get(path).set(asVisitor());
        const staff = await request(server()).get(path).set(as(manager));

        expect(anonymous.status).toBe(404);
        expect(staff.status).toBe(404);
      }
    });
  });

  describe('a resend is absorbed, and the caller cannot tell', () => {
    it('stores one row for two identical submissions and answers both the same', async () => {
      const first = await submit(submission());
      const second = await submit(submission());

      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      expect(second.body).toEqual(first.body);
      expect(await storedRequests()).toHaveLength(1);
    });

    it('absorbs a resend that changed only the free text, and from a different address', async () => {
      // The deduplication subject is the mobile, the service, the age and the
      // sex. A parent who resubmits after adding a sentence has made the same
      // request twice, and a note that could defeat deduplication by a
      // whitespace change would be the same as not having it. A different
      // network — a phone that switched from wifi — must not split the pair
      // either.
      await submit(submission(), '203.0.113.10');
      const resend = await submit(
        submission({ note: 'متن نمونهٔ دیگر.', childName: 'نام دیگر' }),
        '198.51.100.7',
      );

      expect(resend.status).toBe(202);
      expect(await storedRequests()).toHaveLength(1);
    });

    it('keeps a genuinely different request from the same person', async () => {
      const serviceId = await createPublishedService('synthetic-other');
      expect(serviceId).toBeTruthy();

      await submit(submission());
      const differentChild = await submit(submission({ childAgeYears: 9 }));
      const differentService = await submit(submission({ serviceSlug: slugs.get('synthetic-other') }));

      expect(differentChild.status).toBe(202);
      expect(differentService.status).toBe(202);
      expect(await storedRequests()).toHaveLength(3);
    });

    it('does not collapse one parent asking about two different children', async () => {
      // THE OWNER-APPROVED SEMANTICS, AND THE CASE THEY EXIST FOR. One mobile
      // number, one service, two children. Under the earlier planning shorthand
      // — mobile plus service only — the second request would have been silently
      // discarded: a family waiting for a call nobody was going to make, with no
      // trace anywhere that they had asked. The structured triage facts are what
      // keep them apart.
      const first = await submit(submission({ childAgeYears: 4, childSex: 'FEMALE' }));
      const sibling = await submit(submission({ childAgeYears: 9, childSex: 'MALE' }));

      expect(first.status).toBe(202);
      expect(sibling.status).toBe(202);
      expect(await storedRequests()).toHaveLength(2);
    });

    it('separates two children of the same age who differ only by recorded sex', async () => {
      // Twins, or near enough. Age alone would have merged them.
      await submit(submission({ childAgeYears: 5, childSex: 'FEMALE' }));
      const twin = await submit(submission({ childAgeYears: 5, childSex: 'MALE' }));

      expect(twin.status).toBe(202);
      expect(await storedRequests()).toHaveLength(2);
    });

    it('resolves nothing about identity, and reaches no family or child record', async () => {
      // NOT AN IDENTITY SYSTEM, AND IT MUST NOT GROW INTO ONE. Deduplication
      // compares four structured facts exactly. It performs no name matching, no
      // Persian folding and no candidate search, and it does not touch the family
      // or child duplicate-detection machinery that exists elsewhere in this
      // application — so two submissions whose names differ only in spelling are
      // still ONE request when the four facts agree, and no clinic record is read
      // or written on the way to deciding that.
      await submit(submission({ contactName: 'علي نمونه', childName: 'سارا' }));
      const respelled = await submit(submission({ contactName: 'علی نمونه', childName: 'سارة' }));

      expect(respelled.status).toBe(202);
      expect(await storedRequests()).toHaveLength(1);

      const counts = await harness.prisma.$queryRaw<{ families: bigint; children: bigint }[]>`
        SELECT
          (SELECT count(*) FROM family) AS families,
          (SELECT count(*) FROM child) AS children
      `;
      expect(counts[0]?.families).toBe(0n);
      expect(counts[0]?.children).toBe(0n);
    });

    it('writes no audit row for the resend it absorbed', async () => {
      await submit(submission());
      await submit(submission());

      const received = (await auditRows()).filter(
        (row) => row.action === 'website_request.received',
      );

      expect(received).toHaveLength(1);
    });

    it('does not deduplicate two different people who happen to submit alike', async () => {
      await submit(submission({ contactMobile: '09120000010' }));
      const other = await submit(submission({ contactMobile: '09120000011' }));

      expect(other.status).toBe(202);
      expect(await storedRequests()).toHaveLength(2);
    });
  });

  describe('the throttle engages, and says nothing about anybody', () => {
    it('refuses the seventh distinct submission from one address within the window', async () => {
      const flood = 'flooding-address';
      expect(flood).toBeTruthy();

      for (let index = 0; index < 6; index += 1) {
        const response = await submit(
          submission({ contactMobile: `0912100${String(1000 + index)}` }),
          '203.0.113.99',
        );
        expect(response.status).toBe(202);
      }

      const seventh = await submit(submission({ contactMobile: '09121001100' }), '203.0.113.99');

      expect(seventh.status).toBe(429);
      expect(seventh.body.error.code).toBe('PUBLIC_REQUEST_THROTTLED');
      expect(await storedRequests()).toHaveLength(6);
    });

    it('leaves a different visitor entirely alone', async () => {
      for (let index = 0; index < 6; index += 1) {
        await submit(
          submission({ contactMobile: `0912200${String(1000 + index)}` }),
          '203.0.113.99',
        );
      }

      const elsewhere = await submit(submission({ contactMobile: '09122001100' }), '198.51.100.4');

      expect(elsewhere.status).toBe(202);
    });

    it('writes no audit row when it refuses', async () => {
      // `audit_log` is append-only and unprunable. An anonymous caller who could
      // write to it by asking is a caller who can grow it without bound, which
      // is precisely the rule `security-log.ts` exists to keep.
      for (let index = 0; index < 7; index += 1) {
        await submit(
          submission({ contactMobile: `0912300${String(1000 + index)}` }),
          '203.0.113.98',
        );
      }

      const received = (await auditRows()).filter(
        (row) => row.action === 'website_request.received',
      );

      expect(received).toHaveLength(6);
    });

    it('does not refuse everybody when the web tier reports no address', async () => {
      // A proxy misconfiguration must not take the contact form down. With no
      // address there is no fingerprint, so the throttle abstains — and the
      // column records nothing rather than a shared bucket.
      for (let index = 0; index < 8; index += 1) {
        const response = await request(server())
          .post('/public/requests')
          .set(asVisitor())
          .send(submission({ contactMobile: `0912400${String(1000 + index)}` }));

        expect(response.status).toBe(202);
      }

      const rows = await storedRequests();
      expect(rows).toHaveLength(8);
      expect(rows.every((row) => row['submitter_fingerprint'] === null)).toBe(true);
    });
  });

  describe('consent is evidence, not a flag', () => {
    it('records what they agreed to, when, and that they did', async () => {
      const before = new Date();
      await submit(submission());

      const row = (await storedRequests())[0];

      expect(row?.['consent_given']).toBe(true);
      expect(row?.['consent_version']).toBe(CURRENT_PUBLIC_REQUEST_CONSENT_VERSION);
      expect((row?.['consent_recorded_at'] as Date).getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 1000,
      );
    });

    it('takes the consent instant from the server, not from the caller', async () => {
      // A submitter-chosen timestamp is not evidence of anything. The column is
      // not on the request contract at all, so there is nothing to send.
      const response = await submit(submission({ consentRecordedAt: '1990-01-01T00:00:00.000Z' }));

      expect(response.status).toBe(400);
    });
  });

  describe('what is kept, and what is deliberately not', () => {
    it('stores no raw IP address anywhere on the request row', async () => {
      await submit(submission(), '203.0.113.55');

      const row = (await storedRequests())[0];
      const values = Object.values(row ?? {}).map((value) => String(value));

      expect(values).not.toContain('203.0.113.55');
      expect(values.some((value) => value.includes('203.0.113'))).toBe(false);
      // What IS stored is a keyed digest, and it is shaped so no raw value
      // could ever be mistaken for one.
      expect(row?.['submitter_fingerprint']).toMatch(/^[0-9a-f]{64}$/);
      expect(row?.['dedupe_key']).toMatch(/^[0-9a-f]{64}$/);
    });

    it('stores no mobile number inside the abuse-control identifiers', async () => {
      await submit(submission());

      const row = (await storedRequests())[0];

      expect(String(row?.['dedupe_key'])).not.toContain('09120000001');
      expect(String(row?.['submitter_fingerprint'])).not.toContain('09120000001');
    });

    it('writes a permanent audit row that names the act and carries no content', async () => {
      await submit(submission(), '203.0.113.77');

      const rows = await auditRows();
      const received = rows.filter((row) => row.action === 'website_request.received');

      expect(received).toHaveLength(1);
      const row = received[0];

      expect(row?.actor_type).toBe('ANONYMOUS');
      expect(row?.actor_user_id).toBeNull();
      expect(row?.entity_type).toBe('website_request');
      expect(row?.entity_id).toBe((await storedRequests())[0]?.['id']);

      // NO PAYLOAD AT ALL. `audit_log` is unprunable, so anything copied here
      // would outlive the ninety-day purge that gives this table its reason to
      // exist.
      expect(row?.before).toBeNull();
      expect(row?.after).toBeNull();
      expect(row?.metadata).toBeNull();

      // AND NO CLIENT METADATA, unlike every other audited write in the
      // application. See `anonymousWebsiteAuditContext`.
      expect(row?.ip).toBeNull();
      expect(row?.user_agent).toBeNull();
    });

    it('lets no intake value reach the audit table by any route', async () => {
      await submit(
        submission({
          contactName: 'نام کاملاً یکتای نمونه',
          note: 'عبارت کاملاً یکتای نمونه',
        }),
        '203.0.113.88',
      );

      const serialised = JSON.stringify(await auditRows());

      for (const secret of [
        'نام کاملاً یکتای نمونه',
        'عبارت کاملاً یکتای نمونه',
        '09120000001',
        'کودک نمونه',
        '203.0.113.88',
        'UNSPECIFIED',
      ]) {
        expect(serialised).not.toContain(secret);
      }
    });

    it('creates and mutates no family, child or guardian', async () => {
      await submit(submission());

      const counts = await harness.prisma.$queryRaw<{ families: bigint; children: bigint }[]>`
        SELECT
          (SELECT count(*) FROM family) AS families,
          (SELECT count(*) FROM child) AS children
      `;

      expect(counts[0]?.families).toBe(0n);
      expect(counts[0]?.children).toBe(0n);
    });

    it('keeps every published page answering exactly as before', async () => {
      // A write surface that changed a read surface would be the failure this
      // whole module is arranged to prevent.
      const before = await request(server()).get('/public/services').set(internalHeaders());
      await submit(submission());
      const after = await request(server()).get('/public/services').set(internalHeaders());

      expect(after.body).toEqual(before.body);
    });
  });
});
