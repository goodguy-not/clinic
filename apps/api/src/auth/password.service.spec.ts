import {
  ARGON2_MEMORY_COST_KIB,
  ARGON2_PARALLELISM,
  ARGON2_TIME_COST,
  PASSWORD_MAX_BYTES,
} from './auth-policy';
import { PasswordService, parseArgon2Parameters } from './password.service';

/**
 * Arabic-script fixtures are built from code points rather than literals so no
 * editor, formatter or file-encoding step can alter what is being asserted.
 * The distinction between Persian and Arabic yeh is invisible in most fonts and
 * is exactly what this suite exists to protect.
 */
const PERSIAN_YEH = String.fromCodePoint(0x06cc); // U+06CC FARSI YEH
const ARABIC_YEH = String.fromCodePoint(0x064a); // U+064A ARABIC YEH
const PERSIAN_KAF = String.fromCodePoint(0x06a9); // U+06A9 KEHEH
const ARABIC_KAF = String.fromCodePoint(0x0643); // U+0643 ARABIC KAF

const ALEF = String.fromCodePoint(0x0627);
const MADDA_ABOVE = String.fromCodePoint(0x0653);
const ALEF_WITH_MADDA = String.fromCodePoint(0x0622);
const HAMZA_ABOVE = String.fromCodePoint(0x0654);
const ALEF_WITH_HAMZA = String.fromCodePoint(0x0623);

const E = 'e';
const COMBINING_ACUTE = String.fromCodePoint(0x0301);
const E_ACUTE = String.fromCodePoint(0x00e9);

