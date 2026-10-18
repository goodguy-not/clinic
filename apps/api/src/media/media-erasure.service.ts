import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MEDIA_ARCHIVED_ERASURE_DAYS, MEDIA_UNATTACHED_ERASURE_DAYS } from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import type { AuditContext } from '../audit/audit.types';
import { uuidv7 } from '../common/uuid';
import { PrismaService } from '../prisma/prisma.service';
import { MediaStorageService } from './media-storage.service';

/**
 * Erasing a photograph's bytes — the owner's media retention decision.
 *
 * Milestone 10, checkpoint A3. The first code in this product that removes a
 * stored file, and it removes only what the owner decided may go:
 *
 *   * a photograph uploaded thirty days ago and NEVER attached anywhere;
 *   * a photograph a manager ARCHIVED thirty days ago (restorable until then);
 *   * every photograph ever attached to a testimonial whose family withdrew
 *     consent — erased by `TestimonialErasureService` through `eraseLocked`.
 *
 * ============================ WHAT IT ERASES ================================
 *
 * THE BYTES: the master and every rendition, on disk, and the storage keys that
 * named them. AND THE DESCRIPTION (owner decision, Milestone 9.5 A10): the alt
 * text can name a child, so it is cleared in the same statement that stamps
 * `bytes_purged_at`. The ROW stays — the erase-in-place pattern
 * `website_request` established: the asset still says a photograph existed,
 * when it arrived, who uploaded it and where it was used, with
 * `bytes_purged_at` saying when its content went. `audit_log` never held the
 * words (`media.uploaded` and `media.alt_text_updated` record lengths), so the
 * erasure's own audit row is the only trace, and it records only that it
 * happened.
 *
 * ================= IT NEVER BREAKS A BACKUP RUNNING AT THE SAME TIME =========
 *
 * `backup.sh` reads the database in one snapshot and then copies exactly the
 * files that snapshot names. A file unlinked between the two would fail that
 * backup (loudly — it checks every hash — but it would fail). So the two share
 * ONE PostgreSQL ADVISORY LOCK, `MEDIA_FILES_LOCK`:
 *
 *   * the backup holds it SHARED from before its snapshot until the last file
 *     is copied (`scripts/backup/sql/backup.sql`);
 *   * each erasure transaction takes it EXCLUSIVELY with a try-lock before it
 *     changes anything, and commits while holding it.
 *
 * So no erasure can commit while a backup that might name its files is running,
 * and every backup that starts after the commit reads a snapshot in which the
 * keys are already gone and will not look for the files. The unlink after the
 * commit is therefore safe whenever it happens — which is also why a process
 * that dies between commit and unlink loses nothing: `sweepErased` removes what
 * any erased asset still has on disk, on every run.
 *
 * If a backup holds the lock, the run WAITS (up to `backupWaitMs`) and then
 * leaves the rest for the next night. Work left over makes the run incomplete,
 * which the manager's job status shows once it has lasted two days.
 *
 * ============================ HOW IT BEHAVES ================================
 *
 * ONE TRANSACTION PER PHOTOGRAPH, eligibility re-read under the row lock in a
 * separate statement — so an attach that committed while this waited is seen,
 * and a photograph attached at the last moment is skipped rather than erased.
 * `media_asset_erasure_guard` and `media_rendition_erasure_only` refuse an
 * erasure the database does not consider due, so a mistake in the predicate
 * below is a failed run, never a lost photograph. Safe to run twice, and to
 * run concurrently: an erased row no longer matches.
 *
 * THE AUDIT ROW NAMES THE RULE, NEVER THE CONTENT. `media.bytes_erased`, actor
 * `SYSTEM`, with `{ rule }` — which of the owner's rules applied — and nothing
 * about what the photograph showed.
 */

/**
 * The advisory lock shared with `scripts/backup/sql/backup.sql`. The two-key
 * form lives in a different lock space from every single-key lock in this
 * application, so nothing else can collide with it. `media-erasure.service.spec.ts`
 * pins that the backup names these same numbers.
 */
