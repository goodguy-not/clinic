import { Prisma } from '@prisma/client';

/**
 * WHICH TARIFF APPLIES — written once, read from two places.
 *
 * The rule has three parts and all three are easy to restate slightly wrong:
 * a voided row never applies, the effective range must contain the SERVICE date
 * (not today), and a therapist-specific tariff beats the general one for the
 * same date. `ORDER BY therapist_id NULLS LAST LIMIT 1` is that precedence and
 * nothing else, so one query decides it rather than two round trips.
 *
 * It is a SQL fragment rather than a service method because its second caller
 * needs it as a `LATERAL` join — resolving a price for every appointment in a
 * clinic day, from the day's own columns, in the one statement that reads the
 * day. A method could only answer one row at a time, and the alternative to
 * this fragment was a second copy of the precedence rule inside the appointment
 * module. Two copies of "which price applies" is the kind of drift that shows up
 * as a family being quoted one number and charged another.
 *
 * The scope arrives as SQL expressions rather than as values, which is what lets
 * the same text serve a parameterised lookup and a correlated join over a
 * table's columns. Every fragment a caller passes is either a bound parameter or
 * a column reference produced in this codebase; no caller-supplied string ever
 * reaches it.
 *
 * NO STATUS FILTER ON THE SERVICE OR THE THERAPIST, deliberately: a session that
 * happened in Mordad is priced by the tariff that was in force in Mordad,
 * whether or not the service has since been retired.
 */
export type TariffScopeSql = {
  readonly serviceId: Prisma.Sql;
  readonly durationMinutes: Prisma.Sql;
  /** May be a NULL expression: a general tariff then resolves for any therapist. */
  readonly therapistId: Prisma.Sql;
  readonly serviceDate: Prisma.Sql;
};

export function resolveTariffSql(columns: Prisma.Sql, scope: TariffScopeSql): Prisma.Sql {
  return Prisma.sql`
    SELECT ${columns} FROM tariff
    WHERE service_id = ${scope.serviceId}
      AND duration_minutes = ${scope.durationMinutes}
      AND (therapist_id IS NULL OR therapist_id = ${scope.therapistId})
      AND voided_at IS NULL
      AND effective_start <= ${scope.serviceDate}
      AND (effective_end IS NULL OR effective_end >= ${scope.serviceDate})
    ORDER BY therapist_id NULLS LAST
    LIMIT 1
  `;
}
