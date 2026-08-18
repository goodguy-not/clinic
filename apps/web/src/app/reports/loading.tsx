import { PageShell } from '@/components/ui';

export default function ReportsLoading() {
  return (
    <PageShell wide>
      <div role="status" aria-live="polite" className="flex flex-col gap-4">
        <span className="sr-only">گزارش در حال بارگیری است</span>
        <div className="h-16 animate-pulse rounded-xl bg-slate-200" />
        <div className="h-48 animate-pulse rounded-xl bg-slate-100" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
      </div>
    </PageShell>
  );
}
