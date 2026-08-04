import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { readEndpointAccess } from '../auth/decorators/endpoint-access';

/**
 * `Cache-Control: no-store` on every response except public liveness.
 *
 * Nothing between Next and NestJS caches today, but a reverse proxy added later
 * would, and the sharpest case is a response body carrying a one-time
 * temporary password. Defaulting to no-store and exempting one route is the
 * safe direction for that mistake.
 *
 * The exemption is driven by access metadata rather than a path match: `public`
 * is by rule only `/health`, which returns process uptime and nothing else.
 */
@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const access = readEndpointAccess(this.reflector, context);

    if (access?.kind !== 'public') {
      const response = context.switchToHttp().getResponse<Response>();
      response.setHeader('cache-control', 'no-store');
      response.setHeader('referrer-policy', 'no-referrer');
    }

    return next.handle();
  }
}
