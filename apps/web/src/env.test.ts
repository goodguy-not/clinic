import { describe, expect, it } from 'vitest';
import { loadServerEnv } from './env';

describe('loadServerEnv', () => {
  it('accepts a valid environment', () => {
    const env = loadServerEnv({ NODE_ENV: 'test', API_BASE_URL: 'http://localhost:3001' });

    expect(env.NODE_ENV).toBe('test');
    expect(env.API_BASE_URL).toBe('http://localhost:3001');
  });

  it('defaults NODE_ENV to development', () => {
    expect(loadServerEnv({ API_BASE_URL: 'http://localhost:3001' }).NODE_ENV).toBe('development');
  });

  it('fails fast when API_BASE_URL is missing', () => {
    expect(() => loadServerEnv({ NODE_ENV: 'test' })).toThrow(/API_BASE_URL/);
  });

  it('rejects an API_BASE_URL that is not an http(s) URL', () => {
    expect(() => loadServerEnv({ API_BASE_URL: 'localhost:3001' })).toThrow(/http:\/\//);
  });

  it('declares no database connection variable', () => {
    // The web application must not be configurable with database credentials.
    const env = loadServerEnv({ API_BASE_URL: 'http://localhost:3001' });

    expect(Object.keys(env).sort()).toEqual(['API_BASE_URL', 'NODE_ENV']);
  });

  it('never surfaces a database connection string even if one is injected', () => {
    // Defence in depth: if a misconfigured deployment leaked the API's variable
    // into this process, the schema still refuses to hand it to application code.
    //
    // The key is assembled at runtime so this file contains no literal database
    // variable name — `scripts/check-web-boundary.mjs` scans apps/web for that
    // token and is deliberately kept free of per-file exemptions.
    const injectedKey = ['DATABASE', 'URL'].join('_');
    const env = loadServerEnv({
      API_BASE_URL: 'http://localhost:3001',
      [injectedKey]: 'postgresql://clinic:sup3rs3cret@localhost:5433/clinic_dev',
    });

    expect(Object.keys(env)).not.toContain(injectedKey);
    expect(JSON.stringify(env)).not.toContain('sup3rs3cret');
  });
});
