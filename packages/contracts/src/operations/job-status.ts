import { z } from 'zod';

/**
 * Have the clinic's unattended jobs been running?
 *
 * Milestone 10, checkpoint A3. Four jobs run every night on the server (README,
 * Scheduled jobs). Each one keeps a promise somebody would otherwise have to
 * remember — the ninety-day website-request erasure, the thirty-day photograph
 * erasures, the seven-day testimonial erasure after a family withdraws consent,
 * the removal of long-ended staff sessions — and a job that exists but never
 * runs gives false safety. So the manager sees, beside the backup warning, when
 * each one last FINISHED ALL OF ITS WORK.
 *
 * A run that had to leave work for later (for example because a backup was
 * copying the photographs it would erase) is not a success, and does not move
 * `lastSucceededAt`. Two missed nights is a warning.
 */

/** Past this many hours without a success, a job is a warning. */
export const SCHEDULED_JOB_WARNING_HOURS = 48;

export const SCHEDULED_JOB_NAMES = [
  'WEBSITE_REQUEST_PURGE',
  'SESSION_PRUNE',
  'MEDIA_ERASURE',
  'TESTIMONIAL_ERASURE',
] as const;

export type ScheduledJobName = (typeof SCHEDULED_JOB_NAMES)[number];

/**
 * - `OK`        the last success is younger than the threshold
 * - `STALE`     it is older — the manager is warned
 * - `NEVER_RUN` the job has never succeeded on this database — a warning
 */
export const SCHEDULED_JOB_STATES = ['OK', 'STALE', 'NEVER_RUN'] as const;

export type ScheduledJobState = (typeof SCHEDULED_JOB_STATES)[number];

export const scheduledJobStatusSchema = z.strictObject({
  job: z.enum(SCHEDULED_JOB_NAMES),
  state: z.enum(SCHEDULED_JOB_STATES),
  /** True for every state but `OK`. */
  warning: z.boolean(),
  lastSucceededAt: z.iso.datetime().nullable(),
  /** Whole hours since `lastSucceededAt`; null when it never succeeded. */
  ageHours: z.number().int().nonnegative().nullable(),
});

export type ScheduledJobStatus = z.infer<typeof scheduledJobStatusSchema>;

export const jobStatusResponseSchema = z.strictObject({
  /** True when any job is a warning — the only field that decides a banner. */
  warning: z.boolean(),
  warningAfterHours: z.number().int().positive(),
  /** Every job, always, in `SCHEDULED_JOB_NAMES` order. */
  jobs: z.array(scheduledJobStatusSchema),
  checkedAt: z.iso.datetime(),
});

export type JobStatusResponse = z.infer<typeof jobStatusResponseSchema>;
