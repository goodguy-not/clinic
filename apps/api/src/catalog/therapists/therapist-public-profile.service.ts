import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  TherapistPublicProfile,
  UpdateTherapistPublicProfileRequest,
} from '@clinic/contracts';
import { AuditService } from '../../audit/audit.service';
import { AppError } from '../../common/app-error';
import { isCheckViolation, isUniqueViolation, violatesConstraint } from '../../common/pg-error';
import {
  assertPublicSlugStable,
  isPublicSlugImmutabilityViolation,
} from '../../common/public-slug';
import type { RequestContext, ResolvedSession } from '../../common/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { actorContext, canonicalOptionalText } from '../catalog-support';

/**
 * A therapist's public profile, and the opt-in that publishes it.
 *
 * Milestone 9, checkpoint A2. This is the write path A1 deliberately left with
 * no writer: the columns existed, the permission name was frozen, and only the
 * synthetic dev seeder touched them. After this, nothing about who appears on
 * the clinic's website requires SQL, a seed or a deployment.
 *
 * IT IS A SEPARATE SERVICE FROM `TherapistsService`, ON THE SAME TABLE. That is
 * unusual in this codebase and it is the authority boundary made structural:
 * `TherapistsService` is the personnel record, written under `therapist.update`
 * by anybody who administers the clinic; this is written under
 * `therapist.publish_profile`, which A1 separated precisely so that "may
 * correct a misspelt specialty" is not "may put a colleague's photograph on the
 * internet". One service covering both would have made the two authorities one
 * method away from each other.
 *
 * TWO ACTS, NOT ONE FORM. Preparing what a colleague's page would say
 * (`update`) and deciding that it goes live (`setVisibility`) are separate
 * requests with separate audit rows, which is exactly what A1's
 * `therapist_public_profile_chk` permits by requiring the content for the flag
 * and not the flag for the content. A manager who writes a biography has not
 * thereby published anybody.
 *
 * NOTHING FALLS BACK. `full_name` and `specialty` are not read here and are not
 * written here. A therapist with no approved display name is refused
 * publication rather than published under their personnel record.
 *
 * MILESTONE 9.5, CHECKPOINT A6 SPLIT THE COPY IN TWO AND MOVED NO AUTHORITY.
 * `public_display_name`, `public_title` and `public_bio` are now the WORKING
 * DRAFT; `published_public_*` beside them are what the website says, and
 * `setVisibility` is the ONLY statement in this application that writes them.
 * Every public read selects the second set.
 *
 * The consequence is the one the checkpoint exists for: preparing a change to a
 * colleague whose page is already live moves nothing, whoever prepares it — a
 * manager here, or a receptionist on the narrower editorial surface — and the
 * page changes when, and only when, a manager publishes.
 *
 * IT ALSO MOVED ONE REFUSAL. `therapist_public_profile_chk` now reads the
 * PUBLISHED name, so clearing the DRAFT name of a published colleague is
 * accepted (it changes no live page) and the publication that would leave that
 * page nameless is what gets refused. Same rule, checked where it matters.
 */

export type ProfileRow = {
  id: string;
  is_public: boolean;
  public_slug: string | null;
  public_display_name: string | null;
  public_title: string | null;
  public_bio: string | null;
  published_public_display_name: string | null;
  published_public_title: string | null;
  published_public_bio: string | null;
  has_unpublished_changes: boolean;
  public_display_order: number;
  public_first_published_at: Date | null;
  public_revised_at: Date | null;
};

/**
 * Exactly the public-facing columns, and not one column of the personnel
 * record. This projection is why a query here cannot return a specialty.
 */
export const PROFILE_COLUMNS = Prisma.sql`
  t.id,
  t.is_public,
  t.public_slug,
  t.public_display_name,
  t.public_title,
  t.public_bio,
  t.published_public_display_name,
  t.published_public_title,
  t.published_public_bio,
  (
    t.is_public
    AND (t.public_display_name, t.public_title, t.public_bio)
        IS DISTINCT FROM (
          t.published_public_display_name,
          t.published_public_title,
          t.published_public_bio
        )
  ) AS has_unpublished_changes,
  t.public_display_order,
  t.public_first_published_at,
  t.public_revised_at
`;