export const MEDIA_FILES_LOCK = { classId: 4919, objectId: 10 } as const;

export type MediaErasureRule = 'UNATTACHED' | 'ARCHIVED' | 'TESTIMONIAL_CONSENT_WITHDRAWN';

export type MediaErasureOptions = {
  /** How long to wait for a running backup before leaving the rest for next time. */
  readonly backupWaitMs: number;
  /** How often to retry the lock while waiting. */
  readonly pollMs: number;
};

export const DEFAULT_MEDIA_ERASURE_OPTIONS: MediaErasureOptions = {
  backupWaitMs: 30 * 60_000,
  pollMs: 15_000,
};

export type MediaErasureResult = {
  readonly eligible: number;
  readonly erased: number;
  /** Left for the next run because a backup held the files lock throughout. */
  readonly deferred: number;
};

/** What one erasure transaction hands back, to unlink after it commits. */
export type ErasedFiles = { readonly assetIds: string[]; readonly keys: string[] };

@Injectable()
export class MediaErasureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: MediaStorageService,
  ) {}

  /** The two thirty-day rules. The testimonial rule runs from its own job. */
  async run(
    options: MediaErasureOptions = DEFAULT_MEDIA_ERASURE_OPTIONS,
  ): Promise<MediaErasureResult> {
    const context: AuditContext = { actor: { type: 'SYSTEM' }, requestId: uuidv7() };

    const eligible = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id FROM media_asset a WHERE ${dueForRetention('a')} ORDER BY a.id
    `;

    let erased = 0;
    let index = 0;

    const outcome = await withFilesLockRetries(options, async () => {
      while (index < eligible.length) {
        const id = eligible[index]!.id;

        const result = await this.prisma.$transaction(async (tx) => {
          if (!(await tryLockFiles(tx))) return 'LOCKED' as const;

          await tx.$queryRaw`SELECT id FROM media_asset WHERE id = ${id}::uuid FOR UPDATE`;

          // A SEPARATE STATEMENT, AFTER THE LOCK: it sees whatever an attach or
          // a restore committed while this transaction waited for the row.
          const due = await tx.$queryRaw<{ rule: MediaErasureRule }[]>`
            SELECT CASE
                     WHEN a.status = 'ARCHIVED'::media_asset_status
                          AND a.archived_at <= transaction_timestamp()
                              - ${`${MEDIA_ARCHIVED_ERASURE_DAYS} days`}::interval
                       THEN 'ARCHIVED'
                     ELSE 'UNATTACHED'
                   END AS rule
            FROM media_asset a
            WHERE a.id = ${id}::uuid AND ${dueForRetention('a')}
          `;

          const rule = due[0]?.rule;
          if (rule === undefined) return null;

          return this.eraseLocked(tx, id, rule, context);
        });

        if (result === 'LOCKED') return 'LOCKED';

        index += 1;
        if (result !== null) {
          erased += 1;
          await this.removeFiles(result);
        }
      }

      return 'DONE';
    });

    return {
      eligible: eligible.length,
      erased,
      deferred: outcome === 'LOCKED' ? eligible.length - index : 0,
    };
  }

  /** What `run` would erase now. Writes nothing. */
  async countEligible(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM media_asset a WHERE ${dueForRetention('a')}
    `;

    return rows[0]?.count ?? 0;
  }

  /**
   * Erase one photograph's bytes inside the caller's transaction.
   *
   * PRECONDITIONS, BOTH THE CALLER'S: it holds `MEDIA_FILES_LOCK` in this
   * transaction (`tryLockFiles`), and it holds the asset row `FOR UPDATE` and
   * has decided the asset is due. Returns the keys to remove once the
   * transaction has COMMITTED — never before, or a rollback would leave rows
   * naming files that are gone.
   */
  async eraseLocked(
    tx: Prisma.TransactionClient,
    assetId: string,
    rule: MediaErasureRule,
    context: AuditContext,
  ): Promise<ErasedFiles> {
    const master = await tx.$queryRaw<{ key: string | null }[]>`
      SELECT master_storage_key AS key FROM media_asset WHERE id = ${assetId}::uuid
    `;
    const renditions = await tx.$queryRaw<{ key: string }[]>`
      SELECT storage_key AS key FROM media_rendition
      WHERE media_asset_id = ${assetId}::uuid AND storage_key IS NOT NULL
    `;

    await tx.$executeRaw`
      UPDATE media_rendition
      SET storage_key = NULL, bytes_purged_at = transaction_timestamp()
      WHERE media_asset_id = ${assetId}::uuid AND bytes_purged_at IS NULL
    `;
    await tx.$executeRaw`
      UPDATE media_asset
      SET master_storage_key = NULL, alt_text = NULL, bytes_purged_at = transaction_timestamp()
      WHERE id = ${assetId}::uuid AND bytes_purged_at IS NULL
    `;

    await this.audit.record(tx, context, {
      action: 'media.bytes_erased',
      entityType: 'media_asset',
      entityId: assetId,
      metadata: { rule },
    });

    const keys = [master[0]?.key, ...renditions.map((row) => row.key)].filter(
      (key): key is string => key != null,
    );

    return { assetIds: [assetId], keys };
  }

  /** Unlink what a COMMITTED erasure named. Safe to repeat. */
  async removeFiles(files: ErasedFiles): Promise<void> {
    for (const key of files.keys) await this.storage.remove(key);
    for (const assetId of files.assetIds) await this.storage.removeAssetDirectory(assetId);
  }

  /**
   * Remove anything still on disk for an asset the database says is erased.
   *
   * The recovery half of "commit, then unlink": a run that died in between
   * left files nobody names, and this is what finds them. It needs no lock —
   * no backup can be looking for an erased asset's files (see the class note).
   */
  async sweepErased(): Promise<number> {
    const erased = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM media_asset WHERE bytes_purged_at IS NOT NULL
    `;

    for (const { id } of erased) await this.storage.removeAssetDirectory(id);

    return erased.length;
  }
}

/** Take `MEDIA_FILES_LOCK` for this transaction, if no backup holds it. */
export async function tryLockFiles(tx: Prisma.TransactionClient): Promise<boolean> {
  const rows = await tx.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(
      ${MEDIA_FILES_LOCK.classId}::int, ${MEDIA_FILES_LOCK.objectId}::int
    ) AS locked
  `;

  return rows[0]?.locked === true;
}

