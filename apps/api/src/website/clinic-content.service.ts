import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  ClinicContentEntry,
  ClinicContentSlot,
  PublicImage,
  UpdateClinicContentEntryRequest,
} from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import { actorContext, canonicalOptionalText } from '../catalog/catalog-support';
import { AppError } from '../common/app-error';
import { isCheckViolation } from '../common/pg-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { PublicMediaService } from '../media/public-media.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The clinic's routine public copy, written by the manager who owns it.
 *
 * Milestone 9.5, checkpoint A8. Checkpoint A2 gave the clinic's FACTS a writer
 * so that changing the address on a live website stopped being a deployment.
 * This is the same act for the clinic's WORDS: the home hero, the five concern
 * prompts, the first-session moments and the about-page blocks were copy
 * compiled into the web tier, and after this file they are rows a manager
 * edits.
 *
 * ONE BLOCK AT A TIME, ALL FOUR OF ITS FIELDS EVERY TIME. The profile's writer
 * replaces thirteen fields in one act because they are thirteen boxes on one
 * screen; a block is four boxes on one card, and the same rule applies within
 * it — a partial update would have to distinguish "leave the kicker alone" from
 * "clear it". Twenty-one blocks in one request would instead be one audit row
 * covering a page's worth of unrelated edits, which is the opposite of what the
 * trail is for.
 *
 * NOTHING HERE CREATES OR DELETES A BLOCK. The slots are the accepted design,
 * they exist from the migration that inserted them empty, and `slot` and
 * `position` are identity rather than data: no statement in this file writes
 * either, and the database refuses a DELETE outright. A manager takes a block
 * off the website by clearing its heading, which is reversible and audited.
 *
 * THERE IS NO PUBLICATION ACT TO SEPARATE FROM THE EDIT, and that is the frozen
 * rule for this surface rather than an omission. `clinic_profile.update` is
 * manager-only, no lower authority may draft here, and what a manager saves is
 * what the site says — exactly as A2 froze for the profile row. A receptionist
 * reaching either route is refused by the guard chain with no state change.
 *
 * CLEARING A HEADING TAKES THE PHOTOGRAPH WITH IT. `heading IS NULL` is read by
 * the public projection AND by `LIVE_ATTACHMENT_PREDICATE`, so a block that
 * says nothing shows nothing — including a picture a manager had published on
 * it, at the origin, on the very next anonymous request. That is one rule with
 * two readers rather than two rules that could drift.
 *
 * NO PHOTOGRAPH IS WRITTEN HERE AT ALL. Images are `media_attachment` rows
 * owned by the media module, attached under `media.attach` and published under
 * `media.publish`. Nothing in this file creates, publishes or detaches one; it
 * READS the published image so that the manager's screen can show what the site
 * is showing, through the same predicate the serving route applies.
 *
 * NOTHING IS INVENTED HERE. No default heading, no sample paragraph, no
 * placeholder prompt: the real copy is owner-supplied (PROJECT_SPEC.md 17), and
 * every fixture in this repository that fills a slot is obviously synthetic.
 */
