import type { AuditJsonObject, AuditJsonValue } from '../audit/audit.types';

/**
 * THE ONLY PLACE A REPORT EXPORT MAY BUILD AN AUDIT PAYLOAD.
 *
 * An export is the deliberate Milestone 7 exception to "a read writes no audit
 * row" (checkpoint C5): the facts leave the system as a file, the file outlives
 * the session, and nothing in this application can observe it again — so the ACT
 * of taking it is recorded once, at the moment it succeeded.
 *
 * WHAT IS RECORDED IS THE ACT, NEVER THE CONTENTS, AND THE WHOLE FILE EXISTS TO
 * MAKE THAT STRUCTURAL. `audit_log` is append-only and permanent. Copying an
 * exported dataset into it would build a SECOND, UNDELETABLE COPY of exactly the
 * data the clinic was careful about in the first place — every balance, every
 * family name, every amount — kept forever to answer a question that never
 * needed the values: "did somebody take this data out, and what was it about?"
 *
 * SO NOTHING BELOW CAN CARRY A VALUE FROM THE FILE. The payload is assembled
 * from the REQUEST — the surface asked for, the format, the range and its basis,
 * the opaque ids and closed enums the caller filtered by — plus one number the
 * server counted. It is deliberately impossible to pass a row to this function.
 * That rules out, by construction and not by review:
 *
 *   * money — no amount, no total, no balance, no credit, no sum of anything;
 *   * resolved names — no family, child, therapist, service, room or user name;
 *   * personal identifiers — no date of birth, file number, national identifier,
 *     mobile or landline;
 *   * banking values — no reference, and no note;
 *   * free text of any kind.
 *
 * THE FILTERS ARE SAFE TO RECORD BECAUSE THE FROZEN QUERIES CONTAIN NOTHING
 * ELSE. Every Milestone 7 report filter is an opaque entity id, a calendar date
 * or a closed enum (frozen C1 — there is no name search anywhere in reporting,
 * for the reason family search is a POST). An id is a pointer whose meaning
 * requires the database that issued it; a NAME is the personal data itself. That
 * distinction is what makes "which family was this export scoped to?" answerable
 * from the trail without the trail becoming a directory of families.
 *
 * `assertAuditPayloadSafe` STILL RUNS OVER ALL OF IT inside `AuditService`, and
 * the `audit_log` CHECK constraints still stand behind that. This file narrows
 * what is offered; it does not replace the enforcement.
 *
 * THERE IS NO `truncated` KEY, BECAUSE TRUNCATION IS NOT A BEHAVIOUR. No export
 * caps its rows (`report-window.ts`), so a flag saying "this file was complete"
 * would be a constant, and a reviewer would eventually read it as evidence of a
 * check that nothing performs.
 */

/** The five exportable surfaces. Server vocabulary, as audit actions are. */
export const REPORT_EXPORT_SURFACES = [
  'SESSIONS',
  'PROMISES',
  'THERAPIST_ACTIVITY',
  'PAYMENTS',
  'FAMILY_ACCOUNTS',
] as const;

export type ReportExportSurface = (typeof REPORT_EXPORT_SURFACES)[number];

/**
 * What the export was scoped to — the request, restated in the vocabulary the
 * trail is searched in.
 *
 * `range` IS NULL FOR THE REPORT THAT HAS NONE. The family-accounts export takes
 * no period because a position is not a period (frozen C1), and an explicit null
 * says that in the row rather than leaving a reviewer to wonder whether the
 * dates were lost.
 */
export type ReportExportScope = {
  readonly report: ReportExportSurface;
  readonly range: { readonly from: string; readonly to: string; readonly dateBasis: string } | null;
  /** Opaque ids, closed enums and booleans only — never a name, an amount or free text. */
  readonly filters: Readonly<Record<string, AuditJsonValue | undefined>>;
};

/**
 * The metadata one successful export writes.
 *
 * `format` IS STATED THOUGH ONLY CSV EXISTS. The audited fact is "data left the
 * system in this shape", and a trail that recorded the shape only once a second
 * shape appeared would be unable to say what the older rows were.
 *
 * `rowCount` IS A COUNT AND NOT A CONTENT. It is what makes the trail useful —
 * an export of four rows and an export of nine thousand are different events —
 * and it says nothing about any row. It is the count the caller actually
 * received, taken from the same snapshot the file was built from.
 *
 * ONLY THE FILTERS THE CALLER SUPPLIED APPEAR. An absent filter is absent rather
 * than `null`, so the row reads as the request that was made.
 */
export function reportExportAudit(scope: ReportExportScope, rowCount: number): AuditJsonObject {
  const filters: AuditJsonObject = {};

  for (const [key, value] of Object.entries(scope.filters)) {
    if (value !== undefined) filters[key] = value;
  }

  return {
    report: scope.report,
    format: 'CSV',
    range: scope.range === null ? null : { ...scope.range },
    filters,
    rowCount,
  };
}
