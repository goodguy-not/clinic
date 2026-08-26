import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateTestimonialRequest,
  Testimonial,
  TestimonialStatus,
  UpdateTestimonialRequest,
} from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/app-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';
import { actorContext, canonicalOptionalText, canonicalText } from '../catalog/catalog-support';

/**
 * Testimonials: drafted, reviewed, approved, published, and taken down again.
 *
 * Milestone 9, checkpoint A2.
 *
 * THREE RULES, AND THE DATABASE HOLDS ALL THREE INDEPENDENTLY OF THIS FILE:
 *
 *  1. A record existing is NOT approval. Every row starts `DRAFT`, whoever
 *     wrote it, and only `setApproval` under `testimonial.approve` — a
 *     manager-only permission — moves it.
 *  2. Nothing unapproved can be public. `public_testimonial_approval_chk`
 *     refuses `is_public` on a row that is not `APPROVED`, so even a
 *     hand-written UPDATE cannot put unreviewed words on a page.
 *  3. Approved words are frozen. Editing them is refused
 *     (`TESTIMONIAL_APPROVED`); the manager withdraws the approval first, which
 *     also takes the quotation off the site in the same transaction. Any other
 *     rule lets approved text be rewritten into something nobody reviewed,
 *     which is exactly what the approval exists to prevent.
 *
 * WITHDRAWING APPROVAL WRITES TWO AUDIT ROWS WHEN IT UNPUBLISHES. Two things
 * genuinely happened — the review was withdrawn and the page changed — and they
 * share a request id, so a reader sees one act with two consequences rather
 * than one entry they have to interpret.
 */

type TestimonialRow = {
  id: string;
  author_label: string | null;
  body: string;
  status: TestimonialStatus;
  approved_at: Date | null;
  is_public: boolean;
  public_first_published_at: Date | null;
  public_revised_at: Date | null;
  created_at: Date;
};

const TESTIMONIAL_COLUMNS = Prisma.sql`
  t.id,
  t.author_label,
  t.body,
  t.status::text AS status,
  t.approved_at,
  t.is_public,
  t.public_first_published_at,
  t.public_revised_at,
  t.created_at
`;

