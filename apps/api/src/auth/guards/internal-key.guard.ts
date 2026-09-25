import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { API_ENV } from '../../config/config.module';
import type { ApiEnv } from '../../config/env';
import { AppError } from '../../common/app-error';
import { constantTimeEquals } from '../../common/constant-time';
import { getRequestContext } from '../../common/request-context';
import { logSecurityRejection } from '../../common/security-log';
import { readEndpointAccess } from '../decorators/endpoint-access';

/**
 * First guard in the chain: proves the request came from the Next.js server.
 *
 * This is the second layer, not the only one — NestJS is expected to be
 * unreachable from the internet, with only the web tier able to open a
 * connection. The key catches a misconfigured network, not a determined
 * attacker who is already inside it.
 *
 * It also implements deny-by-default: a route with no access classification is
 * rejected here, so forgetting a decorator closes a route rather than opening
 * one.
 */
@Injectable()
export class InternalKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const access = readEndpointAccess(this.reflector, context);

    if (access === undefined) {
      // Deny-by-default. A coverage test also fails for this, so it should be
      // impossible to reach in a built application.
      throw new AppError(
        'AUTH_FORBIDDEN',
        undefined,
        'Route has no endpoint access metadata and is denied by default',
      );
    }

    // `/health` liveness only: a container orchestrator must be able to probe it
    // without holding a secret.
    if (access.kind === 'public') return true;

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-internal-key'];

    if (typeof provided !== 'string' || !constantTimeEquals(provided, this.env.INTERNAL_API_KEY)) {
      logSecurityRejection({
        event: 'auth.internal_key.rejected',
        reason: 'INTERNAL_KEY_INVALID',
        requestId: getRequestContext(request).requestId,
      });

      throw new AppError('AUTH_INTERNAL_KEY_INVALID');
    }

    return true;
  }
}
