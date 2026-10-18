import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ServicePublicCopy, UpdateServicePublicCopyRequest } from '@clinic/contracts';
import { AuditService } from '../../audit/audit.service';
import { AppError } from '../../common/app-error';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { actorContext, canonicalOptionalText } from '../catalog-support';
import { promoteServicePublicCopy, withdrawServicePublicCopy } from './service-public-copy';

/**
 * The service's public description, from a first draft to the moment it appears
 * on the website.
 *
 * Milestone 9.5, checkpoint A6.
 *
 * IT IS A SEPARATE SERVICE FROM `ServicesService`, ON THE SAME TABLE, for the
 * reason `TherapistPublicProfileService` is: the authority boundary made
 * structural. `ServicesService` is the operational record — the name, the
 * bookable durations, the address, the visibility, the active status — written
 * under `service.update` by whoever configures the clinic. THIS writes one
 * column, and it is reachable under `service.draft_public_copy`, which the
 * front desk holds. One service covering both would have put "may rewrite a
 * sentence" one method away from "may withdraw a bookable duration"
 * (DECISION_LOG, 2026-09-08 — Editorial authority and operational authority are
 * split).
 *
 * THE INVARIANT THIS FILE EXISTS TO HOLD: NO DESCRIPTION REACHES A VISITOR
 * WITHOUT A MANAGER PUBLISHING IT. `update` writes `public_description`, the
 * working draft, and touches no published column at any point in a service's
 * life — which is what lets it stay open to a receptionist on a service that is
 * currently live. `setPublication` is the only method here that can move a page
 * and it names `service.update`, which the front desk does not hold.
 *
 * IT WRITES NOTHING ELSE, AND THAT IS ENFORCED BY THE STATEMENT RATHER THAN BY
 * THE ROUTE. The UPDATE below names one column. There is no name here, no
 * duration, no status, no slug, no visibility flag and no tariff — not
 * filtered out, ABSENT — so an editorial request cannot reach operational
 * configuration even if a future caller sent it.
 */

type CopyRow = {
  id: string;
  name: string;
  public_slug: string | null;
  is_public: boolean;
  public_description: string | null;
  published_public_description: string | null;
  has_unpublished_changes: boolean;
  public_first_published_at: Date | null;
  public_revised_at: Date | null;
};

/**
 * `has_unpublished_changes` is DERIVED IN THE READ rather than stored, exactly
 * as an article's is. A stored flag would be a third thing every write path had
 * to keep in step, and the first time one forgot, a manager would be told there
 * was nothing to publish while the live page said something else.
 *
 * IT IS FALSE ON AN UNREACHABLE SERVICE, and that is not the same as "the two
 * columns agree". A service nobody can reach has no published page for a draft
 * to differ from, so an editorial list must not offer a manager a publication
 * to perform there; the act that publishes such a service is the service form's
 * own, which promotes the draft as it goes.
 *
 * The comparison is `IS DISTINCT FROM`, so a description that is null on one
 * side and set on the other counts as a difference — which a plain `<>` would
 * report as unknown and therefore as "no change".
 */
const COPY_COLUMNS = Prisma.sql`
  s.id,
  s.name,
  s.public_slug,
  s.is_public,
  s.public_description,
  s.published_public_description,
  (
    s.is_public
    AND s.public_slug IS NOT NULL
    AND s.public_description IS DISTINCT FROM s.published_public_description
  ) AS has_unpublished_changes,
  s.public_first_published_at,
  s.public_revised_at
`;

