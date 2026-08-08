/**
 * Class strings shared by every interactive element and form control.
 *
 * Kept in their own module (no JSX, no imports) so both `ui.tsx` and
 * `app-header.tsx` can use them without a module cycle.
 */

/** Focus styling shared by every interactive element, so nothing is unreachable by keyboard. */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white';

/**
 * The shared look of a text-like form control (`input`, `select`, `textarea`).
 * Exported so one-off fields (guardian slots, Jalali date selects) use the
 * exact same chrome instead of re-declaring a drifting copy of it.
 */
export const CONTROL_CLASS = `w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 ${FOCUS_RING}`;