@Injectable()
export class TherapistPublicProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(therapistId: string): Promise<TherapistPublicProfile> {
    const rows = await this.prisma.$queryRaw<ProfileRow[]>`
      SELECT ${PROFILE_COLUMNS} FROM therapist t WHERE t.id = ${therapistId}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('THERAPIST_NOT_FOUND');
    return toProfile(row);
  }

  /**
   * The approved content, as a DRAFT. Publishes nobody, and moves no live page.
   *
   * From A6 this writes the draft columns only, so a manager may rewrite the
   * biography of a colleague who is already on the website and the website goes
   * on saying what was last published until they publish again. Clearing the
   * draft display name is therefore accepted here; the publication that would
   * leave a live page nameless is what `therapist_public_profile_chk` refuses,
   * as `THERAPIST_PUBLIC_PROFILE_INCOMPLETE`.
   *
   * IT NEVER STAMPS `public_revised_at`. Until the Milestone 9.5 stabilisation
   * the legacy photograph path was the one live field on this form, and the
   * only reason this method could; that path is gone, and a portrait is now a
   * media attachment whose publication is its own manager act.
   */
  async update(
    therapistId: string,
    input: UpdateTherapistPublicProfileRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<TherapistPublicProfile> {
    const displayName = canonicalOptionalText(input.displayName);
    const title = canonicalOptionalText(input.title);
    const bio = canonicalOptionalText(input.bio);

    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, therapistId);

      assertPublicSlugStable(
        { publicSlug: before.public_slug, firstPublishedAt: before.public_first_published_at },
        input.publicSlug,
      );

      try {
        await tx.$executeRaw`
          UPDATE therapist
          SET public_slug = ${input.publicSlug},
              public_display_name = ${displayName},
              public_title = ${title},
              public_bio = ${bio},
              public_display_order = ${input.displayOrder}
          WHERE id = ${therapistId}::uuid
        `;
      } catch (error) {
        throw translateProfileError(error);
      }

      const after = await this.lockedRead(tx, therapistId);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'therapist.public_profile_updated',
        entityType: 'therapist',
        entityId: therapistId,
        before: profileAudit(before),
        after: profileAudit(after),
      });

      return after;
    });

    return toProfile(updated);
  }

  /**
   * The opt-in. One decision about one person — AND, FROM A6, THE ONLY
   * STATEMENT IN THIS APPLICATION THAT PUTS A COLLEAGUE'S WORDS ON THE WEBSITE.
   *
   * PUBLISHING COPIES THE DRAFT ONTO THE PUBLISHED COLUMNS in the same
   * statement that sets the flag, exactly as publishing an article does. That
   * is what makes this one act rather than two: "publish" means "what is
   * prepared is what the website says", whether the page did not exist before
   * or was showing an earlier version. A separate approval route beside this
   * one would be two names for one decision a manager would then have to choose
   * between.
   *
   * WITHDRAWING LEAVES THE PUBLISHED COPY WHERE IT IS. Nothing reads it while
   * the person is not public, and keeping it means a withdrawn profile still
   * records what the clinic last said — which republishing then deliberately
   * replaces rather than silently restores.
   *
   * IDEMPOTENT ON THE WHOLE ACT, NOT ON THE FLAG. Publishing somebody already
   * public who carries a prepared change is a real publication and is recorded
   * as one — it is how a manager promotes what the front desk wrote — while
   * publishing somebody already public whose draft matches their page changes
   * nothing and writes nothing, so a double-clicked button does not fill the
   * trail with entries whose before and after agree.
   */
  async setVisibility(
    therapistId: string,
    isPublic: boolean,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<TherapistPublicProfile> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, therapistId);

      const alreadySettled = isPublic
        ? before.is_public && !before.has_unpublished_changes
        : !before.is_public;

      if (alreadySettled) return before;

      try {
        if (isPublic) {
          await tx.$executeRaw`
            UPDATE therapist
            SET is_public = TRUE,
                published_public_display_name = public_display_name,
                published_public_title = public_title,
                published_public_bio = public_bio,
                public_revised_at = transaction_timestamp()
            WHERE id = ${therapistId}::uuid
          `;
        } else {
          await tx.$executeRaw`
            UPDATE therapist SET is_public = FALSE WHERE id = ${therapistId}::uuid
          `;
        }
      } catch (error) {
        throw translateProfileError(error);
      }

      const after = await this.lockedRead(tx, therapistId);

      await this.audit.record(tx, actorContext(actor, context), {
        action: isPublic
          ? 'therapist.public_profile_published'
          : 'therapist.public_profile_unpublished',
        entityType: 'therapist',
        entityId: therapistId,
        before: { isPublic: before.is_public },
        // The slug is recorded on the publication row deliberately: it is the
        // URL that came into existence, and the audit trail should say which
        // one without a reader having to join to the therapist row as it stands
        // today.
        // The published display name says WHO the website now names, so a second
        // publication of a revised profile is distinguishable from the first
        // without a reader comparing timestamps. The biography crosses as its
        // LENGTH, for the reason the draft actions do not copy it.
        after: {
          isPublic: after.is_public,
          publicSlug: after.public_slug,
          publishedDisplayName: after.published_public_display_name,
          publishedBioLength:
            after.published_public_bio === null ? 0 : after.published_public_bio.length,
        },
      });

      return after;
    });

    return toProfile(updated);
  }

  private async lock(tx: Prisma.TransactionClient, therapistId: string): Promise<ProfileRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM therapist WHERE id = ${therapistId}::uuid FOR UPDATE
    `;

