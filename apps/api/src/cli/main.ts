import { loadDotEnvIfPresent } from '../config/env';
import { processIo } from './cli-io';
import { runCli } from './run-cli';
import { describeError } from '../common/describe-error';

/**
 * Operator entry point.
 *
 * Run against a deployed database from a shell on the server:
 *   node dist/cli/main.js bootstrap-manager --username <name> --display-name <name>
 */
loadDotEnvIfPresent();

runCli(process.argv.slice(2), processIo)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // The kind of failure, never its message: a driver error can carry the
    // connection string or a row's values, and this path runs next to a freshly
    // generated password and in the nightly jobs' journal.
    processIo.err(describeError(error));
    process.exitCode = 1;
  });
