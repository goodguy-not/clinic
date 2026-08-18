import { Prisma } from '@prisma/client';

/**
 * HOW MUCH OF A REPORT A STATEMENT RETURNS — one page of it, or all of it.
 *
 * Milestone 7 answers the same question on two surfaces: a screen, which reads
 * a page at a time, and a CSV export (checkpoint C5), which is the whole
 * filtered result in one file. THE ONLY DIFFERENCE BETWEEN THE TWO IS THIS
 * CLAUSE. The predicate, the joins, the order and the row mapping are one piece
 * of code in each report service, used by both, which is what makes an export
 * incapable of disagreeing with the report it was taken from: there is no second
 * query to drift.
 *
 * `null` IS "EVERY MATCHING ROW", AND ONLY AN EXPORT MAY ASK FOR IT. No route
 * lets a caller drop the limit on a screen read — the page schema requires a
 * `pageSize` with a ceiling — so the unbounded form is reachable exactly where
 * the checkpoint decided it should be.
 *
 * THE ORDER IS STILL TOTAL IN BOTH FORMS, which matters more here than it looks:
 * an unbounded statement with a partial ordering would return the same rows in
 * an arbitrary sequence, and two exports of an unchanged database would differ.
 * Every report in this directory orders down to a uuidv7, so a file is
 * reproducible.
 */
export type ReportWindow = { readonly limit: number; readonly offset: number };

/** The page a screen asked for, from the frozen offset-paging query. */
export function pageWindow(query: { page: number; pageSize: number }): ReportWindow {
  return { limit: query.pageSize, offset: (query.page - 1) * query.pageSize };
}

/**
 * `LIMIT ... OFFSET ...`, or nothing at all.
 *
 * `Prisma.empty` rather than a very large `LIMIT`: a sentinel number would be a
 * cap somebody eventually hits, silently, in the one place a silent truncation
 * is least acceptable — a financial file. No export in C5 truncates, and this is
 * where that is true rather than promised.
 */
export function windowClause(window: ReportWindow | null): Prisma.Sql {
  return window === null ? Prisma.empty : Prisma.sql`LIMIT ${window.limit} OFFSET ${window.offset}`;
}
