import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { redactSecrets } from '../common/redact';

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

  constructor(private readonly prisma: PrismaService) {}

  /** Liveness. Deliberately does not touch the database. */
  @Get()
  liveness(): LivenessResponse {
    return {
      status: 'ok',
      service: 'api',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness of the system of record. */
  @Get('db')
  async database(): Promise<DatabaseHealthResponse> {
    const startedAt = performance.now();

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      // Logged server-side only, with credentials masked: driver errors often
      // embed the connection URL. The response carries no connection details,
      // so an unreachable database leaks nothing to a caller or to the log.
      this.logger.error(
        'Database health check failed',
        error instanceof Error ? redactSecrets(error.stack ?? error.message) : '',
      );
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
