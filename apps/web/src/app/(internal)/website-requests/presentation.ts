import type { ChildSex, PublicRequestContactTime, WebsiteRequestStatus } from '@clinic/contracts';

export const WEBSITE_REQUEST_STATUS_LABEL: Record<WebsiteRequestStatus, string> = {
  NEW: 'جدید',
  CONTACTED: 'تماس گرفته شد',
  FOLLOW_UP_NEEDED: 'نیازمند پیگیری',
  CONVERTED_TO_FAMILY: 'تبدیل‌شده به خانواده',
  CLOSED: 'بسته‌شده',
};

export const WEBSITE_REQUEST_STATUS_ACTION: Partial<Record<WebsiteRequestStatus, string>> = {
  CONTACTED: 'ثبت تماس انجام‌شده',
  FOLLOW_UP_NEEDED: 'علامت‌گذاری برای پیگیری',
  CLOSED: 'بستن درخواست',
};

export const WEBSITE_REQUEST_STATUS_TONE: Record<
  WebsiteRequestStatus,
  'success' | 'neutral' | 'warning' | 'danger' | 'info'
> = {
  NEW: 'info',
  CONTACTED: 'success',
  FOLLOW_UP_NEEDED: 'warning',
  CONVERTED_TO_FAMILY: 'success',
  CLOSED: 'neutral',
};

export const CHILD_SEX_LABEL: Record<ChildSex, string> = {
  FEMALE: 'دختر',
  MALE: 'پسر',
  UNSPECIFIED: 'مشخص نشده',
};

export const CONTACT_TIME_LABEL: Record<PublicRequestContactTime, string> = {
  MORNING: 'صبح',
  AFTERNOON: 'بعدازظهر',
  EVENING: 'عصر',
  NO_PREFERENCE: 'فرقی نمی‌کند',
};

const PERSIAN_INSTANT = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-arabext', {
  dateStyle: 'medium',
  timeStyle: 'short',
  hourCycle: 'h23',
  timeZone: 'Asia/Tehran',
});

export function formatWebsiteRequestInstant(value: string): string {
  return PERSIAN_INSTANT.format(new Date(value));
}
