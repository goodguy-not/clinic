'use client';

import type { ReactNode } from 'react';
import { FOCUS_RING } from '@/components/ui';

export function ConfirmedSubmitButton({
  children,
  confirmation,
}: {
  children: ReactNode;
  confirmation: string;
}) {
  return (
    <button
      type="submit"
      onClick={(event) => {
        if (!window.confirm(confirmation)) event.preventDefault();
      }}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 transition-colors hover:bg-red-50 ${FOCUS_RING}`}
    >
      {children}
    </button>
  );
}
