import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { ReadinessService } from './readiness.service';

describe('HealthController', () => {
  const queryRaw = jest.fn();

  async function createController(): Promise<HealthController> {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
        { provide: ReadinessService, useValue: { check: jest.fn() } },
      ],
    }).compile();

    return moduleRef.get(HealthController);
  }

  it('reports liveness without touching the database', async () => {
    const controller = await createController();

    const result = controller.liveness();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('api');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('reports the database as reachable when the probe query succeeds', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const controller = await createController();

    const result = await controller.database();

    expect(result).toMatchObject({ status: 'ok', database: 'reachable' });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('fails with 503 and leaks no connection details when the database is unreachable', async () => {
    queryRaw.mockRejectedValue(
      new Error('connect ECONNREFUSED postgresql://clinic:sup3rs3cret@localhost:5433/clinic_dev'),
    );
    const logged: string[] = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    const controller = await createController();

    const error = await controller.database().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toContain(
      'sup3rs3cret',
    );
    // Neither the credential nor anything else the driver said reaches the
    // server log: it names the kind of failure only (Milestone 10, A3).
    expect(logged.join('\n')).not.toContain('sup3rs3cret');
    expect(logged.join('\n')).not.toContain('ECONNREFUSED');
    expect(logged.join('\n')).toContain('Database health check failed: Error');
  });
});
