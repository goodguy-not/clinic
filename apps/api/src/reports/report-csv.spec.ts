import { csvFilename, toCsv, type CsvColumn } from './report-csv';

/**
 * The CSV bytes themselves (Milestone 7, checkpoint C5).
 *
 * EVERYTHING HERE IS SYNTHETIC. No real family, child or amount appears in any
 * fixture in this project.
 *
 * WHAT THIS SUITE IS FOR. The formatter is the one place in the export path
 * where a value can be corrupted without any query being wrong, and the failures
 * it guards against are silent: a Persian heading that opens as mojibake, a
 * comma inside a family name that splits a row, a cell that a spreadsheet
 * executes rather than displays, and an amount mutated by a safety rule that
 * should never have touched it.
 */
type Row = { name: string; amount: string; status: string };

const COLUMNS: readonly CsvColumn<Row>[] = [
  { header: 'خانواده', freeText: true, value: (row) => row.name },
  { header: 'مبلغ (تومان)', value: (row) => row.amount },
  { header: 'وضعیت', value: (row) => row.status },
];

const lines = (csv: string): string[] => csv.replace(/^\uFEFF/, '').split('\r\n');

describe('the report CSV formatter', () => {
  describe('what makes the file open correctly in a Persian spreadsheet', () => {
    it('begins with a UTF-8 byte order mark', () => {
      // Without it Excel does not detect UTF-8 in a .csv, and every Persian
      // heading and family name in the file opens as mojibake.
      expect(toCsv(COLUMNS, [])).toMatch(/^\uFEFF/);
    });

    it('separates and terminates every line with CRLF', () => {
      const csv = toCsv(COLUMNS, [
        { name: 'خانوادهٔ آزمایشی', amount: '1000', status: 'CONFIRMED' },
      ]);

      expect(csv.endsWith('\r\n')).toBe(true);
      expect(csv.includes('\n\r')).toBe(false);
      expect(lines(csv)).toEqual([
        '"خانواده","مبلغ (تومان)","وضعیت"',
        '"خانوادهٔ آزمایشی","1000","CONFIRMED"',
        '',
      ]);
    });

    it('carries Persian text through unchanged, in the heading and in the value', () => {
      const csv = toCsv(COLUMNS, [{ name: 'خانوادهٔ نمونه', amount: '0', status: 'VOIDED' }]);

      expect(csv).toContain('خانواده');
      expect(csv).toContain('خانوادهٔ نمونه');
    });
  });

  describe('escaping, which is what keeps a row a row', () => {
    it('quotes every field, so a value cannot change the shape of its line', () => {
      const csv = toCsv(COLUMNS, [{ name: 'الف', amount: '12', status: 'CONFIRMED' }]);

      expect(lines(csv)[1]).toBe('"الف","12","CONFIRMED"');
    });

    it('survives a comma, a quotation mark and a newline inside one value', () => {
      const csv = toCsv(COLUMNS, [
        { name: 'خانوادهٔ "الف", ب\nپ', amount: '5', status: 'CONFIRMED' },
      ]);

      // The quote is doubled and the whole field stays inside one pair of
      // quotes, which is what an RFC 4180 reader needs to put it back together.
      expect(lines(csv).slice(1).join('\r\n')).toBe('"خانوادهٔ ""الف"", ب\nپ","5","CONFIRMED"\r\n');
    });
  });

  describe('spreadsheet formula execution', () => {
    it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])(
      'neutralises a free-text value beginning with %j',
      (dangerous) => {
        const csv = toCsv(COLUMNS, [{ name: dangerous, amount: '1', status: 'CONFIRMED' }]);

        expect(lines(csv)[1]?.startsWith(`"'${dangerous.replace(/"/g, '""')}`)).toBe(true);
      },
    );

    it('leaves the server’s own values alone, so numbers stay parseable', () => {
      // An amount, a count, a date, an enum and a uuid are not free text: none of
      // them can begin with a dangerous character, and prefixing one would turn
      // a number a manager came for into text a spreadsheet will not sum.
      const csv = toCsv(COLUMNS, [{ name: 'الف', amount: '250000', status: 'CONFIRMED' }]);

      expect(lines(csv)[1]).toBe('"الف","250000","CONFIRMED"');
      expect(csv).not.toContain("'250000");
    });
  });

  describe('the shape of the file', () => {
    it('writes the columns in the declared order and nothing else', () => {
      const csv = toCsv(COLUMNS, [{ name: 'الف', amount: '1', status: 'CONFIRMED' }]);

      expect(lines(csv)[0]).toBe('"خانواده","مبلغ (تومان)","وضعیت"');
    });

    it('answers an empty report with a heading and no rows, never an empty file', () => {
      // An empty report is a successful read everywhere in Milestone 7, and a
      // manager who exported a quiet fortnight is entitled to a file that says so.
      expect(lines(toCsv(COLUMNS, []))).toEqual(['"خانواده","مبلغ (تومان)","وضعیت"', '']);
    });
  });

  describe('the download filename', () => {
    it('carries the period when the report has one', () => {
      expect(csvFilename('payments', { from: '2026-08-01', to: '2026-08-31' })).toBe(
        'payments-2026-08-01-to-2026-08-31.csv',
      );
    });

    it('carries no invented date when the report has no range', () => {
      // A position is not a period: "as at today" would appear here first.
      expect(csvFilename('family-accounts', null)).toBe('family-accounts.csv');
    });
  });
});
