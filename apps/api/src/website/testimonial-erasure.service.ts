import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit.types';
import { uuidv7 } from '../common/uuid';
import {
  DEFAULT_MEDIA_ERASURE_OPTIONS,
  MediaErasureService,
  tryLockFiles,
  withFilesLockRetries,
  type ErasedFiles,
  type MediaErasureOptions,
} from '../media/media-erasure.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A family withdrew consent: erase what they gave the clinic.
 *
 * Milestone 10, checkpoint A3 (owner decision). The manager's
 * `TestimonialsService.withdrawConsent` takes the testimonial off the site at
 * once; this, the nightly `TESTIMONIAL_ERASURE` job, erases within
 * `TESTIMONIAL_CONSENT_ERASURE_DAYS`:
 *
 *   * the WORDS and the ATTRIBUTION — `body` and `author_label` cleared,
 *     `content_erased_at` stamped, in the erase-in-place pattern
 *     `website_request` established. The row remains: that a testimonial
 *     existed, when consent was withdrawn, who recorded it, when it was erased;
 *   * the BYTES of every photograph EVER attached to it — detached or not,
 *     and wherever else it is used — because each one is the family's (a
 *     photographed handwritten note above all). Through `MediaErasureService`,
 *     under the same files lock the backup shares, so it never breaks a
 *     backup running at the same time.
 *
 * ONE TRANSACTION PER TESTIMONIAL: its words and its photographs go together or
 * not at all. The row is locked first, then each photograph in id order.
 * `public_testimonial_withdrawal_is_final` refuses any other change to a
 * withdrawn row, and `media_asset_erasure_guard` refuses to erase a photograph
 * the database does not tie to a withdrawn testimonial.
 *
 * THE AUDIT ROW IS EMPTY, for the reason `website_request.purged` is: it says
 * the content was erased and, by its own timestamp, when. Each photograph gets
 * its own `media.bytes_erased` with the rule, sharing the run's request id.
 */

export type TestimonialErasureResult = {
  readonly eligible: number;
  readonly erased: number;
  /** Photographs whose bytes went with the testimonials erased. */
  readonly photographs: number;
  /** Left for the next run because a backup held the files lock throughout. */
  readonly deferred: number;
};

@Injectable()
export class TestimonialErasureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly media: MediaErasureService,
  ) {}

  async run(
    options: MediaErasureOptions = DEFAULT_MEDIA_ERASURE_OPTIONS,
  ): Promise<TestimonialErasureResult> {
    const context: AuditContext = { actor: { type: 'SYSTEM' }, requestId: uuidv7() };

    const eligible = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM public_testimonial
      WHERE consent_withdrawn_at IS NOT NULL AND content_erased_at IS NULL
      ORDER BY consent_withdrawn_at, id
    `;

    let erased = 0;
    let photographs = 0;
    let index = 0;

    const outcome = await withFilesLockRetries(options, async () => {
      while (index < eligible.length) {
        const id = eligible[index]!.id;

        const result = await this.prisma.$transaction(async (tx) => {
          if (!(await tryLockFiles(tx))) return 'LOCKED' as const;

          const locked = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM public_testimonial
            WHERE id = ${id}::uuid
              AND consent_withdrawn_at IS NOT NULL
              AND content_erased_at IS NULL
            FOR UPDATE
          `;

          // Another run got there first. Safe to repeat is the whole design.
          if (locked[0] === undefined) return null;

          const assets = await tx.$queryRaw<{ id: string; erased: boolean }[]>`
            SELECT a.id, a.bytes_purged_at IS NOT NULL AS erased
            FROM media_asset a
            WHERE a.id IN (
              SELECT media_asset_id FROM media_attachment WHERE testimonial_id = ${id}::uuid
            )
            ORDER BY a.id
            FOR UPDATE OF a
          `;

          const files: ErasedFiles = { assetIds: [], keys: [] };

          for (const asset of assets) {
            if (asset.erased) continue;

            const one = await this.media.eraseLocked(
              tx,
              asset.id,
              'TESTIMONIAL_CONSENT_WITHDRAWN',
              context,
            );
            files.assetIds.push(...one.assetIds);
            files.keys.push(...one.keys);
          }

          await tx.$executeRaw`
            UPDATE public_testimonial
            SET body = NULL,
                author_label = NULL,
                content_erased_at = transaction_timestamp()
            WHERE id = ${id}::uuid
          `;

          await this.audit.record(tx, context, {
            action: 'public_testimonial.content_erased',
            entityType: 'public_testimonial',
            entityId: id,
          });

          return files;
        });

        if (result === 'LOCKED') return 'LOCKED';

        index += 1;
        if (result !== null) {
          erased += 1;
          photographs += result.assetIds.length;
          // After the commit, never before: see `MediaErasureService`.
          await this.media.removeFiles(result);
        }
      }

      return 'DONE';
    });

    return {
      eligible: eligible.length,
      erased,
      photographs,
      deferred: outcome === 'LOCKED' ? eligible.length - index : 0,
    };
  }

  /** What `run` would erase now. Writes nothing. */
  async countEligible(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public_testimonial
      WHERE consent_withdrawn_at IS NOT NULL AND content_erased_at IS NULL
    `;

    return rows[0]?.count ?? 0;
  }
}
