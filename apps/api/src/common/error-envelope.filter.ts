import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ErrorEnvelope } from '@clinic/contracts';
import { AppError, ERROR_STATUS } from './app-error';
import { getRequestContext } from './request-context';
import { redactError } from './redact';

/**
 * Turns every thrown value into the one contract error envelope.
 *
 * Three properties matter here:
 *
 *   - the envelope always carries a request id, so a user can quote it and an
 *     operator can join it to the audit row and the log line;
 *   - an unrecognised throw becomes a generic INTERNAL_ERROR with no detail,
 *     because a stack trace or driver message in a response body is a leak;
 *   - everything logged goes through `redactSecrets` first.
 */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    // A throw from before the middleware ran still needs an envelope.
    let requestId: string;
    try {
      requestId = getRequestContext(request).requestId;
    } catch {
      requestId = '00000000-0000-4000-8000-000000000000';
    }

    const { status, envelope } = this.toEnvelope(exception, requestId);

    if (status >= 500) {
      const { message, stack } = redactError(exception);
      this.logger.error(`[${requestId}] ${message}`, stack);
    }

    // Set here as well as in `NoStoreInterceptor`, because guards run *before*
    // interceptors: a 401 or 403 from the guard chain never reaches the
    // interceptor, so without this a rejection would be the one response on the
    // whole surface that a proxy could cache.
    //
    // `details` is deliberately never logged. A duplicate rejection carries a
    // registration-draft token in its details, and that token is bearer-secret
    // material: it crosses to the web tier once and appears in no log line.
    // Only `message` and `stack` are logged, and only above 500.
    response.status(status).setHeader('cache-control', 'no-store');
    response.setHeader('referrer-policy', 'no-referrer');
    response.json(envelope);
  }

  private toEnvelope(
    exception: unknown,
    requestId: string,
  ): { status: number; envelope: ErrorEnvelope } {
    if (exception instanceof AppError) {
      return {
        status: ERROR_STATUS[exception.code],
        envelope: {
          error: {
            code: exception.code,
            message: exception.message,
            ...(exception.details === undefined ? {} : { details: exception.details }),
            requestId,
          },
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // A framework-level 404 or 405 is genuinely useful to distinguish; the
      // body is still one of our stable codes, never Nest's default shape.
      return {
        status,
        envelope: {
          error: {
            code: status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED',
            message: status >= 500 ? 'Internal error' : exception.message,
            requestId,
          },
        },
      };
    }

    return {
      status: 500,
      envelope: {
        error: { code: 'INTERNAL_ERROR', message: 'Internal error', requestId },
      },
    };
  }
}
