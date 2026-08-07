import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The registration-draft token, read from `x-draft-token` and nowhere else.
 *
 * A header, deliberately — not a path segment and not a query parameter. The
 * token is bearer-secret material: anyone holding one can read the family
 * details somebody typed and complete their registration. A URL reaches the
 * address bar, browser history, the `Referer` header and every access log
 * between the clinic and the server, so a token in one is a credential written
 * to half a dozen places nobody audits.
 *
 * This mirrors how the session token already travels in `x-session-id`.
 *
 * An absent or blank header yields the empty string rather than throwing here.
 * The service turns it into `DRAFT_NOT_FOUND`, which is the same answer it gives
 * for expired, consumed, wrong-user, wrong-session and wrong-purpose — the
 * distinctions are exactly what a holder of a stale token must not learn.
 *
 * Declared here rather than beside `CurrentSession` in `auth/decorators`: that
 * module is Milestone 1 authentication plumbing, and this header belongs to one
 * flow in one module.
 */
export const DraftToken = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const header = context.switchToHttp().getRequest<Request>().headers['x-draft-token'];

    // Express gives an array when a header appears twice. A duplicated bearer
    // token is not something to guess about, so neither value is used.
    if (typeof header !== 'string') return '';

    return header.trim();
  },
);
