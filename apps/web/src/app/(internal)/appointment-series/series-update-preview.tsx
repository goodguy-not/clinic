'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import type { SeriesUpdatePreviewResponse } from '@clinic/contracts';
import { Alert, Badge } from '@/components/ui';
import {
  appointmentInstantInClinic,
  appointmentTimeLabel,
} from '@/scheduling/appointment-presentation';
import { formatScheduleDate } from '@/scheduling/presentation';

export function SeriesUpdatePreview({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<SeriesUpdatePreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof HTMLFormElement) || target.id !== 'series-update-form') return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value === 'apply' && preview?.applicable) return;
    event.preventDefault();
    setPending(true);
    setError(null);
    setPreview(null);
    try {
      const response = await fetch('/api/appointment-series/update-from/preview', {
        method: 'POST',
        body: new FormData(target),
      });
      const data: SeriesUpdatePreviewResponse | { error: string } = await response.json();
      if (!response.ok || 'error' in data)
        setError('error' in data ? data.error : 'پیش‌نمایش بارگیری نشد.');
      else setPreview(data);
    } catch {
      setError('پیش‌نمایش بارگیری نشد. دوباره تلاش کنید.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div onSubmitCapture={submit} onChangeCapture={() => setPreview(null)}>
      {children}
      {pending ? <p role="status">در حال بررسی جلسه‌های آینده…</p> : null}
      {error ? <Alert>{error}</Alert> : null}
      {preview ? (
        <div className="mt-4 space-y-3 rounded-xl border border-slate-200 p-4">
          <h3 className="font-bold">پیش‌نمایش روز و ساعت تازه</h3>
          <p>
            {preview.applicable
              ? 'همهٔ جلسه‌ها آمادهٔ تغییرند.'
              : `${preview.blockedCount} جلسه مانع تغییر دارد.`}
          </p>
          <ul className="space-y-2">
            {preview.occurrences.map((item) => (
              <li
                key={item.appointmentId}
                className="rounded-lg border border-slate-200 p-3 text-sm"
              >
                <a href={`/appointments/${item.appointmentId}`} className="underline">
                  {formatScheduleDate(appointmentInstantInClinic(item.currentStartsAt)?.date ?? '')
                    ?.full ?? item.currentStartsAt}
                  ، {appointmentTimeLabel(item.currentStartsAt)}
                </a>
                <span className="mx-2">←</span>
                <span>
                  {formatScheduleDate(item.date)?.full ?? item.date}،{' '}
                  {appointmentTimeLabel(item.startsAt)} تا {appointmentTimeLabel(item.endsAt)}
                </span>
                <Badge
                  tone={
                    item.blockedBy ? 'danger' : item.outsideAvailability ? 'warning' : 'success'
                  }
                >
                  {item.unchanged
                    ? 'بدون تغییر'
                    : item.blockedBy
                      ? item.blockedBy === 'RECURRENCE_OCCURRENCE_IN_PAST'
                        ? 'زمان پیشنهادی گذشته است'
                        : 'این زمان تداخل دارد'
                      : item.outsideAvailability
                        ? 'خارج از ساعت حضور'
                        : 'آماده'}
                </Badge>
                {item.conflicts.length ? (
                  <p>
                    تداخل:{' '}
                    {item.conflicts
                      .map((conflict) =>
                        conflict.resource === 'CHILD'
                          ? 'کودک'
                          : conflict.resource === 'THERAPIST'
                            ? 'درمانگر'
                            : 'اتاق',
                      )
                      .join('، ')}
                  </p>
                ) : null}
                {item.outsideAvailabilityReason ? (
                  <p>
                    {item.outsideAvailabilityReason === 'CLOSED_DAY'
                      ? 'روز بسته'
                      : item.outsideAvailabilityReason === 'PARTIAL_CLOSURE'
                        ? 'بسته در بخشی از روز'
                        : 'خارج از ساعت هفتگی'}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {preview.applicable ? (
            <button
              type="submit"
              form="series-update-form"
              name="action"
              value="apply"
              className="rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white"
            >
              اعمال تغییر برای این جلسه و آینده
            </button>
          ) : (
            <p className="font-semibold text-red-800">
              مانع‌ها را برطرف کنید و دوباره پیش‌نمایش بگیرید.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
