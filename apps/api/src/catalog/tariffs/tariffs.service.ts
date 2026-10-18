import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateTariffRequest,
  ResolveTariffQuery,
  Tariff,
  TariffListQuery,
  TariffPriceMode,
} from '@clinic/contracts';
import { AuditService } from '../../audit/audit.service';
import { AppError } from '../../common/app-error';
import { toIsoDate } from '../../common/iso-date';
import { isForeignKeyViolation, violatesConstraint } from '../../common/pg-error';
import { lockScope } from '../../common/scope-lock';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { uuidv7 } from '../../common/uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { actorContext, canonicalText } from '../catalog-support';
import { resolveTariffSql } from './tariff-resolution';

/**
 * Effective-dated prices.
 *
 * Three rules shape every method here, and all three are enforced by the
 * database rather than only by this code:
 *
 *  1. A tariff is immutable once written. The only permitted change is the one
 *     transition from active to voided; `tariff_enforce_immutability` refuses
 *     everything else, so a correction must void and replace.
 *  2. Two live tariffs may not cover the same scope on overlapping dates. Two
 *     partial `EXCLUDE` constraints decide that, which is what makes it hold
 *     when two requests arrive at once.
 *  3. `PAID` carries a real price and no reason; `FREE` is exactly zero and
 *     must say why. Never inferred from the amount.
 *
 * LOCK ORDER — service, then therapist, then tariff. Every path that takes more
 * than one of these takes them in that order, so two concurrent requests can
 * never hold one and wait for another in the opposite direction. Void takes
 * only the tariff, which cannot form a cycle with anything.
 *
 * Service and therapist are locked `FOR SHARE`, not `FOR UPDATE`. A share lock
 * still conflicts with the `UPDATE` a deactivation performs — which is the
 * point — while letting two unrelated tariff creations for the same service
 * proceed together. `FOR UPDATE` would serialise all pricing work per service
 * and buy no additional safety.
 */

type TariffRow = {
  id: string;
  service_id: string;
  duration_minutes: number;
  therapist_id: string | null;
  price_mode: TariffPriceMode;
  price_toman: bigint;
  free_reason: string | null;
  effective_start: Date;
  effective_end: Date | null;
  voided_at: Date | null;
  void_reason: string | null;
  supersedes_tariff_id: string | null;
  created_at: Date;
};

const TARIFF_COLUMNS = Prisma.sql`
  id, service_id, duration_minutes, therapist_id,
  price_mode::text AS price_mode,
  price_toman, free_reason, effective_start, effective_end,
  voided_at, void_reason, supersedes_tariff_id, created_at
`;

@Injectable()
export class TariffsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: TariffListQuery): Promise<Tariff[]> {
    const filters: Prisma.Sql[] = [];

    if (query.serviceId !== undefined) {
      filters.push(Prisma.sql`service_id = ${query.serviceId}::uuid`);
    }
    if (query.scope === 'general') {
      filters.push(Prisma.sql`therapist_id IS NULL`);
    }
    if (query.scope === 'therapist') {
      filters.push(Prisma.sql`therapist_id IS NOT NULL`);
    }
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

    const rows = await this.prisma.$queryRaw<TariffRow[]>`
      SELECT ${TARIFF_COLUMNS} FROM tariff
      ${where}
      ORDER BY effective_start DESC, created_at DESC
    `;

