'use client';

import { useState } from 'react';
import { TimeInput } from '@/components/time-input';
import { CONTROL_CLASS } from '@/components/styles';
import { COPY } from '@/shared/copy-fa';

export function ClosureScopeFields() {
  const [partial, setPartial] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-wrap gap-4 text-sm font-semibold text-slate-900">
        <legend className="mb-2">مدت بسته بودن</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="closureScope"
            value="whole"
            checked={!partial}
            onChange={() => setPartial(false)}
          />
          کل روز
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="closureScope"
            value="partial"
            checked={partial}
            onChange={() => setPartial(true)}
          />
          بخشی از روز
        </label>
      </fieldset>
      {partial ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-900">
            {COPY.availabilityStartTime}
            <TimeInput name="startTime" required className={CONTROL_CLASS} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-900">
            {COPY.availabilityEndTime}
            <TimeInput name="endTime" required className={CONTROL_CLASS} />
          </label>
        </div>
      ) : null}
    </div>
  );
}
