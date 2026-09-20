import type { TestimonialStatus } from '@clinic/contracts';

export const TESTIMONIAL_STATUS_LABEL: Record<TestimonialStatus, string> = {
  DRAFT: 'در انتظار بررسی مدیر',
  APPROVED: 'تأیید حریم خصوصی شده',
};

const PERSIAN_DATE = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-arabext', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'Asia/Tehran',
});

export function formatContentDate(value: string): string {
  return PERSIAN_DATE.format(new Date(value));
}

export const CONTENT_SUCCESS_MESSAGES: Record<string, string> = {
  'article-created': 'پیش‌نویس مطلب ساخته شد.',
  'article-updated': 'تغییرات پیش‌نویس ذخیره شد.',
  'article-published': 'نسخهٔ فعلی مطلب روی سایت منتشر شد.',
  'article-unpublished': 'مطلب از سایت عمومی برداشته شد.',
  'testimonial-created': 'پیش‌نویس نقل‌قول ساخته شد.',
  'testimonial-updated': 'پیش‌نویس نقل‌قول ذخیره شد.',
  'testimonial-approved': 'متن نقل‌قول برای انتشار تأیید شد.',
  'testimonial-approval-revoked': 'تأیید نقل‌قول برداشته شد و روی سایت عمومی نیست.',
  'testimonial-published': 'نقل‌قول روی سایت عمومی قرار گرفت.',
  'testimonial-unpublished': 'نقل‌قول از سایت عمومی برداشته شد.',
  'testimonial-image-published': 'عکس دست‌نوشته برای نمایش عمومی تأیید شد.',
  'testimonial-image-withdrawn': 'عکس دست‌نوشته از دسترس عمومی برداشته شد.',
};
