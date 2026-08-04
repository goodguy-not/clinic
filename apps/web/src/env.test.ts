import { describe, expect, it } from 'vitest';
import { loadServerEnv, parseAllowedOrigins } from './env';

const validEnv = {
  NODE_ENV: 'test',
  DEPLOYMENT_MODE: 'non-production',
  API_BASE_URL: 'http://localhost:3001',
  INTERNAL_API_KEY: 'synthetic_test_internal_key_0123456789ab',
  SESSION_COOKIE_SECRET: 'synthetic_test_cookie_secret_0123456789ab',
  WEB_ALLOWED_ORIGINS: 'http://localhost:3000',
};

describe('loadServerEnv', () => {
  it('accepts a valid environment', () => {
    const env = loadServerEnv(validEnv);

    expect(env.DEPLOYMENT_MODE).toBe('non-production');
    expect(env.API_BASE_URL).toBe('http://localhost:3001');
  });

  it('declares no database connection variable', () => {
    // The web application must not be configurable with database credentials.
    expect(Object.keys(loadServerEnv(validEnv)).sort()).toEqual([
      'API_BASE_URL',
      'DEPLOYMENT_MODE',
      'INTERNAL_API_KEY',
      'NODE_ENV',
      'SESSION_COOKIE_SECRET',
      'WEB_ALLOWED_ORIGINS',
    ]);
  });

  it('never surfaces a database connection string even if one is injected', () => {
    const injectedKey = ['DATABASE', 'URL'].join('_');
    const env = loadServerEnv({ ...validEnv, [injectedKey]: 'postgresql://u:sup3rs3cret@h/d' });

    expect(Object.keys(env)).not.toContain(injectedKey);
    expect(JSON.stringify(env)).not.toContain('sup3rs3cret');
  });

  describe('DEPLOYMENT_MODE', () => {
    it('has no default, so forgetting it stops the process', () => {
      const { DEPLOYMENT_MODE: _omitted, ...withoutMode } = validEnv;

      expect(() => loadServerEnv(withoutMode)).toThrow(/DEPLOYMENT_MODE/);
    });

    it('rejects any value other than the two modes', () => {
      expect(() => loadServerEnv({ ...validEnv, DEPLOYMENT_MODE: 'staging' })).toThrow(
        /DEPLOYMENT_MODE/,
      );
    });

    it('is independent of NODE_ENV', () => {
      // A production build tested over LAN HTTP is NODE_ENV=production but a
      // non-production deployment. Tying the two together would break that or
      // invite an override flag.
      const env = loadServerEnv({
        ...validEnv,
        NODE_ENV: 'production',
        DEPLOYMENT_MODE: 'non-production',
      });

      expect(env.DEPLOYMENT_MODE).toBe('non-production');
    });
  });

  describe('required secrets', () => {
    it.each(['INTERNAL_API_KEY', 'SESSION_COOKIE_SECRET'])('requires %s', (key) => {
      const source: Record<string, string> = { ...validEnv };
      delete source[key];

      expect(() => loadServerEnv(source)).toThrow(new RegExp(key));
    });

    it.each(['INTERNAL_API_KEY', 'SESSION_COOKIE_SECRET'])('rejects a short %s', (key) => {
      expect(() => loadServerEnv({ ...validEnv, [key]: 'tooshort' })).toThrow(new RegExp(key));
    });

    it('never echoes a rejected secret', () => {
      let message = '';
      try {
        loadServerEnv({ ...validEnv, INTERNAL_API_KEY: 'sup3rs3cret' });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }

      expect(message).toContain('INTERNAL_API_KEY');
      expect(message).not.toContain('sup3rs3cret');
    });
  });

  describe('WEB_ALLOWED_ORIGINS', () => {
    it('parses a comma-separated list', () => {
      expect(parseAllowedOrigins(' http://a.test , http://b.test ')).toEqual([
        'http://a.test',
        'http://b.test',
      ]);
    });

    it('requires at least one origin', () => {
      expect(() => loadServerEnv({ ...validEnv, WEB_ALLOWED_ORIGINS: ' , ' })).toThrow(
        /WEB_ALLOWED_ORIGINS/,
      );
    });

    it('rejects a value carrying a path, which could never match an Origin header', () => {
      expect(() =>
        loadServerEnv({ ...validEnv, WEB_ALLOWED_ORIGINS: 'http://localhost:3000/app' }),
      ).toThrow(/bare origins/);
    });

    it('rejects something that is not a URL', () => {
      expect(() => loadServerEnv({ ...validEnv, WEB_ALLOWED_ORIGINS: 'localhost:3000' })).toThrow(
        /WEB_ALLOWED_ORIGINS/,
      );
    });

    it('requires https in a production deployment', () => {
      expect(() =>
        loadServerEnv({
          ...validEnv,
          DEPLOYMENT_MODE: 'production',
          WEB_ALLOWED_ORIGINS: 'http://clinic.test',
        }),
      ).toThrow(/https/);
    });

    it('accepts https in a production deployment', () => {
      const env = loadServerEnv({
        ...validEnv,
        DEPLOYMENT_MODE: 'production',
        WEB_ALLOWED_ORIGINS: 'https://clinic.test,https://www.clinic.test',
      });

      expect(env.WEB_ALLOWED_ORIGINS).toContain('https://clinic.test');
    });

    it('allows http only in a non-production deployment', () => {
      expect(loadServerEnv(validEnv).WEB_ALLOWED_ORIGINS).toBe('http://localhost:3000');
    });
  });
});
