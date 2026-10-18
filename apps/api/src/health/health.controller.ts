import { Controller, Get, Logger, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { describeError } from '../common/describe-error';
import { InternalOnly, PublicEndpoint } from '../auth/decorators/endpoint-access';
import { ReadinessService, type ReadinessResponse } from './readiness.service';

export type LivenessResponse = {
  status: 'ok';
  service: 'api';
  uptimeSeconds: number;
  timestamp: string;
};

export type DatabaseHealthResponse = {
  status: 'ok';
  database: 'reachable';
  latencyMs: number;
};

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly readiness: ReadinessService,
  ) {}

  /**
   * Liveness. One of the two routes exempt from the internal key (readiness is
   * the other), because a process supervisor must be able to probe it without
   * holding a secret, and the only route exempt from `no-store` — it reveals
   * nothing but process uptime.
   */
  @Get()
  @PublicEndpoint()
  liveness(): LivenessResponse {
    return {
      status: 'ok',
      service: 'api',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness: the database answers and the media directory takes a write.
   * Milestone 10, checkpoint A3.
   *
   * PUBLIC, LIKE LIVENESS, AND FOR THE SAME REASON — the deployment and restore
   * runbooks and an outside monitor must reach it without a credential. It
   * says `ok` or `unavailable` for each check and nothing else (see
   * `ReadinessService`), `503` when either is down, and it is `no-store`:
   * unlike uptime, a cached "ok" would be a lie. `GET /health/db` below stays
   * the internal, detailed read it was.
   */
  @Get('ready')
  @PublicEndpoint()
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessResponse> {
    const result = await this.readiness.check();

    response.setHeader('cache-control', 'no-store');
    response.status(result.status === 'ok' ? 200 : 503);
    return result;
  }

  /**
   * Readiness of the system of record. Requires the internal key: whether the
   * database is reachable is information about internal infrastructure, not
   * something to hand to anonymous callers.
   */
  @Get('db')
  @InternalOnly()
  async database(): Promise<DatabaseHealthResponse> {
    const startedAt = performance.now();

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      // Logged server-side only, with credentials masked: driver errors often
      // embed the connection URL. The response carries no connection details,
      // so an unreachable database leaks nothing to a caller or to the log.
      this.logger.error(`Database health check failed: ${describeError(error)}`);
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'unreachable',
      });
    }

    return {
      status: 'ok',
      database: 'reachable',
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}
