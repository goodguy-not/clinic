import type { INestApplicationContext } from '@nestjs/common';
import type { ScheduledJobName } from '@clinic/contracts';
import { ScheduledJobsService } from '../jobs/scheduled-jobs.service';
import type { CliIo } from './cli-io';

/**
 * The nightly jobs (Milestone 10, checkpoint A3), as systemd runs them:
 *
 *   node dist/cli/main.js run-jobs [--only <JOB>] [--dry-run]
 *
 * ONE LINE PER JOB, COUNTS ONLY. The output goes to the journal, so it names
 * no request, testimonial, photograph or user — how many, never which.
 *
 * EXIT CODE: 0 when every job ran (an INCOMPLETE job is not a process failure:
 * it waited out a backup and will finish tomorrow, and the manager is warned if
 * it keeps doing so); 1 when any job FAILED, so systemd records the run as
 * failed.
 *
 * `--dry-run` writes nothing at all — no erasure, no success, no audit row —
 * and prints how much each job would do now.
 */
export async function runJobs(
  app: INestApplicationContext,
  options: { readonly only?: ScheduledJobName; readonly dryRun: boolean },
  io: CliIo,
): Promise<number> {
  const reports = await app.get(ScheduledJobsService).run(options);

  for (const report of reports) {
    const counts = Object.entries(report.counts)
      .map(([name, value]) => `${name}=${value}`)
      .join(' ');
    const line = [report.job, report.outcome, counts, report.error ?? ''].filter(Boolean).join(' ');

    (report.outcome === 'FAILED' ? io.err : io.out)(line);
  }

  return reports.some((report) => report.outcome === 'FAILED') ? 1 : 0;
}
