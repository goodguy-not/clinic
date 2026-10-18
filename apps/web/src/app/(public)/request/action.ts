'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { parsePublicRequestForm, type PublicRequestFormState } from '@/server/public-request-form';
import { assertOriginAllowed } from '@/server/origin';
import { submitPublicRequest } from '@/server/public-site';

export async function submitPublicRequestAction(
  serviceSlug: string | null,
  _previous: PublicRequestFormState,
  formData: FormData,
): Promise<PublicRequestFormState> {
  const requestHeaders = await headers();
  assertOriginAllowed(requestHeaders.get('origin'));

  const parsed = parsePublicRequestForm(formData, serviceSlug);
  if (!parsed.ok) {
    return {
      status: 'error',
      fieldErrors: parsed.fieldErrors,
      formError: 'لطفاً موارد مشخص‌شده را بررسی کنید.',
      values: parsed.values,
    };
  }

  const forwardedFor = requestHeaders.get('x-forwarded-for');
  const result = await submitPublicRequest(parsed.data, {
    clientIp: forwardedFor?.split(',')[0]?.trim() ?? null,
  });

  if (!result.ok) {
    const formError =
      result.reason === 'throttled'
        ? 'در فاصلهٔ کوتاهی درخواست‌های زیادی فرستاده شده است. لطفاً بعداً دوباره تلاش کنید یا با کلینیک تماس بگیرید.'
        : result.reason === 'service-context'
          ? 'اطلاعات خدمت انتخاب‌شده دیگر در دسترس نیست. لطفاً از مسیر عمومی درخواست ارزیابی دوباره شروع کنید.'
          : result.reason === 'invalid'
            ? 'برخی اطلاعات پذیرفته نشد. لطفاً فرم را بررسی و دوباره ارسال کنید.'
            : 'در حال حاضر ثبت درخواست ممکن نیست. لطفاً دوباره تلاش کنید یا با کلینیک تماس بگیرید.';
    return {
      status: 'error',
      fieldErrors: {},
      formError,
      values: parsed.values,
    };
  }

  redirect('/request/received');
}
