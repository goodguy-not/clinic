import request from 'supertest';
import {
  settlementStatementResponseSchema,
  type SettlementStatementResponse,
} from '@clinic/contracts';
import { asUser, signIn } from './appointments-support';
import { parseCsv } from './csv-support';
import { createHarness, resetDatabase, type Harness } from './harness';
import { voidChargeOverHttp } from './ledger-support';
import {
  closePeriodOverHttp,
  seedCloseClinic,
  seedStatementClinic,
  statementOverHttp,
  MONTH_ONE,
  type CloseFixture,
  type StatementFixture,
} from './settlement-support';

/**
 * MILESTONE 8, CHECKPOINT C8 — the settlement statement as a CSV file, end to
 * end over the real endpoint and against real PostgreSQL rows.
 *
 * EVERYTHING HERE IS SYNTHETIC. No real family, child, therapist, amount or
 * identifier appears in any fixture in this project.
 *
 * WHAT THIS SUITE IS FOR. The export is deliberately not a new calculation, so
 * the failures worth proving at the HTTP boundary are the ones that would make
 * it one — or would make it say something the product does not mean:
 *
 *   * a manager holding BOTH authorities gets a file and a receptionist is
 *     REFUSED BY THE API, on a direct call, before any statement runs;
 *   * the file RECONCILES with the statement it was taken from, row for row and
 *     value for value, because it IS the statement's own read;
 *   * a SIGNED figure keeps its sign — a clinic subsidy is visible as the
 *     negative number CLAUDE.md requires it to be, and nothing clamps it;
 *   * an UNRATED session is absent rather than exported as a row of zeroes, and
 *     a FREE session is exported as the rated zero it genuinely is;
 *   * the vocabulary stays settlement's own: nothing in the file implies a
 *     payout, a debt or a balance, because this milestone records none;
 *   * one successful export writes EXACTLY ONE audit row carrying the scope of
 *     the act and no value from the file, and a refused or failed one writes
 *     none;
 *   * reading and exporting change no financial fact, however often they are
 *     repeated.
 *
 * The AND-list itself — that revoking EITHER authority closes the download — is
 * exercised against the guard in
 * `src/settlement/statement/settlement-export-access.spec.ts`, because a
 * permission here is derived from a ROLE and cannot be revoked one name at a
 * time over HTTP.
 */
