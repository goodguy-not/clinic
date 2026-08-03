import { loadEnv } from './env';

const validEnv = {
  NODE_ENV: 'test',
  API_PORT: '3001',
  DATABASE_URL: 'postgresql://user:pass@localhost:5433/db?schema=public',
};

describe('loadEnv', () => {
  it('accepts a valid environment and coerces the port to a number', () => {
    const env = loadEnv(validEnv);

    expect(env.NODE_ENV).toBe('test');
    expect(env.API_PORT).toBe(3001);
    expect(typeof env.API_PORT).toBe('number');
  });

  it('applies defaults for optional variables', () => {
    const env = loadEnv({ DATABASE_URL: validEnv.DATABASE_URL });

    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3001);
  });

  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => loadEnv({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/);
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
