import { z } from 'zod';

/**
 * Staff roles. `THERAPIST` is deliberately absent: therapist login is a later,
 * separately approved decision (PROJECT_SPEC.md 4).
 *
 * These values must stay identical to the `user_role` PostgreSQL enum. An
 * integration test in `apps/api` asserts the two lists match, so drift fails a
 * test rather than surfacing as a runtime parse error.
 */
export const USER_ROLES = ['MANAGER', 'RECEPTIONIST'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const userRoleSchema = z.enum(USER_ROLES);

/**
 * Account status. Records with history are deactivated, never deleted
 * (PROJECT_SPEC.md 5), so there is no `DELETED` value and no delete endpoint.
 *
 * Must stay identical to the `user_status` PostgreSQL enum.
 */
export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

export const userStatusSchema = z.enum(USER_STATUSES);
