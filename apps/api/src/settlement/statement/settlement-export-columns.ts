import type { SettlementStatementExceptions, SettlementStatementLine } from '@clinic/contracts';
import type { CsvColumn } from '../../reports/report-csv';

/**
 * WHAT THE SETTLEMENT STATEMENT FILE HAS IN IT (Milestone 8, checkpoint C8).
 *
 * EVERY COLUMN IS A PROJECTION OF ONE FIELD OF THE FROZEN STATEMENT RESPONSE.
 * There is not one arithmetic operation, comparison, currency conversion,
 * percentage resolution or date reinterpretation below: if a value is not
 * already on the wire in `settlementStatementLineSchema` or
 * `settlementStatementExceptionsSchema`, it does not appear in the file. The
 * file is a second REPRESENTATION of the C5/C6 read, never a second calculation
 * of it — which is the failure this checkpoint exists to avoid, because a
 * settlement figure that disagreed with the screen would be discovered by the
 * therapist holding the printout.
 *
 * IT LIVES IN THE SETTLEMENT MODULE RATHER THAN BESIDE THE FIVE MILESTONE 7
 * COLUMN LISTS, for the reason the route does: the read model this projects is
 * this module's, and the product vocabulary below — سهم, تخفیف, دورهٔ بسته‌شده —
 * is settlement's own. `reports/report-export-columns.ts` keeps the five lists
 * whose read models live in `ReportsModule`; the shared machinery is
 * `report-csv.ts` and `csv-export.ts`, and that is all either side borrows.
 *
 * THE HEADINGS ARE PERSIAN AND THE VALUES ARE NOT, exactly as the Milestone 7
 * files are: ISO dates, ASCII digits, and the server's own enum words. The C5
 * trade-off is unchanged and is not restated here.
 *
 * ------------------------------------------------------------------------
 * THE FILE HAS TO BE TRUE ON ITS OWN, WHICH IS WHY IT HAS TWO KINDS OF ROW.
 *
 * A CSV is opened months later beside no screen at all, and the screen is where
 * the excluded sessions are stated. A file of settlement lines alone would
 * therefore be READ AS COMPLETE by a manager whose month contains three sessions
 * nobody has rated — the money would add up, every identity would hold, and the
 * three sessions would simply not be there. That is the one way this export
 * could mislead without a single wrong figure in it, and it is the frozen owner
 * decision this file answers.
 *
 * SO `نوع رکورد` IS THE FIRST COLUMN AND EVERY ROW DECLARES WHAT IT IS:
 *
 *   * `SETTLEMENT_LINE` — one rated session and what each side of it was worth.
 *   * `EXCLUDED_UNRATED` — how many VALID CHARGES in this range carry no standing
 *     rating. There is a basis to settle from and nobody has decided the share.
 *   * `EXCLUDED_UNCHARGED_COMPLETED` — how many completed, attended seats carry
 *     no valid charge at all, so there is no basis to settle from.
 *
 * THE TWO EXCEPTION ROWS ARE ALWAYS WRITTEN, INCLUDING WHEN THEY COUNT ZERO, and
 * that is deliberate. A file that omitted them when there was nothing to say
 * would leave a reader unable to tell "this range excluded nothing" from "this
 * export does not report exclusions", which is exactly the ambiguity the
 * decision closes. It also means an empty range is a file that SAYS it is empty
 * rather than a header with nothing under it.
 *
 * THEY CARRY A COUNT AND NOT ONE UNIT OF MONEY. Every money cell on an exception
 * row is EMPTY — not `0`, which would state that somebody decided the session
 * was worth nothing, and not a total, which the file does not carry for any row.
 * An unrated session is the absence of a decision, and folding it into the money
 * as a zero is the one confusion that quietly under-pays somebody.
 *
 * A `FREE` SESSION IS NOT AN EXCEPTION AND HAS NO ROW HERE. It is RATED and it is
 * SETTLED, at zero, so it is an ordinary `SETTLEMENT_LINE` of zeroes:
 * complimentary work is work. The statement counts free sessions separately for
 * the screen's benefit — to explain why the session count and the money do not
 * track — but nothing about a free session is missing from this file, and giving
 * it an "excluded" row would say that something was.
 *
 * THE EXCEPTION ROWS SORT AND FILTER LIKE ORDINARY DATA, which is why they are
 * rows with a kind column rather than the two shapes a CSV cannot carry: a
 * preamble line above the header makes the file unparseable by every ordinary
 * reader, and a trailing note row is a data row that is not data, stranded among
 * the sessions the moment somebody sorts the sheet. The kind column is the first
 * thing a reader sees and the first thing a filter can select on.
 * ------------------------------------------------------------------------
 * WHAT THIS FILE MAY NOT SAY, WHICH IS AS LOAD-BEARING AS WHAT IT DOES.
 *
 * NO «بدهی», «قابل پرداخت», «پرداختنی», «دریافتنی» OR «مانده» COLUMN EXISTS, and
 * none may ever be added here. Milestone 8 records no therapist payout at all —
 * no payment out, no ledger, no position — so nothing in this system could ever
 * decrease such a figure, and a spreadsheet column named for one would be read
 * by the first person who saw it as a debt the clinic is running up. «تسویه‌شده»
 * in the heading below means "carried by a closed period", never "paid", and the
 * heading says so in the file because a CSV is read months later beside no
 * screen at all — the same reason the family-accounts file carries its scope.
 *
 * NO FAMILY, CHILD OR GUARDIAN APPEARS, because the statement carries none
 * (frozen C1). The arithmetic of a settlement is checkable without a roster of
 * children, and a roster printed onto a file that leaves the building would be a
 * disclosure nobody asked for. THE EXCEPTION ROWS NAME NO SESSION EITHER: they
 * are the counts the statement states, and identifying the individual unrated
 * sessions would be a read this milestone has never performed.
 *
 * THE ONE PERSON WHO DOES APPEAR IS THE THERAPIST THE STATEMENT IS ABOUT, ON
 * EVERY ROW OF BOTH KINDS. The response states them once, in a header a CSV has
 * nowhere to put — and a manager who exports three colleagues in one sitting
 * otherwise holds three files of money with nothing in them to tell the three
 * apart, since the ASCII filename carries a period and no name. It is the same
 * denormalisation every Milestone 7 file makes. The value is a constant per file
 * and no reader may take a difference between two rows to mean anything.
 *
 * NO TOTALS ROW. Totals belong to the read, which states every one of them over
 * the whole range; a totals row inside the data breaks sorting and is stranded
 * the moment a reader sorts the sheet (the M7 rule, unchanged). An EXCEPTION row
 * is not a totals row: it carries no money at all, and it states a fact that
 * exists nowhere else in the file rather than a sum of the rows above it.
 *
 * A SIGNED VALUE KEEPS ITS SIGN AND IS NEVER CLAMPED. `سهم خالص کلینیک` goes
 * negative whenever the clinic explicitly bears a concession larger than its own
 * gross share, and CLAUDE.md requires that subsidy to be VISIBLE; `تسویه‌شده`
 * carries the sign the closed lines carry. Neither is guarded against formula
 * execution, and that is deliberate: a leading `-` on a number is a number to
 * every spreadsheet, and an apostrophe in front of it would turn the one figure
 * a manager must be able to sum into text (`report-csv.ts`).
 * ------------------------------------------------------------------------
 */

