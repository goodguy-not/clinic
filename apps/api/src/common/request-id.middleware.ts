import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { setRequestContext } from './request-context';

/**
 * Establishes the request id and the per-request context.
 *
 * The id is accepted from `x-request-id` only when it is a well-formed UUID.
 * Anything else — missing, malformed, or an attempt to inject a value with
 * structure — is replaced by a locally generated one, so the id can be written
 * to a `uuid` audit column without further validation and cannot be used to
 * smuggle content into logs.
 *
 * The same value is echoed back in the response header, embedded in every error
 * envelope, and written to every audit row, so one identifier correlates the
 * browser response, the server log line and the database record.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_USER_AGENT_LENGTH = 256;

function singleHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const supplied = singleHeader(request.headers['x-request-id']);
    const requestId =
      supplied !== null && UUID.test(supplied) ? supplied.toLowerCase() : randomUUID();

    const userAgent = singleHeader(request.headers['x-client-user-agent']);

    setRequestContext(request, {
      requestId,
      clientIp: singleHeader(request.headers['x-client-ip']),
      userAgent: userAgent === null ? null : userAgent.slice(0, MAX_USER_AGENT_LENGTH),
      session: null,
    });

    response.setHeader('x-request-id', requestId);
    next();
  }
}