    return rows.map(toTariff);
  }

  async get(id: string): Promise<Tariff> {
    const rows = await this.prisma.$queryRaw<TariffRow[]>`
      SELECT ${TARIFF_COLUMNS} FROM tariff WHERE id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('TARIFF_NOT_FOUND');
    return toTariff(row);
  }

  /**
   * The price that applied on a given service date.
   *
   * The precedence — a therapist-specific tariff over the general one, voided
   * rows excluded, the effective range containing the service date — is
   * `resolveTariffSql`, which the appointment day view resolves its read-only
   * price suggestion with as well. One statement of the rule, so a suggestion
   * shown on a screen and the answer this endpoint gives cannot diverge.
   */
  async resolve(query: ResolveTariffQuery): Promise<Tariff> {
    const rows = await this.prisma.$queryRaw<TariffRow[]>`
      ${resolveTariffSql(TARIFF_COLUMNS, {
        serviceId: Prisma.sql`${query.serviceId}::uuid`,
        durationMinutes: Prisma.sql`${query.durationMinutes}`,
        therapistId: Prisma.sql`${query.therapistId ?? null}::uuid`,
        serviceDate: Prisma.sql`${query.serviceDate}::date`,
      })}
    `;

    const row = rows[0];
    // A miss is a visible error, never a silent zero: a caller that treated
    // "no tariff" as "no charge" would be quietly wrong (PROJECT_SPEC.md 5).
    if (row === undefined) throw new AppError('TARIFF_MISSING');
    return toTariff(row);
  }

  async create(
    input: CreateTariffRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Tariff> {
    const created = await this.prisma.$transaction(async (tx) => {
      // Locks first, status second. Checking before locking would read a status
      // that a concurrent deactivation is about to change, and the check would
      // be true of a world that no longer exists by the time the insert lands.
      await this.lockActiveService(tx, input.serviceId);
      await this.lockActiveTherapist(tx, input.therapistId ?? null);

      let voidedId: string | null = null;

      if (input.supersedesTariffId !== undefined) {
        const target = await this.lockLiveTariff(tx, input.supersedesTariffId);
        this.assertSameScope(target, input);
        await this.voidRow(tx, target, 'superseded by a replacement tariff', actor, context, {
          supersededBy: true,
        });
        voidedId = target.id;
      }

      // One writer per pricing scope at a time — the scope each exclusion
      // constraint compares — so two simultaneous overlapping creations end in
      // one tariff and one `TARIFF_OVERLAP`, never a deadlock (M10-A10). Last in
      // the lock order: service -> therapist -> tariff row -> scope.
      await lockScope(
        tx,
        `tariff-scope:${input.serviceId}:${input.durationMinutes}:${input.therapistId ?? 'general'}`,
      );

      const row = await this.insert(tx, input, actor.userId);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'tariff.created',
        entityType: 'tariff',
        entityId: row.id,
        after: auditFacts(row),
        // `confirmFreePrice` is deliberately absent. It records a property of
        // the submission, not of the tariff, and is never persisted or audited.
        ...(voidedId === null ? {} : { metadata: { supersedesTariffId: voidedId } }),
      });

      return row;
    });

    return toTariff(created);
  }

  async void(
    id: string,
    reason: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Tariff> {
    const voided = await this.prisma.$transaction(async (tx) => {
      const target = await this.lockLiveTariff(tx, id);
      await this.voidRow(tx, target, canonicalText(reason), actor, context, {
        supersededBy: false,
      });

      return this.read(tx, id);
    });

    return toTariff(voided);
  }

  /**
   * The one permitted update: active to voided, nothing else touched.
   *
   * `transaction_timestamp()` rather than a value from Node, so this timestamp
   * and the `occurred_at` of the audit row below are provably the same instant.
   */
  private async voidRow(
    tx: Prisma.TransactionClient,
    target: TariffRow,
    reason: string,
    actor: ResolvedSession,
    context: RequestContext,
    options: { supersededBy: boolean },
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE tariff
      SET voided_at = transaction_timestamp(), void_reason = ${reason}
      WHERE id = ${target.id}::uuid
    `;

    await this.audit.record(tx, actorContext(actor, context), {
      action: 'tariff.voided',
      entityType: 'tariff',
      entityId: target.id,
      before: auditFacts(target),
      after: { voidReason: reason },
      metadata: { superseded: options.supersededBy },
    });
  }

  private async insert(
    tx: Prisma.TransactionClient,
    input: CreateTariffRequest,
    createdByUserId: string,
  ): Promise<TariffRow> {
    const id = uuidv7();

    // The server decides the stored amount from the branch, so a free tariff is
    // zero because it is free — not because a client sent a zero.
    const priceToman = input.priceMode === 'PAID' ? BigInt(input.priceToman) : 0n;
    const freeReason = input.priceMode === 'FREE' ? canonicalText(input.freeReason) : null;

    try {
      const rows = await tx.$queryRaw<TariffRow[]>`
        INSERT INTO tariff (
          id, service_id, duration_minutes, therapist_id, price_mode, price_toman,
          free_reason, effective_start, effective_end, supersedes_tariff_id,
          created_at, created_by_user_id
        ) VALUES (
          ${id}::uuid,
          ${input.serviceId}::uuid,
          ${input.durationMinutes},
          ${input.therapistId ?? null}::uuid,
          ${input.priceMode}::tariff_price_mode,
          ${priceToman},
          ${freeReason},
          ${input.effectiveStart}::date,
          ${input.effectiveEnd ?? null}::date,
          ${input.supersedesTariffId ?? null}::uuid,
          transaction_timestamp(),
          ${createdByUserId}::uuid
        )
        RETURNING ${TARIFF_COLUMNS}
      `;

      const inserted = rows[0];
      if (inserted === undefined) throw new AppError('INTERNAL_ERROR');
      return inserted;
    } catch (error) {
      // Caught rather than pre-checked: reading before writing would let two
      // concurrent requests both find the range free. The constraint is the
      // authority, and its error is what makes the rule hold under load.
      if (
        violatesConstraint(error, 'tariff_no_overlap_general_excl') ||
        violatesConstraint(error, 'tariff_no_overlap_therapist_excl')
      ) {
        throw new AppError('TARIFF_OVERLAP');
      }

      if (
        isForeignKeyViolation(error) &&
        violatesConstraint(error, 'tariff_service_id_duration_minutes_fkey')
      ) {
        throw new AppError('TARIFF_DURATION_NOT_ALLOWED');
      }

      throw error;
    }
  }

  /** Lock order step 1. Share lock: conflicts with deactivation, not with peers. */
  private async lockActiveService(tx: Prisma.TransactionClient, serviceId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM service WHERE id = ${serviceId}::uuid FOR SHARE
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('SERVICE_NOT_FOUND');
    if (row.status !== 'ACTIVE') throw new AppError('SERVICE_INACTIVE');
  }

  /** Lock order step 2. Skipped entirely for a general tariff. */
  private async lockActiveTherapist(
    tx: Prisma.TransactionClient,
    therapistId: string | null,
  ): Promise<void> {
    if (therapistId === null) return;

    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM therapist WHERE id = ${therapistId}::uuid FOR SHARE
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('THERAPIST_NOT_FOUND');
    if (row.status !== 'ACTIVE') throw new AppError('THERAPIST_INACTIVE');
  }

  /**
   * Lock order step 3, and the whole reason void is race-safe.
   *
   * A second request for the same tariff blocks here until the first commits,
   * then re-reads the committed `voided_at` and correctly refuses. Reading
   * before locking would let both see a live row and both proceed.
   */
  private async lockLiveTariff(tx: Prisma.TransactionClient, id: string): Promise<TariffRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM tariff WHERE id = ${id}::uuid FOR UPDATE
    `;

    if (locked[0] === undefined) throw new AppError('TARIFF_NOT_FOUND');

    const row = await this.read(tx, id);
    if (row.voided_at !== null) throw new AppError('TARIFF_ALREADY_VOIDED');

    return row;
  }

  /**
   * A replacement must price the same thing.
   *
   * `priceMode` is deliberately not compared: a programme that was paid and
   * becomes free, or the reverse, is a correction of what the price is — not of
   * what is being priced, which is what scope means.
   */
  private assertSameScope(target: TariffRow, input: CreateTariffRequest): void {
    const sameScope =
      target.service_id === input.serviceId &&
      target.duration_minutes === input.durationMinutes &&
      target.therapist_id === (input.therapistId ?? null);

    if (!sameScope) throw new AppError('TARIFF_SCOPE_MISMATCH');
  }

  private async read(tx: Prisma.TransactionClient, id: string): Promise<TariffRow> {
    const rows = await tx.$queryRaw<TariffRow[]>`
      SELECT ${TARIFF_COLUMNS} FROM tariff WHERE id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('TARIFF_NOT_FOUND');
    return row;
  }
}