describe('the settlement statement CSV export (checkpoint C8)', () => {
  let harness: Harness;

  const WEEK_ONE = '2026-09-05';
  const WEEK_THREE = '2026-09-19';

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  const exportOf = (token: string, query: Record<string, string>) =>
    request(harness.app.getHttpServer())
      .get('/settlement/statement/export')
      .query(query)
      .set(asUser(token));

  const KIND = 'نوع رکورد';
  const EXCLUDED_COUNT = 'تعداد جلسه‌های کنارگذاشته‌شده از ارقام مالی (فقط در سطر استثنا)';

  /**
   * The file, parsed and split by the kind every row declares in its first
   * column: the settlement lines, and the two rows that say what this range
   * excluded from them.
   */
  const okExport = async (token: string, query: Record<string, string>) => {
    const response = await exportOf(token, query);
    expect(response.status).toBe(200);

    const { header, rows } = parseCsv(response.text);
    const kind = header.indexOf(KIND);
    expect(kind).toBe(0);

    const excluded = (of: string): string =>
      rows.find((row) => row[kind] === of)?.[header.indexOf(EXCLUDED_COUNT)] ?? '';

    return {
      header,
      rows,
      settlementRows: rows.filter((row) => row[kind] === 'SETTLEMENT_LINE'),
      exceptionRows: rows.filter((row) => row[kind] !== 'SETTLEMENT_LINE'),
      unratedCell: excluded('EXCLUDED_UNRATED'),
      unchargedCell: excluded('EXCLUDED_UNCHARGED_COMPLETED'),
      response,
    };
  };

  const exportAudits = () =>
    harness.prisma.auditLog.findMany({ where: { action: 'report.exported' } });

  const cellsOf = (header: string[], rows: string[][], heading: string): string[] => {
    const column = header.indexOf(heading);
    expect(column).toBeGreaterThanOrEqual(0);

    return rows.map((row) => row[column] ?? '');
  };

  // -------------------------------------------------------------------------
  // One synthetic month containing every fact the statement has to tell apart.
  // -------------------------------------------------------------------------
  describe('over a month of ordinary settlement facts', () => {
    let fixture: StatementFixture;

    beforeEach(async () => {
      await resetDatabase(harness.prisma);
      fixture = await seedStatementClinic(harness);
    });

    const wholeMonth = () => ({
      therapistId: fixture.therapistId,
      from: WEEK_ONE,
      to: WEEK_THREE,
    });

    const statement = async (): Promise<SettlementStatementResponse> => {
      const response = await statementOverHttp(harness, fixture.managerToken, wholeMonth());
      expect(response.status).toBe(200);

      return settlementStatementResponseSchema.parse(response.body);
    };

    describe('who may take a settlement statement out of the building', () => {
      it('refuses a receptionist the file, and writes no audit row', async () => {
        // Manager-only, and the refusal is the API's: a receptionist holds
        // neither `settlement.read` nor `report.export`, so `PermissionsGuard`
        // refuses before any statement runs. A refusal is not an audited fact.
        const receptionist = await signIn(harness, 'RECEPTIONIST');
        const response = await exportOf(receptionist.token, wholeMonth());

        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('AUTH_FORBIDDEN');
        expect(await exportAudits()).toHaveLength(0);
      });

      it('gives a manager a downloadable, uncacheable CSV named for its period', async () => {
        const { response } = await okExport(fixture.managerToken, wholeMonth());

        expect(response.headers['content-type']).toContain('text/csv');
        expect(response.headers['content-type']).toContain('charset=utf-8');
        expect(response.headers['content-disposition']).toBe(
          `attachment; filename="settlement-statement-${WEEK_ONE}-to-${WEEK_THREE}.csv"`,
        );
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        // A colleague's earnings may not sit in a proxy.
        expect(response.headers['cache-control']).toBe('no-store');
      });

      it('answers a quiet period with a file that SAYS it is empty', async () => {
        // Not a header with nothing under it: the two exception rows are always
        // written, so a reader holding this file can tell "this range settled
        // nothing and excluded nothing" from "this export does not report
        // exclusions".
        const { header, settlementRows, exceptionRows, unratedCell, unchargedCell } =
          await okExport(fixture.managerToken, {
            therapistId: fixture.therapistId,
            from: '2026-01-01',
            to: '2026-01-07',
          });

        expect(header.length).toBeGreaterThan(0);
        expect(settlementRows).toHaveLength(0);
        expect(exceptionRows).toHaveLength(2);
        expect(unratedCell).toBe('0');
        expect(unchargedCell).toBe('0');
      });

      it('refuses an unknown therapist and a paged request, and audits neither', async () => {
        // A `404` is thrown inside the export transaction, before the audit row
        // commits — so a failed export is not an audited one.
        const missing = await exportOf(fixture.managerToken, {
          therapistId: '0199a0f5-0000-7000-8000-00000000dead',
          from: WEEK_ONE,
          to: WEEK_THREE,
        });
        expect(missing.status).toBe(404);

        // A file is the whole result: the schema is the screen's own and admits
        // no paging parameter.
        const paged = await exportOf(fixture.managerToken, { ...wholeMonth(), page: '2' });
        expect(paged.status).toBe(400);

        expect(await exportAudits()).toHaveLength(0);
      });
    });

    describe('the file reconciles with the statement it was taken from', () => {
      it('carries every line the statement states, in its order, value for value', async () => {
        const screen = await statement();
        const { header, settlementRows: rows } = await okExport(fixture.managerToken, wholeMonth());

        // Row for row: the file is the statement's own read, not a second one.
        expect(rows).toHaveLength(screen.lines.length);
        expect(cellsOf(header, rows, 'شناسهٔ ثبت سهم جلسه')).toEqual(
          screen.lines.map((line) => line.sessionSettlementId),
        );

        // Value for value, on every money column and on the applied percentage.
        const columns: [string, (index: number) => string][] = [
          ['تاریخ جلسه', (index) => screen.lines[index]?.serviceDate ?? ''],
          [
            'درصد سهم اعمال‌شده (در ده‌هزار)',
            (index) => String(screen.lines[index]?.appliedShareBasisPoints),
          ],
          ['مبلغ پایهٔ جلسه (تومان)', (index) => screen.lines[index]?.baseAmountToman ?? ''],
          ['سهم ناخالص درمانگر (تومان)', (index) => screen.lines[index]?.therapistGrossToman ?? ''],
          [
            'تخفیف به عهدهٔ درمانگر (تومان)',
            (index) => screen.lines[index]?.therapistDiscountToman ?? '',
          ],
          ['سهم خالص درمانگر (تومان)', (index) => screen.lines[index]?.therapistNetToman ?? ''],
          ['سهم ناخالص کلینیک (تومان)', (index) => screen.lines[index]?.clinicGrossToman ?? ''],
          [
            'تخفیف به عهدهٔ کلینیک (تومان)',
            (index) => screen.lines[index]?.clinicDiscountToman ?? '',
          ],
          [
            'سهم خالص کلینیک (تومان) — می‌تواند منفی باشد',
            (index) => screen.lines[index]?.clinicNetToman ?? '',
          ],
          [
            'تسویه‌شده در دورهٔ بسته‌شده (تومان) — پرداخت به درمانگر نیست',
            (index) => screen.lines[index]?.settledToman ?? '',
          ],
        ];

        for (const [heading, expected] of columns) {
          expect(cellsOf(header, rows, heading)).toEqual(
            screen.lines.map((_line, index) => expected(index)),
          );
        }
      });

      it('adds up to the totals the server states, without the file stating one', async () => {
        // The reconciliation a manager actually performs: sum the column in a
        // spreadsheet and compare it with the statement. It holds because the
        // file is the same read — and the file itself carries NO totals row, so
        // sorting the sheet cannot strand one among the sessions.
        const screen = await statement();
        const { header, rows, exceptionRows } = await okExport(fixture.managerToken, wholeMonth());

        // Summed over EVERY row of the file, the exception rows included: their
        // money cells are EMPTY rather than `0`, so a spreadsheet total cannot
        // be moved by a row that carries no money.
        expect(exceptionRows).toHaveLength(2);

        const sum = (heading: string) =>
          cellsOf(header, rows, heading)
            .reduce((running, cell) => running + BigInt(cell), 0n)
            .toString();

        expect(sum('سهم خالص درمانگر (تومان)')).toBe(screen.totals.therapistNetToman);
        expect(sum('سهم خالص کلینیک (تومان) — می‌تواند منفی باشد')).toBe(
          screen.totals.clinicNetToman,
        );
        expect(sum('مبلغ پایهٔ جلسه (تومان)')).toBe(screen.totals.baseAmountToman);
        expect(sum('تسویه‌شده در دورهٔ بسته‌شده (تومان) — پرداخت به درمانگر نیست')).toBe(
          screen.totals.settledToman,
        );
        // `netSettlementToman` is the therapist net of the range, and the file
        // reconciles against it by construction rather than by a second column.
        expect(sum('سهم خالص درمانگر (تومان)')).toBe(screen.totals.netSettlementToman);
      });

      it('prints the percentage that was APPLIED, so one file may show two of them', async () => {
        // The milestone's central promise, visible in a spreadsheet: the 40%
        // agreement covered the first week and the 50% one covers the rest, and
        // no row was re-resolved from today's configuration.
        const { header, settlementRows: rows } = await okExport(fixture.managerToken, wholeMonth());
        const applied = new Set(cellsOf(header, rows, 'درصد سهم اعمال‌شده (در ده‌هزار)'));

        expect(applied).toEqual(new Set(['4000', '5000']));
      });

      it('says whose statement it is, on every row, and names no family or child', async () => {
        const therapist = await harness.prisma.therapist.findFirstOrThrow({
          where: { id: fixture.therapistId },
        });
        const { header, rows } = await okExport(fixture.managerToken, wholeMonth());

        expect(cellsOf(header, rows, 'درمانگر')).toEqual(rows.map(() => therapist.fullName));
        expect(cellsOf(header, rows, 'شناسهٔ درمانگر')).toEqual(
          rows.map(() => fixture.therapistId),
        );

        // A settlement is work and money between the clinic and one therapist.
        expect(header.join(' ')).not.toMatch(/خانواده|کودک|سرپرست|والد/);
      });
    });

    describe('the values a settlement file may not misstate', () => {
      it('keeps a clinic subsidy negative, unclamped and unguarded', async () => {
        // The clinic bore 200,000 of a concession against its own 125,000 gross
        // share. CLAUDE.md requires the subsidy to be VISIBLE, and a spreadsheet
        // has to be able to SUM it — so the cell is `-75000` and carries no
        // apostrophe, which would make it text.
        const screen = await statement();
        const {
          header,
          settlementRows: rows,
          response,
        } = await okExport(fixture.managerToken, wholeMonth());

        const chargeIds = cellsOf(header, rows, 'شناسهٔ هزینهٔ جلسه');
        const index = chargeIds.indexOf(fixture.subsidised.chargeId);
        expect(index).toBeGreaterThanOrEqual(0);

        const clinicNet = cellsOf(header, rows, 'سهم خالص کلینیک (تومان) — می‌تواند منفی باشد')[
          index
        ];
        expect(clinicNet).toBe('-75000');
        expect(clinicNet).toBe(screen.lines[index]?.clinicNetToman);
        expect(response.text).not.toContain("'-75000");

        // And the therapist keeps their whole share of that session: a therapist
        // net is never negative and is never funded by the clinic's concession.
        expect(cellsOf(header, rows, 'سهم خالص درمانگر (تومان)')[index]).toBe('125000');
      });

      it('exports a FREE session as the rated zero it is, and never as an exception', async () => {
        const {
          header,
          settlementRows: rows,
          exceptionRows,
        } = await okExport(fixture.managerToken, wholeMonth());
        const index = cellsOf(header, rows, 'شناسهٔ هزینهٔ جلسه').indexOf(fixture.free.chargeId);

        expect(index).toBeGreaterThanOrEqual(0);
        expect(cellsOf(header, rows, 'مبلغ پایهٔ جلسه (تومان)')[index]).toBe('0');
        expect(cellsOf(header, rows, 'سهم خالص درمانگر (تومان)')[index]).toBe('0');
        // It is RATED, which is what distinguishes it from the unrated session
        // below: complimentary work is work.
        expect(cellsOf(header, rows, 'نحوهٔ ثبت سهم')[index]).toBe('AUTOMATIC');

        // And it is NOT counted as something the file left out: the two
        // exception rows are the two EXCLUSIONS, and a free session is present.
        expect(exceptionRows.map((row) => row[0])).toEqual([
          'EXCLUDED_UNRATED',
          'EXCLUDED_UNCHARGED_COMPLETED',
        ]);
      });

      it('emits no financial row for an unrated session, and never a row of zeroes', async () => {
        // The one confusion that quietly under-pays somebody: a session nobody
        // has decided the share for is NOT a session worth nothing. It is
        // COUNTED on an exception row and given no financial row of any kind.
        const screen = await statement();
        const { header, rows, settlementRows, unratedCell } = await okExport(
          fixture.managerToken,
          wholeMonth(),
        );

        expect(screen.exceptions.unratedSessionCount).toBeGreaterThan(0);
        expect(unratedCell).toBe(String(screen.exceptions.unratedSessionCount));
        expect(cellsOf(header, settlementRows, 'شناسهٔ هزینهٔ جلسه')).not.toContain(
          fixture.unrated.chargeId,
        );
        // Not anywhere in the bytes, under any column: an exception row names no
        // session, it counts them.
        expect(rows.flat()).not.toContain(fixture.unrated.chargeId);
        expect(settlementRows).toHaveLength(screen.lines.length);
      });

      it('leaves another therapist sessions out of this therapist file', async () => {
        const { header, settlementRows: rows } = await okExport(fixture.managerToken, wholeMonth());

        expect(cellsOf(header, rows, 'شناسهٔ هزینهٔ جلسه')).not.toContain(
          fixture.otherTherapist.chargeId,
        );
      });

      it('uses settlement vocabulary and never a payout, debt or balance word', async () => {
        // Milestone 8 records no therapist payout at all, so nothing in this
        // system could ever decrease such a figure. A column named for one would
        // be read as a debt the clinic is running up.
        const { header, response } = await okExport(fixture.managerToken, wholeMonth());
        const headings = header.join(' ');

        expect(headings).not.toMatch(/بدهی|مانده|قابل پرداخت|پرداختنی|دریافتنی|طلب|پرداخت‌شده/);
        expect(headings).toContain('تسویه‌شده در دورهٔ بسته‌شده');
        // The heading is the only place a spreadsheet can be told what
        // «تسویه‌شده» means, because a CSV is read beside no screen.
        expect(headings).toContain('پرداخت به درمانگر نیست');
        // And the file claims nothing a receipt would claim.
        expect(response.text).not.toMatch(/رسید|صورت‌?حساب|گواهی|سند پرداخت/);
      });
    });

    describe('a detached file cannot falsely appear complete', () => {
      it('states both exclusions, with the statement own counts, on rows of their own kind', async () => {
        // The frozen owner decision: a CSV opened away from the interface has to
        // carry the authoritative exception information itself, because the
        // screen is where it otherwise lives.
        const screen = await statement();
        const { exceptionRows, unratedCell, unchargedCell } = await okExport(
          fixture.managerToken,
          wholeMonth(),
        );

        expect(exceptionRows).toHaveLength(2);
        expect(unratedCell).toBe(String(screen.exceptions.unratedSessionCount));
        expect(unchargedCell).toBe(String(screen.exceptions.unchargedCompletedSessionCount));
        // The fixture genuinely contains one of each, so these are not two zeroes
        // agreeing with two zeroes.
        expect(screen.exceptions.unratedSessionCount).toBe(1);
        expect(screen.exceptions.unchargedCompletedSessionCount).toBe(1);
      });

      it('carries no money whatsoever on an exception row, and no zero either', async () => {
        // A count is not a figure. A `0` in a money column would say somebody
        // decided the session was worth nothing, which is the exact opposite of
        // what an unrated session means.
        const { header, exceptionRows } = await okExport(fixture.managerToken, wholeMonth());

        const moneyColumns = header.filter((heading) => heading.includes('(تومان)'));
        expect(moneyColumns.length).toBeGreaterThan(0);

        for (const heading of moneyColumns) {
          expect(cellsOf(header, exceptionRows, heading)).toEqual(['', '']);
        }

        // Nor any session identity, percentage or date: an exception row counts
        // sessions, it does not name them.
        for (const heading of [
          'شناسهٔ ثبت سهم جلسه',
          'شناسهٔ هزینهٔ جلسه',
          'تاریخ جلسه',
          'درصد سهم اعمال‌شده (در ده‌هزار)',
          'نوع سطر',
        ]) {
          expect(cellsOf(header, exceptionRows, heading)).toEqual(['', '']);
        }

        // It does say whose statement it belongs to, as every row of this file
        // does.
        expect(new Set(cellsOf(header, exceptionRows, 'شناسهٔ درمانگر'))).toEqual(
          new Set([fixture.therapistId]),
        );
      });

      it('says so even when the range settled nothing at all', async () => {
        // The failure this decision closes, made concrete: a week whose only two
        // completed sessions carry no valid charge produces NO settlement rows.
        // Without the exception rows the file would be indistinguishable from a
        // week in which the therapist did not work.
        await voidChargeOverHttp(harness, fixture.managerToken, fixture.subsidised.chargeId).expect(
          200,
        );

        const week = { therapistId: fixture.therapistId, from: WEEK_THREE, to: WEEK_THREE };
        const screenResponse = await statementOverHttp(harness, fixture.managerToken, week);
        expect(screenResponse.status).toBe(200);
        const screen = settlementStatementResponseSchema.parse(screenResponse.body);

        const { settlementRows, exceptionRows, unratedCell, unchargedCell } = await okExport(
          fixture.managerToken,
          week,
        );

        expect(screen.lines).toHaveLength(0);
        expect(settlementRows).toHaveLength(0);
        expect(exceptionRows).toHaveLength(2);
        expect(unchargedCell).toBe(String(screen.exceptions.unchargedCompletedSessionCount));
        expect(unchargedCell).toBe('2');
        expect(unratedCell).toBe('0');
      });

      it('keeps the exclusions and the lines in one snapshot, and the file deterministic', async () => {
        const first = await okExport(fixture.managerToken, wholeMonth());
        const second = await okExport(fixture.managerToken, wholeMonth());

        expect(second.response.text).toBe(first.response.text);
        // Every row has the same field count, the exception rows included, so
        // the file stays ordinary CSV that a spreadsheet opens without a wizard.
        expect(first.rows.every((row) => row.length === first.header.length)).toBe(true);
      });
    });

    describe('the audit trail, which records the act and never its contents', () => {
      it('writes exactly one row for one successful export, and none for a read', async () => {
        await statement();
        await statement();
        expect(await exportAudits()).toHaveLength(0);

        await okExport(fixture.managerToken, wholeMonth());

        const rows = await exportAudits();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.entityType).toBe('report');
        // An export changes no row and therefore names none.
        expect(rows[0]?.entityId).toBeNull();
        expect(rows[0]?.actorUserId).toBe(fixture.managerId);
        expect(rows[0]?.before).toBeNull();
        expect(rows[0]?.after).toBeNull();
      });

      it('records the scope of the act: surface, format, range, basis, filter, row count', async () => {
        const screen = await statement();
        await okExport(fixture.managerToken, wholeMonth());

        const [row] = await exportAudits();

        // `rowCount` is what it has always been — the count of lines the caller
        // received — which is now the settlement lines plus the two exception
        // rows every file carries. It is a COUNT OF ROWS and not a copy of the
        // exception counts: the payload gains no key, and the two numbers the
        // file states are not separately recoverable from it.
        expect(row?.metadata).toEqual({
          report: 'SETTLEMENT_STATEMENT',
          format: 'CSV',
          range: { from: WEEK_ONE, to: WEEK_THREE, dateBasis: 'SESSION_DATE' },
          filters: { therapistId: fixture.therapistId },
          rowCount: screen.lines.length + 2,
        });
      });

      it('records no value from the file: no name, no percentage, no amount', async () => {
        const therapist = await harness.prisma.therapist.findFirstOrThrow({
          where: { id: fixture.therapistId },
        });

        await okExport(fixture.managerToken, wholeMonth());

        const [row] = await exportAudits();
        const serialised = JSON.stringify(row?.metadata);

        // All of these are in the file, and none of them may be in an
        // append-only table that keeps them for ever.
        expect(serialised).not.toContain(therapist.fullName);
        expect(serialised).not.toContain('4000');
        expect(serialised).not.toContain('5000');
        expect(serialised).not.toContain('250000');
        expect(serialised).not.toContain('-75000');
        expect(serialised).not.toContain(fixture.familyId);
        // Nor is any exception count copied into it under a name of its own: the
        // payload carries the five accepted keys and nothing else.
        expect(Object.keys(row?.metadata as object).sort()).toEqual([
          'filters',
          'format',
          'range',
          'report',
          'rowCount',
        ]);
        // The therapist id IS recorded: an id is a pointer whose meaning
        // requires the database that issued it, and it is what makes "whose
        // statement left the building?" answerable at all.
        expect(serialised).toContain(fixture.therapistId);
      });
    });

    describe('reading and exporting change nothing', () => {
      it('gives byte-identical files and leaves every financial row untouched', async () => {
        const before = await financialFacts(harness);

        const first = await okExport(fixture.managerToken, wholeMonth());
        await statement();
        const second = await okExport(fixture.managerToken, wholeMonth());

        expect(second.response.text).toBe(first.response.text);
        expect(first.rows.every((row) => row.length === first.header.length)).toBe(true);

        // No rating written, no rating voided, no charge moved, no settlement
        // line materialised, no period closed: an export settles nothing.
        expect(await financialFacts(harness)).toEqual(before);
        // Two exports, two audit rows — the ACT is what is recorded, and it
        // genuinely happened twice.
        expect(await exportAudits()).toHaveLength(2);
      });
    });
  });

  // -------------------------------------------------------------------------
  // A closed period, and a session that lost its value after it closed.
  // -------------------------------------------------------------------------
  describe('against closed settlement history', () => {
    let closeFixture: CloseFixture;

    beforeEach(async () => {
      await resetDatabase(harness.prisma);
      closeFixture = await seedCloseClinic(harness);
    });

    it('states what a closed period carries, and keeps a since-withdrawn session visible', async () => {
      const token = closeFixture.managerToken;

      expect(
        (
          await closePeriodOverHttp(harness, token, {
            therapistId: closeFixture.therapistId,
            ...MONTH_ONE,
          })
        ).status,
      ).toBe(200);

      // The charge is withdrawn AFTER the period closed: the session is worth
      // nothing now, and a closed period nevertheless carries it.
      await voidChargeOverHttp(harness, token, closeFixture.withdrawn.chargeId).expect(200);

      const screenResponse = await statementOverHttp(harness, token, {
        therapistId: closeFixture.therapistId,
        ...MONTH_ONE,
      });
      expect(screenResponse.status).toBe(200);
      const screen = settlementStatementResponseSchema.parse(screenResponse.body);

      const { header, settlementRows: rows } = await okExport(token, {
        therapistId: closeFixture.therapistId,
        ...MONTH_ONE,
      });

      const index = cellsOf(header, rows, 'شناسهٔ هزینهٔ جلسه').indexOf(
        closeFixture.withdrawn.chargeId,
      );
      expect(index).toBeGreaterThanOrEqual(0);

      // Worth nothing now...
      expect(cellsOf(header, rows, 'سهم خالص درمانگر (تومان)')[index]).toBe('0');
      expect(cellsOf(header, rows, 'مبلغ پایهٔ جلسه (تومان)')[index]).toBe('0');
      // ...and a closed period still carries 100,000 of it. Dropping the row
      // would hide the negative correction the next close has to make.
      expect(
        cellsOf(header, rows, 'تسویه‌شده در دورهٔ بسته‌شده (تومان) — پرداخت به درمانگر نیست')[
          index
        ],
      ).toBe('100000');
      expect(
        cellsOf(header, rows, 'تسویه‌شده در دورهٔ بسته‌شده (تومان) — پرداخت به درمانگر نیست'),
      ).toEqual(screen.lines.map((line) => line.settledToman));

      // Every row of this file is the session's CURRENT position; a carried-in
      // correction is a fact of the PERIOD that carried it, not a second row
      // here.
      expect(new Set(cellsOf(header, rows, 'نوع سطر'))).toEqual(new Set(['PRIMARY']));
    });

    it('excludes an unrated session from the financial rows and COUNTS it, as the close did', async () => {
      const token = closeFixture.managerToken;
      const period = { therapistId: closeFixture.therapistId, ...MONTH_ONE };

      const screenResponse = await statementOverHttp(harness, token, period);
      expect(screenResponse.status).toBe(200);
      const screen = settlementStatementResponseSchema.parse(screenResponse.body);

      const { header, rows, settlementRows, unratedCell } = await okExport(token, period);

      // No share rule covered its day, so nobody ever decided its share. It is
      // absent from the financial rows and it is not a zero-valued one...
      expect(cellsOf(header, settlementRows, 'شناسهٔ هزینهٔ جلسه')).not.toContain(
        closeFixture.unrated.chargeId,
      );
      expect(rows.flat()).not.toContain(closeFixture.unrated.chargeId);
      // ...and the file says so, which is the same fact a close records
      // permanently as `excludedUnratedSessionCount`.
      expect(unratedCell).toBe(String(screen.exceptions.unratedSessionCount));
      expect(unratedCell).toBe('1');
    });
  });
});

/**
 * Every settlement fact in the database, as a comparable snapshot.
 *
 * READ FROM THE TABLES rather than from any response: the claim is that an
 * export mutates NO financial history, and only the rows themselves can settle
 * that.
 */
async function financialFacts(harness: Harness) {
  const [ratings, charges, adjustments, lines, periods] = await Promise.all([
    harness.prisma.sessionSettlement.findMany({ orderBy: { id: 'asc' } }),
    harness.prisma.sessionCharge.findMany({ orderBy: { id: 'asc' } }),
    harness.prisma.chargeAdjustment.findMany({ orderBy: { id: 'asc' } }),
    harness.prisma.settlementLine.findMany({ orderBy: { id: 'asc' } }),
    harness.prisma.settlementPeriod.findMany({ orderBy: { id: 'asc' } }),
  ]);

  return JSON.parse(
    JSON.stringify({ ratings, charges, adjustments, lines, periods }, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  ) as unknown;
}
