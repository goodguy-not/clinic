import { COPY } from '@/server/copy-fa';

export default function Loading() {
  return (
    <main
      className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{COPY.dashboardLoading}</span>
      <div className="animate-pulse space-y-5" aria-hidden="true">
        <div className="h-8 w-52 rounded-lg bg-slate-200" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-24 rounded-xl bg-slate-200" />
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="h-72 rounded-xl bg-slate-200" />
          <div className="h-72 rounded-xl bg-slate-200" />
        </div>
      </div>
    </main>
  );
}
