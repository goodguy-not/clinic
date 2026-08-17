import { assertDisposableDatabase } from './disposable-database';

/**
 * The refusals, stated as tests, because this guard is the only thing standing
 * between a convenience script and a database somebody cares about.
 *
 * Every connection string below is synthetic and points nowhere.
 */
describe('the synthetic-clinic database guard', () => {
  const dev = 'postgresql://user:pw@localhost:5433/clinic_dev?schema=public';

  it('accepts a disposable database by name', () => {
    for (const name of ['clinic_dev', 'clinic_test', 'clinic_ci', 'clinic_demo']) {
      const url = `postgresql://user:pw@localhost:5433/${name}`;

      expect(assertDisposableDatabase({ databaseUrl: url, nodeEnv: 'development' })).toBe(url);
    }
  });

  it('refuses every name that does not say it is disposable', () => {
    // An allowlist: a name nobody thought about is refused, rather than a name
    // somebody remembered to exclude.
    for (const name of ['clinic', 'clinic_prod', 'clinic_production', 'clinic_pilot', 'postgres']) {
      expect(() =>
        assertDisposableDatabase({
          databaseUrl: `postgresql://user:pw@localhost:5433/${name}`,
          nodeEnv: 'development',
        }),
      ).toThrow(/Refusing to seed/);
    }
  });

  it('refuses a production process even when the database name looks disposable', () => {
    // Both refusals are independent: neither signal alone is trustworthy.
    expect(() => assertDisposableDatabase({ databaseUrl: dev, nodeEnv: 'production' })).toThrow(
      /NODE_ENV/,
    );
  });

  it('refuses a missing or unparseable connection string', () => {
    expect(() =>
      assertDisposableDatabase({ databaseUrl: undefined, nodeEnv: 'development' }),
    ).toThrow(/DATABASE_URL is not set/);

    expect(() => assertDisposableDatabase({ databaseUrl: '', nodeEnv: 'test' })).toThrow(
      /DATABASE_URL is not set/,
    );

    expect(() => assertDisposableDatabase({ databaseUrl: 'not-a-url', nodeEnv: 'test' })).toThrow(
      /not a valid connection string/,
    );
  });
});
