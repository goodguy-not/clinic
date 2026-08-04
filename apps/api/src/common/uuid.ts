import { randomBytes } from 'node:crypto';

/**
 * UUIDv7 — a time-ordered identifier.
 *
 * Used for every primary key. The leading 48 bits are a millisecond timestamp,
 * so rows insert in roughly ascending key order and B-tree pages fill densely
 * instead of scattering, which matters most for `audit_log` — an append-only
 * table that only ever grows.
 *
 * The embedded timestamp comes from the Node clock, which is deliberately fine:
 * it determines index locality, never a security decision. Every value that
 * gates access — session validity, expiry, lockout — is computed by PostgreSQL
 * (`clock_timestamp()` / `transaction_timestamp()`), never here.
 *
 * Prisma's own `@default(uuid(7))` is also client-generated, so raw SQL inserts
 * that supply an id via this function stay consistent with rows Prisma creates.
 *
 * Layout (RFC 9562): 48-bit unix_ts_ms | version 7 | 12-bit rand_a |
 * variant 0b10 | 62-bit rand_b.
 */
export function uuidv7(): string {
  const bytes = randomBytes(16);
  const milliseconds = BigInt(Date.now());

  bytes[0] = Number((milliseconds >> 40n) & 0xffn);
  bytes[1] = Number((milliseconds >> 32n) & 0xffn);
  bytes[2] = Number((milliseconds >> 24n) & 0xffn);
  bytes[3] = Number((milliseconds >> 16n) & 0xffn);
  bytes[4] = Number((milliseconds >> 8n) & 0xffn);
  bytes[5] = Number(milliseconds & 0xffn);

  // Version 7 in the high nibble of byte 6.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  // RFC 4122 variant (0b10) in the top two bits of byte 8.
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = bytes.toString('hex');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
