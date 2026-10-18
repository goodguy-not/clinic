import request from 'supertest';
import {
  paymentReportResponseSchema,
  sessionReportResponseSchema,
  therapistActivityResponseSchema,
  familyAccountReportResponseSchema,
} from '@clinic/contracts';
import {
  asUser,
  bookId,
  bookingPayload,
  complete,
  recordAttendance,
  readView,
  seedClinic,
  signIn,
  pastSaturday,
} from './appointments-support';
import {
  clinicDay,
  insertPayment,
  insertPromise,
  seedAnotherFamily,
  seedPayingFamily,
  voidPayment,
} from './payment-support';
import { FAMILY_ACCOUNT_SCOPE } from '../src/reports/report-export-columns';
import { createHarness, resetDatabase, type Harness } from './harness';

/**
 * The CSV exports: `GET /reports/{report}/export` (Milestone 7, checkpoint C5).
 *
 * EVERYTHING HERE IS SYNTHETIC. No real family, child, therapist, amount or
 * identifier appears in any fixture in this project.
 *
 * WHAT THIS SUITE IS FOR. An export is the one reporting act that leaves the
 * system, and the failures worth proving at the HTTP boundary are the ones no
 * unit test can reach:
 *
 *   * a manager gets a file and a receptionist is REFUSED BY THE API, on a direct
 *     call, on every one of the five surfaces — not by a hidden button;
 *   * the file RECONCILES with the report it was taken from, row for row and
 *     value for value, because it is the same statement without the paging
 *     window;
 *   * the filters and the DATE BASIS survive into the file, so a back-dated
 *     payment is in the week it arrived in and not the week it was typed in;
 *   * an operational file carries NO MONEY, which is a domain rule and not a
 *     scope cut;
 *   * one successful export writes EXACTLY ONE audit row, carrying the scope of
 *     the act and no value from the file, and a REFUSED export writes none.
 */
