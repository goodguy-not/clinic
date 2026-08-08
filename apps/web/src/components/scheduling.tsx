import Link from 'next/link';
import type { ReactNode } from 'react';
import { FOCUS_RING } from './styles';

/**
 * Contract-independent scheduling presentation primitives.
 *
 * The components accept already-shaped display content and ordinary links.
 * They do not fetch, mutate, infer appointment states, or prescribe a booking
 * workflow. That boundary lets the appointment contracts settle before B1
 * without leaving a temporary page or data model behind.
 */

export type ScheduleDayOption = {
  isoDate: string;
  href: string;
  weekday: string;
  day: string;
  month?: string;
  accessibleLabel: string;
  selected?: boolean;
  today?: boolean;
};

type DirectionLink = {
  href: string;
  label: string;
};

function DirectionIcon({ direction }: { direction: 'previous' | 'next' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="size-5"
    >
      <path
        d={direction === 'previous' ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const DATE_CONTROL_CLASS = `inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 shadow-xs transition-[color,background-color,border-color,transform] hover:border-brand-300 hover:bg-brand-50 hover:text-brand-900 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none ${FOCUS_RING}`;

const DATE_OPTION_BASE =
  'flex min-h-20 min-w-20 snap-start flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-center';

/**
 * Compact period navigation followed by a horizontally scrollable date rail.
 * Seven days fit at tablet width; on a phone each date remains a generous
 * touch target instead of being compressed into illegible columns.
 */
export function ScheduleDateNavigation({
  label,
  periodLabel,
  previous,
  next,
  today,
  todayMarker,
  days,
}: {
  label: string;
  periodLabel: string;
  previous: DirectionLink;
  next: DirectionLink;
  today?: DirectionLink;
  todayMarker: string;
  days: ScheduleDayOption[];
}) {
  return (
    <nav
      aria-label={label}
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-3 sm:px-4">
        <Link
          href={previous.href}
          aria-label={previous.label}
          title={previous.label}
          className={`${DATE_CONTROL_CLASS} size-11 shrink-0 p-0`}
        >
          <DirectionIcon direction="previous" />
        </Link>

        <p className="min-w-0 flex-1 truncate text-center text-sm font-bold text-slate-900 sm:text-base">
          {periodLabel}
        </p>

        {today !== undefined ? (
          <Link href={today.href} className={`${DATE_CONTROL_CLASS} shrink-0 px-3`}>
            {today.label}
          </Link>
        ) : null}

        <Link
          href={next.href}
          aria-label={next.label}
          title={next.label}
          className={`${DATE_CONTROL_CLASS} size-11 shrink-0 p-0`}
        >
          <DirectionIcon direction="next" />
        </Link>
      </div>

      <ol className="flex snap-x snap-mandatory list-none gap-2 overflow-x-auto px-3 py-3 [scrollbar-width:thin] sm:grid sm:grid-cols-7 sm:overflow-visible sm:px-4">
        {days.map((day) => {
          const content = (
            <time dateTime={day.isoDate} className="contents">
              <span className="text-xs font-medium opacity-80">{day.weekday}</span>
              <span className="text-lg font-black leading-none">{day.day}</span>
              <span className="min-h-4 text-[0.6875rem] font-medium opacity-75">
                {day.today ? todayMarker : (day.month ?? '')}
              </span>
            </time>
          );
          const selectedClassName = `${DATE_OPTION_BASE} border-brand-700 bg-brand-700 text-white shadow-sm`;
          const linkClassName = `${DATE_OPTION_BASE} transition-[color,background-color,border-color,box-shadow,transform] active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none ${FOCUS_RING} ${
            day.today
              ? 'border-brand-300 bg-brand-50 text-brand-950 hover:border-brand-500 hover:bg-brand-100'
              : 'border-transparent bg-slate-50 text-slate-700 hover:border-slate-200 hover:bg-slate-100 hover:text-slate-950'
          }`;

          return (
            <li key={day.isoDate} className="shrink-0 sm:min-w-0">
              {day.selected ? (
                <span
                  aria-current="date"
                  aria-label={day.accessibleLabel}
                  className={selectedClassName}
                >
                  {content}
                </span>
              ) : (
                <Link href={day.href} aria-label={day.accessibleLabel} className={linkClassName}>
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function ScheduleAgenda({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const titleId = `${id}-title`;

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <header className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-bold text-slate-950 sm:text-lg">
            {title}
          </h2>
          {description !== undefined ? (
            <p className="mt-0.5 text-sm text-slate-600">{description}</p>
          ) : null}
        </div>
        {action}
      </header>
      <ol className="list-none divide-y divide-slate-100 p-0">{children}</ol>
    </section>
  );
}

/** One chronological row. Callers retain complete control over row ordering. */
export function ScheduleAgendaGroup({
  time,
  timeLabel,
  children,
}: {
  time: string;
  timeLabel: string;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-3 px-3 py-3 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-4 sm:px-5 sm:py-4">
      <div className="relative flex justify-center pt-1 after:absolute after:inset-block-8 after:w-px after:bg-slate-100">
        <time
          dateTime={time}
          dir="ltr"
          className="h-fit rounded-md bg-slate-100 px-2 py-0.5 text-sm font-bold tabular-nums text-slate-700"
        >
          {timeLabel}
        </time>
      </div>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </li>
  );
}

const SCHEDULE_CARD_TONES = {
  brand: { base: 'border-s-brand-600 bg-brand-50/70', hover: 'hover:bg-brand-50' },
  neutral: { base: 'border-s-slate-400 bg-slate-50', hover: 'hover:bg-slate-100' },
  success: { base: 'border-s-emerald-600 bg-emerald-50/70', hover: 'hover:bg-emerald-50' },
  warning: { base: 'border-s-amber-500 bg-amber-50/70', hover: 'hover:bg-amber-50' },
  danger: { base: 'border-s-red-600 bg-red-50/70', hover: 'hover:bg-red-50' },
} as const;

/**
 * A generic agenda card. Tone is visual emphasis only; mapping appointment
 * states to tones remains a B1 decision once those states freeze.
 */
export function ScheduleCard({
  title,
  description,
  metadata,
  badge,
  href,
  accessibleLabel,
  tone = 'brand',
}: {
  title: string;
  description?: ReactNode;
  metadata?: ReactNode;
  badge?: ReactNode;
  href?: string;
  accessibleLabel?: string;
  tone?: keyof typeof SCHEDULE_CARD_TONES;
}) {
  const content = (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="min-w-0 font-bold text-slate-950">{title}</h3>
        {badge}
      </div>
      {description !== undefined ? (
        <div className="text-sm text-slate-700">{description}</div>
      ) : null}
      {metadata !== undefined ? (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-medium text-slate-500">
          {metadata}
        </div>
      ) : null}
    </div>
  );

  const toneClasses = SCHEDULE_CARD_TONES[tone];
  const className = `block min-h-11 rounded-xl border border-slate-200 border-s-4 px-3 py-2.5 shadow-xs ${toneClasses.base}`;

  return (
    <article>
      {href !== undefined ? (
        <Link
          href={href}
          aria-label={accessibleLabel}
          className={`${className} transition-[background-color,border-color,box-shadow,transform] hover:border-slate-300 hover:shadow-sm active:scale-[0.995] motion-reduce:transform-none motion-reduce:transition-none ${toneClasses.hover} ${FOCUS_RING}`}
        >
          {content}
        </Link>
      ) : (
        <div className={className}>{content}</div>
      )}
    </article>
  );
}
