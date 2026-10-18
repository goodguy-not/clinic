'use client';

import { useActionState } from 'react';
import { searchFamiliesAction } from '@/app/(internal)/families/search-action';
import { FOCUS_RING } from '@/components/ui';

type FilterValue = string | number | boolean | undefined;

export function FamilyReportFilter({
  basePath,
  query,
  selectedFamilyId,
}: {
  basePath: string;
  query: Record<string, FilterValue>;
  selectedFamilyId?: string;
}) {
  const [state, action] = useActionState(searchFamiliesAction, {
    q: '',
    includeInactive: false,
    families: [],
    truncated: false,
    searched: false,
    errorMessage: null,
  });

  const href = (familyId?: string) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && key !== 'familyId' && key !== 'page')
        search.set(key, String(value));
    }
    if (familyId !== undefined) search.set('familyId', familyId);
    return `${basePath}?${search.toString()}`;
  };

  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className={`cursor-pointer text-sm font-bold text-slate-900 ${FOCUS_RING}`}>
        {selectedFamilyId === undefined ? 'محدودکردن به یک خانواده' : 'فیلتر خانواده فعال است'}
      </summary>
      <form action={action} className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-slate-800">
          جست‌وجوی امن خانواده
          <input
            name="q"
            type="search"
            minLength={2}
            maxLength={60}
            defaultValue={state.q}
            className={`min-h-11 rounded-lg border border-slate-300 px-3 text-base ${FOCUS_RING}`}
          />
        </label>
        <p className="text-xs text-slate-600">
          نام یا شماره فقط در همین درخواست جست‌وجو می‌شود و وارد نشانی گزارش نمی‌شود.
        </p>
        <button
          type="submit"
          className={`min-h-11 self-start rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 ${FOCUS_RING}`}
        >
          یافتن خانواده
        </button>
      </form>
      {state.errorMessage !== null ? (
        <p role="alert" className="mt-3 text-sm text-red-800">
          {state.errorMessage}
        </p>
      ) : null}
      {state.families.length > 0 ? (
        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
          {state.families.map((family) => (
            <li key={family.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm font-semibold text-slate-900">{family.familyName}</span>
              <a
                href={href(family.id)}
                className={`rounded-md px-3 py-2 text-sm font-semibold text-brand-800 hover:bg-brand-50 ${FOCUS_RING}`}
              >
                انتخاب برای گزارش
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {selectedFamilyId !== undefined ? (
        <a
          href={href()}
          className={`mt-3 inline-flex rounded-md px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 ${FOCUS_RING}`}
        >
          حذف فیلتر خانواده
        </a>
      ) : null}
    </details>
  );
}
