import { z } from 'zod';

/**
 * Is there a recent copy of the clinic's backups OFF the server?
 *
 * Milestone 10, checkpoint A2. The server takes an encrypted backup every night
 * and a computer at the clinic collects it (README, Backup and restore). Both
 * can stop without anybody noticing — the server's job fails, the computer is
 * never switched on, its key is removed — and the first anybody would learn of
 * it is the day a restore is needed. This read exists so that a manager sees it
 * first.
 *
 * THE AGE IS THE AGE OF THE NEWEST BACKUP THE CLINIC COMPUTER CONFIRMED IT
 * HOLDS, measured from when that backup was TAKEN, not from when it was
 * collected. So one number covers both silent failures: a computer that keeps
 * collecting while the server has stopped producing grows old exactly as fast
 * as a computer that has stopped collecting.
 */

/** Past this many hours, the off-site copy is a warning. Owner decision: three days. */
export const OFFSITE_BACKUP_WARNING_HOURS = 72;

/**
 * - `OK`              the newest off-site copy is younger than the threshold
 * - `STALE`           it is older — the manager is warned
 * - `NEVER_COLLECTED` the collection status is configured, nothing has been collected yet
 * - `UNKNOWN`         the status could not be read; treated as a warning
 * - `NOT_CONFIGURED`  this deployment has no collection configured; treated as a warning
 */
export const BACKUP_COLLECTION_STATES = [
  'OK',
  'STALE',
  'NEVER_COLLECTED',
  'UNKNOWN',
  'NOT_CONFIGURED',
] as const;

export type BackupCollectionState = (typeof BACKUP_COLLECTION_STATES)[number];

export const backupStatusResponseSchema = z.strictObject({
  state: z.enum(BACKUP_COLLECTION_STATES),
  /** True for every state but `OK`. */
  warning: z.boolean(),
  warningAfterHours: z.number().int().positive(),
  /** The newest backup the clinic computer holds, checked, and when it said so. */
  offsiteCopy: z
    .strictObject({
      takenAt: z.iso.datetime(),
      collectedAt: z.iso.datetime(),
      ageHours: z.number().int().nonnegative(),
    })
    .nullable(),
  /** When the newest backup on the server was taken, as of the last collection. */
  newestOnServerTakenAt: z.iso.datetime().nullable(),
  checkedAt: z.iso.datetime(),
});

export type BackupStatusResponse = z.infer<typeof backupStatusResponseSchema>;
