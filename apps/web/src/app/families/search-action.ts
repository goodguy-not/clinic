'use server';

import { headers } from 'next/headers';
import { api } from '@/server/api-client';
import { callerContext, readSessionToken, requireSession } from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { assertOriginAllowed } from '@/server/origin';
import type { FamilySearchState } from './search-state';

/**
 * Family search, as a Server Action.
 *
 * WHY AN ACTION AND NOT A ROUTE HANDLER. The term is a guardian's name, a
 * child's name, a mobile number or a file number — personal data, which must
 * not reach a URL, browser history, a `Referer` header or an access log, which
 * is the same reason `FamiliesController.search` is a POST at the API
 * boundary. An action posts the term in a request body and answers in the
 * response to that same request: there is no redirect to carry state across,
 * so there is nothing to put in a query string and nothing to put in a cookie.
 * The term exists for the life of one request and is then gone.
 *
 * That single-request property is also what removes any dependence on where a
 * request lands. No token, no row and no process memory outlives the response,
 * so a second web process has nothing it needs to have seen.
 *
 * AUTHORISATION IS THIS FUNCTION'S OWN JOB. An action is a browser-reachable
 * endpoint that no Route Handler guard covers, so it resolves a session and
 * names its permission here; `handler-coverage.test.ts` enumerates every
 * `'use server'` module and fails the build for one that does not.
 *
 * Origin is checked explicitly on top of the Origin/Host equality Next.js
 * already enforces on every Server Action, against the same configured
 * allow-list every Route Handler uses. Reading is not a state change, but a
 * check applied only to writes is a check somebody forgets to add to the first
 * action that writes.
 */
export async function searchFamiliesAction(
  _previous: FamilySearchState,
  formData: FormData,
): Promise<FamilySearchState> {
  assertOriginAllowed((await headers()).get('origin'));

  await requireSession({ requirePermission: 'family.read' });

  const rawQuery = formData.get('q');
  const q = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  const includeInactive = formData.get('includeInactive') === 'true';

  // The contract requires at least two characters; fewer is treated as "no
  // term", which is the recent-registrations view rather than an error.
  const searched = q.length >= 2;

  const sessionToken = await readSessionToken();
  const result = await api.searchFamilies(
    { ...(searched ? { q } : {}), includeInactive },
    await callerContext(sessionToken ?? undefined),
  );

  return {
    q,
    includeInactive,
    families: result.ok ? result.data.families : [],
    truncated: result.ok ? result.data.truncated : false,
    searched,
    errorMessage: result.ok ? null : persianMessage(result.code),
  };
}
