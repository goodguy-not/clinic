import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { backupStatusResponseSchema } from '@clinic/contracts';
import type { ApiEnv } from '../config/env';
import { BackupStatusService, OFFSITE_STATUS_FILE } from './backup-status.service';

describe('BackupStatusService', () => {
  let directory: string;
  const now = new Date('2026-09-26T08:00:00Z');

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'clinic-backup-status-'));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  const service = (statusDir: string | null = directory) =>
    new BackupStatusService({ BACKUP_STATUS_DIR: statusDir ?? undefined } as ApiEnv);

  const record = (lines: string[]) =>
    writeFileSync(join(directory, OFFSITE_STATUS_FILE), `${lines.join('\n')}\n`);

  async function statusAt(at = now) {
    return backupStatusResponseSchema.parse(await service().status(at));
  }

  it('warns NOT_CONFIGURED when the deployment has no collector', async () => {
    const result = await service(null).status(now);

    expect(result).toMatchObject({ state: 'NOT_CONFIGURED', warning: true, offsiteCopy: null });
  });

  it('warns NEVER_COLLECTED before the first collection', async () => {
    expect(await statusAt()).toMatchObject({ state: 'NEVER_COLLECTED', warning: true });
  });

  it('is OK while the newest off-site backup is younger than three days', async () => {
    record([
      'archive=clinic-backup-20260925T223000Z.tar.gpg',
      'collected_at=2026-09-26T07:10:00Z',
      'newest_on_server=clinic-backup-20260925T223000Z.tar.gpg',
    ]);

    expect(await statusAt()).toEqual({
      state: 'OK',
      warning: false,
      warningAfterHours: 72,
      offsiteCopy: {
        takenAt: '2026-09-25T22:30:00.000Z',
        collectedAt: '2026-09-26T07:10:00.000Z',
        ageHours: 9,
      },
      newestOnServerTakenAt: '2026-09-25T22:30:00.000Z',
      checkedAt: '2026-09-26T08:00:00.000Z',
    });
  });

  it('measures from when the backup was TAKEN, so a server that stopped backing up goes stale too', async () => {
    // Collected this morning — but what it collected is four days old.
    record([
      'archive=clinic-backup-20260922T020000Z.tar.gpg',
      'collected_at=2026-09-26T07:10:00Z',
      'newest_on_server=clinic-backup-20260922T020000Z.tar.gpg',
    ]);

    expect(await statusAt()).toMatchObject({
      state: 'STALE',
      warning: true,
      offsiteCopy: { ageHours: 102 },
    });
  });

  it('turns STALE only once the copy is more than 72 hours old', async () => {
    record(['archive=clinic-backup-20260923T080000Z.tar.gpg', 'collected_at=2026-09-23T09:00:00Z']);

    expect((await statusAt(new Date('2026-09-26T08:00:00Z'))).state).toBe('OK');
    expect((await statusAt(new Date('2026-09-26T08:00:01Z'))).state).toBe('STALE');
  });

  it.each([
    [['archive=../../etc/passwd', 'collected_at=2026-09-26T07:10:00Z']],
    [['archive=clinic-backup-20260925T223000Z.tar.gpg']],
    [['archive=clinic-backup-20261399T999999Z.tar.gpg', 'collected_at=2026-09-26T07:10:00Z']],
    [['archive=clinic-backup-20260925T223000Z.tar.gpg', 'collected_at=yesterday']],
    [['garbage']],
  ])('reports anything malformed as UNKNOWN, a warning, never a guess: %j', async (lines) => {
    record(lines);

    expect(await statusAt()).toMatchObject({ state: 'UNKNOWN', warning: true, offsiteCopy: null });
  });
});