/** Whose statement it is, on every row of both kinds. */
type TherapistSummary = { readonly id: string; readonly fullName: string };

/**
 * The two things a settlement file states, as two kinds of row.
 *
 * NEITHER IS DERIVED HERE. A `SETTLEMENT_LINE` is one frozen statement line and
 * an exception row is one frozen exception count, both read once per export by
 * the statement service itself; the therapist is the summary the response
 * already carries, copied down so a flat file can say what a header would.
 */
export type SettlementStatementExportRow =
  | {
      readonly kind: 'SETTLEMENT_LINE';
      readonly therapist: TherapistSummary;
      readonly line: SettlementStatementLine;
    }
  | {
      readonly kind: 'EXCLUDED_UNRATED' | 'EXCLUDED_UNCHARGED_COMPLETED';
      readonly therapist: TherapistSummary;
      readonly sessionCount: number;
    };

/**
 * The two exception rows of one statement, in the order the statement states
 * them, and ALWAYS BOTH.
 *
 * `freeSessionCount` IS DELIBERATELY NOT AMONG THEM. A free session is present
 * in this file as the rated zero-value line it genuinely is, so an "excluded"
 * row for it would claim something is missing that is not.
 */
export function exceptionRows(
  therapist: TherapistSummary,
  exceptions: SettlementStatementExceptions,
): readonly SettlementStatementExportRow[] {
  return [
    { kind: 'EXCLUDED_UNRATED', therapist, sessionCount: exceptions.unratedSessionCount },
    {
      kind: 'EXCLUDED_UNCHARGED_COMPLETED',
      therapist,
      sessionCount: exceptions.unchargedCompletedSessionCount,
    },
  ];
}

const text = (
  header: string,
  value: (row: SettlementStatementExportRow) => string,
): CsvColumn<SettlementStatementExportRow> => ({ header, freeText: true, value });

/**
 * A column of the settlement line, EMPTY on an exception row.
 *
 * Empty and never `0`: a blank cell is "this row is not a session", while a zero
 * in a money column is a figure somebody decided.
 */
const plain = (
  header: string,
  value: (line: SettlementStatementLine) => string,
): CsvColumn<SettlementStatementExportRow> => ({
  header,
  value: (row) => (row.kind === 'SETTLEMENT_LINE' ? value(row.line) : ''),
});

const count = (
  header: string,
  value: (line: SettlementStatementLine) => number,
): CsvColumn<SettlementStatementExportRow> => ({
  header,
  value: (row) => (row.kind === 'SETTLEMENT_LINE' ? String(value(row.line)) : ''),
});

