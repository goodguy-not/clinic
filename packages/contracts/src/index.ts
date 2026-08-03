/**
 * Shared contracts between the NestJS API and the Next.js web application.
 *
 * This package contains schemas, the types inferred from them, and constants.
 * It contains no functions, no HTTP client, no mapping tables, no Persian text,
 * and no database access of any kind — `scripts/check-web-boundary.mjs`
 * enforces the last two mechanically.
 *
 * Response schemas are strict. An accidental extra field in a NestJS response —
 * a serialised `passwordHash` being the case that matters — fails a test
 * instead of reaching a browser.
 */
export * from './errors';
export * from './permissions';
export * from './roles';
export * from './users';
export * from './auth';
