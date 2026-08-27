import type { INestApplicationContext } from '@nestjs/common';
import { WebsiteRequestRetentionService } from '../website/website-request-retention.service';
import type { CliIo } from './cli-io';

/**
 * The operator command that runs the ninety-day erasure.
 *
 * Milestone 9, checkpoint A4.
 *
 * WHY A COMMAND AND NOT A SCHEDULER. The accepted M9 scope has no scheduler, no
 * queue, no cron service and no background-job framework, and Milestone 10 owns
 * deployment. Shipping an unattended runner here would mean a process holding a
 * destructive grant against a table of personal data before anybody had decided
 * how it is invoked, monitored or alerted on — and a retention job that fails
 * silently is indistinguishable from one that was never installed.
 *
 * What M9 owes is that the erasure is REAL and EXECUTABLE rather than a promise
 * in a document, and that is what this is: one command, against a deployed
 * database, from a shell on the server, exactly as `bootstrap-manager` runs.
 *
 * `--dry-run` FIRST, DELIBERATELY. A destructive operation an operator cannot
 * inspect before running is one they will eventually run at the wrong moment.
 * The dry run writes nothing at all — no row, no audit entry — and reports a
 * COUNT rather than a list, because the answer to "which requests?" is a page of
 * strangers' names and this is a terminal that scrolls into somebody's history.
 *
 * IT IS SAFE TO RUN AGAIN, ALWAYS. The erasure stamps `purged_at` in the same
 * statement that clears the content and skips anything already stamped, so a
 * second run finds nothing and a run interrupted halfway resumes where it
 * stopped. There is no state to reset and no lock file to clear.
 */
export async function purgeWebsiteRequests(
  app: INestApplicationContext,
  options: { readonly dryRun: boolean },
  io: CliIo,
): Promise<number> {
  const retention = app.get(WebsiteRequestRetentionService);

  if (options.dryRun) {
    const eligible = await retention.countEligible();
    io.out(
      `Dry run: ${eligible} website request(s) are eligible for erasure. Nothing was written.`,
    );
    return 0;
  }

  const result = await retention.purge();

  // The two numbers differ when a request was linked to a family, or purged by
  // a concurrent run, between the scan and its own transaction. That is a normal
  // outcome rather than a failure, and saying both is how an operator can see it
  // happened.
  io.out(
    `Erased the content of ${result.purged} of ${result.eligible} eligible website request(s).`,
  );
  return 0;
}
