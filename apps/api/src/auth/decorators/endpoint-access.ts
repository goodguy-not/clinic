import { SetMetadata, type CustomDecorator, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Permission } from '@clinic/contracts';

/**
 * Explicit access classification for every route.
 *
 * Authorization is deny-by-default: a handler with no classification is
 * rejected by the first guard in the chain, and a coverage test fails for any
 * registered route that carries none. Forgetting to classify a route is
 * therefore a broken build, not an open door.
 *
 * Four kinds, because three cannot express the surface:
 *
 *   public         no internal key, no session. `/health` only — a container
 *                  orchestrator must be able to probe liveness.
 *   internal       internal key, no session. `/health/db` (it reveals database
 *                  state) and `POST /auth/login` (there is no session yet).
 *   authenticated  internal key + a valid session.
 *   permissions    internal key + a valid session + named permissions.
 *
 * `internal` is the addition the approved three did not cover: login must be
 * reachable without a session while still being unreachable from outside the
 * private network boundary.
 */
export type EndpointAccess =
  | { readonly kind: 'public' }
  | { readonly kind: 'internal' }
  | { readonly kind: 'authenticated' }
  | { readonly kind: 'permissions'; readonly permissions: readonly Permission[] };

export const ENDPOINT_ACCESS_KEY = 'clinic:endpoint-access';

/**
 * Marks a route reachable while the signed-in user still owes a password
 * change. Only the routes needed to complete that change carry it; every other
 * route returns `AUTH_PASSWORD_CHANGE_REQUIRED`, so the rule is enforced by
 * NestJS rather than by a redirect the browser could skip.
 */
export const ALLOW_PASSWORD_CHANGE_PENDING_KEY = 'clinic:allow-password-change-pending';

export const PublicEndpoint = (): CustomDecorator =>
  SetMetadata<string, EndpointAccess>(ENDPOINT_ACCESS_KEY, { kind: 'public' });

export const InternalOnly = (): CustomDecorator =>
  SetMetadata<string, EndpointAccess>(ENDPOINT_ACCESS_KEY, { kind: 'internal' });

export const AuthenticatedOnly = (): CustomDecorator =>
  SetMetadata<string, EndpointAccess>(ENDPOINT_ACCESS_KEY, { kind: 'authenticated' });

export const RequirePermissions = (...permissions: readonly Permission[]): CustomDecorator =>
  SetMetadata<string, EndpointAccess>(ENDPOINT_ACCESS_KEY, { kind: 'permissions', permissions });

export const AllowWhilePasswordChangePending = (): CustomDecorator =>
  SetMetadata<string, boolean>(ALLOW_PASSWORD_CHANGE_PENDING_KEY, true);

/** Handler metadata wins over controller metadata. Returns undefined when unclassified. */
export function readEndpointAccess(
  reflector: Reflector,
  context: ExecutionContext,
): EndpointAccess | undefined {
  return reflector.getAllAndOverride<EndpointAccess | undefined>(ENDPOINT_ACCESS_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);
}

export function readAllowPasswordChangePending(
  reflector: Reflector,
  context: ExecutionContext,
): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(ALLOW_PASSWORD_CHANGE_PENDING_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? false
  );
}
