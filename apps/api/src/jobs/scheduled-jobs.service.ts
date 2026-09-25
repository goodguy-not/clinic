import { Injectable } from '@nestjs/common';
import { SCHEDULED_JOB_NAMES, type ScheduledJobName } from '@clinic/contracts';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { describeError } from '../common/describe-error';
import { uuidv7 } from '../common/uuid';
import {
  DEFAULT_MEDIA_ERASURE_OPTIONS,
  MediaErasureService,
  type MediaErasureOptions,
} from '../media/media-erasure.service';
import { PrismaService } from '../prisma/prisma.service';
import { TestimonialErasureService } from '../website/testimonial-erasure.service';
import { WebsiteRequestRetentionService } from '../website/website-request-retention.service';

/**
 * The unattended jobs, run one after another by `cli run-jobs` every night.
 *
 * Milestone 10, checkpoint A3. A systemd timer on the server starts the
 * command (`scripts/ops/systemd/clinic-jobs.timer`), as the API's own OS user
 * and database login: every job runs through the same NestJS service the rest
 * of the application uses, and the database narrows the two privileges the
 * jobs added to exactly what they do (migration
 * `20260926090000_m10_a3_scheduled_jobs_and_erasure`).
 *
 * ORDER MATTERS ONCE. `TESTIMONIAL_ERASURE` runs before `MEDIA_ERASURE`, so the
 * media job's sweep removes, the same night, any file a testimonial erasure
 * could not unlink.
 *
 * EACH JOB IS ISOLATED. A job that throws is reported and the next one still
 * runs; the command then exits non-zero, which systemd records as a failed run.
 *
 * A SUCCESS IS "ALL OF ITS WORK IS DONE", and only that moves
 * `scheduled_job.last_succeeded_at` and writes `scheduled_job.succeeded`, in
 * one transaction. A run that left work for later — an erasure that waited out
 * a backup and gave up — is `INCOMPLETE`: not a failure of the process, but not
 * a success the manager may rely on either, so after two such nights the
 * manager's job status turns into a warning. That is how a job that exists but
 * never manages to run cannot give false safety.
 *
 * EVERY JOB IS SAFE TO RUN TWICE, and to run concurrently with itself: each
 * one re-checks its own eligibility under a row lock, and what it has done no
 * longer matches.
 */

export const SCHEDULED_JOB_ORDER: readonly ScheduledJobName[] = [
  'WEBSITE_REQUEST_PURGE',
  'SESSION_PRUNE',
  'TESTIMONIAL_ERASURE',
  'MEDIA_ERASURE',
];

export type JobCounts = Record<string, number>;

export type JobReport = {
  readonly job: ScheduledJobName;
  readonly outcome: 'SUCCEEDED' | 'INCOMPLETE' | 'FAILED' | 'DRY_RUN';
  readonly counts: JobCounts;
  /** A safe description of the failure: never a message a database wrote. */
  readonly error?: string;
};

export type RunJobsOptions = {
  readonly only?: ScheduledJobName;
  readonly dryRun?: boolean;
  readonly media?: MediaErasureOptions;
};

@Injectable()
export class ScheduledJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly websiteRequests: WebsiteRequestRetentionService,
    private readonly testimonials: TestimonialErasureService,
    private readonly media: MediaErasureService,
  ) {}

  async run(options: RunJobsOptions = {}): Promise<JobReport[]> {
    const jobs = SCHEDULED_JOB_ORDER.filter(
      (job) => options.only === undefined || job === options.only,
    );
    const reports: JobReport[] = [];

    for (const job of jobs) {
      try {
        if (options.dryRun === true) {
          reports.push({
            job,
            outcome: 'DRY_RUN',
            counts: { eligible: await this.countEligible(job) },
          });
          continue;
        }

        const { counts, complete } = await this.runOne(
          job,
          options.media ?? DEFAULT_MEDIA_ERASURE_OPTIONS,
        );

        if (complete) await this.recordSuccess(job, counts);

        reports.push({ job, outcome: complete ? 'SUCCEEDED' : 'INCOMPLETE', counts });
      } catch (error) {
        reports.push({ job, outcome: 'FAILED', counts: {}, error: describeError(error) });
      }
    }

    return reports;
  }

  private async runOne(
    job: ScheduledJobName,
    media: MediaErasureOptions,
  ): Promise<{ counts: JobCounts; complete: boolean }> {
    switch (job) {
      case 'WEBSITE_REQUEST_PURGE': {
        const result = await this.websiteRequests.purge();
        return { counts: { ...result }, complete: true };
      }
      case 'SESSION_PRUNE':
        return { counts: { removed: await this.sessions.pruneEnded() }, complete: true };
      case 'TESTIMONIAL_ERASURE': {
        const result = await this.testimonials.run(media);
        return { counts: { ...result }, complete: result.deferred === 0 };
      }
      case 'MEDIA_ERASURE': {
        const result = await this.media.run(media);
        const swept = await this.media.sweepErased();
        return { counts: { ...result, swept }, complete: result.deferred === 0 };
      }
    }
  }

  private countEligible(job: ScheduledJobName): Promise<number> {
    switch (job) {
      case 'WEBSITE_REQUEST_PURGE':
        return this.websiteRequests.countEligible();
      case 'SESSION_PRUNE':
        return this.sessions.countEnded();
      case 'TESTIMONIAL_ERASURE':
        return this.testimonials.countEligible();
      case 'MEDIA_ERASURE':
        return this.media.countEligible();
    }
  }

  /** The row and its audit entry, together. Counts only — never an id. */
  private async recordSuccess(job: ScheduledJobName, counts: JobCounts): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        UPDATE scheduled_job SET last_succeeded_at = transaction_timestamp()
        WHERE name = ${job}::scheduled_job_name
        RETURNING id
      `;

      const row = rows[0];
      if (row === undefined) throw new Error(`scheduled_job has no row for ${job}`);

      await this.audit.record(
        tx,
        { actor: { type: 'SYSTEM' }, requestId: uuidv7() },
        {
          action: 'scheduled_job.succeeded',
          entityType: 'scheduled_job',
          entityId: row.id,
          metadata: { job, ...counts },
        },
      );
    });
  }
}

/** Parses `--only`, refusing anything that is not a job name. */
export function parseJobName(value: string): ScheduledJobName | null {
  return (SCHEDULED_JOB_NAMES as readonly string[]).includes(value)
    ? (value as ScheduledJobName)
    : null;
}