@Injectable()
export class ServicePublicCopyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every service's public copy, in the order the catalog list uses.
   *
   * Retired services are included deliberately: a service withdrawn from the
   * diary may still be on the website while somebody decides what to do about
   * it, and an editorial list that hid it would hide a live page from the
   * people responsible for its words.
   */
  async list(): Promise<ServicePublicCopy[]> {
    const rows = await this.prisma.$queryRaw<CopyRow[]>`
      SELECT ${COPY_COLUMNS} FROM service s ORDER BY s.name ASC
    `;

    return rows.map(toCopy);
  }

  async get(serviceId: string): Promise<ServicePublicCopy> {
    const rows = await this.prisma.$queryRaw<CopyRow[]>`
      SELECT ${COPY_COLUMNS} FROM service s WHERE s.id = ${serviceId}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('SERVICE_NOT_FOUND');
    return toCopy(row);
  }

  /**
   * Editing the DRAFT, at any point in the service's life.
   *
   * IT TOUCHES NO PUBLISHED COLUMN AND NO VISITOR SEES ANYTHING CHANGE. That is
   * what lets this method stay open to `service.draft_public_copy` on a service
   * that is currently on the website: somebody at the front desk can rewrite
   * the sentence families keep misreading, and the page goes on saying exactly
   * what the manager last approved until the manager approves the new wording.
   *
   * IT DOES NOT MOVE `public_revised_at` EITHER. That column is the sitemap's
   * last-modified — a statement to a crawler about the PUBLISHED page — and a
   * draft edit has not modified the published page.
   */
  async update(
    serviceId: string,
    input: UpdateServicePublicCopyRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ServicePublicCopy> {
    const description = canonicalOptionalText(input.description);

    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, serviceId);

      await tx.$executeRaw`
        UPDATE service SET public_description = ${description} WHERE id = ${serviceId}::uuid
      `;

      const after = await this.lockedRead(tx, serviceId);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'service.public_copy_drafted',
        entityType: 'service',
        entityId: serviceId,
        before: copyAudit(before),
        after: copyAudit(after),
      });

      return after;
    });

    return toCopy(updated);
  }

  /**
   * THE MANAGER ACT. What the draft now says is what the website says — or, the
   * other way, the website stops saying it.
   *
   * IDEMPOTENT ON THE WHOLE ACT, NOT ON A FLAG. Publishing when the two columns
   * already agree changes nothing and writes nothing, so a double-clicked
   * button does not fill the trail with entries whose before and after are the
   * same; withdrawing a description that is already absent does likewise.
   *
   * PUBLISHING AN UNREACHABLE SERVICE DOES NOTHING, AND IS NOT AN ERROR. A
   * service that is private or has no address has no published page for this
   * act to change, which `has_unpublished_changes` already states — so the
   * request settles as a no-op and the response says why, rather than raising a
   * refusal about a state the caller can read for themselves. The act that
   * publishes such a service is the service form's own, under `service.update`,
   * which carries the visibility flag and the address this route deliberately
   * cannot touch.
   */
  async setPublication(
    serviceId: string,
    isPublished: boolean,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ServicePublicCopy> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, serviceId);

      const alreadySettled = isPublished
        ? !before.has_unpublished_changes
        : before.published_public_description === null;

      if (alreadySettled) return before;

      if (isPublished) {
        await promoteServicePublicCopy(tx, serviceId);
      } else {
        await withdrawServicePublicCopy(tx, serviceId);
      }

      const after = await this.lockedRead(tx, serviceId);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'service.public_copy_published',
        entityType: 'service',
        entityId: serviceId,
        // Both sides of the PUBLISHED column, which is what makes one action
        // enough for both directions: a reader can see whether a sentence
        // appeared or was withdrawn. The slug is on the row because it is the
        // page that changed, and a reviewer should not have to join to the
        // service as it stands today to find out which.
        before: {
          publicSlug: before.public_slug,
          publishedDescriptionLength: lengthOf(before.published_public_description),
        },
        after: {
          publicSlug: after.public_slug,
          publishedDescriptionLength: lengthOf(after.published_public_description),
        },
      });

      return after;
    });

    return toCopy(updated);
  }

  /**
   * Locks the row for the rest of the transaction, so a publication cannot
   * promote a draft that another request is halfway through replacing.
   */
  private async lock(tx: Prisma.TransactionClient, serviceId: string): Promise<CopyRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM service WHERE id = ${serviceId}::uuid FOR UPDATE
    `;

    if (locked[0] === undefined) throw new AppError('SERVICE_NOT_FOUND');

    return this.lockedRead(tx, serviceId);
  }

  private async lockedRead(tx: Prisma.TransactionClient, serviceId: string): Promise<CopyRow> {
    const rows = await tx.$queryRaw<CopyRow[]>`
      SELECT ${COPY_COLUMNS} FROM service s WHERE s.id = ${serviceId}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('SERVICE_NOT_FOUND');
    return row;
  }
}

function lengthOf(value: string | null): number {
  return value === null ? 0 : value.length;
}

/**
 * What an audit row says about a draft edit.
 *
 * THE DESCRIPTION IS RECORDED AS ITS LENGTH, NOT ITS TEXT, exactly as an
 * article's body is. It is up to two thousand characters of public copy, and an
 * audit table keeping a copy of every draft of it would BE the content revision
 * history this milestone declines to build, hidden inside the one table in the
 * schema that can never be pruned. What a reviewer needs is that the copy
 * changed, when, and who changed it.
 */
function copyAudit(row: CopyRow): Record<string, string | number | boolean | null> {
  return {
    publicSlug: row.public_slug,
    isPublic: row.is_public,
    descriptionLength: lengthOf(row.public_description),
    hasUnpublishedChanges: row.has_unpublished_changes,
  };
}

function toCopy(row: CopyRow): ServicePublicCopy {
  return {
    serviceId: row.id,
    name: row.name,
    publicSlug: row.public_slug,
    isPublic: row.is_public,
    description: row.public_description,
    publishedDescription: row.published_public_description,
    hasUnpublishedChanges: row.has_unpublished_changes,
    publicFirstPublishedAt:
      row.public_first_published_at === null ? null : row.public_first_published_at.toISOString(),
    publicRevisedAt: row.public_revised_at === null ? null : row.public_revised_at.toISOString(),
  };
}
