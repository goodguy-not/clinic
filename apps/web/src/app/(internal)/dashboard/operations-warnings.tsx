import type { BackupStatusResponse, JobStatusResponse, ScheduledJobName } from '@clinic/contracts';
import { Alert } from '@/components/ui';
import { formatContentDate } from '@/app/(internal)/content/presentation';
import { toPersianDigits } from '@/server/numerals-fa';

const JOB_MESSAGES: Record<ScheduledJobName, string> = {
  WEBSITE_REQUEST_PURGE: 'پیام‌های سایت طبق برنامه پاک نشده‌اند.',
  SESSION_PRUNE: 'سوابق ورود قدیمی طبق برنامه پاک نشده‌اند.',
  MEDIA_ERASURE: 'عکس‌های بدون استفاده و بایگانی‌شده طبق برنامه پاک نشده‌اند.',
  TESTIMONIAL_ERASURE: 'نقل‌قول‌هایی که رضایتشان پس گرفته شده طبق برنامه پاک نشده‌اند.',
};

export function OperationsWarnings({
  backup,
  jobs,
}: {
  backup: BackupStatusResponse | null;
  jobs: JobStatusResponse | null;
}) {
  const backupWarning =
    backup === null
      ? 'وضعیت نسخهٔ پشتیبان روشن نیست. با مسئول فنی تماس بگیرید.'
      : !backup.warning
        ? null
        : backup.state === 'STALE' && backup.offsiteCopy !== null
          ? `تازه‌ترین نسخهٔ پشتیبان بیرون از سرور برای ${toPersianDigits(String(Math.floor(backup.offsiteCopy.ageHours / 24)))} روز پیش (${formatContentDate(backup.offsiteCopy.takenAt)}) است. مطمئن شوید رایانهٔ کلینیک روشن و به اینترنت وصل است؛ اگر هست، با مسئول فنی تماس بگیرید.`
          : backup.state === 'NEVER_COLLECTED'
            ? 'هنوز هیچ نسخهٔ پشتیبانی بیرون از سرور دریافت نشده است. رایانهٔ کلینیک را بررسی کنید و با مسئول فنی تماس بگیرید.'
            : backup.state === 'NOT_CONFIGURED'
              ? 'دریافت نسخهٔ پشتیبان بیرون از سرور راه‌اندازی نشده است. با مسئول فنی تماس بگیرید.'
              : 'وضعیت نسخهٔ پشتیبان روشن نیست. با مسئول فنی تماس بگیرید.';
  const jobWarnings =
    jobs === null
      ? ['وضعیت کارهای شبانه روشن نیست. با مسئول فنی تماس بگیرید.']
      : jobs.warning
        ? jobs.jobs
            .filter((job) => job.warning)
            .map((job) => `${JOB_MESSAGES[job.job]} با مسئول فنی تماس بگیرید.`)
        : [];

  if (backupWarning === null && jobWarnings.length === 0) return null;

  return (
    <section aria-label="هشدارهای نگهداری سامانه" className="space-y-2">
      {backupWarning !== null ? <Alert>{backupWarning}</Alert> : null}
      {jobWarnings.map((warning) => (
        <Alert key={warning}>{warning}</Alert>
      ))}
    </section>
  );
}
