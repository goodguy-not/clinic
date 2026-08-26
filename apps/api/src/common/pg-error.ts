import { Prisma } from '@prisma/client';

/**
 * SQLSTATE detection for constraint violations raised by raw SQL.
 *
 * Prisma reports a violation two different ways depending on how the statement
 * was issued: the query builder raises a typed error (`P2002` for a unique
 * conflict), while raw SQL raises `P2010` and carries the real SQLSTATE in
 * `meta.code`. Checking only the typed code misses every violation on the raw
 * path — which is exactly what an integration test caught in Milestone 1.
 *
 * These are matched rather than pre-checked deliberately. A SELECT-then-INSERT
 * would let two concurrent requests both pass the check and both proceed; the
 * constraint is the authority, and catching its error is what makes the rule
 * hold under concurrency.
 */
function hasSqlState(error: unknown, sqlState: string, prismaCode?: string): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (prismaCode !== undefined && error.code === prismaCode) return true;

    const meta = error.meta as { code?: string } | undefined;
    if (meta?.code === sqlState) return true;
  }

  return error instanceof Error && error.message.includes(sqlState);
}

/** SQLSTATE 23505, unique_violation. */
export function isUniqueViolation(error: unknown): boolean {
  return hasSqlState(error, '23505', 'P2002');
}

/** SQLSTATE 23503, foreign_key_violation. */
export function isForeignKeyViolation(error: unknown): boolean {
  return hasSqlState(error, '23503', 'P2003');
}

/**
 * SQLSTATE 23514, check_violation.
 *
 * Raised both by a table CHECK and by a trigger that raises with that ERRCODE —
 * the ledger's cumulative adjustment floor is the second kind, because the rule
 * spans rows and no CHECK can see them.
 */
export function isCheckViolation(error: unknown): boolean {
  return hasSqlState(error, '23514');
}

/**
 * SQLSTATE 23001, restrict_violation.
 *
 * The single code every "the database refuses to rewrite this" guard in this
 * project raises: the no-delete trigger, the born-active trigger, and both
 * financial immutability triggers.
 */
export function isRestrictViolation(error: unknown): boolean {
  return hasSqlState(error, '23001');
}

/**
 * True when the violation names the given constraint.
 *
 * One table can have several constraints of the same class — `tariff` alone has
 * two exclusion constraints and two foreign keys — so "a foreign key failed" is
 * rarely a precise enough answer to map onto a user-facing error code.
 *
 * WHAT "NAMES" MEANS DEPENDS ON THE VIOLATION, AND THAT IS PostgreSQL'S DOING
 * RATHER THAN A CHOICE HERE. A check or foreign-key failure reports the
 * CONSTRAINT NAME; a unique failure reports the KEY, as
 * `Key (public_slug)=(taken) already exists.` — the column, not the index. A
 * caller telling two unique indexes on one table apart therefore passes the
 * COLUMN name, which appears in both spellings (`service_public_slug_key`
 * contains `public_slug`), and one that needs a check constraint passes its
 * name. Both are substring matches against the same two places.
 */
export function violatesConstraint(error: unknown, constraintName: string): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as { constraint?: string; message?: string } | undefined;
    if (meta?.constraint === constraintName) return true;
    if (meta?.message?.includes(constraintName) === true) return true;
  }

  return error instanceof Error && error.message.includes(constraintName);
}
