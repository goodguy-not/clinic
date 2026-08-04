import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../../common/app-error';
import { attachSession, getRequestContext } from '../../common/request-context';
import { logSecurityRejection } from '../../common/security-log';
import { readAllowPasswordChangePending, readEndpointAccess } from '../decorators/endpoint-access';
import { SessionService } from '../session.service';

/**
 * Second guard: establishes who is making the request.
 *
 * Identity comes from exactly one place — the opaque token in `x-session-id`,
 * hashed and looked up in PostgreSQL. `x-user-id`, `x-user-role`,
 * `x-permissions` and `authorization` are never read anywhere in this
 * application, so a compromised or buggy web tier cannot assert an identity it
 * was not given.
 *
 * Because the lookup runs on every request, a role change, a status change or a
 * revocation takes effect on the very next request. There is no cached claim to
 * invalidate.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const access = readEndpointAccess(this.reflector, context);

    // `public` and `internal` routes carry no session: liveness, database
    // readiness, and login itself, which is where a session begins.
    if (access === undefined || access.kind === 'public' || access.kind === 'internal') {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const requestContext = getRequestContext(request);
    const presented = request.headers['x-session-id'];

    if (typeof presented !== 'string' || presented === '') {
      throw new AppError('AUTH_SESSION_INVALID');
    }

    const session = await this.sessions.resolve(presented);

    if (session === null) {
      // Logged, never audited. An attacker can present forged cookies without
      // limit; `audit_log` is append-only and unprunable, so it must not be
      // writable by an unauthenticated request that changes no account state.
      logSecurityRejection({
        event: 'auth.session.rejected',
        reason: 'SESSION_INVALID',
        requestId: requestContext.requestId,
        clientIp: requestContext.clientIp,
      });

      throw new AppError('AUTH_SESSION_INVALID');
    }

    attachSession(request, session);

    // Forced password change is enforced here, by NestJS, on every route except
    // the few needed to complete the change. The web tier's redirect is a
    // convenience on top of this rule, not the rule itself.
    if (session.mustChangePassword && !readAllowPasswordChangePending(this.reflector, context)) {
      throw new AppError('AUTH_PASSWORD_CHANGE_REQUIRED');
    }

    return true;
  }
}
