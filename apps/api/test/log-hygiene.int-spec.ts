import { Logger } from '@nestjs/common';
import request from 'supertest';
import { TestimonialsService } from '../src/website/testimonials.service';
import { createHarness, internalHeaders, resetDatabase, type Harness } from './harness';
import { uploadPhoto } from './media-support';
import { as, loginAs, submitRequest } from './website-support';

/**
 * Milestone 10, checkpoint A3 — PRODUCTION LOGS CARRY NO PERSONAL DATA.
 *
 * No request bodies, no photo descriptions or file names, no session tokens,
 * no usernames and no addresses. This drives the paths most likely to regress
 * through the real API and captures EVERY line the application logs while they
 * run: a failed sign-in, a forged session, an upload, a public contact request,
 * and an unexpected failure whose message is full of a family's details (the
 * shape a PostgreSQL error with a failing row takes). Then it looks for each
 * sentinel in all of it.
 *
 * Every value here is synthetic.
 */
describe('log hygiene (real PostgreSQL)', () => {
  let harness: Harness;
  let lines: string[];

  const SENTINELS = {
    username: 'sample.unknown.colleague',
    password: 'synthetic wrong password value',
    address: '198.51.100.23',
    forgedToken: 'forgedSyntheticTokenValue0123456789abcdefABCDEF',
    fileName: 'sample-family-surname-photo.jpg',
    altText: 'توضیح نمونهٔ یک عکس خانوادگی',
    contactName: 'سرپرست نمونهٔ لاگ',
    contactMobile: '09120000077',
    failingRow: 'Sample Parent Surname',
  };

  beforeAll(async () => {
    harness = await createHarness();
  }, 60_000);

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    lines = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const expectNoSentinel = () => {
    const logged = lines.join('\n');
    for (const [name, value] of Object.entries(SENTINELS)) {
      expect({ name, found: logged.includes(value) }).toEqual({ name, found: false });
    }
  };

  it('logs a failed sign-in and a forged session by kind, without who or from where', async () => {
    const login = await request(harness.app.getHttpServer())
      .post('/auth/login')
      .set(internalHeaders({ 'x-client-ip': SENTINELS.address }))
      .send({ username: SENTINELS.username, password: SENTINELS.password });
    expect(login.status).toBe(401);

    const forged = await request(harness.app.getHttpServer())
      .get('/auth/session')
      .set(
        internalHeaders({
          'x-session-id': SENTINELS.forgedToken,
          'x-client-ip': SENTINELS.address,
        }),
      );
    expect(forged.status).toBe(401);

    expect(lines.some((line) => line.includes('event=auth.login.rejected'))).toBe(true);
    expect(lines.some((line) => line.includes('event=auth.session.rejected'))).toBe(true);
    expectNoSentinel();
  });

  it('logs nothing about an upload or a public contact request', async () => {
    const receptionist = await loginAs(harness, 'RECEPTIONIST');

    await uploadPhoto(harness, receptionist, {
      fileName: SENTINELS.fileName,
      altText: SENTINELS.altText,
    });
    await submitRequest(
      harness,
      { contactName: SENTINELS.contactName, contactMobile: SENTINELS.contactMobile },
      SENTINELS.address,
    );

    expectNoSentinel();
  });

  it('logs an unexpected failure by its kind and request id, never its message', async () => {
    const manager = await loginAs(harness, 'MANAGER');
    jest
      .spyOn(TestimonialsService.prototype, 'list')
      .mockRejectedValue(
        new Error(
          `new row violates check constraint "family_mobile_chk" DETAIL: Failing row contains (${SENTINELS.failingRow}, ${SENTINELS.contactMobile}).`,
        ),
      );

    const response = await request(harness.app.getHttpServer())
      .get('/content/testimonials')
      .set(as(manager));

    expect(response.status).toBe(500);
    const requestId = response.body.error.requestId as string;
    const logged = lines.find((line) => line.includes(requestId));
    expect(logged).toContain('Error constraint=family_mobile_chk');
    expectNoSentinel();
  });
});
