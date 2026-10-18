'use client';

import { useActionState } from 'react';
import { FamilySearchPanel } from './family-search-panel';
import { searchFamiliesAction } from './search-action';
import type { FamilySearchState } from './search-state';

/**
 * The one Client Component in the product, and the smallest one that can exist.
 *
 * Its entire job is to own `useActionState`, which is the only way to read a
 * Server Action's return value and is a client hook. It imports React, the
 * presentational panel and a type — nothing from `@/server/`, so the session
 * token, the internal API key and the cookie secret stay out of reach. Any
 * accidental import of a module that touches them would fail the build, since
 * every one of those declares `server-only`.
 *
 * PROGRESSIVE ENHANCEMENT IS THE POINT. `useActionState` given a Server
 * Function keeps this form working with JavaScript disabled: React renders a
 * real `action` URL and encodes the previous state into the form, the browser
 * posts it natively, and the action's result comes back as HTML. That is what
 * lets the search term live only in a request body — it never needs a URL, a
 * redirect or a cookie to survive, because it never has to survive anything.
 *
 * It depends on the state staying serialisable; see `search-state.ts`.
 */
export function FamilySearch({ initial }: { initial: FamilySearchState }) {
  const [state, formAction] = useActionState(searchFamiliesAction, initial);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <FamilySearchPanel {...state} />
    </form>
  );
}
