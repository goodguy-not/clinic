import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateSpaceRequest, Space, UpdateSpaceRequest } from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';
import { actorContext, canonicalOptionalText, canonicalText } from '../catalog/catalog-support';

/**
 * Public spaces, from the first draft to the moment they come off the website.
 *
 * Milestone 9.5, checkpoint A7.
 *
 * THIS FILE WRITES EDITORIAL CONTENT AND NOTHING OPERATIONAL. It reads and
 * writes `public_space` and no other table. IT NEVER TOUCHES `room`, and it
 * could not: there is no column joining the two, no import of the catalog
 * module here, and no statement below names a room, a service, an appointment
 * or an availability window. The separation the checkpoint requires is
 * therefore a fact about the schema and about this file's imports rather than a
 * rule somebody has to remember while editing it.
 *
 * THE INVARIANT IT EXISTS TO HOLD, AND IT IS THE ARTICLE INVARIANT: NO WORD
 * REACHES A VISITOR WITHOUT A MANAGER PUBLISHING IT — not the first description
 * of a new space, and not a rewrite of one that has been live for a month.
 *
 * That is why a space holds its copy TWICE. `name`, `description` and
 * `display_order` are the working draft, which `public_space.draft` may rewrite
 * at any time; `published_name`, `published_description` and
 * `published_display_order` are what the website says, and `setPublication` —
 * reachable only under `public_space.publish` — is the ONLY statement in this
 * application that writes them. The public read selects the second set.
 *
 * THE ORDERING IS SPLIT WITH THE WORDS, DELIBERATELY. Reordering a live gallery
 * is a change a visitor sees, so it waits for the same manager act. Publishing
 * copies all three columns in one statement, which is what keeps "publish" one
 * decision rather than three.
 *
 * PHOTOGRAPHS ARE NOT WRITTEN HERE AT ALL. A space's images are
 * `media_attachment` rows owned by the media module, attached under
 * `media.attach` and published under `media.publish`. Nothing in this file
 * creates, publishes, detaches or reads one — which is what makes "publishing a
 * space cannot publish a photograph, and publishing a photograph cannot publish
 * a space" true by construction. What a space publication DOES control is
 * whether any published photograph on it is reachable, and that is enforced in
 * `LIVE_ATTACHMENT_PREDICATE` rather than here.
 *
 * Every state change and its audit row share one transaction, as every write in
 * this application does.
 */

type SpaceRow = {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
  published_name: string | null;
  published_description: string | null;
  published_display_order: number | null;
  is_public: boolean;
  has_unpublished_changes: boolean;
  public_first_published_at: Date | null;
  public_revised_at: Date | null;
  created_at: Date;
};

/**
 * `has_unpublished_changes` is DERIVED IN THE READ rather than stored, for the
 * reason an article's is: a stored flag is a fourth thing every write path has
 * to keep in step, and the first time one forgets, a manager is told there is
 * nothing to publish while the live gallery shows something else.
 *
 * The comparison is `IS DISTINCT FROM` over the whole row, so a description
 * that is null on one side and set on the other counts as a difference — which
 * a plain `<>` would report as unknown and therefore as "no change".
 */
const SPACE_COLUMNS = Prisma.sql`
  s.id,
  s.name,
  s.description,
  s.display_order,
  s.published_name,
  s.published_description,
  s.published_display_order,
  s.is_public,
  (
    s.is_public
    AND (s.name, s.description, s.display_order)
        IS DISTINCT FROM (s.published_name, s.published_description, s.published_display_order)
  ) AS has_unpublished_changes,
  s.public_first_published_at,
  s.public_revised_at,
  s.created_at
`;

