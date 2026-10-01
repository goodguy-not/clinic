import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { NOTICE_CODES, type NoticeCode } from '@clinic/contracts';
import { relativeRedirect } from './security-headers';

/**
 * Informational outcomes of a write that succeeded.
 *
 * The mirror image of `failureRedirect`: same mechanism, opposite meaning. A
 * write that finds a *similar* family or child goes ahead — similarity alone is
 * never a refusal, and blocking two real families who share a surname would be
 * the exact failure this milestone is built to avoid — but the interface still
 * has to say something, because a warning nobody sees is not a warning.
 *
 * What travels is one value from a closed list. Not a name, not an identifier,
 * not a candidate id: the destination is a URL, and a URL reaches browser
 * history, a `Referer` header and an access log. `SIMILAR_FAMILY_EXISTS` says
 * "look at the search screen" and reveals nothing about who the similar family
 * is.
 *
 * The receiving page validates the value against the contract before rendering
 * it, exactly as it does for an error code, so the parameter cannot inject text
 * into the page.
 */

const PERSIAN_NOTICES: Record<NoticeCode, string> = {
  SIMILAR_FAMILY_EXISTS:
    'خانوادهٔ مشابهی در سامانه ثبت شده است. اگر تکراری است، از صفحهٔ جست‌وجو بررسی کنید.',
  SIMILAR_CHILD_EXISTS:
    'کودک مشابهی در سامانه ثبت شده است. اگر تکراری است، از صفحهٔ جست‌وجو بررسی کنید.',
};

export function isKnownNoticeCode(value: string | null): value is NoticeCode {
  if (value === null) return false;

  return (NOTICE_CODES as readonly string[]).includes(value);
}

export function persianNotice(code: NoticeCode): string {
  return PERSIAN_NOTICES[code];
}

/**
 * Redirects to a record's own page, carrying at most one notice.
 *
 * The path is built from a literal and this application's own origin, as in
 * `failureRedirect` — nothing the caller submitted contributes to it. The record
 * id in the path is an opaque uuid: it identifies a row, it is already how every
 * detail link in the product works, and it is not personal data.
 *
 * Several warnings can fire at once. Only the first is carried, because the
 * page shows one informational alert and a list of codes in a query string
 * would be a small step towards putting content there.
 */
export function noticeRedirect(
  _request: NextRequest,
  path: `/${string}`,
  notices: readonly NoticeCode[],
): NextResponse {
  const target = new URL(path, 'https://unused.invalid');
  const first = notices[0];

  if (first !== undefined) target.searchParams.set('notice', first);

  return relativeRedirect(`${target.pathname}${target.search}` as `/${string}`);
}

/** Exposed so the coverage test can assert against the contract's own list. */
export const TRANSLATED_NOTICE_CODES: readonly NoticeCode[] = NOTICE_CODES;
