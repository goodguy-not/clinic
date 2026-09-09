import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TherapistProfileCopy, UpdateTherapistProfileCopyRequest } from '@clinic/contracts';
import { AuditService } from '../../audit/audit.service';
import { AppError } from '../../common/app-error';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { actorContext, canonicalOptionalText } from '../catalog-support';
import { PROFILE_COLUMNS, type ProfileRow } from './therapist-public-profile.service';

/**
 * The narrow editorial view of a colleague's public profile: the title and the
 * biography, and nothing else in the product.
 *
 * Milestone 9.5, checkpoint A6.
 *
 * IT IS A THIRD SERVICE ON THE `therapist` TABLE, AND THE THIRD AUTHORITY IS
 * THE POINT. `TherapistsService` is the personnel record under
 * `therapist.update`; `TherapistPublicProfileService` is the publication
 * decision under `therapist.publish_profile`, which A1 separated so that "may
 * correct a misspelt specialty" is not "may put a colleague's photograph on the
 * internet"; this is drafting under `therapist.draft_public_profile`, which the
 * front desk holds. Folding it into either of the others would have handed a
 * drafting role the whole of that other authority.
 *
 * WHAT IT CAN WRITE IS THREE COLUMNS, AND THE STATEMENT IS THE ENFORCEMENT. The
 * UPDATE below names `public_display_name`, `public_title` and `public_bio` —
 * the whole of the routine public copy about a colleague. There is no slug
 * here, no display order, no photograph path, no `is_public`, no specialty, no
 * status and no availability — not filtered out, ABSENT.
 *
 * THE DISPLAY NAME IS DRAFTABLE, AND DRAFTING ONE PUBLISHES NOBODY. The name a
 * visitor reads is `published_public_display_name`, a different column that
 * only the manager opt-in writes; preparing a name here changes no live page,
 * and clearing one is not a way to take a colleague off the website — the
 * published name stays where it is, and a publication that would leave that
 * page nameless is refused by `therapist_public_profile_chk`. What stays with
 * `therapist.publish_profile` is the DECISION that a named human being appears
 * on a public website, and at what address.
 *
 * NOTHING HERE PUBLISHES. All three columns are drafts, every public read
 * selects the published copies, and the only statement that promotes one to the
 * other is the manager opt-in in `TherapistPublicProfileService`.
 */
@Injectable()
export class TherapistProfileCopyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every therapist's public copy, in the clinic's own public ordering.
   *
   * INACTIVE COLLEAGUES ARE INCLUDED AND PRIVATE ONES ARE TOO, because this is
   * the editorial list rather than the team page: somebody preparing copy has
   * to be able to prepare it for a colleague who is not published yet, which is
   * the ordinary case, and a page that hid them would make the surface useful
   * only for people already on the website.
   */
  async list(): Promise<TherapistProfileCopy[]> {
    const rows = await this.prisma.$queryRaw<ProfileRow[]>`
      SELECT ${PROFILE_COLUMNS} FROM therapist t
      ORDER BY t.public_display_order ASC, t.id ASC
    `;

    return rows.map(toCopy);
  }

  async get(therapistId: string): Promise<TherapistProfileCopy> {
    const rows = await this.prisma.$queryRaw<ProfileRow[]>`
      SELECT ${PROFILE_COLUMNS} FROM therapist t WHERE t.id = ${therapistId}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('THERAPIST_NOT_FOUND');
    return toCopy(row);
  }

  /**
   * Editing the DRAFT, at any point in a colleague's publication.
   *
   * IT TOUCHES NO PUBLISHED COLUMN AND NO VISITOR SEES ANYTHING CHANGE. That is
   * what lets this stay open to a receptionist on somebody whose page is
   * currently live: the front desk can rewrite the paragraph families keep
   * asking about, and the page goes on saying exactly what the manager last
   * approved until the manager approves the new wording.
   *
   * IT DOES NOT MOVE `public_revised_at` EITHER. That column is the sitemap's
   * last-modified — a statement to a crawler about the PUBLISHED page — and a
   * draft edit has not modified the published page.
   */
  async update(
    therapistId: string,
    input: UpdateTherapistProfileCopyRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<TherapistProfileCopy> {
    const displayName = canonicalOptionalText(input.displayName);
    const title = canonicalOptionalText(input.title);
    const bio = canonicalOptionalText(input.bio);

    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, therapistId);

      await tx.$executeRaw`
        UPDATE therapist
        SET public_display_name = ${displayName},
            public_title = ${title},
            public_bio = ${bio}
        WHERE id = ${therapistId}::uuid
      `;

      const after = await this.lockedRead(tx, therapistId);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'therapist.public_profile_drafted',
        entityType: 'therapist',
        entityId: therapistId,
        before: copyAudit(before),
        after: copyAudit(after),
      });

      return after;
    });

    return toCopy(updated);
  }

  /**
   * Locks the row for the rest of the transaction, so a publication in another
   * request cannot promote a draft this one is halfway through replacing.
   */
  private async lock(tx: Prisma.TransactionClient, therapistId: string): Promise<ProfileRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM therapist WHERE id = ${therapistId}::uuid FOR UPDATE
    `;

    if (locked[0] === undefined) throw new AppError('THERAPIST_NOT_FOUND');

    return this.lockedRead(tx, therapistId);
  }

  private async lockedRead(tx: Prisma.TransactionClient, therapistId: string): Promise<ProfileRow> {
    const rows = await tx.$queryRaw<ProfileRow[]>`
      SELECT ${PROFILE_COLUMNS} FROM therapist t WHERE t.id = ${therapistId}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('THERAPIST_NOT_FOUND');
    return row;
  }
}

/**
 * What an audit row says about a draft edit.
 *
 * The biography is recorded as its LENGTH rather than its text, exactly as the
 * A2 profile action records it: it is owner-written public copy up to four
 * thousand characters long, and an audit table storing every draft of it would
 * be a content revision history hidden in the one table that can never be
 * pruned. The title is short and is what a page is identified by, so it is
 * recorded in full.
 */
function copyAudit(row: ProfileRow): Record<string, string | number | boolean | null> {
  return {
    displayName: row.public_display_name,
    title: row.public_title,
    bioLength: row.public_bio === null ? 0 : row.public_bio.length,
    isPublic: row.is_public,
    hasUnpublishedChanges: row.has_unpublished_changes,
  };
}

/**
 * The editorial projection. NARROWER THAN `toProfile` ON PURPOSE: no slug, no
 * photograph path, no display order and no publication timestamps, because none
 * of them is copy and this shape is read under a drafting authority.
 */
function toCopy(row: ProfileRow): TherapistProfileCopy {
  return {
    therapistId: row.id,
    displayName: row.public_display_name,
    publishedDisplayName: row.published_public_display_name,
    title: row.public_title,
    publishedTitle: row.published_public_title,
    bio: row.public_bio,
    publishedBio: row.published_public_bio,
    isPublic: row.is_public,
    hasUnpublishedChanges: row.has_unpublished_changes,
  };
}
