import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateShareRuleRequest,
  Permission,
  ResolveShareRuleQuery,
  ShareRule,
  ShareRuleListQuery,
} from '@clinic/contracts';
import { AuditService } from '../../audit/audit.service';
import { AppError } from '../../common/app-error';
import { toIsoDate } from '../../common/iso-date';
import { violatesConstraint } from '../../common/pg-error';
import { lockScope } from '../../common/scope-lock';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { uuidv7 } from '../../common/uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { actorContext, canonicalText } from '../../catalog/catalog-support';
import {
  resolveShareRuleRow,
  SHARE_RULE_COLUMNS,
  type ShareRuleRow,
} from './share-rule-resolution';

/**
 * Effective-dated therapist share percentages.
 *
 * THIS SERVICE OWNS CONFIGURATION, NOT SETTLEMENT. It records what a therapist
 * was agreed to take and between which dates; it computes nothing, snapshots
 * nothing onto a session, and reads no charge, payment or family balance. A
 * family's payment history is irrelevant to every question answered here —
 * settlement is completed-session value and independent of payment (CLAUDE.md)
 * — and the word "settlement" appears in the module name only because that is
 * the milestone this configuration belongs to.
 *
 * FOUR RULES SHAPE EVERY METHOD, and the first three are enforced by the
 * database rather than only by this code:
 *
 *  1. A RULE IS IMMUTABLE ONCE WRITTEN. The only permitted change is the one
 *     transition from live to voided; `therapist_share_rule_enforce_
 *     immutability` refuses everything else, so a correction must void and
 *     replace. That is what keeps a later agreement from rewriting what applied
 *     last Tir.
 *  2. TWO LIVE RULES MAY NOT COVER ONE THERAPIST ON OVERLAPPING DATES.
 *     `therapist_share_rule_no_overlap_excl` decides that, which is what makes
 *     it hold when two requests arrive at once.
 *  3. A VOIDED RULE ALWAYS RECORDS WHEN, BY WHOM AND WHY.
 *  4. THERE IS NO DEFAULT SHARE. A resolution miss is `SHARE_RULE_MISSING`, an
 *     error, never a zero — zero is a real agreed share, and answering "not
 *     configured" with it is how somebody is quietly paid nothing.
 *
 * LOCK ORDER — therapist, then share rule. Every path that takes both takes
 * them in that order, so two concurrent requests can never hold one and wait
 * for the other in the opposite direction. Void takes only the rule, which
 * cannot form a cycle with anything.
 *
 * The therapist is locked `FOR SHARE`, not `FOR UPDATE`: a share lock still
 * conflicts with the `UPDATE` a deactivation performs, while letting two
 * unrelated writes about the same therapist proceed together.
 */

/**
 * Superseding a rule is a withdrawal, so it demands the withdrawal authority in
 * addition to the create one the route already names. Held as a constant for
 * the reason `scheduling-rules.ts` holds its override permission as one: the
 * name is checked against the resolved session at runtime, not declared on the
 * route, because only some requests perform the act.
 */
const SHARE_RULE_VOID_PERMISSION: Permission = 'therapist_share.void';

@Injectable()
export class ShareRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ShareRuleListQuery): Promise<ShareRule[]> {
    const filters: Prisma.Sql[] = [];

    if (query.therapistId !== undefined) {
      filters.push(Prisma.sql`therapist_id = ${query.therapistId}::uuid`);
    }
    if (query.onDate !== undefined) {
      filters.push(
        Prisma.sql`effective_start <= ${query.onDate}::date
          AND (effective_end IS NULL OR effective_end >= ${query.onDate}::date)`,
      );
    }
    if (query.includeVoided !== true) {
      filters.push(Prisma.sql`voided_at IS NULL`);
    }

