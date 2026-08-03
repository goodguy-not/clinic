import { z } from 'zod';
import { userRoleSchema, userStatusSchema } from './roles';

/**
 * Login identifier. The same rule is enforced by a PostgreSQL CHECK, so this
 * schema is a fast, friendly duplicate of a constraint the database also holds
 * — not the only place it is true.
 *
 * The pattern implies lower case, which is what makes the identifier
 * case-insensitively unique without the `citext` extension.
 */
export const usernameSchema = z
  .string()
  .regex(
    /^[a-z0-9._-]{3,32}$/,
    'must be 3 to 32 characters using only a-z, 0-9, dot, underscore or hyphen',
  );

/**
 * `\S` mirrors the `btrim(display_name) <> ''` half of the database CHECK: a
 * value of only spaces is not a name.
 */
export const displayNameSchema = z.string().min(1).max(120).regex(/\S/);

/** A staff account as shown on the manager administration surface. */
export const staffUserSchema = z.strictObject({
  id: z.uuid(),
  username: usernameSchema,
  displayName: z.string(),
  role: userRoleSchema,
  status: userStatusSchema,
  mustChangePassword: z.boolean(),
  lockedUntil: z.iso.datetime().nullable(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export type StaffUser = z.infer<typeof staffUserSchema>;

export const createUserRequestSchema = z.strictObject({
  username: usernameSchema,
  displayName: displayNameSchema,
  role: userRoleSchema,
});

export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

/**
 * The temporary password is returned exactly once, at creation, and is never
 * stored in plain text, audited or logged.
 */
export const createUserResponseSchema = z.strictObject({
  user: staffUserSchema,
  temporaryPassword: z.string().min(1),
});

export type CreateUserResponse = z.infer<typeof createUserResponseSchema>;

export const userListResponseSchema = z.strictObject({
  users: z.array(staffUserSchema),
});

export type UserListResponse = z.infer<typeof userListResponseSchema>;

/** Returned by role change, status change and unlock. */
export const userResponseSchema = z.strictObject({
  user: staffUserSchema,
});

export type UserResponse = z.infer<typeof userResponseSchema>;

export const updateUserRoleRequestSchema = z.strictObject({
  role: userRoleSchema,
});

export type UpdateUserRoleRequest = z.infer<typeof updateUserRoleRequestSchema>;

export const updateUserStatusRequestSchema = z.strictObject({
  status: userStatusSchema,
});

export type UpdateUserStatusRequest = z.infer<typeof updateUserStatusRequestSchema>;

export const passwordResetResponseSchema = z.strictObject({
  temporaryPassword: z.string().min(1),
});

export type PasswordResetResponse = z.infer<typeof passwordResetResponseSchema>;

export const revokeSessionsResponseSchema = z.strictObject({
  revokedCount: z.number().int().nonnegative(),
});

export type RevokeSessionsResponse = z.infer<typeof revokeSessionsResponseSchema>;
