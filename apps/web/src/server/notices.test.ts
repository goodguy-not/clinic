import { NOTICE_CODES } from '@clinic/contracts';
import { describe, expect, it } from 'vitest';
import { isKnownNoticeCode, persianNotice, TRANSLATED_NOTICE_CODES } from './notices';

describe('Persian notice mapping', () => {
  it('translates every notice code the contract defines', () => {
    // Same guard as the error map: a code added upstream without a translation
    // fails here rather than reaching a user as English.
    for (const code of NOTICE_CODES) {
      const message = persianNotice(code);

      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/[A-Za-z]{4,}/);
    }
  });

  it('exposes the contract list rather than a local copy', () => {
    expect(TRANSLATED_NOTICE_CODES).toEqual(NOTICE_CODES);
  });

  it('accepts only codes the contract defines', () => {
    for (const code of NOTICE_CODES) {
      expect(isKnownNoticeCode(code)).toBe(true);
    }

    // The value arrives in a query string, so anything else must be refused
    // before it is rendered.
    for (const rejected of [null, '', 'SIMILAR', 'similar_family_exists', '<script>']) {
      expect(isKnownNoticeCode(rejected)).toBe(false);
    }
  });

  it('names no candidate, only a category', () => {
    // The whole point of a fixed code is that the URL says a similar record
    // exists without saying who it is.
    for (const code of NOTICE_CODES) {
      expect(code).toMatch(/^[A-Z_]+$/);
    }
  });
});
