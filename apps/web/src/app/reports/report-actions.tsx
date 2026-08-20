'use client';

import { useState } from 'react';
import { FOCUS_RING } from '@/components/ui';

export type ExportReportKind =
  'sessions' | 'promises' | 'therapist-activity' | 'payments' | 'family-accounts' | 'settlement';

type ExportRequest = {
  kind: ExportReportKind;
  filters: Record<string, string | number | boolean | undefined>;
  csrfToken: string;
};

export function ReportActions({
  exportRequest,
  scopeLabel,
}: {
  exportRequest?: ExportRequest;
  scopeLabel?: string;
}) {
  const [state, setState] = useState<'idle' | 'downloading' | 'failed'>('idle');

  async function download() {
    if (exportRequest === undefined || state === 'downloading') return;
    setState('downloading');

    try {
      const response = await fetch('/api/reports/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          csrfToken: exportRequest.csrfToken,
          kind: exportRequest.kind,
          filters: JSON.stringify(exportRequest.filters),
        }),
      });
      if (!response.ok) throw new Error('download refused');

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = downloadName(response.headers.get('content-disposition'));
      link.click();
      URL.revokeObjectURL(objectUrl);
      setState('idle');
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="flex max-w-xl flex-col items-start gap-1.5 sm:items-end">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className={`min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 ${FOCUS_RING}`}
        >
          چاپ
        </button>
        {exportRequest !== undefined ? (
          <button
            type="button"
            onClick={download}
            disabled={state === 'downloading'}
            aria-describedby="report-export-status"
            className={`min-h-11 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:cursor-wait disabled:opacity-70 ${FOCUS_RING}`}
          >
            {state === 'downloading' ? 'در حال آماده‌سازی…' : 'دریافت CSV'}
          </button>
        ) : null}
      </div>
      {exportRequest !== undefined ? (
        <p
          id="report-export-status"
          aria-live="polite"
          className="text-xs leading-5 text-slate-600"
        >
          {state === 'failed'
            ? 'دریافت فایل انجام نشد. دوباره تلاش کنید.'
            : `همهٔ ردیف‌های همین محدوده${scopeLabel ? ` · ${scopeLabel}` : ''}`}
        </p>
      ) : null}
    </div>
  );
}

function downloadName(disposition: string | null): string {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded !== undefined) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall through to the privacy-safe generic name.
    }
  }
  const plain = disposition?.match(/filename="?([^";]+)"?/i)?.[1];
  return plain ?? 'clinic-report.csv';
}
