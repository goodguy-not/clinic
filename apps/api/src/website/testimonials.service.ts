import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TESTIMONIAL_CONSENT_ERASURE_DAYS } from '@clinic/contracts';
import type {
  CreateTestimonialRequest,
  Testimonial,
  TestimonialConsentWithdrawal,
  TestimonialKind,
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
 * MILESTONE 9.5, CHECKPOINT A7 ADDS `kind` AND CHANGES NONE OF THE THREE.
 * A `HANDWRITTEN` testimonial is a note a family wrote and the clinic
 * photographed, and the ONE rule it adds is that THE PHOTOGRAPH IS NEVER THE
 * MEANING: `body` — a transcription a human read and typed — is required for
 * both kinds by `createTestimonialRequestSchema`, by the NOT NULL column, by
 * `public_testimonial_body_chk` and again by
 * `public_testimonial_handwritten_body_chk`, so a handwritten testimonial with
 * nothing written down cannot be created, let alone approved or published.
 *
 * NOTHING IN THIS FILE READS A PHOTOGRAPH, AND NO COLUMN IT WRITES COULD HOLD
 * MACHINE-READ TEXT. There is no OCR anywhere in this application and no field
 * for its output. A transcription reaches `body` through `create` and `update`
 * like any other prose — which is to say, because a person typed it and takes
 * responsibility for it.
 *
 * THE IMAGE IS NOT WRITTEN HERE EITHER. A testimonial's photograph is a
 * `media_attachment` row, attached under `media.attach` and published under
 * `media.publish`, and the media serving predicate additionally refuses it
 * while the testimonial is not public. So the family's handwriting reaches a
 * visitor only after a manager has approved the words, published the
 * testimonial AND published the attachment: three manager acts, and withdrawing
 * the approval revokes all three consequences in one transaction.
 *
 * THE CLINIC'S CONSENT POLICY IS NOT MODELLED HERE, IN ANY FORM. Manager
 * approval is the privacy gate this product enforces; how consent to publish a
 * family's words is obtained, recorded, versioned or withdrawn is an owner and
 * legal decision (PROJECT_SPEC.md 17), and nothing in this file guesses at it.
 *
 * A FAMILY WITHDRAWING CONSENT IS A FOURTH RULE (Milestone 10, checkpoint A3,
 * owner decision). The manager records it with `withdrawConsent`: in one
 * transaction the approval is revoked and the quotation leaves the site, and
 * from then on the testimonial is ABSENT from every read here — list, get,
 * edit, approve, publish, and attaching a photograph — because a family who
 * asked for their words to be erased is not asking for them to be edited.
 * Within `TESTIMONIAL_CONSENT_ERASURE_DAYS` the nightly job erases the words,
 * the attribution and every photograph ever attached
 * (`TestimonialErasureService`). `listConsentWithdrawals` is the one read that
 * still names the row, and it carries dates only. The database makes both
 * acts final (`public_testimonial_withdrawal_is_final`).
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
  kind: TestimonialKind;
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
  t.kind::text AS kind,
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
      SELECT ${TESTIMONIAL_COLUMNS} FROM public_testimonial t
      WHERE t.consent_withdrawn_at IS NULL
      ORDER BY t.id DESC
    `;

    return rows.map(toTestimonial);
  }

  async get(id: string): Promise<Testimonial> {
    const rows = await this.prisma.$queryRaw<TestimonialRow[]>`
      SELECT ${TESTIMONIAL_COLUMNS} FROM public_testimonial t
      WHERE t.id = ${id}::uuid AND t.consent_withdrawn_at IS NULL
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
    // `canonicalText` trims, and `publicProseSchema` has already refused an
    // empty or whitespace-only body. Together they are why a HANDWRITTEN
    // testimonial cannot be created from a photograph alone: there is no path
    // through this method that stores one without words.
    const body = canonicalText(input.body);

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO public_testimonial (
          id, author_label, body, kind, status, is_public, created_at, created_by_user_id
        ) VALUES (
          ${id}::uuid, ${authorLabel}, ${body}, ${input.kind}::testimonial_kind,
          'DRAFT'::testimonial_status,
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
        SET author_label = ${authorLabel},
            body = ${body},
            kind = ${input.kind}::testimonial_kind
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

  /**
   * A family has withdrawn consent. Manager-only (`testimonial.approve`).
   *
   * One transaction: approval revoked, taken off the site, the withdrawal
   * stamped with who recorded it. Repeating it is a no-op rather than a
   * `404`, so a retried request after a dropped connection is not an error.
   * It cannot be undone — the database refuses — and it needs no reason: the
   * reason is the family's, and it is the act itself.
   */
  async withdrawConsent(
    id: string,
    actor: ResolvedSession,
    context: RequestContext,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ withdrawn: boolean }[]>`
        SELECT consent_withdrawn_at IS NOT NULL AS withdrawn
        FROM public_testimonial WHERE id = ${id}::uuid FOR UPDATE
      `;

      if (locked[0] === undefined) throw new AppError('TESTIMONIAL_NOT_FOUND');
      if (locked[0].withdrawn) return;

      const before = await this.readLocked(tx, id);

      await tx.$executeRaw`
        UPDATE public_testimonial
        SET status = 'DRAFT'::testimonial_status,
            approved_at = NULL,
            is_public = FALSE,
            consent_withdrawn_at = transaction_timestamp(),
            consent_withdrawn_by_user_id = ${actor.userId}::uuid
        WHERE id = ${id}::uuid
      `;

      // Status and placement only: the words are about to be erased, and an
      // audit row is the one place they could never be erased from.
      await this.audit.record(tx, actorContext(actor, context), {
        action: 'public_testimonial.consent_withdrawn',
        entityType: 'public_testimonial',
        entityId: id,
        before: { status: before.status, isPublic: before.is_public },
        after: { status: 'DRAFT', isPublic: false },
      });

      // The second fact, as `setApproval` records it: the page changed.
      if (before.is_public) {
        await this.audit.record(tx, actorContext(actor, context), {
          action: 'public_testimonial.unpublished',
          entityType: 'public_testimonial',
          entityId: id,
          before: { isPublic: true },
          after: { isPublic: false },
          metadata: { cause: 'consent_withdrawn' },
        });
      }
    });
  }

  /** Every withdrawal, newest first: dates and an id, never content. */
  async listConsentWithdrawals(): Promise<TestimonialConsentWithdrawal[]> {
    const rows = await this.prisma.$queryRaw<
      { id: string; consent_withdrawn_at: Date; content_erased_at: Date | null; due: Date }[]
    >`
      SELECT id, consent_withdrawn_at, content_erased_at,
             consent_withdrawn_at
               + ${`${TESTIMONIAL_CONSENT_ERASURE_DAYS} days`}::interval AS due
      FROM public_testimonial
      WHERE consent_withdrawn_at IS NOT NULL
      ORDER BY consent_withdrawn_at DESC, id DESC
    `;

    return rows.map((row) => ({
      id: row.id,
      consentWithdrawnAt: row.consent_withdrawn_at.toISOString(),
      contentErasedAt: row.content_erased_at === null ? null : row.content_erased_at.toISOString(),
      erasureDueBy: row.due.toISOString(),
    }));
  }

  private async lock(tx: Prisma.TransactionClient, id: string): Promise<TestimonialRow> {
    // A withdrawn testimonial is not found: nothing may edit, approve or
    // publish it again (and the database would refuse each of them).
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM public_testimonial
      WHERE id = ${id}::uuid AND consent_withdrawn_at IS NULL
      FOR UPDATE
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
 * THE ATTRIBUTION IS NOW A LENGTH TOO (Milestone 10, checkpoint A3). Until
 * then it was recorded in full, so a reviewer could check it after the fact —
 * but a family may now withdraw consent, and the owner's rule is that the
 * trail keeps THAT the words and the attribution were erased, never what they
 * were. A value copied into `audit_log` can never be erased, so the only way to
 * honour that rule is never to copy it. The reviewer checks the attribution on
 * the row itself, where it is frozen from approval until it is erased. Rows
 * written before this change still carry the label (DECISION_LOG, 2026-09-26).
 */
function testimonialAudit(row: TestimonialRow): Record<string, string | number | boolean | null> {
  return {
    authorLabelLength: row.author_label === null ? null : row.author_label.length,
    bodyLength: row.body.length,
    // Recorded in full: it is one of two words, it is not identifying, and it
    // is the fact a reviewer needs in order to tell whether the words they are
    // approving are a transcription of somebody's handwriting.
    kind: row.kind,
    status: row.status,
    isPublic: row.is_public,
  };
}

function toTestimonial(row: TestimonialRow): Testimonial {
  return {
    id: row.id,
    authorLabel: row.author_label,
    body: row.body,
    kind: row.kind,
    status: row.status,
    approvedAt: row.approved_at === null ? null : row.approved_at.toISOString(),
    isPublic: row.is_public,
    firstPublishedAt:
      row.public_first_published_at === null ? null : row.public_first_published_at.toISOString(),
    publicRevisedAt: row.public_revised_at === null ? null : row.public_revised_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}
