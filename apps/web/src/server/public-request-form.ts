import 'server-only';
import {
  CURRENT_PUBLIC_REQUEST_CONSENT_VERSION,
  publicRequestSubmissionSchema,
  type PublicRequestSubmission,
} from '@clinic/contracts';
import { toWesternDigits } from './numerals-fa';

export type PublicRequestField =
  | 'contactName'
  | 'contactMobile'
  | 'childAgeYears'
  | 'childSex'
  | 'childName'
  | 'preferredContactTime'
  | 'note'
  | 'consent';

export type PublicRequestValues = Record<PublicRequestField, string>;

export type PublicRequestFormState = {
  status: 'idle' | 'error';
  fieldErrors: Partial<Record<PublicRequestField, string>>;
  formError: string | null;
  values: PublicRequestValues;
};

export const EMPTY_PUBLIC_REQUEST_VALUES: PublicRequestValues = {
  contactName: '',
  contactMobile: '',
  childAgeYears: '',
  childSex: '',
  childName: '',
  preferredContactTime: '',
  note: '',
  consent: '',
};

export function publicRequestValues(formData: FormData): PublicRequestValues {
  const value = (name: PublicRequestField): string => {
    const raw = formData.get(name);
    return typeof raw === 'string' ? raw : '';
  };

  return {
    contactName: value('contactName'),
    contactMobile: value('contactMobile'),
    childAgeYears: value('childAgeYears'),
    childSex: value('childSex'),
    childName: value('childName'),
    preferredContactTime: value('preferredContactTime'),
    note: value('note'),
    consent: value('consent'),
  };
}

function normalizeMobile(value: string): string {
  const digits = toWesternDigits(value).trim().replace(/[\s-]/g, '');
  if (digits.startsWith('+98')) return `0${digits.slice(3)}`;
  if (digits.startsWith('0098')) return `0${digits.slice(4)}`;
  return digits;
}

function optional(value: string): string | undefined {
  return value.trim() === '' ? undefined : value;
}

const FIELD_MESSAGES: Record<PublicRequestField, string> = {
  contactName: 'نام و نام خانوادگی خود را وارد کنید.',
  contactMobile: 'شمارهٔ همراه معتبر وارد کنید؛ مانند ۰۹۱۲۱۲۳۴۵۶۷.',
  childAgeYears: 'سن فرزندتان را به سال کامل، از ۰ تا ۹۹ سال وارد کنید.',
  childSex: 'یکی از گزینه‌های جنسیت را انتخاب کنید.',
  childName: 'نام فرزند باید متن ساده و حداکثر ۱۲۰ نویسه باشد.',
  preferredContactTime: 'یکی از زمان‌های پیشنهادی را انتخاب کنید.',
  note: 'یادداشت باید متن ساده و حداکثر ۲۰۰۰ نویسه باشد.',
  consent: 'برای ارسال درخواست، رضایت خود را اعلام کنید.',
};

export function parsePublicRequestForm(
  formData: FormData,
  serviceSlug: string | null,
):
  | { ok: true; data: PublicRequestSubmission; values: PublicRequestValues }
  | {
      ok: false;
      fieldErrors: Partial<Record<PublicRequestField, string>>;
      values: PublicRequestValues;
    } {
  const values = publicRequestValues(formData);
  const ageText = toWesternDigits(values.childAgeYears).trim();
  const age = /^\d+$/.test(ageText) ? Number(ageText) : Number.NaN;
  const raw = {
    contactName: values.contactName,
    contactMobile: normalizeMobile(values.contactMobile),
    serviceSlug,
    ...(optional(values.childName) === undefined ? {} : { childName: values.childName }),
    childAgeYears: age,
    childSex: values.childSex,
    ...(optional(values.preferredContactTime) === undefined
      ? {}
      : { preferredContactTime: values.preferredContactTime }),
    ...(optional(values.note) === undefined ? {} : { note: values.note }),
    consent: values.consent === 'true',
    consentVersion: CURRENT_PUBLIC_REQUEST_CONSENT_VERSION,
  };
  const parsed = publicRequestSubmissionSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data, values };

  const fieldErrors: Partial<Record<PublicRequestField, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field !== 'string' || !(field in FIELD_MESSAGES)) continue;
    const key = field as PublicRequestField;
    fieldErrors[key] ??= FIELD_MESSAGES[key];
  }

  return { ok: false, fieldErrors, values };
}
