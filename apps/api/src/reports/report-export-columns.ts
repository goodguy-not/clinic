import type {
  FamilyAccountReportRow,
  PaymentReportRow,
  PromiseReportRow,
  SessionReportRow,
  TherapistActivityRow,
} from '@clinic/contracts';
import type { CsvColumn } from './report-csv';

/**
 * WHAT EACH EXPORTED FILE HAS IN IT — one column list per report, and nothing
 * else in this file.
 *
 * EVERY COLUMN IS A PROJECTION OF ONE FIELD OF THE FROZEN REPORT ROW. There is
 * not one arithmetic operation, comparison, currency conversion, status
 * derivation or date reinterpretation anywhere below: if a value is not already
 * on the wire, it does not appear in a file. That is what makes an export
 * incapable of disagreeing with its report — and the reason a column that needs
 * a calculation is a signal that the calculation belongs in the report, where
 * both surfaces would get it.
 *
 * THE HEADINGS ARE PERSIAN AND THE VALUES ARE NOT. The manager reads the
 * headings, so they are written in the language of the product; the values are
 * the server's own vocabulary — ISO dates, ASCII digits, and the same status
 * words the API returns. That is a deliberate trade-off with a real cost, and it
 * is stated in the C5 report rather than hidden here:
 *
 *   * A STATUS PRINTS AS `COMPLETED` RATHER THAN IN PERSIAN. The Persian labels
 *     live in the web tier, where they belong to the screens that render them;
 *     copying them into NestJS would create a second, silently diverging
 *     vocabulary in the tier that is supposed to have none, and translating in
 *     the API would put product copy where CLAUDE.md keeps it out of. An enum is
 *     at least unambiguous, and it matches the screen's own filter values.
 *   * A DATE PRINTS AS `2026-08-18` RATHER THAN AS A JALALI DAY. The clinic day
 *     is decided in Asia/Tehran by PostgreSQL and travels as an ISO date on the
 *     wire (frozen C1); rendering the Persian calendar is the web tier's, and
 *     adding a calendar conversion to NestJS for a file would make the API a
 *     second place where a date can be turned into the wrong day.
 *
 * MONEY IS THE CANONICAL WIRE VALUE: a plain integer string of whole toman, no
 * separator, no symbol and no decimal point, so a spreadsheet parses it as a
 * number. The unit is in the heading, where it cannot corrupt the cell.
 *
 * THE ROW'S OWN KEY IS EXPORTED; OTHER ENTITIES PRINT BY NAME. A session file
 * carries its appointment and participant ids, a payment file its payment id, a
 * family-accounts file its family id — the identifier of the record the line IS,
 * so a spreadsheet row can be traced back to the fact it came from. The
 * therapist, service, room and child on that line print as the names a person
 * reads, exactly as the report prints them.
 *
 * NO FILE CARRIES A TOTALS LINE. Totals belong to the report, which states them
 * over the whole filtered result; a totals row inside the data breaks sorting
 * and filtering, and a reader who sorted the sheet would find it stranded in the
 * middle of the rows. A spreadsheet adds a column up for itself.
 */

const text = <Row>(header: string, value: (row: Row) => string): CsvColumn<Row> => ({
  header,
  freeText: true,
  value,
});

const plain = <Row>(header: string, value: (row: Row) => string): CsvColumn<Row> => ({
  header,
  value,
});

const count = <Row>(header: string, value: (row: Row) => number): CsvColumn<Row> => ({
  header,
  value: (row) => String(value(row)),
});

/**
 * Sessions: the operational file, and there is NO MONEY IN IT.
 *
 * No price, no tariff, no charge and no "was this billed?" flag — the report
 * carries none (it is readable under the diary authority precisely because it
 * carries none), and a file is not a reason to add one.
 */
export const SESSION_EXPORT_COLUMNS: readonly CsvColumn<SessionReportRow>[] = [
  plain('تاریخ جلسه', (row) => row.date),
  plain('زمان شروع (UTC)', (row) => row.startsAt),
  count('مدت (دقیقه)', (row) => row.durationMinutes),
  plain('وضعیت نوبت', (row) => row.status),
  plain('حضور', (row) => row.attendance),
  text('خانواده', (row) => row.family.familyName),
  text('نام کودک', (row) => row.child.firstName),
  text('نام خانوادگی کودک', (row) => row.child.lastName),
  text('شمارهٔ پرونده', (row) => row.child.fileNumber),
  text('درمانگر', (row) => row.therapist.fullName),
  text('خدمت', (row) => row.service.name),
  text('اتاق', (row) => row.room.name),
  plain('شناسهٔ نوبت', (row) => row.appointmentId),
  plain('شناسهٔ حضور در نوبت', (row) => row.participantId),
];

/**
 * Promises: each promise's own agreed amount, and NO TOTAL OF THEM ANYWHERE.
 *
 * A promise moves no money in any state (CLAUDE.md). The heading says so,
 * because a column of amounts in a spreadsheet is exactly where somebody would
 * sum them and read the result as money the clinic is owed.
 */
