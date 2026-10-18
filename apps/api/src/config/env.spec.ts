import { loadEnv } from './env';

const validEnv = {
  NODE_ENV: 'test',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://user:pass@localhost:5433/db?schema=public',
  INTERNAL_API_KEY: 'synthetic_test_internal_key_0123456789',
  MEDIA_STORAGE_DIR: '/tmp/synthetic-media-root',
};

describe('loadEnv', () => {
  it('accepts a valid environment and coerces the port to a number', () => {
    const env = loadEnv(validEnv);

    expect(env.NODE_ENV).toBe('test');
    expect(env.API_PORT).toBe(3001);
    expect(typeof env.API_PORT).toBe('number');
  });

  it('applies defaults for optional variables', () => {
    const env = loadEnv({
      DATABASE_URL: validEnv.DATABASE_URL,
      INTERNAL_API_KEY: validEnv.INTERNAL_API_KEY,
      MEDIA_STORAGE_DIR: validEnv.MEDIA_STORAGE_DIR,
    });

    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3001);
    expect(env.PASSWORD_BLOCKED_TERMS).toBeUndefined();
  });

  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => loadEnv({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/);
  });

  it('fails fast when MEDIA_STORAGE_DIR is missing', () => {
    // No default, deliberately. A plausible relative default would let a
    // misconfigured deployment start and write families' photographs into
    // whatever directory the process was launched from.
    const { MEDIA_STORAGE_DIR: _omitted, ...withoutRoot } = validEnv;

    expect(() => loadEnv(withoutRoot)).toThrow(/MEDIA_STORAGE_DIR/);
  });

  it('fails fast when INTERNAL_API_KEY is missing', () => {
    // Required with no default. A default would be a published credential, and
    // an absent one must stop the process rather than silently disable the
    // Next-to-Nest boundary check.
    const { INTERNAL_API_KEY: _omitted, ...withoutKey } = validEnv;

    expect(() => loadEnv(withoutKey)).toThrow(/INTERNAL_API_KEY/);
  });

  it('rejects an INTERNAL_API_KEY that is too short to be a real secret', () => {
    expect(() => loadEnv({ ...validEnv, INTERNAL_API_KEY: 'tooshort' })).toThrow(
      /INTERNAL_API_KEY/,
    );
  });

  it('never echoes the internal key, even when rejecting it', () => {
    let message = '';
    try {
      loadEnv({ ...validEnv, INTERNAL_API_KEY: 'sup3rs3cret' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('INTERNAL_API_KEY');
    expect(message).not.toContain('sup3rs3cret');
  });

  it('accepts optional clinic blocked terms', () => {
    const env = loadEnv({ ...validEnv, PASSWORD_BLOCKED_TERMS: 'alpha,beta' });

    expect(env.PASSWORD_BLOCKED_TERMS).toBe('alpha,beta');
  });

  it('rejects a DATABASE_URL that is not a postgresql connection string', () => {
    expect(() => loadEnv({ ...validEnv, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /postgresql:\/\//,
    );
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadEnv({ ...validEnv, API_PORT: '70000' })).toThrow(/API_PORT/);
  });

  it('never echoes the offending value, so credentials cannot leak into logs', () => {
    const secret = 'mysql://user:sup3rs3cret@host/db';

    let message = '';
    try {
      loadEnv({ ...validEnv, DATABASE_URL: secret });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('sup3rs3cret');
  });
});
