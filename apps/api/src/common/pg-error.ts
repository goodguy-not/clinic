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
 * True when the violation names the given constraint.
 *
 * One table can have several constraints of the same class — `tariff` alone has
 * two exclusion constraints and two foreign keys — so "a foreign key failed" is
 * rarely a precise enough answer to map onto a user-facing error code.
 */
export function violatesConstraint(error: unknown, constraintName: string): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as { constraint?: string; message?: string } | undefined;
    if (meta?.constraint === constraintName) return true;
    if (meta?.message?.includes(constraintName) === true) return true;
  }

  return error instanceof Error && error.message.includes(constraintName);
}
