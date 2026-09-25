import { jobStatusResponseSchema } from '@clinic/contracts';
import type { PrismaService } from '../prisma/prisma.service';
import { JobStatusService } from './job-status.service';

describe('JobStatusService', () => {
  const now = new Date('2026-09-26T08:00:00Z');

  const service = (rows: { name: string; last_succeeded_at: Date | null }[]) =>
    new JobStatusService({
      $queryRaw: jest.fn().mockResolvedValue(rows),
    } as unknown as PrismaService);

  it('reports every job, in order, and warns about one that never ran', async () => {
    const result = jobStatusResponseSchema.parse(
      await service([
        { name: 'WEBSITE_REQUEST_PURGE', last_succeeded_at: new Date('2026-09-26T01:00:00Z') },
        { name: 'SESSION_PRUNE', last_succeeded_at: new Date('2026-09-26T01:00:00Z') },
        { name: 'MEDIA_ERASURE', last_succeeded_at: new Date('2026-09-26T01:00:00Z') },
        { name: 'TESTIMONIAL_ERASURE', last_succeeded_at: null },
      ]).status(now),
    );

    expect(result.jobs.map((job) => job.job)).toEqual([
      'WEBSITE_REQUEST_PURGE',
      'SESSION_PRUNE',
      'MEDIA_ERASURE',
      'TESTIMONIAL_ERASURE',
    ]);
    expect(result.jobs[0]).toEqual({
      job: 'WEBSITE_REQUEST_PURGE',
      state: 'OK',
      warning: false,
      lastSucceededAt: '2026-09-26T01:00:00.000Z',
      ageHours: 7,
    });
    expect(result.jobs[3]).toMatchObject({ state: 'NEVER_RUN', warning: true, ageHours: null });
    expect(result.warning).toBe(true);
  });

  it('turns STALE only after 48 hours without a success', async () => {
    const at = (hoursAgo: number) => [
      { name: 'SESSION_PRUNE', last_succeeded_at: new Date(now.getTime() - hoursAgo * 3_600_000) },
    ];

    const fresh = await service(at(48)).status(now);
    const stale = await service(at(48.001)).status(now);

    expect(fresh.jobs.find((job) => job.job === 'SESSION_PRUNE')?.state).toBe('OK');
    expect(stale.jobs.find((job) => job.job === 'SESSION_PRUNE')?.state).toBe('STALE');
  });
});
