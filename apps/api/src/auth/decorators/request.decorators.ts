import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../../common/app-error';
import {
  getRequestContext,
  type RequestContext,
  type ResolvedSession,
} from '../../common/request-context';

/**
 * The per-request context NestJS established for itself: request id, and the
 * client address and user agent as reported by the web tier.
 */
export const Ctx = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestContext =>
    getRequestContext(context.switchToHttp().getRequest<Request>()),
);

/**
 * The session resolved from the opaque token by `SessionGuard`.
 *
 * A handler receiving this has an identity that came from a database lookup, not
 * from a header. Using it on a route that is not `authenticated` or
 * `permissions` throws rather than returning a partially-populated object.
 */
export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ResolvedSession => {
    const session = getRequestContext(context.switchToHttp().getRequest<Request>()).session;

    if (session === null) {
      throw new AppError(
        'AUTH_SESSION_INVALID',
        undefined,
        'CurrentSession used on a route that carries no session',
      );
    }

    return session;
  },
);
