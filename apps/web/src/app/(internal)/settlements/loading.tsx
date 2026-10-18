import { PageShell } from '@/components/ui';
export default function Loading() {
  return (
    <PageShell>
      <div
        role="status"
        className="animate-pulse rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600"
      >
        در حال بارگیری اطلاعات تسویه…
      </div>
    </PageShell>
  );
}
