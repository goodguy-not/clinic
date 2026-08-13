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

  describe('the ledger messages', () => {
    // Milestone 5's five financial conditions are five different situations with
    // five different fixes, so each has to read as its own instruction rather
    // than as a variation on "something is wrong with this charge".
    it('gives every ledger code a message of its own', () => {
      const messages = [
        'CHARGE_NOT_FOUND',
        'CHARGE_ALREADY_VOIDED',
        'CHARGE_VOIDED',
        'CHARGE_EXISTS_FOR_PARTICIPANT',
        'CHARGE_NOT_ELIGIBLE',
        'ADJUSTMENT_NOT_FOUND',
        'ADJUSTMENT_ALREADY_VOIDED',
        'ADJUSTMENT_EXCEEDS_CHARGE',
      ].map((code) => persianMessage(code as Parameters<typeof persianMessage>[0]));

      expect(new Set(messages).size).toBe(messages.length);
    });

    it('describes a standing charge as what blocks reversing the session', () => {
      // This code is raised when a recorded fact would be reversed — reopening a
      // completed session, changing an attendance — not when a charge is posted
      // again. A re-post is idempotent and returns the existing charge, so the
      // message must not offer voiding as the way to post one.
      const message = persianMessage('CHARGE_EXISTS_FOR_PARTICIPANT');

      expect(message).toContain('ابطال');
      expect(message).toContain('تغییر نمی‌کند');
      expect(message).not.toContain('دوباره');
    });

    it('states the adjustment ceiling as the remainder, not as a free-session rule', () => {
      // The general condition: what is left of the charge after the concessions
      // already active against it. A free session is one instance of it, not a
      // separate rule to recite.
      const message = persianMessage('ADJUSTMENT_EXCEEDS_CHARGE');

      expect(message).toContain('باقی‌مانده');
      expect(message).not.toContain('رایگان');
    });

    it('separates a charge that is already void from one that may not be changed', () => {
      expect(persianMessage('CHARGE_ALREADY_VOIDED')).not.toBe(persianMessage('CHARGE_VOIDED'));
      // The second one has a way forward: post the charge again.
      expect(persianMessage('CHARGE_VOIDED')).toContain('دوباره');
    });

    it('explains eligibility as attendance at a session that took place', () => {
      expect(persianMessage('CHARGE_NOT_ELIGIBLE')).toContain('حاضر');
    });

    it('names no table, column, constraint or status value', () => {
      // Operator-facing text, not implementation language.
      for (const code of TRANSLATED_CODES) {
        const message = persianMessage(code);

        for (const internal of ['_', 'PAID', 'FREE', 'null', 'SQL']) {
          expect(message).not.toContain(internal);
        }
      }
    });
  });

  it('contains no English in any message', () => {
    for (const code of TRANSLATED_CODES) {
      expect(persianMessage(code)).not.toMatch(/[A-Za-z]{4,}/);
    }
  });
});
