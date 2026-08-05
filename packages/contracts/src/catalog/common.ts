import { z } from 'zod';

/**
 * Lifecycle of a catalog record.
 *
 * Records with history are deactivated, never deleted (PROJECT_SPEC.md 5), so
 * there is no `DELETED` value, no delete request schema and no delete endpoint.
 * The database refuses a `DELETE` outright.
 *
 * Must stay identical to the `catalog_status` PostgreSQL enum; an integration
 * test asserts the two lists match.
 */
export const CATALOG_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export const catalogStatusSchema = z.enum(CATALOG_STATUSES);

/**
 * A name or short free-text label on a catalog record.
 *
 * `.trim()` runs before the length checks, so the value that reaches the
 * database is already canonical. That is what makes `name = btrim(name)` —
 * asserted by a CHECK on every one of these columns — hold, and it is why
 * `"اتاق ۱"` and `" اتاق ۱ "` cannot coexist as two rows that look identical
 * in a list.
 *
 * Outer whitespace only. There is deliberately no Persian yeh/kaf folding, no
 * internal-whitespace collapsing and no fuzzy matching: each would silently
 * rewrite what a user typed, and near-duplicate detection is a separate,
 * unapproved feature.
 */
export const catalogNameSchema = z.string().trim().min(1).max(120);

/**
 * A recorded reason. Required wherever it appears, so "why" is never an empty
 * string sitting in an audit trail.
 */
export const catalogReasonSchema = z.string().trim().min(1).max(500);

/**
 * One allowed session length, in whole minutes.
 *
 * The upper bound mirrors `service_duration_positive_chk`. Eight hours is not
 * a plausible session; it is the point past which a typed value is a mistake.
 */
export const durationMinutesSchema = z.number().int().positive().max(480);

/** Activation and deactivation share one request shape across all three entities. */
export const updateCatalogStatusRequestSchema = z.strictObject({
  status: catalogStatusSchema,
});

export type UpdateCatalogStatusRequest = z.infer<typeof updateCatalogStatusRequestSchema>;
