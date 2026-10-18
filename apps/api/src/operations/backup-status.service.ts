import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OFFSITE_BACKUP_WARNING_HOURS, type BackupStatusResponse } from '@clinic/contracts';
import { API_ENV } from '../config/config.module';
import { describeError } from '../common/describe-error';
import type { ApiEnv } from '../config/env';

/** Written by scripts/backup/collector-serve.sh on every acknowledged collection. */
export const OFFSITE_STATUS_FILE = 'offsite-collection';

const ARCHIVE_NAME = /^clinic-backup-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.tar\.gpg$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const HOUR_MS = 3_600_000;

/**
 * Milestone 10, checkpoint A2 — how old is the clinic's newest off-site backup?
 *
 * READS ONE SMALL FILE AND WRITES NOTHING. The collector's forced command owns
 * the file; the API only reports it. Nothing here touches the database, the
 * archives or the media directory, and nothing a caller sends reaches a path.
 *
 * The file is trusted for nothing but a timestamp. Every value is checked
 * against the exact shape the collector writes, and anything else is
 * `UNKNOWN` — a warning, never a guess.
 */
@Injectable()
export class BackupStatusService {
  private readonly logger = new Logger(BackupStatusService.name);

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  async status(now: Date = new Date()): Promise<BackupStatusResponse> {
    const base = {
      warningAfterHours: OFFSITE_BACKUP_WARNING_HOURS,
      checkedAt: now.toISOString(),
    };
    const warn = (
      state: 'NOT_CONFIGURED' | 'NEVER_COLLECTED' | 'UNKNOWN',
    ): BackupStatusResponse => ({
      ...base,
      state,
      warning: true,
      offsiteCopy: null,
      newestOnServerTakenAt: null,
    });

    const directory = this.env.BACKUP_STATUS_DIR;
    if (directory === undefined) return warn('NOT_CONFIGURED');

    let text: string;
    try {
      text = await readFile(join(directory, OFFSITE_STATUS_FILE), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return warn('NEVER_COLLECTED');
      this.logger.warn(`backup collection status unreadable: ${describeError(error)}`);
      return warn('UNKNOWN');
    }

    const fields = parseFields(text);
    const takenAt = archiveTakenAt(fields.get('archive'));
    const collectedAt = fields.get('collected_at');
    if (takenAt === null || collectedAt === undefined || !INSTANT.test(collectedAt)) {
      this.logger.warn('backup collection status is malformed');
      return warn('UNKNOWN');
    }

    const ageMs = now.getTime() - takenAt.getTime();
    const ageHours = Math.max(0, Math.floor(ageMs / HOUR_MS));
    const stale = ageMs > OFFSITE_BACKUP_WARNING_HOURS * HOUR_MS;

    return {
      ...base,
      state: stale ? 'STALE' : 'OK',
      warning: stale,
      offsiteCopy: {
        takenAt: takenAt.toISOString(),
        collectedAt: new Date(collectedAt).toISOString(),
        ageHours,
      },
      newestOnServerTakenAt: archiveTakenAt(fields.get('newest_on_server'))?.toISOString() ?? null,
    };
  }
}

function parseFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of text.split('\n')) {
    const index = line.indexOf('=');
    if (index > 0) fields.set(line.slice(0, index), line.slice(index + 1).trim());
  }
  return fields;
}

/** The instant an archive was taken, from the name backup.sh gives it. */
function archiveTakenAt(name: string | undefined): Date | null {
  const match = name === undefined ? null : ARCHIVE_NAME.exec(name);
  if (match === null) return null;
  const [, year, month, day, hour, minute, second] = match;
  const instant = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  return Number.isNaN(instant.getTime()) ? null : instant;
}
