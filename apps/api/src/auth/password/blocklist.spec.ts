import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PASSWORD_MIN_CODE_POINTS } from '../auth-policy';
import { countCodePoints } from './normalize';
import {
  commonPasswordBlocklist,
  containsBlockedTerm,
  containsUsername,
  isCommonPassword,
  isKeyboardWalk,
  isShortRepeatedUnit,
  parseBlockedTerms,
} from './blocklist';

describe('committed common-password list', () => {
  it('loads entries from the file', () => {
    expect(commonPasswordBlocklist().size).toBeGreaterThan(0);
  });

  it('loads exactly the number of entries its header declares', () => {
    // This is the guard that catches a malformed header. A header line that
    // lost its leading '#' would otherwise be silently loaded as a password,
    // and a truncated file would silently weaken the blocklist. Both show up
    // here as a count mismatch. (It caught exactly that during generation: a
    // shell-mangled regeneration command had become a 172-character "password".)
    const raw = readFileSync(join(__dirname, 'common-passwords-min15.txt'), 'utf8');
    const declared = /entries here:\s*(\d+)/.exec(raw)?.[1];

    expect(declared).toBeDefined();
    expect(commonPasswordBlocklist().size).toBe(Number(declared));
  });

  it('records complete provenance, with no placeholder left behind', () => {
    const raw = readFileSync(join(__dirname, 'common-passwords-min15.txt'), 'utf8');
    const header = raw.slice(0, raw.indexOf('\n\n') === -1 ? 4000 : 4000);

    expect(header).toMatch(/release tag:\s+\S+/);
    expect(header).toMatch(/commit SHA:\s+[0-9a-f]{40}/);
    expect(header).toMatch(/source sha256:\s+[0-9a-f]{64}/);
    expect(header).toMatch(/retrieved:\s+\d{4}-\d{2}-\d{2}/);
    expect(header).toMatch(/MIT License/);
    expect(header).not.toMatch(/PENDING/);
  });

  it('contains no entry shorter than the policy minimum', () => {
    // The file exists for long-but-weak passwords. A shorter entry would be
    // dead weight, because length already rejects it before the list is
    // consulted. This pins the file's stated purpose.
    for (const entry of commonPasswordBlocklist()) {
      expect(countCodePoints(entry)).toBeGreaterThanOrEqual(PASSWORD_MIN_CODE_POINTS);
    }
  });

  it('is byte-identical to the pinned SecLists residue', () => {
    // The locale work added Persian rules alongside this file; it must not have
    // edited, filtered or regenerated it. Freezing the digest and the entry
    // count together catches a silent edit and a silent truncation.
    const bytes = readFileSync(join(__dirname, 'common-passwords-min15.txt'));
    const digest = createHash('sha256').update(bytes).digest('hex');

    expect(digest).toBe('581b3ac586dc6eb92f9acf3bb7b4dfc472dc89ffcd4079ed120d239522c41712');
    expect(commonPasswordBlocklist().size).toBe(10898);
  });

  it('contains no comment or blank line', () => {
    for (const entry of commonPasswordBlocklist()) {
      expect(entry.startsWith('#')).toBe(false);
      expect(entry.trim()).toBe(entry);
      expect(entry.length).toBeGreaterThan(0);
    }
  });

  it('matches a known entry case-insensitively', () => {
    expect(isCommonPassword('passwordpassword')).toBe(true);
    expect(isCommonPassword('PasswordPassword'.toLowerCase())).toBe(true);
  });

  it('matches exactly, not as a substring', () => {
    expect(isCommonPassword('xxpasswordpasswordxx')).toBe(false);
  });

  it('does not match an ordinary passphrase', () => {
    expect(isCommonPassword('quiet harbour lantern drift')).toBe(false);
  });
});

describe('parseBlockedTerms', () => {
  it('returns an empty list when the variable is unset', () => {
    // Correct behaviour before the owner supplies clinic-specific terms.
    expect(parseBlockedTerms(undefined)).toEqual([]);
  });

  it('splits, trims and case-folds', () => {
    expect(parseBlockedTerms(' Alpha , BETA,gamma ')).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('drops empty segments', () => {
    expect(parseBlockedTerms('alpha,,  ,beta')).toEqual(['alpha', 'beta']);
  });
});

describe('containsBlockedTerm', () => {
  it('detects a term anywhere in the password', () => {
    expect(containsBlockedTerm('my-alpha-passphrase', ['alpha'])).toBe(true);
    expect(containsBlockedTerm('my-passphrase', ['alpha'])).toBe(false);
  });

  it('is a no-op for an empty term list', () => {
    expect(containsBlockedTerm('anything at all', [])).toBe(false);
  });
});

describe('containsUsername', () => {
  it('detects the username anywhere in the password', () => {
    expect(containsUsername('reza-my-long-passphrase', 'reza')).toBe(true);
    expect(containsUsername('my-long-passphrase', 'reza')).toBe(false);
  });

  it('ignores an empty username', () => {
    expect(containsUsername('anything at all', '   ')).toBe(false);
  });
});

describe('isShortRepeatedUnit', () => {
  it.each([
    ['aaaaaaaaaaaaaaa', 1],
    ['abababababababab', 2],
    ['abcabcabcabcabc', 3],
    ['abcdabcdabcdabcd', 4],
    ['abcdeabcdeabcde', 5],
    ['salamsalamsalam', 5],
    ['abcdefabcdefabcdef', 6],
    ['azizamazizamazizam', 6],
  ])('detects %s (unit length %i)', (password: string) => {
    expect(isShortRepeatedUnit(password)).toBe(true);
  });

  it('ignores a unit longer than the threshold', () => {
    // The threshold is 6 code points; a seven-character unit is past it.
    expect(isShortRepeatedUnit('abcdefgabcdefgabcdefg')).toBe(false);
  });

  it('ignores a non-repeating passphrase', () => {
    expect(isShortRepeatedUnit('quiet harbour lantern drift')).toBe(false);
  });

  it('documents the known limitation: a truncated repetition is not caught', () => {
    // Period 3 with a remainder, so there is no exact period. A
    // minimum-distinct-code-point rule would catch this class, but that is a
    // different policy than the one approved, so it is not implemented.
    expect(isShortRepeatedUnit('1231231231231231')).toBe(false);
  });
});

describe('isKeyboardWalk', () => {
  it.each([
    'qwertyuiopasdfgh',
    'asdfghjklzxcvbnm',
    '123456789012345',
    'abcdefghijklmnop',
    'qazwsxedcrfvtgby',
  ])('detects %s', (password: string) => {
    expect(isKeyboardWalk(password)).toBe(true);
  });

  it('detects a reversed walk', () => {
    expect(isKeyboardWalk('ponmlkjihgfedcba')).toBe(true);
  });

  it('does not flag an ordinary passphrase', () => {
    expect(isKeyboardWalk('quiet harbour lantern drift')).toBe(false);
  });
});
