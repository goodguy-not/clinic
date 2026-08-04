import { PERMISSIONS, type Permission, type UserRole } from '@clinic/contracts';

/**
 * The authoritative role to permission map.
 *
 * This lives in `apps/api` and nowhere else. The permission *names* are shared
 * through `@clinic/contracts` so Next can decide what to render, but Next never
 * derives permissions from a role: it reads the resolved list NestJS returns,
 * and NestJS re-resolves that list from the database on every request. A role
 * or status change therefore takes effect on the very next request with no
 * cached claim to go stale.
 *
 * `Record<UserRole, ...>` makes the map exhaustive: adding a role to the
 * contract without deciding its permissions is a compile error, which is the
 * point of keeping roles a code enum rather than data.
 *
 * A receptionist holds no permission in Milestone 1. Their access is the
 * self-service endpoints, which require authentication but no permission — not
 * an oversight, and a test asserts it stays empty.
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  MANAGER: PERMISSIONS,
  RECEPTIONIST: [],
};

export function permissionsForRole(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
