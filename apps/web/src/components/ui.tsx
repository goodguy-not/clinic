import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The small shared visual vocabulary for internal pages.
 *
 * Deliberately a handful of plain functions returning markup, not a design
 * system. Each exists because the same shape is needed on four or more of the
 * catalog screens; anything used once stays where it is used.
 *
 * Every piece here is a Server Component: no state, no handlers, no client
 * bundle. Spacing and alignment use logical properties (`ms`/`me`, `ps`/`pe`,
 * `text-start`) so the layout flips correctly under `dir="rtl"` instead of
 * being pinned to the left.
 *
 * Mobile first: the base classes describe the narrow layout, and `sm:`/`md:`
 * widen it. A receptionist on a phone is the default case, not the fallback.
 */

/** Focus styling shared by every interactive element, so nothing is unreachable by keyboard. */
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white';

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-6">{children}</div>
    </main>
  );
}

export function PageHeader({
  title,
  description,
  backHref,
  backLabel,
  action,
}: {
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3">
      {backHref !== undefined && backLabel !== undefined ? (
        <Link
          href={backHref}
          className={`text-sm text-sky-800 underline underline-offset-4 hover:text-sky-950 ${FOCUS_RING} rounded-sm`}
        >
          {backLabel}
        </Link>
      ) : null}

      {/* Stacks on a phone and sits side by side once there is room. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
          {description !== undefined ? (
            <p className="text-sm text-slate-600">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
    </header>
  );
}

export function Panel({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      {title !== undefined ? (
        <h2 className="mb-4 text-base font-semibold text-slate-900">{title}</h2>
      ) : null}
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/**
 * `role="alert"` so a screen reader announces the message when the page loads
 * after a failed submission — the redirect-with-error-code pattern means the
 * user arrives on a fresh page, not an updated one.
 */
export function Alert({
  children,
  tone = 'error',
}: {
  children: ReactNode;
  tone?: 'error' | 'info';
}) {
  const styles =
    tone === 'error'
      ? 'border-red-300 bg-red-50 text-red-900'
      : 'border-sky-300 bg-sky-50 text-sky-900';

  return (
    <p role="alert" className={`rounded-md border px-4 py-3 text-sm font-medium ${styles}`}>
      {children}
    </p>
  );
}

export function StatusBadge({ active, labels }: { active: boolean; labels: [string, string] }) {
  const [activeLabel, inactiveLabel] = labels;

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        active ? 'bg-emerald-100 text-emerald-900' : 'bg-slate-200 text-slate-700'
      }`}
    >
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center">
      <p className="text-sm text-slate-600">{message}</p>
      {action}
    </div>
  );
}

/**
 * A record list rather than a table.
 *
 * A table with five columns is unreadable on a phone, and the alternative —
 * horizontal scrolling — hides exactly the columns a receptionist needs. Each
 * record is a card that becomes a row once there is width for one.
 */
export function RecordList({ children }: { children: ReactNode }) {
  return <ul className="flex list-none flex-col gap-3 p-0">{children}</ul>;
}

export function RecordItem({
  title,
  badge,
  details,
  actions,
}: {
  title: string;
  badge?: ReactNode;
  details?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{title}</span>
            {badge}
          </div>
          {details !== undefined ? (
            <div className="flex flex-col gap-1 text-sm text-slate-600">{details}</div>
          ) : null}
        </div>
        {actions !== undefined ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </li>
  );
}

const BUTTON_BASE = `inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors ${FOCUS_RING}`;

const BUTTON_TONES = {
  primary: 'bg-sky-700 text-white hover:bg-sky-800',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
} as const;

export function SubmitButton({
  children,
  tone = 'primary',
}: {
  children: ReactNode;
  tone?: keyof typeof BUTTON_TONES;
}) {
  return (
    <button type="submit" className={`${BUTTON_BASE} ${BUTTON_TONES[tone]}`}>
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  children,
  tone = 'primary',
}: {
  href: string;
  children: ReactNode;
  tone?: keyof typeof BUTTON_TONES;
}) {
  return (
    <Link href={href} className={`${BUTTON_BASE} ${BUTTON_TONES[tone]}`}>
      {children}
    </Link>
  );
}

const CONTROL =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400';

/**
 * Label, control and help text as one unit.
 *
 * `htmlFor`/`id` are required arguments rather than optional extras, and help
 * text is wired through `aria-describedby`, so a field cannot be added without
 * its label and explanation reaching assistive technology.
 */
export function Field({
  id,
  label,
  help,
  required = false,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  required?: boolean;
  children: (props: { id: string; className: string; describedBy?: string }) => ReactNode;
}) {
  const helpId = `${id}-help`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-900">
        {label}
        {required ? <span className="ms-1 text-red-700">*</span> : null}
      </label>
      {children({
        id,
        className: `${CONTROL} ${FOCUS_RING}`,
        ...(help !== undefined ? { describedBy: helpId } : {}),
      })}
      {help !== undefined ? (
        <p id={helpId} className="text-xs text-slate-600">
          {help}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A group of related radios or checkboxes.
 *
 * A `fieldset`/`legend` rather than a heading, so the question is announced
 * with each option instead of the options arriving without their context.
 */
export function ChoiceGroup({
  legend,
  help,
  children,
}: {
  legend: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 text-sm font-medium text-slate-900">{legend}</legend>
      {help !== undefined ? <p className="mb-1 text-xs text-slate-600">{help}</p> : null}
      <div className="flex flex-col gap-2">{children}</div>
    </fieldset>
  );
}

export function ChoiceOption({
  id,
  name,
  value,
  label,
  description,
  badge,
  type = 'radio',
  defaultChecked = false,
}: {
  id: string;
  name: string;
  value: string;
  label: string;
  description?: string;
  /**
   * Optional marker beside the label — used to show that a listed service is
   * inactive. The option stays selectable and stays checked: an existing
   * association is a decision somebody made, and hiding or clearing it would
   * discard that silently.
   */
  badge?: ReactNode;
  type?: 'radio' | 'checkbox';
  defaultChecked?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-slate-200 p-3">
      <input
        id={id}
        name={name}
        value={value}
        type={type}
        defaultChecked={defaultChecked}
        className={`mt-1 size-4 shrink-0 ${FOCUS_RING}`}
      />
      <label htmlFor={id} className="flex flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-900">{label}</span>
          {badge}
        </span>
        {description !== undefined ? (
          <span className="text-xs text-slate-600">{description}</span>
        ) : null}
      </label>
    </div>
  );
}

/** Buttons for a form, stacked on a phone and inline once there is room. */
export function FormActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center">{children}</div>;
}