    if (locked[0] === undefined) throw new AppError('THERAPIST_NOT_FOUND');

    return this.lockedRead(tx, therapistId);
  }

  async lockedRead(tx: Prisma.TransactionClient, therapistId: string): Promise<ProfileRow> {
    const rows = await tx.$queryRaw<ProfileRow[]>`
      SELECT ${PROFILE_COLUMNS} FROM therapist t WHERE t.id = ${therapistId}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('THERAPIST_NOT_FOUND');
    return row;
  }
}

/**
 * The three ways the database refuses a public-profile write, each as the code
 * that names the mistake.
 *
 * `therapist_public_profile_chk` is the opt-in itself: public, with no address
 * and no approved name. Reported as `THERAPIST_PUBLIC_PROFILE_INCOMPLETE`
 * whichever side of the rule was violated — trying to publish without the
 * content, or trying to remove the content from somebody published — because it
 * is one rule and one fix.
 */
function translateProfileError(error: unknown): unknown {
  if (isPublicSlugImmutabilityViolation(error)) return new AppError('PUBLIC_SLUG_IMMUTABLE');
  if (isUniqueViolation(error)) return new AppError('PUBLIC_SLUG_TAKEN');
  if (isCheckViolation(error) && violatesConstraint(error, 'therapist_public_profile_chk')) {
    return new AppError('THERAPIST_PUBLIC_PROFILE_INCOMPLETE');
  }
  return error;
}

/**
 * What an audit row says about a profile.
 *
 * The biography is recorded as its LENGTH rather than its text. It is
 * owner-written public copy up to four thousand characters long, and an audit
 * table that stored a copy of every draft of it would be a content revision
 * history — the thing this checkpoint explicitly declines to build — hidden in
 * the one table that can never be pruned. What a reviewer needs to know is that
 * the biography changed, and when, and who did it.
 */
function profileAudit(row: ProfileRow): Record<string, string | number | boolean | null> {
  return {
    publicSlug: row.public_slug,
    displayName: row.public_display_name,
    title: row.public_title,
    displayOrder: row.public_display_order,
    bioLength: row.public_bio === null ? 0 : row.public_bio.length,
    isPublic: row.is_public,
  };
}

export function toProfile(row: ProfileRow): TherapistPublicProfile {
  return {
    therapistId: row.id,
    publicSlug: row.public_slug,
    displayName: row.public_display_name,
    title: row.public_title,
    bio: row.public_bio,
    publishedDisplayName: row.published_public_display_name,
    publishedTitle: row.published_public_title,
    publishedBio: row.published_public_bio,
    hasUnpublishedChanges: row.has_unpublished_changes,
    displayOrder: row.public_display_order,
    isPublic: row.is_public,
    firstPublishedAt:
      row.public_first_published_at === null ? null : row.public_first_published_at.toISOString(),
    publicRevisedAt: row.public_revised_at === null ? null : row.public_revised_at.toISOString(),
  };
}
