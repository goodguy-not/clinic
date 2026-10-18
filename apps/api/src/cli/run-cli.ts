import { NestFactory } from '@nestjs/core';
import { CliModule } from './cli.module';
import { bootstrapManager } from './bootstrap-manager';
import { purgeWebsiteRequests } from './purge-website-requests';
import { resetPassword } from './reset-password';
import { runJobs } from './run-jobs';
import { parseJobName } from '../jobs/scheduled-jobs.service';
import type { CliIo } from './cli-io';

/**
 * Argument handling for the operator CLI.
 *
 * Exported separately from `main.ts` so tests can drive it directly, and so the
 * process only calls `process.exit` in one place.
 */

const USAGE = [
  'Usage:',
  '  bootstrap-manager --username <name> --display-name <name> [--password-stdin]',
  '  reset-password    --username <name> [--password-stdin]',
  '  purge-website-requests [--dry-run]',
  '  run-jobs [--only <JOB>] [--dry-run]',
  '',
  'Passwords are generated and printed once unless --password-stdin is given.',
  'A password may never be passed as an argument.',
  '',
  'purge-website-requests erases the content of closed, never-linked website',
  'requests ninety days after closure. It never deletes a row, and it is safe',
  'to run again. Use --dry-run to see how many are eligible without erasing.',
  '',
  'run-jobs runs the nightly jobs in order: WEBSITE_REQUEST_PURGE, SESSION_PRUNE,',
  'TESTIMONIAL_ERASURE, MEDIA_ERASURE. Each is safe to run again. --only runs one;',
  '--dry-run prints how much each would do and writes nothing.',
].join('\n');

export function parseFlags(argv: readonly string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith('--')) continue;

    const name = token.slice(2);
    const next = argv[index + 1];

    if (next !== undefined && !next.startsWith('--')) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }

  return flags;
}

function stringFlag(flags: Map<string, string | true>, name: string): string | null {
  const value = flags.get(name);
  return typeof value === 'string' ? value : null;
}

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const command = argv[0];
  const flags = parseFlags(argv.slice(1));

  if (command === undefined || command === '--help' || command === 'help') {
    io.out(USAGE);
    return command === undefined ? 2 : 0;
  }

  // A password on the command line lands in shell history and in the process
  // list, where any other user on the host can read it. There is no safe way to
  // accept one, so the flag is rejected outright rather than quietly ignored.
  if (flags.has('password')) {
    io.err('Refusing --password: a password must never be passed as an argument.');
    io.err('It would be visible in shell history and in the process list.');
    io.err('Omit it to have one generated, or use --password-stdin.');
    return 2;
  }

  const passwordFromStdin = flags.get('password-stdin') === true;

  // Logging is disabled for the context: the only bytes this process writes to
  // stdout are the CLI's own, so a generated password can never be interleaved
  // into a log stream that gets shipped somewhere.
  //
  // `abortOnError: false` (Milestone 10, A3): with logging off, Nest's default
  // on a start-up error — an invalid environment, an unreachable database — is
  // to exit silently. The error must reach `main.ts`, which prints its kind, or
  // a misconfigured nightly job leaves nothing in the journal.
  const app = await NestFactory.createApplicationContext(CliModule, {
    logger: false,
    abortOnError: false,
  });

  try {
    switch (command) {
      case 'bootstrap-manager': {
        const username = stringFlag(flags, 'username');
        const displayName = stringFlag(flags, 'display-name');

        if (username === null) {
          io.err('--username is required.');
          io.err(USAGE);
          return 2;
        }

        if (displayName === null) {
          io.err('--display-name is required for bootstrap-manager.');
          return 2;
        }

        return await bootstrapManager(app, { username, displayName, passwordFromStdin }, io);
      }

      case 'reset-password': {
        const username = stringFlag(flags, 'username');

        if (username === null) {
          io.err('--username is required.');
          io.err(USAGE);
          return 2;
        }

        return await resetPassword(app, { username, passwordFromStdin }, io);
      }

      // Milestone 9, checkpoint A4. The only command here that names no user:
      // the ninety-day erasure acts on messages from people who have no account,
      // and its audit rows carry a SYSTEM actor for exactly that reason. Hence
      // `--username` is required by the two account commands rather than up
      // front — it would be meaningless on this one.
      case 'purge-website-requests':
        return await purgeWebsiteRequests(app, { dryRun: flags.get('dry-run') === true }, io);

      // Milestone 10, checkpoint A3. What the nightly timer runs.
      case 'run-jobs': {
        const only = flags.get('only');
        if (only === true) {
          io.err('--only needs a job name.');
          return 2;
        }

        const job = only === undefined ? undefined : parseJobName(only);
        if (job === null) {
          io.err(`Unknown job: ${String(only)}`);
          return 2;
        }

        return await runJobs(
          app,
          { ...(job === undefined ? {} : { only: job }), dryRun: flags.get('dry-run') === true },
          io,
        );
      }

      default:
        io.err(`Unknown command: ${command}`);
        io.err(USAGE);
        return 2;
    }
  } finally {
    await app.close();
  }
}
