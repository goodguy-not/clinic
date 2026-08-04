import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../../common/app-error';
import { getRequestContext } from '../../common/request-context';
import { readEndpointAccess } from '../decorators/endpoint-access';

/**
 * Third guard: checks named permissions against the list NestJS resolved from
 * the database for this request.
 *
 * The permissions compared here were derived from the role read moments ago by
 * `SessionGuard`, never from anything the caller sent. Later milestones add
 * permission constants to the shared contract; this guard does not change when
 * they do.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const access = readEndpointAccess(this.reflector, context);

    if (access === undefined || access.kind !== 'permissions') return true;

    const request = context.switchToHttp().getRequest<Request>();
    const session = getRequestContext(request).session;

    if (session === null) {
      // Unreachable while SessionGuard runs first; kept because a guard must
      // not assume the order of the guard before it.
      throw new AppError('AUTH_SESSION_INVALID');
    }

    const missing = access.permissions.filter(
      (permission) => !session.permissions.includes(permission),
    );

    if (missing.length > 0) {
      // The response names no permission: a caller learns that they may not do
      // this, not what the permission model looks like.
      throw new AppError('AUTH_FORBIDDEN');
    }

    return true;
  }
}
