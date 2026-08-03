import { z } from 'zod';
import { permissionSchema } from './permissions';
import { userRoleSchema } from './roles';
import { usernameSchema } from './users';

/**
 * A password in transit. Deliberately only "not empty".
 *
 * Password policy — minimum and maximum code points, NFC normalisation,
 * ill-formed input rejection, byte limits, blocklists — lives in `apps/api`
 * and is enforced there. Restating any of it here would duplicate a security
 * rule into a package the browser tier consumes, and the two copies would
 * eventually disagree. A rejected password comes back as
 * `PASSWORD_POLICY_VIOLATION`.
 *
 * Note that the server limit is expressed in bytes, not characters, so it is
 * not even the same kind of rule as anything that could be written here.
 */
export const passwordSchema = z.string().min(1);

export const loginRequestSchema = z.strictObject({
  username: usernameSchema,
  password: passwordSchema,
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * The signed-in user, as returned for display.
 *
 * `permissions` is resolved by NestJS from its own role map and is included so
 * Next can decide what to render. It is display data: NestJS re-resolves
 * permissions from the database on every request and never trusts a permission
 * claim travelling in the other direction.
 *
 * `status` is absent by design — a non-ACTIVE user cannot hold a session, so
 * the field would be a constant.
 */
export const authenticatedUserSchema = z.strictObject({
  id: z.uuid(),
  username: usernameSchema,
  displayName: z.string(),
  role: userRoleSchema,
  mustChangePassword: z.boolean(),
  permissions: z.array(permissionSchema),
});

export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;

/**
 * `cookieMaxAgeSeconds` is computed by PostgreSQL from
 * `absolute_expires_at - clock_timestamp()`, minus a small safety margin. Next
 * uses it verbatim as the cookie's Max-Age and never derives a duration from
 * its own clock, so the web tier does not become a second security clock.
 *
 * It is advisory, not authoritative: transport latency can leave the cookie
 * stored slightly past the database expiry, and such a cookie is unusable
 * because every request is revalidated against `absolute_expires_at`.
 */
export const sessionIssueSchema = z.strictObject({
  cookieMaxAgeSeconds: z.number().int().positive(),
});

export type SessionIssue = z.infer<typeof sessionIssueSchema>;

/**
 * The raw session token crosses the private Next-to-Nest boundary exactly once,
 * here. PostgreSQL stores only its SHA-256 hash.
 */
export const loginResponseSchema = z.strictObject({
  sessionToken: z.string().min(1),
  session: sessionIssueSchema,
  user: authenticatedUserSchema,
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const sessionResponseSchema = z.strictObject({
  user: authenticatedUserSchema,
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const changePasswordRequestSchema = z.strictObject({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
});

export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/**
 * Changing a password rotates the session, so the response carries a new token
 * and a new cookie lifetime exactly as login does.
 */
export const changePasswordResponseSchema = loginResponseSchema;

export type ChangePasswordResponse = z.infer<typeof changePasswordResponseSchema>;