/** The tariff facts an audit row records. Never `confirmFreePrice`. */
function auditFacts(row: TariffRow): Record<string, string | number | boolean | null> {
  return {
    serviceId: row.service_id,
    durationMinutes: row.duration_minutes,
    therapistId: row.therapist_id,
    priceMode: row.price_mode,
    priceToman: row.price_toman.toString(),
    freeReason: row.free_reason,
    effectiveStart: toIsoDate(row.effective_start),
    effectiveEnd: row.effective_end === null ? null : toIsoDate(row.effective_end),
    supersedesTariffId: row.supersedes_tariff_id,
  };
}

export function toTariff(row: TariffRow): Tariff {
  return {
    id: row.id,
    serviceId: row.service_id,
    durationMinutes: row.duration_minutes,
    therapistId: row.therapist_id,
    priceMode: row.price_mode,
    // A decimal string, never the raw bigint: JSON has no integer type, and a
    // number above 2^53 would lose precision silently on the way out.
    priceToman: row.price_toman.toString(),
    freeReason: row.free_reason,
    // Calendar days formatted through UTC components — see `iso-date.ts` for
    // why the local ones answer a question a DATE cannot be asked.
    effectiveStart: toIsoDate(row.effective_start),
    effectiveEnd: row.effective_end === null ? null : toIsoDate(row.effective_end),
    voidedAt: row.voided_at === null ? null : row.voided_at.toISOString(),
    voidReason: row.void_reason,
    supersedesTariffId: row.supersedes_tariff_id,
    createdAt: row.created_at.toISOString(),
  };
}
