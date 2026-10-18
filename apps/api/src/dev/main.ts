import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { loadDotEnvIfPresent } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { redactSecrets } from '../common/redact';
import { assertDisposableDatabase } from './disposable-database';
import { reconcileClinic } from './clinic-reconciliation';
import { simulateClinic } from './clinic-simulation';
import { managerActor, seedSyntheticClinic } from './synthetic-clinic';

/**
 * Entry point for the synthetic-clinic seed.
 *
 *   node dist/dev/main.js --confirm [--weeks 5] [--families 12] [--run-tag abc123]
 *   node dist/dev/main.js --confirm --practice-clinic
 *
 * `--practice-clinic` builds the two-month practice clinic of Milestone 10
 * (`clinic-simulation.ts`) into an EMPTY database and reconciles it before it
 * returns; it exits non-zero on any discrepancy, so a practice environment is
 * never handed over with books that do not balance.
 *
 * A SEPARATE BINARY FROM THE OPERATOR CLI, DELIBERATELY. `dist/cli/main.js` is
 * documented as the thing you run against a deployed database from a shell on
 * the server; this writes hundreds of financial rows that can never be deleted.
 * Putting the two behind one command would put a seed one typo away from a
 * production recovery.
 *
 * THREE THINGS HAVE TO BE TRUE BEFORE IT WRITES ANYTHING: `NODE_ENV` is not
 * production, the database name says it is disposable, and the operator passed
 * `--confirm`. The first two are the guard; the third is there because the first
 * two can both be satisfied by accident on a laptop pointed at the wrong URL.
 */
loadDotEnvIfPresent();

async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('help')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  if (!argv.includes('--confirm')) {
    process.stderr.write('Refusing to seed without --confirm.\n');
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  assertDisposableDatabase({
    databaseUrl: process.env['DATABASE_URL'],
    nodeEnv: process.env['NODE_ENV'],
  });

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  if (argv.includes('--practice-clinic')) {
    try {
      return await practiceClinic(app);
    } finally {
      await app.close();
    }
  }

  try {
    const summary = await seedSyntheticClinic(app, {
      weeks: numberFlag(argv, '--weeks'),
      families: numberFlag(argv, '--families'),
      therapists: numberFlag(argv, '--therapists'),
      slotsPerDay: numberFlag(argv, '--slots-per-day'),
      runTag: stringFlag(argv, '--run-tag'),
    });

    process.stdout.write(`\nSeeded a synthetic clinic. Run tag: ${summary.runTag}\n`);
    process.stdout.write(`Clinic today: ${summary.clinicToday}\n`);
    process.stdout.write(`History: ${summary.from} to ${summary.to}\n\n`);

    for (const [label, value] of [
      ['services', summary.services],
      ['rooms', summary.rooms],
      ['therapists', summary.therapists],
      ['published services', summary.publishedServices],
      ['published articles', summary.publishedArticles],
      ['published testimonials', summary.publishedTestimonials],
      ['published therapists', summary.publishedTherapists],
      ['families', summary.families],
      ['children', summary.children],
      ['appointments', summary.appointments],
      ['completed', summary.completed],
      ['cancelled', summary.cancelled],
      ['no-shows', summary.noShows],
      ['unresolved outcomes', summary.unresolvedOutcomes],
      ['charges', summary.charges],
      ['completed but unpriced', summary.unpricedSessions],
      ['adjustments', summary.adjustments],
      ['voided charges', summary.voidedCharges],
      ['payments', summary.payments],
      ['voided payments', summary.voidedPayments],
      ['promises', summary.promises],
    ] as const) {
      process.stdout.write(`  ${label.padEnd(24)} ${value}\n`);
    }

    if (summary.staff.length > 0) {
      // Printed to stdout and never through the logger, exactly as the operator
      // CLI prints a generated password: a logger is a shipping pipeline. These
      // accounts exist only in a disposable database and must change their
      // password at first sign-in.
      process.stdout.write('\nSynthetic staff accounts (local database only):\n');

      for (const account of summary.staff) {
        process.stdout.write(`  ${account.username}  ${account.temporaryPassword}\n`);
      }
    }

    return 0;
  } finally {
    await app.close();
  }
}

async function practiceClinic(app: INestApplicationContext): Promise<number> {
  const { book } = await simulateClinic(app);
  const report = await reconcileClinic(app, book, await managerActor(app.get(PrismaService)));
  const { calendar } = book;
  const out = (line = '') => process.stdout.write(`${line}\n`);

  out();
  out(`Built the practice clinic. Clinic today: ${calendar.today}`);
  out(
    `History: ${calendar.windowStart} to ${calendar.lastHistoryDay} (closed month ` +
      `${calendar.closedMonth.label}: ${calendar.closedMonth.from} to ${calendar.closedMonth.to})`,
  );
  out();

  for (const [label, value] of [
    ['families', book.families.length],
    ['sessions booked', book.sessions.length],
    ['charges', book.charges.size],
    ['payments', book.payments.length],
    ['promises', book.promises.length],
    ['closed periods', book.periods.length],
    ['website requests', book.websiteRequests.length],
  ] as const) {
    out(`  ${label.padEnd(24)} ${value}`);
  }

  out();
  out('Reconciliation (independent of the report code):');
  for (const check of report.checks) {
    const verdict =
      check.discrepancies.length === 0 ? 'ok' : `${check.discrepancies.length} DISCREPANCIES`;
    out(`  ${verdict.padEnd(18)} ${String(check.compared).padStart(6)}  ${check.name}`);
    for (const line of check.discrepancies.slice(0, 10)) out(`      ${line}`);
  }

  // Printed to stdout and never through the logger, as the seed prints its
  // accounts: these exist only in this disposable database.
  out();
  out('Practice staff accounts (this database only; change the password at first sign-in):');
  for (const account of book.staff) {
    if (account.temporaryPassword !== null) {
      out(`  ${account.username}  ${account.temporaryPassword}`);
    }
  }

  return report.discrepancyCount === 0 ? 0 : 1;
}

const USAGE = [
  'Usage:',
  '  node dist/dev/main.js --confirm [--weeks 5] [--families 12] [--therapists 4]',
  '                        [--slots-per-day 3] [--run-tag abc123]',
  '  node dist/dev/main.js --confirm --practice-clinic',
  '',
  '--practice-clinic builds the reconciled two-month practice clinic into an empty',
  'database (one active manager from bootstrap-manager, nothing else) and exits',
  'non-zero if its books do not reconcile.',
  '',
  'Populates a synthetic multi-week clinic for local review of the dashboard and',
  'reports. Everything it writes is invented. It refuses to run unless NODE_ENV is',
  'not production and the database name ends in _dev, _test, _ci or _demo.',
  '',
  'It is additive and deletes nothing: financial rows cannot be removed. To start',
  'clean, drop and recreate the local database and re-run the migrations.',
].join('\n');

function stringFlag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];

  return value === undefined || value.startsWith('--') ? undefined : value;
}

function numberFlag(argv: readonly string[], name: string): number | undefined {
  const value = stringFlag(argv, name);
  if (value === undefined) return undefined;

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive whole number.`);
  }

  return parsed;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Redacted for the reason the operator CLI redacts: a driver failure can
    // carry the connection string.
    process.stderr.write(
      `${redactSecrets(error instanceof Error ? error.message : String(error))}\n`,
    );
    process.exitCode = 1;
  });
