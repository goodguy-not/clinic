import { ERROR_CODES } from '@clinic/contracts';
import { describe, expect, it } from 'vitest';
import { COPY } from './copy-fa';
import { persianMessage, TRANSLATED_CODES } from './errors-fa';

describe('Persian error mapping', () => {
  it('translates every code the contract defines', () => {
    // Iterating the contract's own list means a code added upstream without a
    // translation fails here rather than reaching a user as English.
    for (const code of ERROR_CODES) {
      const message = persianMessage(code);

      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/[A-Za-z]{4,}/);
    }
  });

  it('covers the unreachable-API code the web tier raises itself', () => {
    expect(TRANSLATED_CODES).toContain('API_UNREACHABLE');
    expect(persianMessage('API_UNREACHABLE').length).toBeGreaterThan(0);
  });

  it('uses the approved generic message for invalid credentials', () => {
    expect(persianMessage('AUTH_INVALID_CREDENTIALS')).toBe(COPY.loginFailed);
  });

  it('gives session-invalid and session-expired the same message', () => {
    // NestJS distinguishes them internally; the interface must not, or it would
    // reintroduce a signal the API deliberately withholds.
    expect(persianMessage('AUTH_SESSION_INVALID')).toBe(persianMessage('AUTH_SESSION_EXPIRED'));
    expect(persianMessage('AUTH_SESSION_INVALID')).toBe(COPY.sessionExpired);
  });

  it('gives CSRF and Origin rejections the same non-technical message', () => {
    expect(persianMessage('AUTH_CSRF_INVALID')).toBe(persianMessage('AUTH_ORIGIN_REJECTED'));
  });

  it('contains no English in any message', () => {
    for (const code of TRANSLATED_CODES) {
      expect(persianMessage(code)).not.toMatch(/[A-Za-z]{4,}/);
    }
  });
});