    const where =
      filters.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`;

    const rows = await this.prisma.$queryRaw<ShareRuleRow[]>`
      SELECT ${SHARE_RULE_COLUMNS} FROM therapist_share_rule
      ${where}
      ORDER BY effective_start DESC, created_at DESC
    `;

    return rows.map(toShareRule);
  }

  async get(id: string): Promise<ShareRule> {
    const rows = await this.prisma.$queryRaw<ShareRuleRow[]>`
      SELECT ${SHARE_RULE_COLUMNS} FROM therapist_share_rule WHERE id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('SHARE_RULE_NOT_FOUND');
    return toShareRule(row);
  }

  /**
   * The percentage that applied to a therapist on a given service date.
   *
   * THE STATEMENT ITSELF IS `resolveShareRuleRow`, shared with the rating
   * service so this endpoint's answer and a session's snapshot cannot come from
   * two readings of the same rule. What is added here is the REFUSAL: a caller
   * asking "which percentage applied?" is answered with an error rather than
   * with silence, because a caller that treated "no rule" as "no share" would
   * quietly pay a therapist nothing.
   */
  async resolve(query: ResolveShareRuleQuery): Promise<ShareRule> {
    const row = await resolveShareRuleRow(this.prisma, query.therapistId, query.serviceDate);

    if (row === undefined) throw new AppError('SHARE_RULE_MISSING');
    return toShareRule(row);
  }

  /**
   * Create a rule, or correct one — the same act with one field different.
   *
   * A CORRECTION IS ONE TRANSACTION. The withdrawal of the old rule and the
   * insertion of its replacement commit together or not at all; two separate
   * calls could leave a therapist with no rule over a range they had one for,
   * and the gap would surface as a missing share the next time a session on
   * that date was rated.
   *
   * The old rule is NOT edited. It keeps its percentage, its range and its own
   * `voidReason`, and stays readable through `includeVoided`.
   */
  async create(
    input: CreateShareRuleRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ShareRule> {
    // The second authority, demanded only by the request that actually
    // withdraws something, and checked BEFORE the transaction opens so a
    // refusal writes no audit row at all. `permissions` is the list NestJS
    // re-resolved from the database for this request, never anything the caller
    // sent.
    if (
      input.supersedesShareRuleId !== undefined &&
      !actor.permissions.includes(SHARE_RULE_VOID_PERMISSION)
    ) {
      throw new AppError('AUTH_FORBIDDEN');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockTherapist(tx, input.therapistId);

      let supersededId: string | null = null;

      if (input.supersedesShareRuleId !== undefined) {
        const target = await this.lockLiveRule(tx, input.supersedesShareRuleId);
        this.assertSameScope(target, input);
        // `reason` is required by the request schema whenever
        // `supersedesShareRuleId` is present, so this is never undefined here.
        await this.voidRow(tx, target, canonicalText(input.reason ?? ''), actor, context, {
          superseded: true,
        });
        supersededId = target.id;
      }

      const row = await this.insert(tx, input, actor.userId);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'therapist_share_rule.created',
        entityType: 'therapist_share_rule',
        entityId: row.id,
        after: auditFacts(row),
        ...(supersededId === null ? {} : { metadata: { supersedesShareRuleId: supersededId } }),
      });

      return row;
    });

    return toShareRule(created);
  }

  async void(
    id: string,
    reason: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ShareRule> {
    const voided = await this.prisma.$transaction(async (tx) => {
      const target = await this.lockLiveRule(tx, id);
      await this.voidRow(tx, target, canonicalText(reason), actor, context, { superseded: false });

      return this.read(tx, id);
    });

    return toShareRule(voided);
  }

  /**
   * The one permitted update: live to voided, nothing else touched.
   *
   * `transaction_timestamp()` rather than a value from Node, so this timestamp
   * and the `occurred_at` of the audit row below are provably the same instant.
   */
  private async voidRow(
    tx: Prisma.TransactionClient,
    target: ShareRuleRow,
    reason: string,
    actor: ResolvedSession,
    context: RequestContext,
    options: { superseded: boolean },
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE therapist_share_rule
      SET voided_at = transaction_timestamp(),
          voided_by_user_id = ${actor.userId}::uuid,
          void_reason = ${reason}
      WHERE id = ${target.id}::uuid
    `;

    await this.audit.record(tx, actorContext(actor, context), {
      action: 'therapist_share_rule.voided',
      entityType: 'therapist_share_rule',
      entityId: target.id,
      before: auditFacts(target),
      after: { voidReason: reason },
      metadata: { superseded: options.superseded },
    });
  }

  private async insert(
    tx: Prisma.TransactionClient,
    input: CreateShareRuleRequest,
    createdByUserId: string,
  ): Promise<ShareRuleRow> {
    const id = uuidv7();

    // One writer per therapist's rules at a time, so two simultaneous
    // overlapping rules end in one rule and one `SHARE_RULE_OVERLAP`, never a
    // deadlock (M10-A10). Last in the lock order, after the therapist and any
    // superseded rule.
    await lockScope(tx, `share-rule:${input.therapistId}`);

    try {
      const rows = await tx.$queryRaw<ShareRuleRow[]>`
        INSERT INTO therapist_share_rule (
          id, therapist_id, share_basis_points, effective_start, effective_end,
          supersedes_share_rule_id, created_at, created_by_user_id
        ) VALUES (
          ${id}::uuid,
          ${input.therapistId}::uuid,
          ${input.shareBasisPoints},
          ${input.effectiveStart}::date,
          ${input.effectiveEnd ?? null}::date,
          ${input.supersedesShareRuleId ?? null}::uuid,
          transaction_timestamp(),
          ${createdByUserId}::uuid
        )
        RETURNING ${SHARE_RULE_COLUMNS}
      `;

      const inserted = rows[0];
      if (inserted === undefined) throw new AppError('INTERNAL_ERROR');
      return inserted;
    } catch (error) {
      // Caught rather than pre-checked: reading before writing would let two
      // concurrent requests both find the range free. The constraint is the
      // authority, and its error is what makes the rule hold under load.
      if (violatesConstraint(error, 'therapist_share_rule_no_overlap_excl')) {
        throw new AppError('SHARE_RULE_OVERLAP');
      }

      throw error;
    }
  }

  /**
   * Lock order step 1.
   *
   * EXISTENCE ONLY — an INACTIVE therapist is deliberately NOT refused, which
   * is where this departs from `TariffsService`. A share rule is a record of an
   * agreement about work that may already have happened, and a therapist who
   * has left is exactly the case where a wrong historical percentage most needs
   * correcting. Refusing on status would make a departed therapist's
   * configuration permanently uncorrectable, which contradicts the frozen rule
   * that a rule must be correctable while its history is preserved. A tariff
   * refuses because it prices FUTURE bookings; this does not.
   */
  private async lockTherapist(tx: Prisma.TransactionClient, therapistId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM therapist WHERE id = ${therapistId}::uuid FOR SHARE
    `;

    if (rows[0] === undefined) throw new AppError('THERAPIST_NOT_FOUND');
  }

  /**
   * Lock order step 2, and the whole reason void is race-safe.
   *
   * A second request for the same rule blocks here until the first commits,
   * then re-reads the committed `voided_at` and correctly refuses. Reading
   * before locking would let both see a live row and both proceed.
   */
  private async lockLiveRule(tx: Prisma.TransactionClient, id: string): Promise<ShareRuleRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM therapist_share_rule WHERE id = ${id}::uuid FOR UPDATE
    `;

    if (locked[0] === undefined) throw new AppError('SHARE_RULE_NOT_FOUND');

    const row = await this.read(tx, id);
    if (row.voided_at !== null) throw new AppError('SHARE_RULE_ALREADY_VOIDED');

    return row;
  }

  /**
   * A replacement must be about the same therapist.
   *
   * The percentage and the effective range are deliberately not compared: those
   * are what a correction exists to change. Who it is about is not — correcting
   * one therapist's agreement by replacing another's is a mistake noticed only
   * by whoever ends up short.
   */
  private assertSameScope(target: ShareRuleRow, input: CreateShareRuleRequest): void {
    if (target.therapist_id !== input.therapistId) throw new AppError('SHARE_RULE_SCOPE_MISMATCH');
  }

  private async read(tx: Prisma.TransactionClient, id: string): Promise<ShareRuleRow> {
    const rows = await tx.$queryRaw<ShareRuleRow[]>`
      SELECT ${SHARE_RULE_COLUMNS} FROM therapist_share_rule WHERE id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('SHARE_RULE_NOT_FOUND');
    return row;
  }
}

