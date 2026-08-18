/**
 * THE ONE PLACE THIS SYSTEM TURNS REPORT ROWS INTO A CSV FILE.
 *
 * It is a FORMATTER AND NOTHING ELSE (Milestone 7, checkpoint C5). Nothing here
 * reads a table, sums a column, derives a status, compares a date or converts a
 * currency: every value it writes is a string that a report service already put
 * on the wire, and a column is a projection of one field of one frozen row
 * shape. That is the whole defence against the failure this checkpoint is most
 * exposed to — a second reporting implementation that agrees with the screen on
 * the day it is written and drifts the first time either side is corrected.
 *
 * WHY THE BYTES LOOK LIKE THIS. The file is opened by a clinic manager in a
 * Persian Windows spreadsheet, and every choice below is made for that reader:
 *
 *   * A UTF-8 BYTE ORDER MARK. Excel does not detect UTF-8 in a `.csv` without
 *     one: the Persian column headers and every family name open as mojibake,
 *     and the reader's only recourse is an import wizard they should not need.
 *     The BOM costs three bytes and is ignored by every other consumer worth
 *     supporting. This is the single most important line in the file.
 *   * CRLF LINE ENDINGS, which is what RFC 4180 specifies and what the oldest
 *     spreadsheet on the clinic's oldest machine expects.
 *   * EVERY FIELD QUOTED, ALWAYS, with an embedded quote doubled. Unconditional
 *     quoting makes the output deterministic — a value's own punctuation cannot
 *     change the shape of the line it is on — and it removes the whole class of
 *     bug where a comma inside a family name silently splits a row.
 *   * A COMMA DELIMITER, and this is the one real trade-off in the file. Excel
 *     splits a `.csv` on the WINDOWS LIST SEPARATOR of the reader's locale, not
 *     on the comma, so a machine configured with a semicolon separator will open
 *     these files in a single column until the reader imports them or changes
 *     the setting. The alternatives are worse: a `sep=,` preamble is a
 *     Microsoft extension that every other CSV parser reads as a data row, and
 *     picking the semicolon would break the standard-conforming consumers to
 *     please one configuration of one product. RFC 4180 is what the rest of the
 *     world can read, so RFC 4180 is what is written. See the C5 report.
 *   * ASCII DIGITS EVERYWHERE, never Persian-Indic ones. The interface renders
 *     Persian digits because a person is reading them; a spreadsheet has to
 *     PARSE these, and `۱۲۳۴` is text in every cell it lands in. Money is
 *     therefore written exactly as the wire carries it — a plain integer string
 *     of whole toman, with no separator, no symbol and no decimal point — which
 *     is the canonical representation and not a second one.
 *
 * SPREADSHEET FORMULA INJECTION IS DEFENDED PER COLUMN, NOT GLOBALLY. A cell
 * whose text begins with `=`, `+`, `-`, `@`, a tab or a carriage return is
 * executed as a formula by Excel and LibreOffice when the file is opened, even
 * from inside quotes. The guard here is applied ONLY to columns declared
 * `freeText` — the values a family, a colleague or a catalogue entry supplied —
 * and prefixes them with an apostrophe, which those products consume as "this is
 * text". It is deliberately NOT applied to the server's own values: an amount,
 * a count, a date, an enum and a uuid must stay machine-parseable, none of them
 * can begin with a dangerous character (every amount in this system is
 * unsigned), and mutating them to be safe from a risk they do not carry would
 * corrupt the numbers the file exists to deliver.
 *
 * NOTHING IS TRUNCATED AND THERE IS NO ROW CAP, which is why no audit payload in
 * C5 carries a `truncated` flag: a silently shortened financial file is a worse
 * failure than a slow one, and no measured bound exists to justify a number.
 * See `report-export.service.ts` for the size risk this leaves open.
 */

/** One column of one report: a Persian heading and a projection of one row. */
export type CsvColumn<Row> = {
  readonly header: string;
  /**
   * Values a person or a family supplied. Only these are guarded against
   * formula execution, and only these could ever need it.
   */
  readonly freeText?: true;
  readonly value: (row: Row) => string;
};

const BOM = '\uFEFF';
const CRLF = '\r\n';

/** Excel and LibreOffice evaluate a cell beginning with any of these. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * The file, whole, in the column order the caller declared.
 *
 * THE ORDER IS THE ARRAY'S AND IS THEREFORE FIXED IN CODE. A reader who saved
 * last month's export and diffs it against this month's is comparing two files
 * whose columns cannot have moved, and a consumer that indexes by position
 * cannot be broken by a change nobody noticed making.
 *
 * A REPORT WITH NO ROWS IS STILL A FILE, and it is a header line with nothing
 * under it — never an empty file and never an error. An empty report is a
 * successful read everywhere else in Milestone 7 (frozen C1), and a manager who
 * exported a quiet fortnight is entitled to a file that says so.
 */
export function toCsv<Row>(columns: readonly CsvColumn<Row>[], rows: readonly Row[]): string {
  const lines = [columns.map((column) => field(column.header, false)).join(',')];

  for (const row of rows) {
    lines.push(
      columns.map((column) => field(column.value(row), column.freeText === true)).join(','),
    );
  }

  // A trailing CRLF, so every line — the last one included — is terminated
  // rather than merely separated. RFC 4180 permits both; a terminator is what
  // `wc -l` and every line-oriented tool expect.
  return BOM + lines.join(CRLF) + CRLF;
}

function field(value: string, freeText: boolean): string {
  const guarded = freeText && FORMULA_LEAD.test(value) ? `'${value}` : value;

  return `"${guarded.replace(/"/g, '""')}"`;
}

/**
 * A filename for the download, built from ASCII alone.
 *
 * ASCII BECAUSE `Content-Disposition` IS A HEADER. A Persian filename would need
 * RFC 5987 encoding to survive one, and the encodings that products actually
 * implement disagree; a name the browser mangles is worse than a plain one it
 * does not. The Persian is in the file, where a spreadsheet reads it correctly.
 *
 * THE RANGE IS IN THE NAME WHEN THE REPORT HAS ONE, because a manager exporting
 * the same report every month ends up with a folder of them, and the period is
 * the only thing that distinguishes two files of the same report. The
 * family-accounts export has no range and gets no dates: a position is not a
 * period, and inventing "as at today" in a filename would be the first place
 * that idea appeared anywhere in this system.
 */
export function csvFilename(report: string, range: { from: string; to: string } | null): string {
  return range === null ? `${report}.csv` : `${report}-${range.from}-to-${range.to}.csv`;
}
