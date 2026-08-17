/**
 * The guard that keeps the synthetic-clinic seed away from anything real.
 *
 * AN ALLOWLIST, NOT A BLOCKLIST, and the same reasoning the integration harness
 * uses: excluding a name like `clinic_prod` would protect exactly one database,
 * and a stray `DATABASE_URL` pointing at a pilot instance would sail straight
 * through. The seed writes hundreds of families, appointments, charges and
 * payments that CANNOT BE DELETED afterwards — `session_charge`, `payment` and
 * `payment_promise` all refuse `DELETE` and `TRUNCATE` by trigger — so the only
 * safe question is "is this database disposable?", and only a name that says so
 * counts as an answer.
 *
 * `_dev` is included where the harness's list stops at `_test` and `_ci`,
 * because a local review database is exactly what this tool is for; `_demo` is
 * there so a reviewer can keep a second one without editing this file.
 */
export const DISPOSABLE_DATABASE = /_(?:dev|test|ci|demo)$/;

export type DatabaseGuardInput = {
  databaseUrl: string | undefined;
  nodeEnv: string | undefined;
};

/**
 * Returns the connection string, or throws with a message that says what to do.
 *
 * TWO INDEPENDENT REFUSALS, because either one alone has a hole. `NODE_ENV` is
 * an environment variable anybody can set and says nothing about which database
 * the URL points at; the database name says nothing about whether this process
 * is a production deployment. A tool that writes unremovable rows should have to
 * pass both.
 */
export function assertDisposableDatabase(input: DatabaseGuardInput): string {
  if (input.nodeEnv === 'production') {
    throw new Error(
      'Refusing to seed: NODE_ENV is "production". The synthetic clinic is a local review ' +
        'tool and must never run against a deployed environment.',
    );
  }

  const url = input.databaseUrl;

  if (url === undefined || url === '') {
    throw new Error('Refusing to seed: DATABASE_URL is not set.');
  }

  let databaseName: string;

  try {
    databaseName = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error('Refusing to seed: DATABASE_URL is not a valid connection string.');
  }

  if (!DISPOSABLE_DATABASE.test(databaseName)) {
    throw new Error(
      `Refusing to seed "${databaseName}": this writes financial rows that cannot be deleted ` +
        'afterwards, so the database name must end in _dev, _test, _ci or _demo. ' +
        'Use clinic_dev locally.',
    );
  }

  return url;
}
