import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CatalogStatus,
  CreateServiceRequest,
  Service,
  ServiceMutationResponse,
  UpdateServiceRequest,
} from '@clinic/contracts';
import { AuditService } from '../../audit/audit.service';
import { AppError } from '../../common/app-error';
import {
  isForeignKeyViolation,
  isUniqueViolation,
  violatesConstraint,
} from '../../common/pg-error';
import {
  assertPublicSlugStable,
  isPublicSlugImmutabilityViolation,
} from '../../common/public-slug';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { uuidv7 } from '../../common/uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { actorContext, canonicalOptionalText, canonicalText } from '../catalog-support';
import { promoteServicePublicCopy } from './service-public-copy';

/**
 * Clinic services and the session lengths each may be booked for.
 *
 * MILESTONE 9.5, CHECKPOINT A6 NARROWED WHAT `publicDescription` MEANS HERE
 * WITHOUT CHANGING WHAT THIS METHOD WRITES. The column this form writes is now
 * the WORKING DRAFT of the public description; `published_public_description`
 * beside it is what the website says, and `service-public-copy.ts` holds the
 * only two statements that write it. A manager correcting a description on this
 * form therefore no longer moves a live page on its own — the promotion is a
 * separate, separately audited act — EXCEPT on the write that first makes the
 * service reachable, which IS that decision being taken. See `update` below.
 *
 * Two invariants shape every method:
 *
 *  1. A service row is never deleted. Deactivation is `status = INACTIVE`, and
 *     the database refuses a DELETE outright.
 *  2. Every state change and its audit row share one transaction, so a rolled
 *     back write cannot leave an audit entry claiming it happened.
 */

type ServiceRow = {
  id: string;
  name: string;
  public_description: string | null;
  published_public_description: string | null;
  is_public: boolean;
  public_slug: string | null;
  public_first_published_at: Date | null;
  status: CatalogStatus;
  deactivated_at: Date | null;
  created_at: Date;
  durations: number[];
};

/**
 * The projection every response is built from.
 *
 * Durations are aggregated in the same statement rather than fetched per row:
 * a list of services would otherwise issue one query per service, and the
 * ordering has to be deterministic for responses to be comparable.
 */
