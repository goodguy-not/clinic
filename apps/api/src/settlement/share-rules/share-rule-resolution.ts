import { Prisma } from '@prisma/client';
import { AppError } from '../../common/app-error';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * WHICH PERCENTAGE APPLIED TO A THERAPIST ON A SERVICE DATE — stated once, for
 * the two callers that must never disagree about it.
 *
 * `ShareRulesService.resolve` answers the manager's question over HTTP.
 * `SessionRatingService` asks the same question while snapshotting a rating onto
 * a session, inside somebody else's transaction. Two copies of this statement
 * would eventually differ about a boundary date, and the difference would be a
 * number on somebody's settlement — so the SQL lives here and the services call
 * it, exactly as `resolveTariffSql` is the catalog's one statement of which
 * price applies.
 *
 * BY THE SERVICE DATE AND BY NOTHING ELSE. There is no `now()` in this
 * statement and no ordering that could break a tie in favour of the most recent
 * row: a historical date resolves to the rule that was live for it, and keeps
 * resolving to that rule after every later change to the configuration. The
 * range is inclusive at both ends, matching
 * `therapist_share_rule_no_overlap_excl`'s `daterange(start, end, '[]')`.
 *
 * A MISS IS RETURNED AS `undefined`, NOT RAISED. The two callers answer it
 * differently and only they know which is right: the resolution endpoint raises
 * `SHARE_RULE_MISSING`, while a charge being posted for a therapist with no rule
 * simply goes unrated — the charge must still exist (CLAUDE.md — the session
 * happened), and a miss must never become a zero.
 *
 * THE TWO-ROW GUARD IS UNREACHABLE AND IS HERE ANYWAY. It is unreachable while
 * `therapist_share_rule_no_overlap_excl` holds; if that constraint were ever
 * dropped, this fails loudly instead of paying whoever sorted first. Picking one
 * of two answers about somebody's earnings silently is the one thing this
 * milestone must never do.
 */

export type ShareRuleRow = {
  id: string;
  therapist_id: string;
  share_basis_points: number;
  effective_start: Date;
  effective_end: Date | null;
  supersedes_share_rule_id: string | null;
  created_at: Date;
  voided_at: Date | null;
  void_reason: string | null;
};

export const SHARE_RULE_COLUMNS = Prisma.sql`
  id, therapist_id, share_basis_points, effective_start, effective_end,
  supersedes_share_rule_id, created_at, voided_at, void_reason
`;

export type ShareRuleClient = PrismaService | Prisma.TransactionClient;

export async function resolveShareRuleRow(
  client: ShareRuleClient,
  therapistId: string,
  serviceDate: string,
): Promise<ShareRuleRow | undefined> {
  const rows = await client.$queryRaw<ShareRuleRow[]>`
    SELECT ${SHARE_RULE_COLUMNS} FROM therapist_share_rule
    WHERE therapist_id = ${therapistId}::uuid
      AND voided_at IS NULL
      AND effective_start <= ${serviceDate}::date
      AND (effective_end IS NULL OR effective_end >= ${serviceDate}::date)
  `;

  if (rows.length > 1) throw new AppError('SHARE_RULE_OVERLAP');

  return rows[0];
}
