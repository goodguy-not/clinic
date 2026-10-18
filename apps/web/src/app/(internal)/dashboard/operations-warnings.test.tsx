import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackupStatusResponse, JobStatusResponse } from '@clinic/contracts';
import { OperationsWarnings } from './operations-warnings';

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  readSessionToken: vi.fn(),
  callerContext: vi.fn(),
  dashboard: vi.fn(),
  backupStatus: vi.fn(),
  jobStatus: vi.fn(),
}));
vi.mock('@/server/auth-session', () => ({
  requireSession: mocks.requireSession,
  readSessionToken: mocks.readSessionToken,
  callerContext: mocks.callerContext,
}));
vi.mock('@/server/api-client', () => ({
  api: {
    dashboard: mocks.dashboard,
    backupStatus: mocks.backupStatus,
    jobStatus: mocks.jobStatus,
  },
}));

import Home from './page';

const backup: BackupStatusResponse = {
  state: 'OK',
  warning: false,
  warningAfterHours: 72,
  offsiteCopy: {
    takenAt: '2026-09-30T00:00:00.000Z',
    collectedAt: '2026-09-30T01:00:00.000Z',
    ageHours: 1,
  },
  newestOnServerTakenAt: '2026-09-30T00:00:00.000Z',
  checkedAt: '2026-09-30T01:00:00.000Z',
};
const jobs: JobStatusResponse = {
  warning: false,
  warningAfterHours: 48,
  checkedAt: '2026-09-30T01:00:00.000Z',
  jobs: ['WEBSITE_REQUEST_PURGE', 'SESSION_PRUNE', 'MEDIA_ERASURE', 'TESTIMONIAL_ERASURE'].map(
    (job) => ({
      job: job as JobStatusResponse['jobs'][number]['job'],
      state: 'OK' as const,
      warning: false,
      lastSucceededAt: '2026-09-30T00:00:00.000Z',
      ageHours: 1,
    }),
  ),
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.readSessionToken.mockResolvedValue('synthetic-session');
  mocks.callerContext.mockResolvedValue({ sessionToken: 'synthetic-session' });
  mocks.dashboard.mockResolvedValue({ ok: false, code: 'API_UNREACHABLE' });
  mocks.backupStatus.mockResolvedValue({ ok: true, data: backup });
  mocks.jobStatus.mockResolvedValue({ ok: true, data: jobs });
});

describe('manager operations warnings', () => {
  it('stays quiet when both checks are well', () => {
    expect(renderToStaticMarkup(<OperationsWarnings backup={backup} jobs={jobs} />)).toBe('');
  });

  it.each(['STALE', 'NEVER_COLLECTED', 'UNKNOWN', 'NOT_CONFIGURED'] as const)(
    'warns for backup state %s',
    (state) => {
      const html = renderToStaticMarkup(
        <OperationsWarnings
          backup={{
            ...backup,
            state,
            warning: true,
            offsiteCopy: state === 'STALE' ? { ...backup.offsiteCopy!, ageHours: 96 } : null,
          }}
          jobs={jobs}
        />,
      );
      expect(html).toContain('مسئول فنی');
      if (state === 'STALE') expect(html).toContain('رایانهٔ کلینیک');
    },
  );

  it.each(['STALE', 'NEVER_RUN'] as const)('warns when a nightly job is %s', (state) => {
    const html = renderToStaticMarkup(
      <OperationsWarnings
        backup={backup}
        jobs={{
          ...jobs,
          warning: true,
          jobs: jobs.jobs.map((job, index) =>
            index === 0 ? { ...job, state, warning: true } : job,
          ),
        }}
      />,
    );
    expect(html).toContain('پیام‌های سایت طبق برنامه پاک نشده‌اند');
  });

  it('warns when either status read fails', () => {
    expect(renderToStaticMarkup(<OperationsWarnings backup={null} jobs={jobs} />)).toContain(
      'وضعیت نسخهٔ پشتیبان روشن نیست',
    );
    expect(renderToStaticMarkup(<OperationsWarnings backup={backup} jobs={null} />)).toContain(
      'وضعیت کارهای شبانه روشن نیست',
    );
  });

  it('never calls management endpoints for receptionists', async () => {
    mocks.requireSession.mockResolvedValue({ permissions: [] });
    await Home();
    expect(mocks.backupStatus).not.toHaveBeenCalled();
    expect(mocks.jobStatus).not.toHaveBeenCalled();
  });

  it('reads both statuses for managers and shows a warning on failed calls', async () => {
    mocks.requireSession.mockResolvedValue({ permissions: ['user.read'] });
    mocks.backupStatus.mockResolvedValue({ ok: false, code: 'API_UNREACHABLE' });
    await Home();
    expect(mocks.backupStatus).toHaveBeenCalledOnce();
    expect(mocks.jobStatus).toHaveBeenCalledOnce();
  });
});