/**
 * One rated session per `SETTLEMENT_LINE` row, in the statement's own order,
 * followed by the two exception rows.
 *
 * `نوع سطر` IS CARRIED THOUGH EVERY SETTLEMENT ROW OF THIS FILE READS `PRIMARY`.
 * The read is keyed on `SESSION_DATE`, so every line states its session's CURRENT
 * authoritative position and a correction to it is a change to that same session
 * rather than a second row (C6). The column says which kind of LINE the reader is
 * holding, which is a different question from `نوع رکورد` — one distinguishes a
 * primary position from a carried-in correction, the other distinguishes a
 * session from an exclusion, and collapsing them into one column would mean an
 * eventual `CORRECTION` had to share a column with `EXCLUDED_UNRATED`.
 * `correctsSessionSettlementId` is NOT carried beside it: it is null on every row
 * this read can produce, and a column that could only ever be empty invites the
 * reader to conclude something from its emptiness.
 *
 * THE PERCENTAGE THAT APPLIED TRAVELS WITH EVERY ROW, in basis points as the
 * snapshot stores it. A settlement figure whose percentage is discoverable only
 * by opening another screen is a figure the therapist has to take on trust — and
 * it is the SNAPSHOT, never a rule resolved today, which is why one file may
 * legitimately show two different percentages for one therapist.
 *
 * THE IDS COME LAST. The rating is what the row IS, the charge is what it
 * prices, and the therapist is whose statement it is; all three are exported so
 * a spreadsheet line can be traced back to the facts it came from, and all three
 * are opaque pointers rather than anything about a person. An exception row
 * carries the therapist alone, because it names no session.
 */
export const SETTLEMENT_STATEMENT_EXPORT_COLUMNS: readonly CsvColumn<SettlementStatementExportRow>[] =
  [
    // FIRST, so a reader knows what kind of row they are holding before they read
    // anything on it — and so a file that excludes sessions says so in its own
    // first column rather than only on a screen the reader does not have.
    { header: 'نوع رکورد', value: (row) => row.kind },
    // SECOND, so a file read months later says whose settlement it is before it
    // says a single figure. The name is a person's own text and is therefore
    // guarded against formula execution; the id at the end is the fact.
    text('درمانگر', (row) => row.therapist.fullName),
    // THIRD, and populated ONLY on an exception row: the number of sessions this
    // range excluded from every financial figure in the file, for the reason the
    // row's kind names. A settlement row leaves it empty.
    {
      header: 'تعداد جلسه‌های کنارگذاشته‌شده از ارقام مالی (فقط در سطر استثنا)',
      value: (row) => (row.kind === 'SETTLEMENT_LINE' ? '' : String(row.sessionCount)),
    },
    plain('تاریخ جلسه', (line) => line.serviceDate),
    text('خدمت', (row) => (row.kind === 'SETTLEMENT_LINE' ? row.line.serviceName : '')),
    count('مدت (دقیقه)', (line) => line.durationMinutes),
    // THE ONLY FACT THAT SEPARATES A COMPLIMENTARY SESSION FROM ONE DISCOUNTED
    // TO NOTHING, both of which are a row of noughts. The screen states it from
    // the charge's own tariff price mode and a file is read months later beside
    // no screen at all, so testing a money cell against zero in a spreadsheet
    // would be a second and wrong source of truth. UNRATED is not here: it has
    // no settlement row and is carried by the exception rows instead.
    plain('نوع قیمت جلسه', (line) => line.priceMode),
    plain('نوع سطر', (line) => line.lineType),
    plain('درصد سهم اعمال‌شده (در ده‌هزار)', (line) => String(line.appliedShareBasisPoints)),
    plain('نحوهٔ ثبت سهم', (line) => line.ratedVia),
    plain('مبلغ پایهٔ جلسه (تومان)', (line) => line.baseAmountToman),
    plain('سهم ناخالص درمانگر (تومان)', (line) => line.therapistGrossToman),
    plain('تخفیف به عهدهٔ درمانگر (تومان)', (line) => line.therapistDiscountToman),
    plain('سهم خالص درمانگر (تومان)', (line) => line.therapistNetToman),
    plain('سهم ناخالص کلینیک (تومان)', (line) => line.clinicGrossToman),
    plain('تخفیف به عهدهٔ کلینیک (تومان)', (line) => line.clinicDiscountToman),
    // The one figure in the file that is legitimately below zero, and the heading
    // says so rather than leaving a reader to suspect a broken export.
    plain('سهم خالص کلینیک (تومان) — می‌تواند منفی باشد', (line) => line.clinicNetToman),
    // «تسویه‌شده» IS "CARRIED BY A CLOSED PERIOD", NOT "PAID", and the heading is
    // the only place a spreadsheet can be told so.
    plain(
      'تسویه‌شده در دورهٔ بسته‌شده (تومان) — پرداخت به درمانگر نیست',
      (line) => line.settledToman,
    ),
    plain('شناسهٔ ثبت سهم جلسه', (line) => line.sessionSettlementId),
    plain('شناسهٔ هزینهٔ جلسه', (line) => line.sessionChargeId),
    { header: 'شناسهٔ درمانگر', value: (row) => row.therapist.id },
  ];