/**
 * The share-rule facts an audit row records.
 *
 * THE PERCENTAGE IS WRITTEN IN FULL, AND THE ACCEPTED RULE IS WHAT DECIDES IT.
 * DECISION_LOG 2026-08-09 draws the line exactly here: a value copied into
 * `audit_log` is a second undeletable store, so an identifier that is NOT the
 * fact being changed is masked or omitted (a national id, a phone number, a bank
 * reference — 2026-08-15), while THE FACT BEING CHANGED is written in full,
 * because masking it "would make the trail useless for the corrections it exists
 * to explain". A share rule's percentage is not an identifier attached to the
 * change; it IS the change.
 *
 * C1 FROZE AN AUDIT VOCABULARY THAT DEPENDS ON IT. There is deliberately no
 * `therapist_share_rule.updated`, because a percentage change is recorded as
 * "the share that stopped applying and the one that replaced it" rather than as
 * a diff a reader has to interpret (`audit/audit-actions.ts`). Drop the value
 * and `therapist_share_rule.voided` no longer records the share that stopped
 * applying, which is the entire reason that action exists as its own name.
 *
 * IT ADDS NO EXPOSURE SURFACE. `therapist_share_rule` is immutable and carries a
 * no-delete and a no-truncate trigger, so the percentage is already retained
 * permanently in the row this entry names. Unlike a phone number — whose source
 * row can be corrected, leaving the audit copy as the only remaining store — the
 * primary store here is exactly as undeletable as the copy.
 *
 * WHAT IS NOT HERE. No session, charge, amount, family or child: a rule knows
 * about none of them. No name of any kind — `therapistId` is an opaque uuid, the
 * same identifier every existing audit row about a therapist already carries.
 * And the percentage appears in `before`/`after`, which is where a changed fact
 * belongs; `metadata` carries only the correction linkage, never a value.
 */
function auditFacts(row: ShareRuleRow): Record<string, string | number | boolean | null> {
  return {
    therapistId: row.therapist_id,
    shareBasisPoints: row.share_basis_points,
    effectiveStart: toIsoDate(row.effective_start),
    effectiveEnd: row.effective_end === null ? null : toIsoDate(row.effective_end),
    supersedesShareRuleId: row.supersedes_share_rule_id,
  };
}

export function toShareRule(row: ShareRuleRow): ShareRule {
  return {
    id: row.id,
    therapistId: row.therapist_id,
    shareBasisPoints: row.share_basis_points,
    // Calendar days formatted through UTC components — see `iso-date.ts` for
    // why the local ones answer a question a DATE cannot be asked.
    effectiveStart: toIsoDate(row.effective_start),
    effectiveEnd: row.effective_end === null ? null : toIsoDate(row.effective_end),
    voidedAt: row.voided_at === null ? null : row.voided_at.toISOString(),
    voidReason: row.void_reason,
    supersedesShareRuleId: row.supersedes_share_rule_id,
    createdAt: row.created_at.toISOString(),
  };
}