/**
 * Run `work` until it finishes or the files lock stays busy past the wait.
 *
 * `work` returns `LOCKED` when a backup holds the lock; it is resumable, so
 * calling it again continues where it stopped.
 */
export async function withFilesLockRetries(
  options: MediaErasureOptions,
  work: () => Promise<'DONE' | 'LOCKED'>,
): Promise<'DONE' | 'LOCKED'> {
  const deadline = Date.now() + options.backupWaitMs;

  for (;;) {
    if ((await work()) === 'DONE') return 'DONE';
    if (Date.now() + options.pollMs >= deadline) return 'LOCKED';
    await new Promise((resolve) => setTimeout(resolve, options.pollMs));
  }
}

/**
 * THE TWO THIRTY-DAY RULES, WRITTEN ONCE for the scan, the re-check under the
 * row lock and the dry run. The database states the same rules independently
 * in `media_asset_erasure_is_due`; see the class note for why both exist.
 */
function dueForRetention(alias: string): Prisma.Sql {
  const a = Prisma.raw(alias);

  return Prisma.sql`
    ${a}.bytes_purged_at IS NULL
    AND (
      (
        ${a}.status = 'ARCHIVED'::media_asset_status
        AND ${a}.archived_at <= transaction_timestamp()
            - ${`${MEDIA_ARCHIVED_ERASURE_DAYS} days`}::interval
      )
      OR (
        ${a}.created_at <= transaction_timestamp()
            - ${`${MEDIA_UNATTACHED_ERASURE_DAYS} days`}::interval
        AND NOT EXISTS (
          SELECT 1 FROM media_attachment m WHERE m.media_asset_id = ${a}.id
        )
      )
    )
  `;
}
