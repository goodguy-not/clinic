export const SPACE_SUCCESS_MESSAGES: Record<string, string> = {
  'space-created': 'پیش‌نویس فضا ساخته شد. اکنون می‌توانید عکس‌های آن را آماده کنید.',
  'space-updated': 'تغییرات پیش‌نویس ذخیره شد و هنوز چیزی روی سایت تغییر نکرده است.',
  'space-published': 'نسخهٔ آماده‌شدهٔ این فضا روی سایت قرار گرفت.',
  'space-unpublished': 'این فضا از سایت عمومی برداشته شد.',
  'space-photo-published': 'عکس برای نمایش عمومی آماده شد.',
  'space-photo-withdrawn': 'عکس از نمایش عمومی برداشته شد.',
};

export function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
