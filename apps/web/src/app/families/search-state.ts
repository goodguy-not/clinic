import type { FamilySummary } from '@clinic/contracts';

/**
 * What one family search produced.
 *
 * A separate module from the action deliberately: a `'use server'` file may
 * export only async functions (React rejects anything else at call time, and
 * `check-web-boundary.mjs` catches it at build time), and this type is shared
 * by the action, the page and the client shell.
 *
 * PLAIN, SERIALISABLE DATA, and that is load-bearing. `useActionState` carries
 * the previous state into the next submission, and with JavaScript disabled it
 * does so by encoding it into the form React renders. A React element cannot
 * be encoded that way — React silently drops progressive enhancement and emits
 * an inert `action="javascript:throw ..."` form instead, which was observed
 * against Next 16.2.12 before this shape was settled on. Anything added here
 * must stay serialisable.
 *
 * It carries no search term of its own beyond `q`, which exists so the input
 * can show what was searched for; nothing here is ever placed in a URL.
 */
export type FamilySearchState = {
  q: string;
  includeInactive: boolean;
  families: FamilySummary[];
  truncated: boolean;
  searched: boolean;
  errorMessage: string | null;
};