@Injectable()
export class SpacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Everything, drafts included, in the order somebody editing them wants.
   *
   * The DRAFT order, not the published one: this is the working list, and a
   * receptionist who has just moved an entry expects to see it where they put
   * it. The public gallery orders by the published column, in a different file.
   *
   * It is the only read in this module that returns unpublished content, and it
   * is behind `public_space.read`.
   */
  async list(): Promise<Space[]> {
    const rows = await this.prisma.$queryRaw<SpaceRow[]>`
      SELECT ${SPACE_COLUMNS} FROM public_space s ORDER BY s.display_order ASC, s.id ASC
    `;

    return rows.map(toSpace);
  }

  async get(id: string): Promise<Space> {
    const rows = await this.prisma.$queryRaw<SpaceRow[]>`
      SELECT ${SPACE_COLUMNS} FROM public_space s WHERE s.id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('PUBLIC_SPACE_NOT_FOUND');
    return toSpace(row);
  }

  /**
   * Always a draft. `is_public` is not a column this statement can set, and
   * there is no field on the request that could ask it to.
   *
   * IT TAKES NO ROOM AND CANNOT BE REACHED FROM ONE. Creating a space is an
   * editorial act somebody performs on purpose; nothing about creating,
   * renaming or deactivating a room runs this method, and no request shape here
   * names an operational record.
   */
  async create(
    input: CreateSpaceRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Space> {
    const id = uuidv7();
    const name = canonicalText(input.name);
    const description = canonicalOptionalText(input.description);

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO public_space (
          id, name, description, display_order, is_public, created_at, created_by_user_id
        ) VALUES (
          ${id}::uuid, ${name}, ${description}, ${input.displayOrder},
          FALSE, transaction_timestamp(), ${actor.userId}::uuid
        )
      `;

      const row = await this.readLocked(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'public_space.created',
        entityType: 'public_space',
        entityId: id,
        after: spaceAudit(row),
      });

      return row;
    });

    return toSpace(created);
  }

  /**
   * Editing the DRAFT, at any point in the space's life.
   *
   * IT TOUCHES NO PUBLISHED COLUMN AND NO VISITOR SEES ANYTHING CHANGE. That is
   * what lets this stay open to `public_space.draft` on a space that is
   * currently live: the front desk can rewrite the description of the waiting
   * area, and the gallery goes on saying exactly what the manager last approved
   * until the manager approves the new wording.
   *
   * IT DOES NOT MOVE `public_revised_at` EITHER, for the reason an article's
   * draft edit does not: that column describes the PUBLISHED content, and a
   * draft edit has not modified it.
   */
  async update(
    id: string,
    input: UpdateSpaceRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Space> {
    const name = canonicalText(input.name);
    const description = canonicalOptionalText(input.description);

    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, id);

      await tx.$executeRaw`
        UPDATE public_space
        SET name = ${name},
            description = ${description},
            display_order = ${input.displayOrder}
        WHERE id = ${id}::uuid
      `;

      const after = await this.readLocked(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'public_space.updated',
        entityType: 'public_space',
        entityId: id,
        before: spaceAudit(before),
        after: spaceAudit(after),
      });

      return after;
    });

    return toSpace(updated);
  }

  /**
   * THE ONLY PLACE IN THIS APPLICATION THAT MAKES A SPACE'S WORDS VISIBLE.
   *
   * Publishing COPIES THE DRAFT ONTO THE PUBLISHED COLUMNS in the same
   * statement that sets the flag — the A2 rule, unchanged: "publish" means
   * "what the draft now says is what the website says", whether the gallery
   * entry was absent before or was showing an earlier version.
   *
   * WITHDRAWING LEAVES THE PUBLISHED COPY WHERE IT IS. Nothing reads it while
   * `is_public` is false, and keeping it means a withdrawn space still records
   * what the clinic last said.
   *
   * IT PUBLISHES NO PHOTOGRAPH, AND CANNOT. A space's images each carry their
   * own manager publication under `media.publish`; this statement writes no
   * media row. What unpublishing DOES do is make every published photograph on
   * this space unreachable at the origin on the very next request, because the
   * media predicate re-derives the owner's publication per request — the same
   * relationship an article has with its illustrations.
   *
   * IDEMPOTENT ON THE WHOLE ACT, NOT ON THE FLAG, exactly as an article's is:
   * publishing a space that is already public but carries a prepared change is
   * a real publication and is recorded as one.
   */
  async setPublication(
    id: string,
    isPublic: boolean,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Space> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, id);

      const alreadySettled = isPublic
        ? before.is_public && !before.has_unpublished_changes
        : !before.is_public;

      if (alreadySettled) return before;

      if (isPublic) {
        await tx.$executeRaw`
          UPDATE public_space
          SET is_public = TRUE,
              published_name = name,
              published_description = description,
              published_display_order = display_order,
              public_revised_at = transaction_timestamp()
          WHERE id = ${id}::uuid
        `;
      } else {
        await tx.$executeRaw`
          UPDATE public_space SET is_public = FALSE WHERE id = ${id}::uuid
        `;
      }

      const after = await this.readLocked(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: isPublic ? 'public_space.published' : 'public_space.unpublished',
        entityType: 'public_space',
        entityId: id,
        before: { isPublic: before.is_public },
        // What crossed the boundary: the published name in full, because it is
        // short and is what the gallery entry is identified by, and the
        // description as its length, for the reason an article's body is
        // recorded as a length.
        after: {
          isPublic: after.is_public,
          publishedName: after.published_name,
          publishedDescriptionLength:
            after.published_description === null ? 0 : after.published_description.length,
          publishedDisplayOrder: after.published_display_order,
        },
      });

      return after;
    });

    return toSpace(updated);
  }

  private async lock(tx: Prisma.TransactionClient, id: string): Promise<SpaceRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM public_space WHERE id = ${id}::uuid FOR UPDATE
    `;

    if (locked[0] === undefined) throw new AppError('PUBLIC_SPACE_NOT_FOUND');

    return this.readLocked(tx, id);
  }

  private async readLocked(tx: Prisma.TransactionClient, id: string): Promise<SpaceRow> {
    const rows = await tx.$queryRaw<SpaceRow[]>`
      SELECT ${SPACE_COLUMNS} FROM public_space s WHERE s.id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('PUBLIC_SPACE_NOT_FOUND');
    return row;
  }
}

/**
 * What an audit row says about a space.
 *
 * The name and the ordering in full — both short, and both what a reviewer
 * identifies a gallery entry by — and the description as its LENGTH, for the
 * reason an article's body is recorded as a length: `audit_log` can never be
 * pruned, and a copy of every draft of every paragraph would be the content
 * revision history this product declines to build, hidden in the one table that
 * cannot be cleaned up.
 */
function spaceAudit(row: SpaceRow): Record<string, string | number | boolean | null> {
  return {
    name: row.name,
    descriptionLength: row.description === null ? 0 : row.description.length,
    displayOrder: row.display_order,
    isPublic: row.is_public,
  };
}

function toSpace(row: SpaceRow): Space {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    displayOrder: row.display_order,
    isPublic: row.is_public,
    hasUnpublishedChanges: row.has_unpublished_changes,
    firstPublishedAt:
      row.public_first_published_at === null ? null : row.public_first_published_at.toISOString(),
    publicRevisedAt: row.public_revised_at === null ? null : row.public_revised_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}
