import type { PublicClinicProfile } from '@clinic/contracts';
import {
  Alert,
  Field,
  FormActions,
  PageHeader,
  PageShell,
  Panel,
  SubmitButton,
} from '@/components/ui';

export function ClinicProfileForm({
  clinic,
  csrfToken,
  message,
}: {
  clinic: PublicClinicProfile;
  csrfToken: string;
  message: string | null;
}) {
  return (
    <PageShell>
      <PageHeader
        title="مشخصات عمومی کلینیک"
        description="فقط اطلاعاتی را وارد کنید که باید همین حالا در وب‌سایت عمومی دیده شود."
        backHref="/content"
        backLabel="بازگشت"
      />
      <Alert tone="info">
        این فرم پیش‌نویس جداگانه ندارد؛ ذخیرهٔ مدیر، اطلاعات عمومی فعلی را به‌روزرسانی می‌کند.
        خانه‌های خالی به معنی نمایش‌ندادن همان مورد هستند.
      </Alert>
      {message !== null ? <Alert tone="info">{message}</Alert> : null}
      <Panel>
        <form
          method="post"
          action="/api/content/clinic-profile/update"
          className="flex flex-col gap-5"
        >
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <Field id="displayName" label="نام نمایشی کلینیک">
            {({ id, className, describedBy }) => (
              <input
                id={id}
                className={className}
                aria-describedby={describedBy}
                name="displayName"
                type="text"
                maxLength={120}
                defaultValue={clinic.displayName ?? ''}
              />
            )}
          </Field>
          <Field id="tagline" label="جملهٔ معرفی کوتاه">
            {({ id, className, describedBy }) => (
              <input
                id={id}
                className={className}
                aria-describedby={describedBy}
                name="tagline"
                type="text"
                maxLength={200}
                defaultValue={clinic.tagline ?? ''}
              />
            )}
          </Field>
          <Field id="about" label="دربارهٔ کلینیک">
            {({ id, className, describedBy }) => (
              <textarea
                id={id}
                className={className}
                aria-describedby={describedBy}
                name="about"
                rows={7}
                maxLength={4000}
                defaultValue={clinic.about ?? ''}
              />
            )}
          </Field>
          <Field id="addressLine" label="نشانی">
            {({ id, className, describedBy }) => (
              <input
                id={id}
                className={className}
                aria-describedby={describedBy}
                name="addressLine"
                type="text"
                maxLength={300}
                defaultValue={clinic.addressLine ?? ''}
              />
            )}
          </Field>
          <Field id="cityLabel" label="نام شهر یا محدوده">
            {({ id, className, describedBy }) => (
              <input
                id={id}
                className={className}
                aria-describedby={describedBy}
                name="cityLabel"
                type="text"
                maxLength={120}
                defaultValue={clinic.cityLabel ?? ''}
              />
            )}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="phonePrimary" label="تلفن اصلی">
              {({ id, className, describedBy }) => (
                <input
                  id={id}
                  className={className}
                  aria-describedby={describedBy}
                  name="phonePrimary"
                  type="tel"
                  dir="ltr"
                  maxLength={40}
                  defaultValue={clinic.phonePrimary ?? ''}
                />
              )}
            </Field>
            <Field id="phoneSecondary" label="تلفن دوم">
              {({ id, className, describedBy }) => (
                <input
                  id={id}
                  className={className}
                  aria-describedby={describedBy}
                  name="phoneSecondary"
                  type="tel"
                  dir="ltr"
                  maxLength={40}
                  defaultValue={clinic.phoneSecondary ?? ''}
                />
              )}
            </Field>
          </div>
          <Field id="email" label="ایمیل">
            {({ id, className, describedBy }) => (
              <input
                id={id}
                className={className}
                aria-describedby={describedBy}
                name="email"
                type="email"
                dir="ltr"
                maxLength={200}
                defaultValue={clinic.email ?? ''}
              />
            )}
          </Field>
          <Field id="workingHoursNote" label="توضیح ساعت کاری">
            {({ id, className, describedBy }) => (
              <input
                id={id}
                className={className}
                aria-describedby={describedBy}
                name="workingHoursNote"
                type="text"
                maxLength={300}
                defaultValue={clinic.workingHoursNote ?? ''}
              />
            )}
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id="mapLatitude"
              label="عرض جغرافیایی"
              help="برای نمایش نقطهٔ نقشه، هر دو مقدار عرض و طول را با هم وارد کنید."
            >
              {({ id, className, describedBy }) => (
                <input
                  id={id}
                  className={className}
                  aria-describedby={describedBy}
                  name="mapLatitude"
                  type="number"
                  dir="ltr"
                  min={-90}
                  max={90}
                  step="any"
                  defaultValue={clinic.mapLatitude ?? ''}
                />
              )}
            </Field>
            <Field id="mapLongitude" label="طول جغرافیایی">
              {({ id, className, describedBy }) => (
                <input
                  id={id}
                  className={className}
                  aria-describedby={describedBy}
                  name="mapLongitude"
                  type="number"
                  dir="ltr"
                  min={-180}
                  max={180}
                  step="any"
                  defaultValue={clinic.mapLongitude ?? ''}
                />
              )}
            </Field>
          </div>
          <Field
            id="instagramUrl"
            label="پیوند اینستاگرام"
            help="نشانی کامل و امن که با https آغاز می‌شود."
          >
            {({ id, className, describedBy }) => (
              <input
                id={id}
                className={className}
                aria-describedby={describedBy}
                name="instagramUrl"
                type="url"
                dir="ltr"
                maxLength={300}
                defaultValue={clinic.instagramUrl ?? ''}
              />
            )}
          </Field>
          <Field
            id="telegramUrl"
            label="پیوند تلگرام"
            help="نشانی کامل و امن که با https آغاز می‌شود."
          >
            {({ id, className, describedBy }) => (
              <input
                id={id}
                className={className}
                aria-describedby={describedBy}
                name="telegramUrl"
                type="url"
                dir="ltr"
                maxLength={300}
                defaultValue={clinic.telegramUrl ?? ''}
              />
            )}
          </Field>
          <FormActions>
            <SubmitButton>ذخیرهٔ مشخصات عمومی</SubmitButton>
          </FormActions>
        </form>
      </Panel>
    </PageShell>
  );
}
