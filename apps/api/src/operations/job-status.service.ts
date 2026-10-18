import { Injectable } from '@nestjs/common';
import {
  SCHEDULED_JOB_NAMES,
  SCHEDULED_JOB_WARNING_HOURS,
  type JobStatusResponse,
  type ScheduledJobName,
} from '@clinic/contracts';
import { PrismaService } from '../prisma/prisma.service';

const HOUR_MS = 3_600_000;

/**
 * Milestone 10, checkpoint A3 — when did each nightly job last finish all of
 * its work? READS FOUR ROWS AND WRITES NOTHING.
 *
 * The same shape as the off-site backup age, deliberately: one age per job,
 * measured from its last SUCCESS, so a job that fails, a job that keeps leaving
 * work for later and a timer that was never installed all read the same way —
 * older than `SCHEDULED_JOB_WARNING_HOURS`, or `NEVER_RUN`, and a warning.
 */
@Injectable()
export class JobStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async status(now: Date = new Date()): Promise<JobStatusResponse> {
    const rows = await this.prisma.$queryRaw<
      { name: ScheduledJobName; last_succeeded_at: Date | null }[]
    >`
      SELECT name::text AS name, last_succeeded_at FROM scheduled_job
    `;
    const last = new Map(rows.map((row) => [row.name, row.last_succeeded_at]));

    const jobs = SCHEDULED_JOB_NAMES.map((job) => {
      const succeededAt = last.get(job) ?? null;

      if (succeededAt === null) {
        return {
          job,
          state: 'NEVER_RUN' as const,
          warning: true,
          lastSucceededAt: null,
          ageHours: null,
        };
      }

      const ageMs = now.getTime() - succeededAt.getTime();
      const stale = ageMs > SCHEDULED_JOB_WARNING_HOURS * HOUR_MS;

      return {
        job,
        state: stale ? ('STALE' as const) : ('OK' as const),
        warning: stale,
        lastSucceededAt: succeededAt.toISOString(),
        ageHours: Math.max(0, Math.floor(ageMs / HOUR_MS)),
      };
    });

    return {
      warning: jobs.some((job) => job.warning),
      warningAfterHours: SCHEDULED_JOB_WARNING_HOURS,
      jobs,
      checkedAt: now.toISOString(),
    };
  }
}
