import { loadDotEnvIfPresent } from '../config/env';
import { processIo } from './cli-io';
import { runCli } from './run-cli';
import { redactSecrets } from '../common/redact';

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
    // Redacted: a failure here can be a driver error carrying the connection
    // string, and this path runs next to a freshly generated password.
    processIo.err(redactSecrets(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
