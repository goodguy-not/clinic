import type { Prisma } from '@prisma/client';

/**
 * Serialises the writers of one scope for the rest of the transaction
 * (M10-A10).
 *
 * WHY AN EXCLUSION CONSTRAINT NEEDS THIS. PostgreSQL checks an exclusion
 * constraint after the new row's index entry is written, so two transactions
 * inserting conflicting rows at the same instant can each find the other
 * in progress and wait for it. The deadlock detector then aborts one with
 * 40P01, which is not a constraint violation and reached the caller as a 500.
 * Measured on this schema with a barrier race (four writers, forty rounds):
 * 57 of 120 losers deadlocked without this lock, none with it — every loser
 * was refused by the constraint instead (DECISION_LOG, 2026-10-18).
 *
 * Taken immediately before the constrained write, the loser waits here until
 * the winner commits, then meets the winner's committed row in the constraint
 * and is refused with the ordinary overlap code. The constraint stays the
 * authority; this only makes its refusal the one that happens.
 *
 * The key is hashed by PostgreSQL's own `hashtextextended`, as the child
 * schedule lock is: a collision costs needless serialisation of two unrelated
 * scopes, never a wrong answer. Keys are namespaced by a prefix per scope kind.
 */
export async function lockScope(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
