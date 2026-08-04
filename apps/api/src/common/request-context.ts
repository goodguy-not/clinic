import type { Request } from 'express';
import type { Permission, UserRole } from '@clinic/contracts';

/**
 * Per-request state that NestJS resolves for itself.
 *
 * Nothing here is taken from a client-supplied identity header. `requestId` is
 * validated or regenerated; `session` is the result of hashing the opaque
 * session token and reading PostgreSQL. `x-user-id`, `x-user-role`,
 * `x-permissions` and `authorization` are never read anywhere in this
 * application.
 */

export type ResolvedSession = {
  sessionId: string;
  userId: string;
  username: string;
  displayName: string;
  role: UserRole;
  mustChangePassword: boolean;
  permissions: readonly Permission[];
};

export type RequestContext = {
  requestId: string;
  /** As reported by the web tier, and only as trustworthy as its proxy configuration. */
  clientIp: string | null;
  userAgent: string | null;
  session: ResolvedSession | null;
};

const CONTEXT_KEY = '__clinicRequestContext';

type WithContext = Request & { [CONTEXT_KEY]?: RequestContext };

export function setRequestContext(request: Request, context: RequestContext): void {
  (request as WithContext)[CONTEXT_KEY] = context;
}

export function getRequestContext(request: Request): RequestContext {
  const context = (request as WithContext)[CONTEXT_KEY];

  if (context === undefined) {
    // The request-id middleware runs before every guard, so an absent context
    // means the middleware was not wired — a startup bug, not a request error.
    throw new Error('Request context is missing; RequestIdMiddleware is not applied to this route');
  }

  return context;
}

export function attachSession(request: Request, session: ResolvedSession): void {
  getRequestContext(request).session = session;
}
