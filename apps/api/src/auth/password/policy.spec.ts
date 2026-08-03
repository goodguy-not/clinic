import { validatePassword } from './policy';

/** A realistic passphrase that trips none of the blocklist rules. */
const GOOD = 'quiet harbour lantern drift';

describe('validatePassword', () => {
  it('accepts a realistic passphrase and returns the normalised form', () => {
    const result = validatePassword(GOOD);

    expect(result.ok).toBe(true);
    expect(result.ok && result.normalized).toBe(GOOD);
  });

  it('accepts a Persian passphrase', () => {
    // Synthetic, not clinic content: "blue window quiet morning".
    const persian = 'پنجره آبی صبح آرام است';
    const result = validatePassword(persian);

    expect(result.ok).toBe(true);
  });

  it('accepts spaces, so passphrases are usable', () => {
    expect(validatePassword('four words with spaces').ok).toBe(true);
  });

  it('collects every applicable violation rather than stopping at the first', () => {
    // Too short AND a repeated unit.
    const result = validatePassword('abab');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toEqual(expect.arrayContaining(['TOO_SHORT', 'REPEATED_UNIT']));
  });

  it('rejects a password over the code-point maximum', () => {
    const result = validatePassword('a'.repeat(129));

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.violations).toContain('TOO_LONG');
  });

  it('rejects an entry from the committed common-password list', () => {
    const result = validatePassword('passwordpassword');

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.violations).toContain('COMMON_PASSWORD');
  });

  it('rejects a password containing the account username', () => {
    const result = validatePassword(`reza ${GOOD}`, { username: 'reza' });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.violations).toContain('CONTAINS_USERNAME');
  });

  it('matches the username case-insensitively', () => {
    const result = validatePassword(`REZA ${GOOD}`, { username: 'reza' });

    expect(result.ok ? [] : result.violations).toContain('CONTAINS_USERNAME');
  });

  it('rejects a password containing an owner-supplied clinic term', () => {
    const result = validatePassword(`${GOOD} novaclinic`, { blockedTerms: ['novaclinic'] });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.violations).toContain('CONTAINS_BLOCKED_TERM');
  });

  it('applies no clinic-term rule when the owner has supplied none', () => {
    expect(validatePassword(GOOD, { blockedTerms: [] }).ok).toBe(true);
  });

  it('rejects a short repeated unit', () => {
    const result = validatePassword('abcabcabcabcabc');

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.violations).toContain('REPEATED_UNIT');
  });

  it('rejects a keyboard walk', () => {
    const result = validatePassword('qwertyuiopasdfgh');

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.violations).toContain('KEYBOARD_WALK');
  });

  it('reports the input-guard rejection alone, running nothing downstream', () => {
    const result = validatePassword('\uD800' + 'a'.repeat(30));

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.violations).toEqual(['ILL_FORMED_UNICODE']);
  });

  it('enforces no composition rules, per NIST SP 800-63B', () => {
    // All lower case, no digit, no symbol: still acceptable at this length.
    expect(validatePassword('sixteen lower case letters here').ok).toBe(true);
  });
});
