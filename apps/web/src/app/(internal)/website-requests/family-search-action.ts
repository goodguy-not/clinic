'use server';

import { WEBSITE_REQUEST_LINK_PERMISSIONS } from '@clinic/contracts';
import { headers } from 'next/headers';
import { api } from '@/server/api-client';
import { callerContext, readSessionToken, requireSession } from '@/server/auth-session';
import { persianMessage } from '@/server/errors-fa';
import { assertOriginAllowed } from '@/server/origin';
import type { WebsiteRequestFamilySearchState } from './family-search-state';

export async function searchFamiliesForWebsiteRequestAction(
  _previous: WebsiteRequestFamilySearchState,
  formData: FormData,
): Promise<WebsiteRequestFamilySearchState> {
  assertOriginAllowed((await headers()).get('origin'));
  await requireSession({ requirePermission: WEBSITE_REQUEST_LINK_PERMISSIONS });

  const rawQuery = formData.get('q');
  const q = typeof rawQuery === 'string' ? rawQuery.trim() : '';
  const searched = q.length >= 2;
  if (!searched) {
    return {
      q,
      families: [],
      truncated: false,
      searched: false,
      errorMessage: 'برای جست‌وجو دست‌کم دو نویسه وارد کنید.',
    };
  }

  const token = await readSessionToken();
  const result = await api.searchFamilies(
    { q, includeInactive: false },
    await callerContext(token ?? undefined),
  );

  return {
    q,
    families: result.ok ? result.data.families : [],
    truncated: result.ok ? result.data.truncated : false,
    searched,
    errorMessage: result.ok ? null : persianMessage(result.code),
  };
}