export const PROMISE_EXPORT_COLUMNS: readonly CsvColumn<PromiseReportRow>[] = [
  plain('تاریخ سررسید', (row) => row.dueOn),
  text('خانواده', (row) => row.family.familyName),
  plain('مبلغ همان قول (تومان) — بدهی نیست', (row) => row.amountToman),
  plain('وضعیت', (row) => row.status),
  plain('زمان ثبت (UTC)', (row) => row.createdAt),
  plain('زمان تعیین تکلیف (UTC)', (row) => row.resolvedAt ?? ''),
  plain('شناسهٔ قول', (row) => row.id),
];

/**
 * Therapist activity: counts and minutes, and NOT ONE FIELD OF MONEY.
 *
 * No share, no percentage, no session value and no rate. Settlement rules are
 * unapproved (CLAUDE.md), and a column here would be half of one, published in a
 * spreadsheet where somebody would supply the other half with a multiplication.
 */
export const THERAPIST_ACTIVITY_EXPORT_COLUMNS: readonly CsvColumn<TherapistActivityRow>[] = [
  text('درمانگر', (row) => row.therapist.fullName),
  count('برنامه‌ریزی‌شده', (row) => row.scheduledCount),
  count('تکمیل‌شده', (row) => row.completedCount),
  count('لغوشده', (row) => row.cancelledCount),
  count('حاضر', (row) => row.attendedCount),
  count('غایب', (row) => row.noShowCount),
  count('بدون ثبت نتیجه', (row) => row.unresolvedOutcomeCount),
  count('دقیقهٔ حضور', (row) => row.attendedDurationMinutes),
];

/**
 * Payments: the money that arrived, keyed on the day it ARRIVED.
 *
 * `تاریخ دریافت وجه` IS `receivedOn` AND THE ENTRY INSTANT IS A SEPARATE COLUMN,
 * so a back-dated payment cannot be read as belonging to the day it was typed
 * in. Both are present because a reconciliation asks both questions.
 *
 * NO BANK REFERENCE AND NO NOTE (frozen C1): a banking identifier, and free text
 * a family may be described in, have no business in a file that leaves the
 * clinic.
 */
export const PAYMENT_EXPORT_COLUMNS: readonly CsvColumn<PaymentReportRow>[] = [
  plain('تاریخ دریافت وجه', (row) => row.receivedOn),
  text('خانواده', (row) => row.family.familyName),
  plain('مبلغ (تومان)', (row) => row.amountToman),
  plain('روش', (row) => row.method),
  plain('وضعیت', (row) => row.status),
  plain('زمان ثبت در سامانه (UTC)', (row) => row.recordedAt),
  text('ثبت‌کننده', (row) => row.recordedBy.displayName),
  plain('شناسهٔ پرداخت', (row) => row.id),
];

/**
 * Family accounts: each family's WHOLE position, exactly as the report states
 * it.
 *
 * CREDIT AND AMOUNT DUE ARE TWO COLUMNS AND ARE NEVER NETTED. One family's
 * credit does not reduce another's debt, and a single signed "balance" column
 * would be the clinic-wide balance this product does not recognise — in a format
 * where a reader would immediately sum it.
 *
 * THE PROMISE COUNTS SAY IN THEIR HEADINGS THAT THEY REDUCE NOTHING. On the
 * screen that fact is printed beside them; in a spreadsheet the heading is the
 * only place it can be said, and a bare "open promises" column beside an amount
 * due is precisely the pair somebody would subtract.
 *
 * WHAT THIS FILE CANNOT SAY is that these numbers know only what this system
 * holds — no opening balance and no pre-system paper debt (DECISION_LOG,
 * 2026-08-15). A CSV has nowhere to put a disclosure that is not a column, and a
 * note row would corrupt the table. It is stated on the screen the file is taken
 * from, and it is recorded as a risk in the C5 report.
 */
export const FAMILY_ACCOUNT_EXPORT_COLUMNS: readonly CsvColumn<FamilyAccountReportRow>[] = [
  text('خانواده', (row) => row.family.familyName),
  plain('مبلغ خالص بدهکارشده (تومان)', (row) => row.position.netChargedTotalToman),
  plain('جمع پرداخت تأییدشده (تومان)', (row) => row.position.confirmedPaymentTotalToman),
  plain('مبلغ قابل پرداخت (تومان)', (row) => row.position.amountDueToman),
  plain('اعتبار خانواده (تومان)', (row) => row.position.creditToman),
  count('تعداد پرداخت', (row) => row.position.paymentCount),
  count('تعداد پرداخت باطل‌شده', (row) => row.position.voidedPaymentCount),
  plain('تاریخ آخرین پرداخت', (row) => row.position.lastPayment?.receivedOn ?? ''),
  plain('مبلغ آخرین پرداخت (تومان)', (row) => row.position.lastPayment?.amountToman ?? ''),
  count('قول باز — کاهندهٔ بدهی نیست', (row) => row.position.openPromiseCount),
  count('قول سررسیدگذشته — کاهندهٔ بدهی نیست', (row) => row.position.missedPromiseCount),
  plain('شناسهٔ خانواده', (row) => row.family.id),
];
