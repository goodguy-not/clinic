import { ERROR_CODES, type ErrorCode } from '@clinic/contracts';
import { COPY } from './copy-fa';

/**
 * Maps every stable NestJS error code to Persian.
 *
 * A test iterates `ERROR_CODES`, so a code added to the contract without a
 * translation fails the build rather than reaching a user as an English string
 * or an empty box.
 *
 * `API_UNREACHABLE` is the web tier's own code for "NestJS did not answer"; it
 * is not part of the contract because NestJS cannot report its own absence.
 */
export type DisplayableCode = ErrorCode | 'API_UNREACHABLE';

const MESSAGES: Record<DisplayableCode, string> = {
  // Deliberately identical for unknown username, wrong password, locked and
  // disabled: the server returns one code for all four, and the interface must
  // not reintroduce the distinction the API went to trouble to remove.
  AUTH_INVALID_CREDENTIALS: COPY.loginFailed,

  AUTH_SESSION_INVALID: COPY.sessionExpired,
  AUTH_SESSION_EXPIRED: COPY.sessionExpired,
  AUTH_PASSWORD_CHANGE_REQUIRED: COPY.mustChangePassword,
  AUTH_FORBIDDEN: 'شما اجازهٔ انجام این کار را ندارید.',
  AUTH_INTERNAL_KEY_INVALID: 'خطای پیکربندی سامانه. با پشتیبانی فنی تماس بگیرید.',
  AUTH_CSRF_INVALID: 'این درخواست معتبر نیست. صفحه را تازه کنید و دوباره تلاش کنید.',
  AUTH_ORIGIN_REJECTED: 'این درخواست معتبر نیست. صفحه را تازه کنید و دوباره تلاش کنید.',
  VALIDATION_FAILED: 'اطلاعات واردشده معتبر نیست.',
  PASSWORD_POLICY_VIOLATION: 'رمز عبور انتخاب‌شده شرایط لازم را ندارد.',
  USER_NOT_FOUND: 'کاربر پیدا نشد.',
  USER_USERNAME_TAKEN: 'این نام کاربری قبلاً استفاده شده است.',
  USER_SELF_MODIFICATION_FORBIDDEN: 'این تغییر را روی حساب خودتان نمی‌توانید انجام دهید.',
  USER_LAST_MANAGER: 'آخرین مدیر فعال را نمی‌توان غیرفعال یا تنزل داد.',

  // اطلاعات پایهٔ درمانگاه. صفحه‌های مربوط در گام‌های بعدی همین مرحله ساخته
  // می‌شوند؛ ترجمه‌ها همین‌جا می‌آیند چون آزمون پوشش، هر کد بدون ترجمه را
  // ناموفق می‌کند.
  THERAPIST_NOT_FOUND: 'درمانگر پیدا نشد.',
  SERVICE_NOT_FOUND: 'خدمت پیدا نشد.',
  ROOM_NOT_FOUND: 'اتاق پیدا نشد.',
  TARIFF_NOT_FOUND: 'تعرفه پیدا نشد.',
  SERVICE_NAME_TAKEN: 'خدمتی با این نام از قبل ثبت شده است.',
  ROOM_NAME_TAKEN: 'اتاقی با این نام از قبل ثبت شده است.',
  TARIFF_DURATION_NOT_ALLOWED: 'این مدت‌زمان برای این خدمت تعریف نشده است.',
  SERVICE_DURATION_IN_USE: 'برای این مدت‌زمان تعرفه ثبت شده است و حذف آن ممکن نیست.',
  TARIFF_OVERLAP: 'برای همین خدمت و بازهٔ زمانی، تعرفهٔ دیگری وجود دارد.',
  TARIFF_ALREADY_VOIDED: 'این تعرفه پیش‌تر ابطال شده است.',
  TARIFF_SCOPE_MISMATCH: 'تعرفهٔ جایگزین باید برای همان خدمت، مدت‌زمان و درمانگر باشد.',
  SERVICE_INACTIVE: 'این خدمت غیرفعال است.',
  THERAPIST_INACTIVE: 'این درمانگر غیرفعال است.',
  TARIFF_MISSING: 'برای این خدمت، مدت‌زمان و تاریخ، تعرفه‌ای ثبت نشده است.',

  INTERNAL_ERROR: 'خطای داخلی رخ داد. اگر تکرار شد با پشتیبانی فنی تماس بگیرید.',
  API_UNREACHABLE: 'سامانه در دسترس نیست. کمی بعد دوباره تلاش کنید.',
};

export function persianMessage(code: DisplayableCode): string {
  return MESSAGES[code] ?? MESSAGES.INTERNAL_ERROR;
}

/** Exposed so the coverage test can assert against the contract's own list. */
export const TRANSLATED_CODES: readonly DisplayableCode[] = [...ERROR_CODES, 'API_UNREACHABLE'];