const PASSPHRASE = 'quiet harbour lantern drift';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeEach(() => {
    service = new PasswordService();
  });

  describe('hashing', () => {
    it('produces an Argon2id encoded hash carrying the current parameters', async () => {
      const encoded = await service.hash(PASSPHRASE);

      expect(encoded.startsWith('$argon2id$')).toBe(true);
      expect(parseArgon2Parameters(encoded)).toEqual({
        version: 19,
        memoryCost: ARGON2_MEMORY_COST_KIB,
        timeCost: ARGON2_TIME_COST,
        parallelism: ARGON2_PARALLELISM,
      });
    });

    it('salts, so the same password hashes differently every time', async () => {
      const [first, second] = await Promise.all([
        service.hash(PASSPHRASE),
        service.hash(PASSPHRASE),
      ]);

      expect(first).not.toBe(second);
      await expect(service.verify(first, PASSPHRASE)).resolves.toBe(true);
      await expect(service.verify(second, PASSPHRASE)).resolves.toBe(true);
    });

    it('refuses to hash input the guard rejects, because callers must validate first', async () => {
      await expect(service.hash('\uD800bad')).rejects.toThrow(/input guard/);
      await expect(service.hash('a'.repeat(PASSWORD_MAX_BYTES + 1))).rejects.toThrow(/input guard/);
    });
  });

  describe('verification', () => {
    it('accepts the correct password and rejects a wrong one', async () => {
      const encoded = await service.hash(PASSPHRASE);

      await expect(service.verify(encoded, PASSPHRASE)).resolves.toBe(true);
      await expect(service.verify(encoded, 'quiet harbour lantern drifts')).resolves.toBe(false);
    });

    it('returns false rather than throwing on a malformed stored hash', async () => {
      // A 500 here would tell an attacker their guess was interesting.
      await expect(service.verify('not-a-hash', PASSPHRASE)).resolves.toBe(false);
      await expect(service.verify('', PASSPHRASE)).resolves.toBe(false);
    });

    it('returns false without invoking Argon2 when the input guard rejects', async () => {
      const encoded = await service.hash(PASSPHRASE);

      await expect(service.verify(encoded, '\uD800bad')).resolves.toBe(false);
      await expect(service.verify(encoded, 'a'.repeat(PASSWORD_MAX_BYTES + 1))).resolves.toBe(
        false,
      );
    });
  });

  describe('NFC normalisation', () => {
    it('treats canonically equivalent Arabic sequences as the same password', async () => {
      // U+0622 decomposes canonically to U+0627 U+0653.
      expect((ALEF + MADDA_ABOVE).normalize('NFC')).toBe(ALEF_WITH_MADDA);

      const precomposed = `${ALEF_WITH_MADDA}-my-long-passphrase`;
      const decomposed = `${ALEF}${MADDA_ABOVE}-my-long-passphrase`;

      const encoded = await service.hash(precomposed);
      await expect(service.verify(encoded, decomposed)).resolves.toBe(true);
    });

    it('treats alef-with-hamza equivalently in either encoding', async () => {
      expect((ALEF + HAMZA_ABOVE).normalize('NFC')).toBe(ALEF_WITH_HAMZA);

      const encoded = await service.hash(`${ALEF_WITH_HAMZA}-my-long-passphrase`);
      await expect(
        service.verify(encoded, `${ALEF}${HAMZA_ABOVE}-my-long-passphrase`),
      ).resolves.toBe(true);
    });

    it('treats a decomposed Latin accent equivalently', async () => {
      expect((E + COMBINING_ACUTE).normalize('NFC')).toBe(E_ACUTE);

      const encoded = await service.hash(`caf${E_ACUTE} lantern drift quietly`);
      await expect(
        service.verify(encoded, `caf${E}${COMBINING_ACUTE} lantern drift quietly`),
      ).resolves.toBe(true);
    });

    it('keeps Persian and Arabic yeh DIFFERENT, because they are different characters', async () => {
      // NFC does not fold these. They have no canonical or compatibility
      // equivalence, and no custom folding is applied: silently merging them
      // would shrink the keyspace and make two visibly different passwords
      // interchangeable.
      expect(PERSIAN_YEH.normalize('NFC')).not.toBe(ARABIC_YEH.normalize('NFC'));

      const encoded = await service.hash(`long-passphrase-${PERSIAN_YEH.repeat(4)}`);
      await expect(
        service.verify(encoded, `long-passphrase-${ARABIC_YEH.repeat(4)}`),
      ).resolves.toBe(false);
    });

    it('keeps Persian keheh and Arabic kaf DIFFERENT', async () => {
      expect(PERSIAN_KAF.normalize('NFC')).not.toBe(ARABIC_KAF.normalize('NFC'));

      const encoded = await service.hash(`long-passphrase-${PERSIAN_KAF.repeat(4)}`);
      await expect(
        service.verify(encoded, `long-passphrase-${ARABIC_KAF.repeat(4)}`),
      ).resolves.toBe(false);
    });
  });

  describe('dummy hash', () => {
    it('is a real Argon2id hash with current parameters, so the unknown-user branch costs the same', async () => {
      const dummy = await service.dummyHash();

      expect(dummy.startsWith('$argon2id$')).toBe(true);
      expect(parseArgon2Parameters(dummy)?.memoryCost).toBe(ARGON2_MEMORY_COST_KIB);
    });

    it('is memoised, so it is computed once and cannot be timed as a first-request cost', async () => {
      const [first, second] = await Promise.all([service.dummyHash(), service.dummyHash()]);
      expect(first).toBe(second);
    });

    it('is pre-warmed by onModuleInit', async () => {
      const fresh = new PasswordService();
      await fresh.onModuleInit();
      await expect(fresh.dummyHash()).resolves.toMatch(/^\$argon2id\$/);
    });

    it('never authenticates anything', async () => {
      await expect(service.verifyAgainstDummy(PASSPHRASE)).resolves.toBe(false);
      await expect(service.verifyAgainstDummy('')).resolves.toBe(false);
    });
  });

  describe('needsRehash', () => {
    it('is false for a hash produced under current policy', async () => {
      expect(service.needsRehash(await service.hash(PASSPHRASE))).toBe(false);
    });

    it('is true when any stored parameter differs from policy', () => {
      const weaker = `$argon2id$v=19$m=4096,t=${ARGON2_TIME_COST},p=${ARGON2_PARALLELISM}$c2FsdA$aGFzaA`;
      const fewerPasses = `$argon2id$v=19$m=${ARGON2_MEMORY_COST_KIB},t=1,p=${ARGON2_PARALLELISM}$c2FsdA$aGFzaA`;

      expect(service.needsRehash(weaker)).toBe(true);
      expect(service.needsRehash(fewerPasses)).toBe(true);
    });

    it('is true for a hash from a different algorithm or an unparseable value', () => {
      expect(service.needsRehash('$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA')).toBe(true);
      expect(service.needsRehash('$2b$12$abcdefghijklmnopqrstuv')).toBe(true);
      expect(service.needsRehash('')).toBe(true);
    });
  });

  describe('parseArgon2Parameters', () => {
    it('returns null for anything that is not an Argon2id encoded hash', () => {
      expect(parseArgon2Parameters('nonsense')).toBeNull();
      expect(parseArgon2Parameters('$argon2d$v=19$m=1,t=1,p=1$a$b')).toBeNull();
    });
  });
});
