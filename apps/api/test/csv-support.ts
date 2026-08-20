/**
 * Reading back a CSV this system wrote.
 *
 * EVERY FIELD IT WRITES IS QUOTED AND A QUOTE INSIDE ONE IS DOUBLED
 * (`report-csv.ts`), so the reader below is the whole of RFC 4180 this format
 * uses. It is a TEST helper and deliberately not a parser the application owns:
 * nothing in the product ever reads a file back.
 */
export function parseCsv(csv: string): { header: string[]; rows: string[][] } {
  // The BOM is compared by code point rather than written as a literal: an
  // invisible character in a source file is a character somebody deletes.
  if (csv.charCodeAt(0) !== 0xfeff) {
    throw new Error('the file is missing its UTF-8 byte order mark');
  }

  const body = csv.slice(1);
  const lines: string[][] = [];
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
      lines.push(row);
      row = [];
      field = '';
      index += 1;
    } else field += character;
  }

  const [header, ...rest] = lines;

  return { header: header ?? [], rows: rest };
}
