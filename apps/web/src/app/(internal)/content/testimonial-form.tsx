import type { Testimonial } from '@clinic/contracts';
import type { ReactNode } from 'react';
import {
  Alert,
  Field,
  FormActions,
  PageHeader,
  PageShell,
  Panel,
  SubmitButton,
} from '@/components/ui';

export function TestimonialForm({
  testimonial,
  csrfToken,
  errorMessage,
  successMessage,
  children,
}: {
  testimonial?: Testimonial;
  csrfToken: string;
  errorMessage: string | null;
  successMessage?: string | null;
  children?: ReactNode;
}) {
  const isEdit = testimonial !== undefined;
  const isApproved = testimonial?.status === 'APPROVED';

  return (
    <PageShell>
      <PageHeader
        title={
          isApproved ? 'بررسی نقل‌قول تأییدشده' : isEdit ? 'آماده‌سازی نقل‌قول' : 'نقل‌قول تازه'
        }
        description="رونویسی خوانا و بی‌نام را وارد کنید. بررسی حریم خصوصی و انتشار فقط با مدیر است."
        backHref="/content"
        backLabel="بازگشت به محتوای وب‌سایت"
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}
      {successMessage ? <Alert tone="info">{successMessage}</Alert> : null}
      <Alert tone="info">
        {isApproved
          ? 'این متن بررسی و تأیید شده است. برای تغییر آن، مدیر باید ابتدا تأیید را بردارد.'
          : 'این نقل‌قول هنوز پیش‌نویس است و در سایت عمومی دیده نمی‌شود.'}
      </Alert>

      <Panel title="متن قابل خواندن برای بازدیدکنندگان">
        <form
          method="post"
          action={isEdit ? '/api/content/testimonials/update' : '/api/content/testimonials/create'}
          className="flex flex-col gap-5"
        >
          <input type="hidden" name="csrfToken" value={csrfToken} />
          {isEdit ? <input type="hidden" name="id" value={testimonial.id} /> : null}

          <fieldset className="flex flex-col gap-3 border-0 p-0" disabled={isApproved}>
            <legend className="text-sm font-semibold text-slate-900">نوع نقل‌قول</legend>
            <p className="text-sm leading-6 text-slate-600">
              برای عکسِ یادداشت، «دست‌نویس» را انتخاب کنید. متن تایپ‌شدهٔ پایین باید همان نوشته را
              بازگو کند و متن اصلی سایت خواهد بود.
            </p>
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-800">
                <input
                  type="radio"
                  name="kind"
                  value="TYPED"
                  defaultChecked={(testimonial?.kind ?? 'TYPED') === 'TYPED'}
                />
                تایپ‌شده
              </label>
              <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-800">
                <input
                  type="radio"
                  name="kind"
                  value="HANDWRITTEN"
                  defaultChecked={testimonial?.kind === 'HANDWRITTEN'}
                />
                دست‌نویس
              </label>
            </div>
          </fieldset>

          <Field
            id="authorLabel"
            label="عنوان گوینده"
            help="اختیاری و کلی؛ نام یا اطلاعات شناسایی وارد نکنید."
          >
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="authorLabel"
                type="text"
                maxLength={200}
                readOnly={isApproved}
                defaultValue={testimonial?.authorLabel ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          <Field
            id="body"
            label="رونویسی / متن نقل‌قول"
            help="این متن را انسان از روی یادداشت می‌خواند و تایپ می‌کند. باید با دست‌نوشته یکسان، خوانا و بدون اطلاعات شناسایی یا درمانی باشد."
            required
          >
            {({ id, className, describedBy }) => (
              <textarea
                id={id}
                name="body"
                rows={9}
                required
                maxLength={20000}
                readOnly={isApproved}
                defaultValue={testimonial?.body ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          {!isApproved ? (
            <FormActions>
              <SubmitButton>{isEdit ? 'ذخیرهٔ رونویسی' : 'ساخت پیش‌نویس و ادامه'}</SubmitButton>
            </FormActions>
          ) : null}
        </form>
      </Panel>
      {children}
    </PageShell>
  );
}
