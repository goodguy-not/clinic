import { randomBytes } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Algorithm, hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { Semaphore } from './argon2-semaphore';
import {
  ARGON2_MAX_CONCURRENCY,
  ARGON2_MEMORY_COST_KIB,
  ARGON2_OUTPUT_LENGTH_BYTES,
  ARGON2_PARALLELISM,
  ARGON2_TIME_COST,
} from './auth-policy';
import { normalizePassword } from './password/normalize';

/**
 * Argon2id hashing and verification.
 *
 * The encoded hash carries its own parameters
 * (`$argon2id$v=19$m=...,t=...,p=...$salt$hash`), so raising the cost later does
 * not invalidate existing hashes: `needsRehash` detects the difference and the
 * login path re-hashes transparently on the next successful sign-in.
 *
 * Every password crossing this boundary is NFC-normalised first. Changing that
 * normalisation later would invalidate every stored hash, which is why it is
 * recorded as effectively permanent.
 */

const ARGON2_VERSION = 19;

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: ARGON2_MEMORY_COST_KIB,
  timeCost: ARGON2_TIME_COST,
  parallelism: ARGON2_PARALLELISM,
  outputLen: ARGON2_OUTPUT_LENGTH_BYTES,
} as const;

export type Argon2Parameters = {
  version: number;
  memoryCost: number;
  timeCost: number;
  parallelism: number;
};

const ARGON2ID_ENCODED = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/;

/** Returns null when the value is not an Argon2id encoded hash this code produced. */
export function parseArgon2Parameters(encodedHash: string): Argon2Parameters | null {
  const match = ARGON2ID_ENCODED.exec(encodedHash);
  if (match === null) return null;

  const [, version, memoryCost, timeCost, parallelism] = match;
  if (
    version === undefined ||
    memoryCost === undefined ||
    timeCost === undefined ||
    parallelism === undefined
  ) {
    return null;
  }

  return {
    version: Number(version),
    memoryCost: Number(memoryCost),
    timeCost: Number(timeCost),
    parallelism: Number(parallelism),
  };
}

@Injectable()
export class PasswordService implements OnModuleInit {
  readonly #semaphore = new Semaphore(ARGON2_MAX_CONCURRENCY);
  #dummyHash: Promise<string> | undefined;

  /**
   * Pre-computes the dummy hash so the first unknown-username login does not
   * pay for it and thereby stand out. Memoised, so a unit test constructing the
   * service directly gets the same value lazily.
   */
  async onModuleInit(): Promise<void> {
    await this.dummyHash();
  }

  /**
   * The hash verified against when no account matches the submitted username,
   * so that branch costs the same as a real verification. Built from random
   * bytes at startup with the current policy parameters — nothing can ever
   * authenticate against it.
   */
  dummyHash(): Promise<string> {
    this.#dummyHash ??= this.#rawHash(randomBytes(32).toString('base64'));
    return this.#dummyHash;
  }

  /**
   * Callers must have run `validatePassword` first; a guard rejection here is a
   * programming error rather than a user-facing outcome, so it throws.
   */
  async hash(rawPassword: string): Promise<string> {
    const normalization = normalizePassword(rawPassword);

    if (!normalization.ok) {
      throw new Error(
        `Refusing to hash a password rejected by the input guard (${normalization.reason}); validate before hashing`,
      );
    }

    return this.#rawHash(normalization.normalized);
  }

  /**
   * A guard rejection returns false without invoking Argon2. That is the
   * documented exception to "exactly one Argon2 verification per attempt":
   * the rule covers well-formed, byte-bounded credentials, and the resulting
   * timing difference depends only on attacker-supplied input, never on whether
   * an account exists or what state it is in.
   */
  async verify(encodedHash: string, rawPassword: string): Promise<boolean> {
    const normalization = normalizePassword(rawPassword);
    if (!normalization.ok) return false;

    return this.#rawVerify(encodedHash, normalization.normalized);
  }

  /** The unknown-username branch: same cost, and never a match. */
  async verifyAgainstDummy(rawPassword: string): Promise<boolean> {
    const normalization = normalizePassword(rawPassword);
    if (!normalization.ok) return false;

    return this.#rawVerify(await this.dummyHash(), normalization.normalized);
  }

  /**
   * True when the stored hash was produced under different parameters than
   * current policy, including when it is not a recognisable Argon2id hash at
   * all. The login path re-hashes inside the same transaction as the successful
   * sign-in, so legacy parameters cannot become permanent.
   */
  needsRehash(encodedHash: string): boolean {
    const parameters = parseArgon2Parameters(encodedHash);
    if (parameters === null) return true;

    return (
      parameters.version !== ARGON2_VERSION ||
      parameters.memoryCost !== ARGON2_MEMORY_COST_KIB ||
      parameters.timeCost !== ARGON2_TIME_COST ||
      parameters.parallelism !== ARGON2_PARALLELISM
    );
  }

  #rawHash(normalizedPassword: string): Promise<string> {
    return this.#semaphore.run(() => argon2Hash(normalizedPassword, ARGON2_OPTIONS));
  }

  async #rawVerify(encodedHash: string, normalizedPassword: string): Promise<boolean> {
    return this.#semaphore.run(async () => {
      try {
        return await argon2Verify(encodedHash, normalizedPassword);
      } catch {
        // A malformed or truncated stored hash must read as "does not match",
        // not as a 500 that tells the caller their guess was interesting.
        return false;
      }
    });
  }
}