const SERVICE_COLUMNS = Prisma.sql`
  s.id,
  s.name,
  s.public_description,
  s.published_public_description,
  s.is_public,
  s.public_slug,
  s.public_first_published_at,
  s.status::text AS status,
  s.deactivated_at,
  s.created_at,
  COALESCE(
    (
      SELECT array_agg(d.duration_minutes ORDER BY d.duration_minutes)
      FROM service_duration d
      WHERE d.service_id = s.id
    ),
    ARRAY[]::int[]
  ) AS durations
`;

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<Service[]> {
    const rows = await this.prisma.$queryRaw<ServiceRow[]>`
      SELECT ${SERVICE_COLUMNS} FROM service s ORDER BY s.name ASC
    `;

    return rows.map(toService);
  }

  async get(id: string): Promise<Service> {
    const rows = await this.prisma.$queryRaw<ServiceRow[]>`
      SELECT ${SERVICE_COLUMNS} FROM service s WHERE s.id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('SERVICE_NOT_FOUND');
    return toService(row);
  }

  async create(
    input: CreateServiceRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ServiceMutationResponse> {
    const id = uuidv7();
    const name = canonicalText(input.name);
    const publicDescription = canonicalOptionalText(input.publicDescription);
    // Absent and null are the same thing on a CREATE: there is no previous slug
    // for "unchanged" to refer to.
    const publicSlug = input.publicSlug ?? null;
    const durations = normalizeDurations(input.allowedDurationsMinutes);

    const created = await this.prisma.$transaction(async (tx) => {
      try {
        await tx.$executeRaw`
          INSERT INTO service (
            id, name, public_description, is_public, public_slug, public_revised_at,
            status, created_at, created_by_user_id
          ) VALUES (
            ${id}::uuid, ${name}, ${publicDescription}, ${input.isPublic}, ${publicSlug},
            ${input.isPublic && publicSlug !== null ? Prisma.sql`transaction_timestamp()` : Prisma.sql`NULL`},
            'ACTIVE'::catalog_status, transaction_timestamp(), ${actor.userId}::uuid
          )
        `;
      } catch (error) {
        // Caught rather than pre-checked: a SELECT-then-INSERT would let two
        // concurrent creations both pass. The unique index is the authority.
        //
        // TWO UNIQUE INDEXES NOW, AND THEY ARE DIFFERENT MISTAKES. The name
        // collides with a service in the same list; the slug collides across
        // EVERY service including private and retired ones, which the manager
        // may not be able to see. They are told apart by the COLUMN PostgreSQL
        // names in the violation, so the manager is told which box to change.
        if (isUniqueViolation(error)) {
          throw new AppError(
            violatesConstraint(error, 'public_slug') ? 'PUBLIC_SLUG_TAKEN' : 'SERVICE_NAME_TAKEN',
          );
        }
        throw error;
      }

      await this.insertDurations(tx, id, durations);

      // A service CREATED public and addressable is published by this
      // statement, so its prepared description is published with it. The
      // ordinary case creates a private service and promotes nothing.
      if (input.isPublic && publicSlug !== null) {
        await promoteServicePublicCopy(tx, id);
      }

      const row = await this.readForUpdate(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'service.created',
        entityType: 'service',
        entityId: id,
        after: {
          name: row.name,
          publicDescription: row.public_description,
          publishedPublicDescription: row.published_public_description,
          isPublic: row.is_public,
          publicSlug: row.public_slug,
          status: row.status,
          allowedDurationsMinutes: row.durations,
        },
      });

      return row;
    });

    const service = toService(created);
    return {
      service,
      publication: {
        publicSlug: service.publicSlug,
        affectsPublicCache: isPubliclyReachable(created),
      },
    };
  }

  async update(
    id: string,
    input: UpdateServiceRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ServiceMutationResponse> {
    const name = canonicalText(input.name);
    const publicDescription = canonicalOptionalText(input.publicDescription);
    const durations = normalizeDurations(input.allowedDurationsMinutes);

    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, id);

      // The A1 invariant, refused as a sentence rather than as a trigger's
      // 23001. The row is already locked, so this cannot race the UPDATE below;
      // the trigger is still the authority and is still caught, in case a later
      // edit removes this line.
      assertPublicSlugStable(
        { publicSlug: before.public_slug, firstPublishedAt: before.public_first_published_at },
        input.publicSlug,
      );

      // Omitted means UNCHANGED. `COALESCE` cannot express that — it would read
      // an explicit null as "unchanged" too — so the whole assignment is
      // dropped from the statement instead.
      const slugAssignment =
        input.publicSlug === undefined
          ? Prisma.empty
          : Prisma.sql`public_slug = ${input.publicSlug},`;

      // REACHABLE MEANS BOTH FACTS, NOT JUST THE FLAG. A service may carry
      // `is_public` with no slug — that is exactly the state every Milestone 2
      // row was left in — and such a service is not on the website, so an edit
      // to it has revised no published content. Computed here rather than in
      // SQL because a column reference inside the statement would read the OLD
      // slug, which is the wrong one on the write that first supplies it.
      const slugAfter = input.publicSlug === undefined ? before.public_slug : input.publicSlug;
      const reachableAfter = input.isPublic && slugAfter !== null;

      // THE ONE WRITE ON THIS FORM THAT PUBLISHES COPY, AND IT PUBLISHES IT
      // BECAUSE IT IS THE PUBLICATION. A service crossing from unreachable to
      // reachable is the manager deciding that what is prepared should be seen,
      // which is the same act `article.setPublication(true)` performs — so the
      // draft description crosses with it, and a service does not go onto the
      // website with a blank space where its description was prepared.
      //
      // A LATER EDIT TO A SERVICE THAT IS ALREADY LIVE PROMOTES NOTHING, and
      // that asymmetry is the whole protection. Otherwise a manager changing a
      // duration would publish whatever unreviewed sentence happened to be in
      // the draft, which is exactly the defect the A2 article model was built to
      // prevent. Promoting a prepared change is an explicit act on its own
      // route (`ServicePublicCopyService.setPublication`).
      const reachableBefore = before.is_public && before.public_slug !== null;
      const publishesCopy = !reachableBefore && reachableAfter;

      try {
        await tx.$executeRaw`
          UPDATE service
          SET name = ${name},
              public_description = ${publicDescription},
              is_public = ${input.isPublic},
              ${slugAssignment}
              -- The sitemap's last-modified, and only while the row is public
              -- after this write: a private service has no published content
              -- for an edit to have revised.
              public_revised_at = CASE
                WHEN ${reachableAfter} THEN transaction_timestamp()
                ELSE public_revised_at
              END
          WHERE id = ${id}::uuid
        `;
      } catch (error) {
        if (isPublicSlugImmutabilityViolation(error)) {
          throw new AppError('PUBLIC_SLUG_IMMUTABLE');
        }
        if (isUniqueViolation(error)) {
          throw new AppError(
            violatesConstraint(error, 'public_slug') ? 'PUBLIC_SLUG_TAKEN' : 'SERVICE_NAME_TAKEN',
          );
        }
        throw error;
      }

      if (publishesCopy) await promoteServicePublicCopy(tx, id);

      await this.replaceDurations(tx, id, before.durations, durations);

      const after = await this.readForUpdate(tx, id);

      // ONE ACTION, NOT TWO. Publishing a service is not a separate act from
      // editing one: it is the same form, the same authority and the same state
      // change, and the payload below carries the before and after of every
      // public-facing column. A `service.published` beside this would describe
      // one write as two facts a reader would have to pair up (DECISION_LOG,
      // 2026-08-27).
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'service.updated',
        entityType: 'service',
        entityId: id,
        before: {
          name: before.name,
          publicDescription: before.public_description,
          // The PUBLISHED description is on both sides from A6, because this
          // write can move it — on the one transition that publishes — and a
          // reader must be able to see whether it did without inferring it from
          // the flag.
          publishedPublicDescription: before.published_public_description,
          isPublic: before.is_public,
          publicSlug: before.public_slug,
          allowedDurationsMinutes: before.durations,
        },
        after: {
          name: after.name,
          publicDescription: after.public_description,
          publishedPublicDescription: after.published_public_description,
          isPublic: after.is_public,
          publicSlug: after.public_slug,
          allowedDurationsMinutes: after.durations,
        },
      });

      return { before, after };
    });

    const service = toService(updated.after);
    return {
      service,
      publication: {
        publicSlug: service.publicSlug,
        affectsPublicCache:
          isPubliclyReachable(updated.before) || isPubliclyReachable(updated.after),
      },
    };
  }

  async changeStatus(
    id: string,
    status: CatalogStatus,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ServiceMutationResponse> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, id);

      // Already in the requested state: return it unchanged rather than writing
      // an audit row for a change that did not happen. Makes the endpoint
      // idempotent and keeps the trail free of entries whose before and after
      // are identical.
      if (before.status === status) return { before, after: before, changed: false };

      // `transaction_timestamp()` rather than a value from Node: it is constant
      // for the whole transaction, so this timestamp and the `occurred_at` of
      // the audit row below are provably the same instant. A `new Date()` here
      // would be a second clock that can disagree.
      if (status === 'INACTIVE') {
        await tx.$executeRaw`
          UPDATE service
          SET status = 'INACTIVE'::catalog_status, deactivated_at = transaction_timestamp()
          WHERE id = ${id}::uuid
        `;
      } else {
        // Reactivation clears the timestamp; the CHECK constraint requires the
        // two to agree, so a stale value here would fail the write.
        await tx.$executeRaw`
          UPDATE service
          SET status = 'ACTIVE'::catalog_status, deactivated_at = NULL
          WHERE id = ${id}::uuid
        `;
      }

      const after = await this.readForUpdate(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'service.status_changed',
        entityType: 'service',
        entityId: id,
        before: { status: before.status },
        after: { status: after.status },
      });

      return { before, after, changed: true };
    });

    const service = toService(updated.after);
    return {
      service,
      publication: {
        publicSlug: service.publicSlug,
        affectsPublicCache:
          updated.changed &&
          (isPubliclyReachable(updated.before) || isPubliclyReachable(updated.after)),
      },
    };
  }

  private async insertDurations(
    tx: Prisma.TransactionClient,
    serviceId: string,
    durations: number[],
  ): Promise<void> {
    for (const minutes of durations) {
      await tx.$executeRaw`
        INSERT INTO service_duration (id, service_id, duration_minutes)
        VALUES (${uuidv7()}::uuid, ${serviceId}::uuid, ${minutes})
      `;
    }
  }

  /**
   * Applies the difference rather than deleting everything and reinserting.
   *
   * A wholesale replace would delete rows a tariff still references and fail on
   * every update that touched an unrelated field. Only genuinely removed
   * durations are deleted, so an edit that keeps a priced duration succeeds.
   */
  private async replaceDurations(
    tx: Prisma.TransactionClient,
    serviceId: string,
    before: number[],
    after: number[],
  ): Promise<void> {
    const removed = before.filter((minutes) => !after.includes(minutes));
    const added = after.filter((minutes) => !before.includes(minutes));

    if (removed.length > 0) {
      try {
        await tx.$executeRaw`
          DELETE FROM service_duration
          WHERE service_id = ${serviceId}::uuid
            AND duration_minutes IN (${Prisma.join(removed)})
        `;
      } catch (error) {
        // `tariff_service_id_duration_minutes_fkey` is ON DELETE RESTRICT: a
        // duration that any tariff prices — including a voided one, which is
        // history and keeps its references — cannot be withdrawn. The whole
        // transaction rolls back, audit row included.
        if (isForeignKeyViolation(error)) throw new AppError('SERVICE_DURATION_IN_USE');
        throw error;
      }
    }

    await this.insertDurations(tx, serviceId, added);
  }

  /**
   * Locks the row for the rest of the transaction.
   *
   * Two concurrent updates would otherwise each read the current durations,
   * compute a diff against them and write conflicting sets. The lock serialises
   * them so the second sees the first's result.
   */
  private async lock(tx: Prisma.TransactionClient, id: string): Promise<ServiceRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM service WHERE id = ${id}::uuid FOR UPDATE
    `;

    if (locked[0] === undefined) throw new AppError('SERVICE_NOT_FOUND');

    return this.readForUpdate(tx, id);
  }

  private async readForUpdate(tx: Prisma.TransactionClient, id: string): Promise<ServiceRow> {
    const rows = await tx.$queryRaw<ServiceRow[]>`
      SELECT ${SERVICE_COLUMNS} FROM service s WHERE s.id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('SERVICE_NOT_FOUND');
    return row;
  }
}

function isPubliclyReachable(row: ServiceRow): boolean {
  return row.is_public && row.public_slug !== null && row.status === 'ACTIVE';
}

/** Deduplicated and ordered, so two spellings of the same set behave the same. */
function normalizeDurations(durations: number[]): number[] {
  return [...new Set(durations)].sort((a, b) => a - b);
}

export function toService(row: ServiceRow): Service {
  return {
    id: row.id,
    name: row.name,
    publicDescription: row.public_description,
    isPublic: row.is_public,
    publicSlug: row.public_slug,
    publicFirstPublishedAt:
      row.public_first_published_at === null ? null : row.public_first_published_at.toISOString(),
    status: row.status,
    deactivatedAt: row.deactivated_at === null ? null : row.deactivated_at.toISOString(),
    allowedDurationsMinutes: row.durations,
    createdAt: row.created_at.toISOString(),
  };
}