@Injectable()
export class TestimonialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Everything, including unapproved drafts. Behind `testimonial.read`. */
  async list(): Promise<Testimonial[]> {
    const rows = await this.prisma.$queryRaw<TestimonialRow[]>`
      SELECT ${TESTIMONIAL_COLUMNS} FROM public_testimonial t ORDER BY t.id DESC
    `;

    return rows.map(toTestimonial);
  }

  async get(id: string): Promise<Testimonial> {
    const rows = await this.prisma.$queryRaw<TestimonialRow[]>`
      SELECT ${TESTIMONIAL_COLUMNS} FROM public_testimonial t WHERE t.id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('TESTIMONIAL_NOT_FOUND');
    return toTestimonial(row);
  }

  /** Always a `DRAFT`, and never public. Neither is a column this can set. */
  async create(
    input: CreateTestimonialRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Testimonial> {
    const id = uuidv7();
    const authorLabel = canonicalOptionalText(input.authorLabel);
    const body = canonicalText(input.body);

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO public_testimonial (
          id, author_label, body, status, is_public, created_at, created_by_user_id
        ) VALUES (
          ${id}::uuid, ${authorLabel}, ${body}, 'DRAFT'::testimonial_status,
          FALSE, transaction_timestamp(), ${actor.userId}::uuid
        )
      `;

      const row = await this.readLocked(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'public_testimonial.created',
        entityType: 'public_testimonial',
        entityId: id,
        after: testimonialAudit(row),
      });

      return row;
    });

    return toTestimonial(created);
  }

  /** Refused once the words have been approved. See the rules above. */
  async update(
    id: string,
    input: UpdateTestimonialRequest,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Testimonial> {
    const authorLabel = canonicalOptionalText(input.authorLabel);
    const body = canonicalText(input.body);

    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, id);

      if (before.status === 'APPROVED') throw new AppError('TESTIMONIAL_APPROVED');

      await tx.$executeRaw`
        UPDATE public_testimonial
        SET author_label = ${authorLabel}, body = ${body}
        WHERE id = ${id}::uuid
      `;

      const after = await this.readLocked(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: 'public_testimonial.updated',
        entityType: 'public_testimonial',
        entityId: id,
        before: testimonialAudit(before),
        after: testimonialAudit(after),
      });

      return after;
    });

    return toTestimonial(updated);
  }

  /**
   * The privacy review PROJECT_SPEC.md 11 requires, in both directions.
   *
   * Withdrawing approval UNPUBLISHES in the same statement. Leaving that to a
   * second request would put an approved-and-published quotation on a live page
   * with its approval already revoked, for as long as somebody took to remember
   * — and the database would refuse the first half anyway, because
   * `public_testimonial_approval_chk` will not let a public row be anything but
   * `APPROVED`.
   */
  async setApproval(
    id: string,
    approved: boolean,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Testimonial> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, id);
      const wasApproved = before.status === 'APPROVED';

      if (wasApproved === approved) return before;

      await tx.$executeRaw`
        UPDATE public_testimonial
        SET status = ${approved ? 'APPROVED' : 'DRAFT'}::testimonial_status,
            approved_at = ${approved ? Prisma.sql`transaction_timestamp()` : Prisma.sql`NULL`},
            is_public = ${approved ? Prisma.sql`is_public` : Prisma.sql`FALSE`}
        WHERE id = ${id}::uuid
      `;

      const after = await this.readLocked(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: approved ? 'public_testimonial.approved' : 'public_testimonial.approval_revoked',
        entityType: 'public_testimonial',
        entityId: id,
        before: testimonialAudit(before),
        after: testimonialAudit(after),
      });

      // The second fact, in the same transaction and under the same request id:
      // the quotation came off the website. Recorded as its own action because
      // it is its own event — somebody looking for "when did this stop being
      // visible?" finds the same action here as for a deliberate unpublish.
      if (before.is_public && !after.is_public) {
        await this.audit.record(tx, actorContext(actor, context), {
          action: 'public_testimonial.unpublished',
          entityType: 'public_testimonial',
          entityId: id,
          before: { isPublic: true },
          after: { isPublic: false },
          metadata: { cause: 'approval_revoked' },
        });
      }

      return after;
    });

    return toTestimonial(updated);
  }

  /**
   * Placement on a page, separate from approval.
   *
   * Refused on anything unapproved — `TESTIMONIAL_NOT_APPROVED`, checked here
   * so the manager gets a sentence, and refused again by the CHECK behind it.
   */
  async setPublication(
    id: string,
    isPublic: boolean,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<Testimonial> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, id);

      if (isPublic && before.status !== 'APPROVED') {
        throw new AppError('TESTIMONIAL_NOT_APPROVED');
      }

      if (before.is_public === isPublic) return before;

      await tx.$executeRaw`
        UPDATE public_testimonial
        SET is_public = ${isPublic},
            public_revised_at = CASE
              WHEN ${isPublic} THEN transaction_timestamp()
              ELSE public_revised_at
            END
        WHERE id = ${id}::uuid
      `;

      const after = await this.readLocked(tx, id);

      await this.audit.record(tx, actorContext(actor, context), {
        action: isPublic ? 'public_testimonial.published' : 'public_testimonial.unpublished',
        entityType: 'public_testimonial',
        entityId: id,
        before: { isPublic: before.is_public },
        after: { isPublic: after.is_public },
      });

      return after;
    });

    return toTestimonial(updated);
  }

  private async lock(tx: Prisma.TransactionClient, id: string): Promise<TestimonialRow> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM public_testimonial WHERE id = ${id}::uuid FOR UPDATE
    `;

    if (locked[0] === undefined) throw new AppError('TESTIMONIAL_NOT_FOUND');

    return this.readLocked(tx, id);
  }

  private async readLocked(tx: Prisma.TransactionClient, id: string): Promise<TestimonialRow> {
    const rows = await tx.$queryRaw<TestimonialRow[]>`
      SELECT ${TESTIMONIAL_COLUMNS} FROM public_testimonial t WHERE t.id = ${id}::uuid
    `;

    const row = rows[0];
    if (row === undefined) throw new AppError('TESTIMONIAL_NOT_FOUND');
    return row;
  }
}

/**
 * What an audit row says about a testimonial.
 *
 * THE QUOTATION ITSELF IS RECORDED AS ITS LENGTH. It is somebody else's words
 * about their child's therapy, and `audit_log` is the one table in this schema
 * that can never be deleted or pruned: copying a family's account of their
 * child into it on every draft edit would build a permanent, unremovable store
 * of exactly the content PROJECT_SPEC.md 11 requires a manager to review before
 * anybody sees it. The trail records that the text changed, when, and who
 * changed it; the text lives in the one row that can be corrected.
 *
 * `authorLabel` IS recorded in full, and deliberately: it is short, it is the
 * attribution a reviewer has to be able to check after the fact, and it is the
 * field where an identifying name would appear if one ever did.
 */
function testimonialAudit(row: TestimonialRow): Record<string, string | number | boolean | null> {
  return {
    authorLabel: row.author_label,
    bodyLength: row.body.length,
    status: row.status,
    isPublic: row.is_public,
  };
}

function toTestimonial(row: TestimonialRow): Testimonial {
  return {
    id: row.id,
    authorLabel: row.author_label,
    body: row.body,
    status: row.status,
    approvedAt: row.approved_at === null ? null : row.approved_at.toISOString(),
    isPublic: row.is_public,
    firstPublishedAt:
      row.public_first_published_at === null ? null : row.public_first_published_at.toISOString(),
    publicRevisedAt: row.public_revised_at === null ? null : row.public_revised_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}