@Injectable()
export class ClinicContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: PublicMediaService,
  ) {}

  /**
   * Every slot, written or not, in the order the pages render them.
   *
   * IT SHOWS THE EMPTY ONES, WHICH IS THE DIFFERENCE FROM THE PUBLIC READ. A
   * website cannot render a block with nothing in it; a manager has come to
   * this screen precisely to find the boxes nobody has filled in.
   */
  async list(): Promise<ClinicContentEntry[]> {
    const rows = await this.prisma.$queryRaw<ClinicContentEntryRow[]>`
      ${ENTRY_COLUMNS}
      FROM clinic_content_entry e
      ORDER BY e.slot ASC, e.position ASC
    `;

    const images = await this.media.imagesForOwners(
      'CLINIC_CONTENT_ENTRY',
      rows.map((row) => row.id),
    );

    return rows.map((row) => toClinicContentEntry(row, images));
  }

  /**
   * Replaces one block's copy.
   *
   * THE ROW IS LOCKED FOR THE LENGTH OF THE TRANSACTION, for the reason the
   * profile's writer locks its singleton: two managers saving the same card at
   * once would otherwise interleave a read and a write, and the audit row of
   * the second would claim a `before` the first had already replaced.
   *
   * A CHECK VIOLATION IS `VALIDATION_FAILED` RATHER THAN A 500. The four text
   * constraints on this table restate rules the request schema already
   * enforces, so reaching one means the two tiers disagree — a defect, not a
   * user mistake — but the caller's next move is the same either way: look at
   * what was typed. This is `ClinicProfileService`'s reasoning, unchanged.
   */
  async update(
    id: string,
    input: UpdateClinicContentEntryRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<ClinicContentEntry> {
    const next = {
      label: canonicalOptionalText(input.label),
      eyebrow: canonicalOptionalText(input.eyebrow),
      heading: canonicalOptionalText(input.heading),
      body: canonicalOptionalText(input.body),
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await lockEntry(tx, id);

      try {
        await tx.$executeRaw`
          UPDATE clinic_content_entry
          SET label = ${next.label},
              eyebrow = ${next.eyebrow},
              heading = ${next.heading},
              body = ${next.body}
          WHERE id = ${id}::uuid
        `;
      } catch (error) {
        if (isCheckViolation(error)) throw new AppError('VALIDATION_FAILED');
        throw error;
      }

      const after = await readEntry(tx, id);

      // ONE ACTION AND NO PUBLICATION ACT TO SEPARATE FROM IT, exactly as
      // `clinic_public_profile.updated` has none: the block is always live, so
      // editing it IS publishing.
      //
      // THE WHOLE PAYLOAD IS RECORDED. These are short public sentences about a
      // business, written to be read by strangers — not personal data and not
      // private prose — so recording them in full is what makes the trail
      // answer "what did the home page say last month?".
      //
      // `slot` AND `position` ARE IN THE PAYLOAD AND ARE NEVER WRITTEN. They
      // are there so a reader of the trail knows WHICH block changed without
      // having to resolve a UUID against a table.
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'clinic_content_entry.updated',
        entityType: 'clinic_content_entry',
        entityId: id,
        before: auditableEntry(before),
        after: auditableEntry(after),
        metadata: {
          // The one derived fact worth stating outright, because it is the
          // publication consequence: this edit put the block on the website or
          // took it off, and with it any photograph attached to it.
          publishedStateChanged: (before.heading === null) !== (after.heading === null),
        },
      });

      return after;
    });

    const images = await this.media.imagesForOwners('CLINIC_CONTENT_ENTRY', [id]);

    return toClinicContentEntry(updated, images);
  }
}

/**
 * The columns of a block, named once.
 *
 * Written out rather than `SELECT *` for the reason every public projection in
 * this milestone is written out: a column added to this table tomorrow has to
 * be added HERE, visibly, before it can reach a response.
 */
const ENTRY_COLUMNS = Prisma.sql`
  SELECT e.id, e.slot::text AS slot, e.position, e.label, e.eyebrow, e.heading, e.body
`;

type ClinicContentEntryRow = {
  id: string;
  slot: ClinicContentSlot;
  position: number;
  label: string | null;
  eyebrow: string | null;
  heading: string | null;
  body: string | null;
};

async function lockEntry(tx: Prisma.TransactionClient, id: string): Promise<ClinicContentEntryRow> {
  const rows = await tx.$queryRaw<ClinicContentEntryRow[]>`
    ${ENTRY_COLUMNS}
    FROM clinic_content_entry e
    WHERE e.id = ${id}::uuid
    FOR UPDATE
  `;

  const row = rows[0];
  if (row === undefined) throw new AppError('CLINIC_CONTENT_ENTRY_NOT_FOUND');
  return row;
}

async function readEntry(tx: Prisma.TransactionClient, id: string): Promise<ClinicContentEntryRow> {
  const rows = await tx.$queryRaw<ClinicContentEntryRow[]>`
    ${ENTRY_COLUMNS}
    FROM clinic_content_entry e
    WHERE e.id = ${id}::uuid
  `;

  const row = rows[0];
  if (row === undefined) throw new AppError('CLINIC_CONTENT_ENTRY_NOT_FOUND');
  return row;
}

function toClinicContentEntry(
  row: ClinicContentEntryRow,
  images: Map<string, PublicImage[]>,
): ClinicContentEntry {
  return {
    id: row.id,
    slot: row.slot,
    position: row.position,
    label: row.label,
    eyebrow: row.eyebrow,
    heading: row.heading,
    body: row.body,
    // The FIRST in the clinic's own order, for the reason a therapist portrait
    // takes the first: a block is an illustrated paragraph rather than a
    // gallery, and showing one of two beats showing none. The media library
    // shows a manager every attachment there is.
    image: images.get(row.id)?.[0] ?? null,
  };
}

/**
 * The block as an audit payload: all of it, including the identity fields.
 *
 * Written as an explicit object rather than a spread, so a column added to this
 * table tomorrow has to be added here — visibly — or withheld here, visibly,
 * with a reason beside it. Nothing is withheld today: every value is public
 * copy about a business.
 */
function auditableEntry(row: ClinicContentEntryRow): Record<string, string | number | null> {
  return {
    slot: row.slot,
    position: row.position,
    label: row.label,
    eyebrow: row.eyebrow,
    heading: row.heading,
    body: row.body,
  };
}
