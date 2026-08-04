import type { INestApplication } from '@nestjs/common';
import { RequestIdMiddleware } from './common/request-id.middleware';

/**
 * Wiring that both the running server and the integration tests need.
 *
 * The request-id middleware is applied with `app.use` rather than through
 * `MiddlewareConsumer.forRoutes`, deliberately. Express 5 (NestJS 11) changed
 * wildcard path syntax, and a middleware that silently stops matching some
 * routes would leave requests with no context and no correlation id — a failure
 * that is easy to miss and expensive to debug. `app.use` matches everything by
 * construction, with no path pattern to get wrong.
 *
 * Keeping it here rather than in `main.ts` means the test application is
 * configured identically to the real one.
 */
export function configureApp(app: INestApplication): void {
  const requestId = new RequestIdMiddleware();

  app.use(requestId.use.bind(requestId));
}
