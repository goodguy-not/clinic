'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { AVAILABILITY_WINDOWS_MAX, type AvailabilityWindowInput } from '@clinic/contracts';
import { FOCUS_RING } from '@/components/styles';
import { TimeInput } from '@/components/time-input';
import { WEEKDAYS_FA, windowsOverlap } from '@/scheduling/availability-presentation';

type EditorWindow = AvailabilityWindowInput & { key: string };

const TIME_CLASS = `min-h-11 min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-2 text-base tabular-nums text-slate-900 ${FOCUS_RING}`;
const SMALL_BUTTON = `inline-flex min-h-11 items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold transition-[background-color,border-color,transform] active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none ${FOCUS_RING}`;

export function WeeklyAvailabilityEditor({
  therapistId,
  windows,
  csrfToken,
  labels,
}: {
  therapistId: string;
  windows: AvailabilityWindowInput[];
  csrfToken: string;
  labels: {
    overlap: string;
    addWindow: string;
    dayOff: string;
    startTime: string;
    endTime: string;
    removeWindow: string;
    limit: string;
    save: string;
  };
}) {
  const [editorWindows, setEditorWindows] = useState<EditorWindow[]>(() =>
    windows.map((window, index) => ({ ...window, key: `saved-${index}` })),
  );
  const [submittedInvalid, setSubmittedInvalid] = useState(false);

  const hasOverlap = useMemo(
    () =>
      editorWindows.some((window, index) =>
        editorWindows.slice(index + 1).some((other) => windowsOverlap(window, other)),
      ),
    [editorWindows],
  );

  function addWindow(weekday: number) {
    if (editorWindows.length >= AVAILABILITY_WINDOWS_MAX) return;

    setEditorWindows((current) => [
      ...current,
      {
        key: `new-${Date.now()}-${weekday}`,
        weekday: weekday as AvailabilityWindowInput['weekday'],
        startTime: '09:00',
        endTime: '13:00',
      },
    ]);
  }

  function updateWindow(key: string, field: 'startTime' | 'endTime', value: string) {
    setEditorWindows((current) =>
      current.map((window) => (window.key === key ? { ...window, [field]: value } : window)),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    if (hasOverlap) {
      event.preventDefault();
      setSubmittedInvalid(true);
    }
  }

  return (
    <form
      method="post"
      action={`/api/availability/${therapistId}/windows`}
      onSubmit={submit}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="csrfToken" value={csrfToken} />

      {(hasOverlap || submittedInvalid) && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-900"
        >
          {labels.overlap}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {WEEKDAYS_FA.map((day, weekday) => {
          const dayWindows = editorWindows.filter((window) => window.weekday === weekday);

          return (
            <section
              key={day}
              aria-labelledby={`weekday-${weekday}`}
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 id={`weekday-${weekday}`} className="font-bold text-slate-950">
                  {day}
                </h3>
                <button
                  type="button"
                  onClick={() => addWindow(weekday)}
                  disabled={editorWindows.length >= AVAILABILITY_WINDOWS_MAX}
                  className={`${SMALL_BUTTON} border-brand-300 bg-white text-brand-900 hover:bg-brand-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400`}
                >
                  <span aria-hidden="true">+</span>
                  {labels.addWindow}
                </button>
              </div>

              {dayWindows.length === 0 ? (
                <p className="py-2 text-sm text-slate-500">{labels.dayOff}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {dayWindows.map((window, index) => {
                    const startId = `${window.key}-start`;
                    const endId = `${window.key}-end`;

                    return (
                      <div
                        key={window.key}
                        className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 rounded-lg border border-slate-200 bg-white p-2"
                      >
                        <input type="hidden" name="weekday" value={weekday} />
                        <label
                          htmlFor={startId}
                          className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-600"
                        >
                          {labels.startTime}
                          <TimeInput
                            id={startId}
                            name="startTime"
                            required
                            value={window.startTime}
                            onChange={(value) => updateWindow(window.key, 'startTime', value)}
                            className={TIME_CLASS}
                          />
                        </label>
                        <label
                          htmlFor={endId}
                          className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-600"
                        >
                          {labels.endTime}
                          <TimeInput
                            id={endId}
                            name="endTime"
                            required
                            value={window.endTime}
                            onChange={(value) => updateWindow(window.key, 'endTime', value)}
                            className={TIME_CLASS}
                          />
                        </label>
                        <button
                          type="button"
                          aria-label={`${labels.removeWindow} ${day}، بازهٔ ${index + 1}`}
                          title={labels.removeWindow}
                          onClick={() =>
                            setEditorWindows((current) =>
                              current.filter((candidate) => candidate.key !== window.key),
                            )
                          }
                          className={`${SMALL_BUTTON} size-11 border-red-200 bg-white p-0 text-red-800 hover:bg-red-50`}
                        >
                          <span aria-hidden="true">×</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-600">
          {editorWindows.length.toLocaleString('fa-IR')} /{' '}
          {AVAILABILITY_WINDOWS_MAX.toLocaleString('fa-IR')} — {labels.limit}
        </p>
        <button
          type="submit"
          disabled={hasOverlap}
          className={`inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-slate-400 ${FOCUS_RING}`}
        >
          {labels.save}
        </button>
      </div>
    </form>
  );
}
