import { NestFactory } from '@nestjs/core';
import { CliModule } from './cli.module';
import { bootstrapManager } from './bootstrap-manager';
import { resetPassword } from './reset-password';
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
  '',
  'Passwords are generated and printed once unless --password-stdin is given.',
  'A password may never be passed as an argument.',
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
  const username = stringFlag(flags, 'username');

  if (username === null) {
    io.err('--username is required.');
    io.err(USAGE);
    return 2;
  }

  // Logging is disabled for the context: the only bytes this process writes to
  // stdout are the CLI's own, so a generated password can never be interleaved
  // into a log stream that gets shipped somewhere.
  const app = await NestFactory.createApplicationContext(CliModule, { logger: false });

  try {
    switch (command) {
      case 'bootstrap-manager': {
        const displayName = stringFlag(flags, 'display-name');

        if (displayName === null) {
          io.err('--display-name is required for bootstrap-manager.');
          return 2;
        }

        return await bootstrapManager(app, { username, displayName, passwordFromStdin }, io);
      }

      case 'reset-password':
        return await resetPassword(app, { username, passwordFromStdin }, io);

      default:
        io.err(`Unknown command: ${command}`);
        io.err(USAGE);
        return 2;
    }
  } finally {
    await app.close();
  }
}
