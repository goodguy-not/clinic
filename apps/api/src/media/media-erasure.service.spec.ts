import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEDIA_FILES_LOCK, withFilesLockRetries } from './media-erasure.service';

/**
 * The backup and the erasure must name ONE lock, and the backup must hold it
 * across everything that reads the media. A mismatch here would fail no other
 * test — it would fail one night's backup, in production.
 */
describe('MEDIA_FILES_LOCK and the backup', () => {
  const backupSql = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'scripts', 'backup', 'sql', 'backup.sql'),
    'utf8',
  );

  const at = (needle: string): number => {
    const index = backupSql.indexOf(needle);
    expect(index).toBeGreaterThanOrEqual(0);
    return index;
  };

  it('is taken shared by the backup with the same two keys the erasure uses', () => {
    at(`SELECT pg_advisory_lock_shared(${MEDIA_FILES_LOCK.classId}, ${MEDIA_FILES_LOCK.objectId})`);
  });

  it('is taken before the snapshot, and the media are copied in the same session after it', () => {
    const lock = at('pg_advisory_lock_shared(');
    const snapshot = at('pg_export_snapshot()');
    const copy = at('\\! bash "$CLINIC_BACKUP_COPY_MEDIA"');

    expect(lock).toBeLessThan(snapshot);
    expect(snapshot).toBeLessThan(copy);
    // Session-level, never transaction-level: it must outlive the COMMIT.
    expect(backupSql).not.toContain('pg_advisory_xact_lock_shared');
    expect(backupSql).not.toContain('pg_advisory_unlock');
  });
});

describe('withFilesLockRetries', () => {
  it('stops waiting at the deadline and reports the work as left over', async () => {
    const work = jest.fn().mockResolvedValue('LOCKED');

    await expect(withFilesLockRetries({ backupWaitMs: 0, pollMs: 0 }, work)).resolves.toBe(
      'LOCKED',
    );
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('resumes once the lock is free', async () => {
    const work = jest.fn().mockResolvedValueOnce('LOCKED').mockResolvedValueOnce('DONE');

    await expect(withFilesLockRetries({ backupWaitMs: 1_000, pollMs: 1 }, work)).resolves.toBe(
      'DONE',
    );
    expect(work).toHaveBeenCalledTimes(2);
  });
});