describe('the report CSV exports (real PostgreSQL)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  const REPORTS = [
    'sessions',
    'promises',
    'therapist-activity',
    'payments',
    'family-accounts',
  ] as const;

  const exportOf = (token: string, report: string, query: Record<string, string> = {}) =>
    request(harness.app.getHttpServer())
      .get(`/reports/${report}/export`)
      .query(query)
      .set(asUser(token));

  const reportOf = (token: string, report: string, query: Record<string, string> = {}) =>
    request(harness.app.getHttpServer()).get(`/reports/${report}`).query(query).set(asUser(token));

  /**
   * The file, parsed back. Every field is quoted and a quote inside one is
   * doubled, so the reader below is the whole of RFC 4180 this format uses.
   */
  const parse = (csv: string): string[][] => {
    expect(csv.startsWith('\uFEFF')).toBe(true);

    const body = csv.slice(1);
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;

    for (let index = 0; index < body.length; index += 1) {
      const character = body[index];

      if (quoted) {
        if (character === '"' && body[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
        } else {
          field += character;
        }
        continue;
      }

      if (character === '"') quoted = true;
      else if (character === ',') {
        row.push(field);
        field = '';
      } else if (character === '\r' && body[index + 1] === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        index += 1;
      } else field += character;
    }

    return rows;
  };

  const okExport = async (
    token: string,
    report: string,
    query: Record<string, string> = {},
  ): Promise<{ header: string[]; rows: string[][]; response: request.Response }> => {
    const response = await exportOf(token, report, query);
    expect(response.status).toBe(200);

    const [header, ...rows] = parse(response.text);

    return { header: header ?? [], rows, response };
  };

  const exportAudits = () =>
    harness.prisma.auditLog.findMany({ where: { action: 'report.exported' } });

  describe('who may take a file out of the building', () => {
    it('refuses a receptionist every export, on a direct call, and writes no audit row', async () => {
      // The frozen owner decision: export is manager-only. A receptionist reads
      // sessions, promises and therapist activity on the screen all day — the
      // refusal below is the API's, before any statement runs, and not a hidden
      // control in the web tier.
      const receptionist = await signIn(harness, 'RECEPTIONIST');

      for (const report of REPORTS) {
        const response = await exportOf(receptionist.token, report, {
          from: '2026-08-01',
          to: '2026-08-31',
        });

        expect(response.status).toBe(403);
      }

      // A refusal is not an audited fact: an unauthenticated caller could
      // otherwise fill an append-only table by asking.
      expect(await exportAudits()).toHaveLength(0);
    });

    it('still lets a receptionist READ the three operational reports it refuses to export', async () => {
      // The export authority is separate from the read, which is the whole reason
      // `report.export` is its own name. Withholding the file does not withhold
      // the screen.
      const receptionist = await signIn(harness, 'RECEPTIONIST');
      const range = { from: '2026-08-01', to: '2026-08-31' };

      for (const report of ['sessions', 'promises', 'therapist-activity']) {
        expect((await reportOf(receptionist.token, report, range)).status).toBe(200);
        expect((await exportOf(receptionist.token, report, range)).status).toBe(403);
      }
    });

    it('gives a manager a downloadable, uncacheable CSV', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const { response } = await okExport(manager.token, 'payments', {
        from: '2026-08-01',
        to: '2026-08-31',
      });

      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-type']).toContain('charset=utf-8');
      expect(response.headers['content-disposition']).toBe(
        'attachment; filename="payments-2026-08-01-to-2026-08-31.csv"',
      );
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      // A file of every family's money may not sit in a proxy.
      expect(response.headers['cache-control']).toBe('no-store');
    });

    it('answers a quiet period with a heading and no rows, not an error', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const { header, rows } = await okExport(manager.token, 'sessions', {
        from: '2026-01-01',
        to: '2026-01-07',
      });

      expect(header.length).toBeGreaterThan(0);
      expect(rows).toHaveLength(0);
    });

    it('refuses a paged export, because a file is the whole filtered result', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const response = await exportOf(manager.token, 'sessions', {
        from: '2026-08-01',
        to: '2026-08-31',
        page: '2',
      });

      expect(response.status).toBe(400);
      expect(await exportAudits()).toHaveLength(0);
    });
  });

  describe('the file reconciles with the report it was taken from', () => {
    it('carries every payment the report lists, on the same received day', async () => {
      const fixture = await seedPayingFamily(harness);
      const today = await clinicDay(harness);
      const earlier = await clinicDay(harness, -3);

      await insertPayment(harness, fixture, { amountToman: '250000', receivedOn: today });
      await insertPayment(harness, fixture, {
        amountToman: '125000',
        method: 'CARD',
        receivedOn: earlier,
      });
      // Voided by a later, separate statement, exactly as the database insists
      // and as the void service does: a payment is never born reversed.
      const reversed = await insertPayment(harness, fixture, {
        amountToman: '90000',
        receivedOn: today,
      });
      await voidPayment(harness, fixture, reversed);

      const range = { from: earlier, to: today };
      const screen = paymentReportResponseSchema.parse(
        (await reportOf(fixture.managerToken, 'payments', range)).body,
      );
      const { header, rows } = await okExport(fixture.managerToken, 'payments', range);

      // Row for row: the file is the report's own statement without the paging
      // window, so the ids and their order are identical.
      expect(rows).toHaveLength(screen.payments.length);
      const idColumn = header.indexOf('شناسهٔ پرداخت');
      expect(rows.map((row) => row[idColumn])).toEqual(screen.payments.map((row) => row.id));

      // Value for value: the amount is the canonical wire string, the status is
      // the server's derived word, and the day is `receivedOn`.
      const amountColumn = header.indexOf('مبلغ (تومان)');
      const statusColumn = header.indexOf('وضعیت');
      const dayColumn = header.indexOf('تاریخ دریافت وجه');

      expect(rows.map((row) => row[amountColumn])).toEqual(
        screen.payments.map((row) => row.amountToman),
      );
      expect(rows.map((row) => row[statusColumn])).toEqual(
        screen.payments.map((row) => row.status),
      );
      expect(rows.map((row) => row[dayColumn])).toEqual(
        screen.payments.map((row) => row.receivedOn),
      );
      expect(rows.some((row) => row[statusColumn] === 'VOIDED')).toBe(true);
    });

    it('keys payments on the day the money arrived, never on the day it was entered', async () => {
      // A payment entered today but RECEIVED before the range is outside it, and
      // the dashboard's reconciliation — which keys on the entry day — is a
      // different question that this file does not answer.
      const fixture = await seedPayingFamily(harness);
      const today = await clinicDay(harness);
      const longAgo = await clinicDay(harness, -30);

      await insertPayment(harness, fixture, { amountToman: '400000', receivedOn: longAgo });

      const inside = await okExport(fixture.managerToken, 'payments', {
        from: longAgo,
        to: longAgo,
      });
      const outside = await okExport(fixture.managerToken, 'payments', { from: today, to: today });

      expect(inside.rows).toHaveLength(1);
      expect(outside.rows).toHaveLength(0);
    });

    it('honours an entity filter, and narrows the file exactly as it narrows the screen', async () => {
      const fixture = await seedPayingFamily(harness);
      const today = await clinicDay(harness);
      await insertPayment(harness, fixture, { amountToman: '250000', receivedOn: today });
      await insertPayment(harness, fixture, {
        amountToman: '75000',
        method: 'CARD',
        receivedOn: today,
      });

      const filtered = await okExport(fixture.managerToken, 'payments', {
        from: today,
        to: today,
        method: 'CARD',
      });

      expect(filtered.rows).toHaveLength(1);
      expect(filtered.rows[0]?.[filtered.header.indexOf('روش')]).toBe('CARD');
    });
  });

  describe('what an operational file may not contain', () => {
    it('exports sessions with no money of any kind, and no invented column', async () => {
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const saturday = pastSaturday();

      const appointmentId = await bookId(
        harness,
        manager.token,
        bookingPayload(clinic, { startsAt: saturday.startsAt }),
      );
      expect((await complete(harness, manager.token, appointmentId)).status).toBe(200);

      const range = { from: saturday.date, to: saturday.date };
      const screen = sessionReportResponseSchema.parse(
        (await reportOf(manager.token, 'sessions', range)).body,
      );
      const { header, rows } = await okExport(manager.token, 'sessions', range);

      expect(rows).toHaveLength(screen.summary.total);
      expect(rows[0]?.[header.indexOf('وضعیت نوبت')]).toBe('COMPLETED');

      // Not a price, not a tariff, not a charge, not a "was this billed?" flag.
      // The report carries none — which is why both roles may READ it — and a
      // file is not a reason to add one.
      const headings = header.join(' ');
      expect(headings).not.toMatch(/تومان|مبلغ|تعرفه|هزینه|سهم/);
    });

    it('exports therapist activity with no share, no rate and no session value', async () => {
      // Therapist settlement rules are unapproved (CLAUDE.md) and none of them may
      // be inferred. A file is where half a settlement calculation would first be
      // published for somebody to finish with a multiplication.
      const manager = await signIn(harness, 'MANAGER');
      const clinic = await seedClinic(harness, manager.token);
      const saturday = pastSaturday();

      const appointmentId = await bookId(
        harness,
        manager.token,
        bookingPayload(clinic, { startsAt: saturday.startsAt }),
      );
      expect((await complete(harness, manager.token, appointmentId)).status).toBe(200);

      // Attendance is a fact about a SEAT, not about the booking or the child.
      const view = await readView(harness, manager.token, appointmentId);
      const participantId = view.body.participants[0].participant.id as string;
      expect(
        (await recordAttendance(harness, manager.token, appointmentId, participantId, 'ATTENDED'))
          .status,
      ).toBe(200);

      const range = { from: saturday.date, to: saturday.date };
      const screen = therapistActivityResponseSchema.parse(
        (await reportOf(manager.token, 'therapist-activity', range)).body,
      );
      const { header, rows } = await okExport(manager.token, 'therapist-activity', range);

      expect(rows).toHaveLength(screen.therapists.length);
      expect(rows[0]?.[header.indexOf('حاضر')]).toBe(String(screen.therapists[0]?.attendedCount));

      const headings = header.join(' ');
      expect(headings).not.toMatch(/تومان|مبلغ|سهم|درصد|تسویه|ارزش/);
      // And no totals line hiding in the data: every row is a therapist.
      expect(rows).toHaveLength(screen.totals.therapistCount);
    });

    it('exports promises with each promise own amount and no total of them', async () => {
      const fixture = await seedPayingFamily(harness);
      const today = await clinicDay(harness);
      await insertPromise(harness, fixture, { amountToman: '300000', dueOn: today });
      await insertPromise(harness, fixture, { amountToman: '200000', dueOn: today });

      const { header, rows } = await okExport(fixture.managerToken, 'promises', {
        from: today,
        to: today,
      });

      // Two rows, two amounts, and nothing anywhere that adds them up: a promise
      // moves no money in any state (CLAUDE.md), and a summed column in a
      // spreadsheet reads as money the clinic is owed.
      expect(rows).toHaveLength(2);
      expect(header.some((heading) => heading.includes('بدهی نیست'))).toBe(true);
      expect(rows.every((row) => row[header.indexOf('وضعیت')] === 'OPEN')).toBe(true);
    });
  });

  describe('the family-accounts file, which is every family whole position', () => {
    it('states credit and amount due as two columns, never netted, and never narrowed', async () => {
      const fixture = await seedPayingFamily(harness);
      const today = await clinicDay(harness);
      await insertPayment(harness, fixture, { amountToman: '500000', receivedOn: today });
      await insertPromise(harness, fixture, { amountToman: '100000', dueOn: today });

      const screen = familyAccountReportResponseSchema.parse(
        (await reportOf(fixture.managerToken, 'family-accounts')).body,
      );
      const { header, rows } = await okExport(fixture.managerToken, 'family-accounts');
      const position = screen.families[0]?.position;
      const cell = (heading: string) => rows[0]?.[header.indexOf(heading)];

      expect(rows).toHaveLength(screen.families.length);
      // A family that has paid and been charged nothing stands in credit; the two
      // figures are separate columns because one family's credit is not another
      // family's debt, and a single signed "balance" would be the clinic-wide
      // balance this product does not recognise.
      expect(cell('اعتبار خانواده (تومان)')).toBe(position?.creditToman);
      expect(cell('مبلغ قابل پرداخت (تومان)')).toBe(position?.amountDueToman);
      expect(cell('جمع پرداخت تأییدشده (تومان)')).toBe(position?.confirmedPaymentTotalToman);
      expect(cell('مبلغ خالص بدهکارشده (تومان)')).toBe(position?.netChargedTotalToman);

      // The promise is counted beside the money and reduces none of it, and the
      // heading is the only place a spreadsheet can be told so.
      expect(cell('قول باز — کاهندهٔ بدهی نیست')).toBe(String(position?.openPromiseCount));
    });

    it('says in the file itself that the figures are only this system records', async () => {
      // The screen prints the qualification beside the report; a CSV leaves the
      // application and is read months later beside no screen at all, and an
      // amount due read without it looks like a complete statement of what a
      // family owes. There is no opening balance and no pre-system paper debt in
      // any of these numbers, because no such row exists.
      const fixture = await seedPayingFamily(harness);
      const other = await seedAnotherFamily(harness, fixture);
      const today = await clinicDay(harness);
      await insertPayment(harness, fixture, { amountToman: '500000', receivedOn: today });
      await insertPayment(harness, fixture, {
        familyId: other,
        amountToman: '10000',
        receivedOn: today,
      });

      const { header, rows, response } = await okExport(fixture.managerToken, 'family-accounts');
      const scopeColumn = header.findIndex((heading) => heading.startsWith('دامنهٔ ارقام'));

      // It is a column of the table, not a preamble line and not a note row:
      // the file stays ordinary CSV that sorts, filters and copies.
      expect(scopeColumn).toBe(0);
      expect(header[0]).toContain('فقط سوابق ثبت‌شده در سامانه');
      expect(header[0]).toContain('بدون مانده افتتاحیه');
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row[scopeColumn] === FAMILY_ACCOUNT_SCOPE)).toBe(true);

      // It is a property of the report and not of any family, so it cannot vary
      // per row and no reader may read a difference between two rows as meaning
      // anything about either family.
      expect(new Set(rows.map((row) => row[scopeColumn])).size).toBe(1);

      // It states where the numbers came from and claims nothing else. The check
      // is on the disclosure itself rather than on the whole file, because the
      // file legitimately contains «جمع پرداخت تأییدشده» — the C4 report's own
      // name for confirmed payments, which is a financial fact and not a claim
      // about this document.
      const disclosure = `${header[0] ?? ''} ${rows[0]?.[scopeColumn] ?? ''}`;
      expect(disclosure).not.toMatch(/رسید|صورت‌?حساب|تسویه|قطعی|سند|گواهی|بدهکار است/);
      expect(response.text).not.toMatch(/رسید رسمی|صورت‌?حساب رسمی|گواهی/);
    });

    it('carries the scope on a family that owes nothing, without implying a balance was carried in', async () => {
      // A family with no records at all is a zero position, and the qualification
      // is the same sentence: the zero means "nothing in this system", not "this
      // family started at zero".
      const fixture = await seedPayingFamily(harness);
      const { header, rows } = await okExport(fixture.managerToken, 'family-accounts');

      expect(rows[0]?.[0]).toBe(FAMILY_ACCOUNT_SCOPE);
      expect(rows[0]?.[header.indexOf('مبلغ قابل پرداخت (تومان)')]).toBe('0');
      // No opening-balance column was introduced to carry the disclosure.
      expect(header.some((heading) => heading.includes('مانده افتتاحیه'))).toBe(true);
      expect(header.filter((heading) => heading.includes('مانده افتتاحیه'))).toHaveLength(1);
    });

    it('stays valid, deterministic CSV: the same request gives byte-identical files', async () => {
      const fixture = await seedPayingFamily(harness);
      const today = await clinicDay(harness);
      await insertPayment(harness, fixture, { amountToman: '500000', receivedOn: today });

      const first = await okExport(fixture.managerToken, 'family-accounts');
      const second = await okExport(fixture.managerToken, 'family-accounts');

      expect(second.response.text).toBe(first.response.text);
      // Every line has the same number of fields, the added column included.
      expect(first.rows.every((row) => row.length === first.header.length)).toBe(true);
    });

    it('adds the scope column to this file alone', async () => {
      // The other four exports are untouched: the qualification is about a
      // financial POSITION, and no other report states one.
      const manager = await signIn(harness, 'MANAGER');
      const range = { from: '2026-08-01', to: '2026-08-31' };

      for (const report of ['sessions', 'promises', 'therapist-activity', 'payments']) {
        const { header } = await okExport(manager.token, report, range);
        expect(header.some((heading) => heading.startsWith('دامنهٔ ارقام'))).toBe(false);
      }
    });

    it('takes no date range, because a position is not a period', async () => {
      const fixture = await seedPayingFamily(harness);
      const response = await exportOf(fixture.managerToken, 'family-accounts', {
        from: '2026-08-01',
        to: '2026-08-31',
      });

      expect(response.status).toBe(400);
    });

    it('selects families without narrowing anybody balance', async () => {
      // `standing` decides WHICH families are listed. The position each row
      // carries was derived over the whole family before the filter ran.
      const fixture = await seedPayingFamily(harness);
      const today = await clinicDay(harness);
      await insertPayment(harness, fixture, { amountToman: '500000', receivedOn: today });

      const all = await okExport(fixture.managerToken, 'family-accounts');
      const owing = await okExport(fixture.managerToken, 'family-accounts', { standing: 'OWING' });
      const credit = await okExport(fixture.managerToken, 'family-accounts', {
        standing: 'IN_CREDIT',
      });

      expect(all.rows).toHaveLength(1);
      expect(owing.rows).toHaveLength(0);
      expect(credit.rows).toHaveLength(1);
      expect(credit.rows[0]?.[credit.header.indexOf('اعتبار خانواده (تومان)')]).toBe('500000');
    });
  });

  describe('Persian text and values a spreadsheet might misread', () => {
    it('escapes a comma and a quotation mark, and neutralises a formula', async () => {
      const fixture = await seedPayingFamily(harness);
      const today = await clinicDay(harness);
      await insertPayment(harness, fixture, { amountToman: '250000', receivedOn: today });

      // Synthetic, and deliberately hostile: a comma would split the row, a quote
      // would end the field, and a leading `=` is executed by Excel and
      // LibreOffice when the file is opened.
      const hostile = '=خانوادهٔ «الف», ب "پ"';
      // `search_family_name` is written with the same normaliser the application
      // uses, because the database refuses a family whose search key was not
      // derived from its name.
      await harness.prisma.$executeRaw`
        UPDATE family
           SET family_name = ${hostile},
               search_family_name = fa_normalize(${hostile})
         WHERE id = ${fixture.familyId}::uuid
      `;

      const { header, rows, response } = await okExport(fixture.managerToken, 'payments', {
        from: today,
        to: today,
      });

      // The name survives the round trip intact, apart from the apostrophe that
      // tells a spreadsheet the cell is text rather than a formula.
      expect(rows[0]?.[header.indexOf('خانواده')]).toBe(`'${hostile}`);
      expect(rows[0]?.[header.indexOf('مبلغ (تومان)')]).toBe('250000');
      // The amount was NOT guarded: it is the server's own value, it cannot begin
      // with a dangerous character, and a prefixed number is text a manager
      // cannot sum.
      expect(response.text).not.toContain("'250000");
    });
  });

  describe('the audit trail, which records the act and never its contents', () => {
    it('writes exactly one row for one successful export, and none for a read', async () => {
      const fixture = await seedPayingFamily(harness);
      const today = await clinicDay(harness);
      await insertPayment(harness, fixture, { amountToman: '250000', receivedOn: today });

      // Reading the same report as many times as you like writes nothing:
      // `audit_log` is append-only and permanent, and a read copied into it would
      // grow with every screen refresh.
      await reportOf(fixture.managerToken, 'payments', { from: today, to: today });
      await reportOf(fixture.managerToken, 'payments', { from: today, to: today });
      expect(await exportAudits()).toHaveLength(0);

      await okExport(fixture.managerToken, 'payments', { from: today, to: today });

      const rows = await exportAudits();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.entityType).toBe('report');
      // An export changes no row and therefore names none.
      expect(rows[0]?.entityId).toBeNull();
      expect(rows[0]?.actorUserId).toBe(fixture.managerId);
      expect(rows[0]?.before).toBeNull();
      expect(rows[0]?.after).toBeNull();
    });

    it('records the scope of the act: report, format, range, filters, row count', async () => {
      const fixture = await seedPayingFamily(harness);
      const today = await clinicDay(harness);
      await insertPayment(harness, fixture, { amountToman: '250000', receivedOn: today });
      await insertPayment(harness, fixture, { amountToman: '75000', receivedOn: today });

      await okExport(fixture.managerToken, 'payments', {
        from: today,
        to: today,
        familyId: fixture.familyId,
      });

      const [row] = await exportAudits();

      expect(row?.metadata).toEqual({
        report: 'PAYMENTS',
        format: 'CSV',
        range: { from: today, to: today, dateBasis: 'PAYMENT_RECEIVED_ON' },
        filters: { familyId: fixture.familyId, includeVoided: true },
        rowCount: 2,
      });
    });

    it('records no value from the file: no money, no name, no identifier', async () => {
      const fixture = await seedPayingFamily(harness);
      const today = await clinicDay(harness);
      await insertPayment(harness, fixture, {
        amountToman: '987654',
        receivedOn: today,
        reference: 'REF-SYNTHETIC-1',
        note: 'یادداشت آزمایشی',
      });

      await okExport(fixture.managerToken, 'payments', { from: today, to: today });

      const [row] = await exportAudits();
      const serialised = JSON.stringify(row?.metadata);

      // The amount, the family name, the bank reference and the note were all in
      // the file. None of them is in the permanent trail: the trail says an
      // authorised export happened and what it was scoped to, and the opaque ids
      // it does carry are pointers rather than the personal data itself.
      expect(serialised).not.toContain('987654');
      expect(serialised).not.toContain('خانوادهٔ آزمایشی');
      expect(serialised).not.toContain('REF-SYNTHETIC-1');
      expect(serialised).not.toContain('یادداشت آزمایشی');
    });

    it('states an absent range explicitly on the report that has none, and copies no file content', async () => {
      const fixture = await seedPayingFamily(harness);
      const today = await clinicDay(harness);
      await insertPayment(harness, fixture, { amountToman: '500000', receivedOn: today });

      await okExport(fixture.managerToken, 'family-accounts');

      const [row] = await exportAudits();
      // The act and its scope, unchanged by the file gaining a column: the trail
      // records WHAT was exported, and copies neither the scope value the file
      // carries nor any other cell of it.
      expect(row?.metadata).toEqual({
        report: 'FAMILY_ACCOUNTS',
        format: 'CSV',
        range: null,
        filters: { includeInactive: false },
        rowCount: 1,
      });
      expect(JSON.stringify(row?.metadata)).not.toContain(FAMILY_ACCOUNT_SCOPE);
      expect(JSON.stringify(row?.metadata)).not.toContain('500000');
    });

    it('names the surface in the payload rather than in five different actions', async () => {
      // "How often does data leave this system?" is asked of exports as a class,
      // which is the shape a reviewer filters on.
      const manager = await signIn(harness, 'MANAGER');
      const range = { from: '2026-08-01', to: '2026-08-31' };

      await okExport(manager.token, 'sessions', range);
      await okExport(manager.token, 'promises', range);
      await okExport(manager.token, 'therapist-activity', range);

      const rows = await exportAudits();
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => (row.metadata as { report: string }).report).sort()).toEqual([
        'PROMISES',
        'SESSIONS',
        'THERAPIST_ACTIVITY',
      ]);
    });
  });
});
