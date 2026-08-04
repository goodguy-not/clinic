/**
 * Persian user-facing copy.
 *
 * NestJS returns English codes and developer messages; every Persian string in
 * the product lives here (CLAUDE.md, Architecture boundary).
 *
 * OWNER-APPROVED strings are marked. The rest are functional field labels and
 * button text — the minimum needed for a form to be usable and accessible, not
 * marketing, legal or clinical copy, none of which is invented anywhere in this
 * milestone.
 */

export const COPY = {
  /** OWNER-APPROVED. */
  passwordGuidance:
    'رمز عبور باید دست‌کم ۱۵ کاراکتر داشته باشد. استفاده از عبارت عبور، مدیر رمز و جای‌گذاری مجاز است.',

  /** OWNER-APPROVED. Shown for every login failure, whatever the real cause. */
  loginFailed: 'نام کاربری یا رمز عبور صحیح نیست. اگر مشکل ادامه داشت، با مدیر مجموعه تماس بگیرید.',

  /** OWNER-APPROVED. */
  sessionExpired: 'نشست شما پایان یافته یا معتبر نیست. برای ورود دوباره ادامه دهید.',

  /** OWNER-APPROVED. */
  sessionExpiredButton: 'ادامه به صفحه ورود',

  // --- functional labels ----------------------------------------------------

  loginTitle: 'ورود به سامانه',
  username: 'نام کاربری',
  password: 'رمز عبور',
  signIn: 'ورود',

  changePasswordTitle: 'تغییر رمز عبور',
  currentPassword: 'رمز عبور فعلی',
  newPassword: 'رمز عبور جدید',
  confirmNewPassword: 'تکرار رمز عبور جدید',
  changePasswordSubmit: 'ثبت رمز عبور جدید',
  passwordsDoNotMatch: 'رمز عبور جدید و تکرار آن یکسان نیستند.',
  mustChangePassword: 'برای ادامه باید رمز عبور خود را تغییر دهید.',

  staffTitle: 'مدیریت کاربران',
  staffCreateTitle: 'ایجاد کاربر جدید',
  displayName: 'نام نمایشی',
  role: 'نقش',
  roleManager: 'مدیر',
  roleReceptionist: 'پذیرش',
  status: 'وضعیت',
  statusActive: 'فعال',
  statusDisabled: 'غیرفعال',
  create: 'ایجاد',
  makeManager: 'ارتقا به مدیر',
  makeReceptionist: 'تغییر به پذیرش',
  disable: 'غیرفعال کردن',
  enable: 'فعال کردن',
  resetPassword: 'بازنشانی رمز عبور',
  unlock: 'رفع قفل',
  revokeSessions: 'پایان دادن به نشست‌ها',
  lockedUntil: 'قفل تا',
  never: '—',
  signOut: 'خروج',

  /** Shown once, immediately after a reset or a creation. */
  temporaryPasswordTitle: 'رمز عبور موقت',
  temporaryPasswordNotice:
    'این رمز فقط همین یک بار نمایش داده می‌شود. آن را به کاربر بدهید و در جایی ذخیره نکنید.',
} as const;

export type CopyKey = keyof typeof COPY;
