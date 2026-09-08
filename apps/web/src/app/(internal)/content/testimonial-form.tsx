import type { Testimonial } from '@clinic/contracts';
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
}: {
  testimonial?: Testimonial;
  csrfToken: string;
  errorMessage: string | null;
}) {
  const isEdit = testimonial !== undefined;

  return (
    <PageShell>
      <PageHeader
        title={isEdit ? 'ویرایش پیش‌نویس نقل‌قول' : 'نقل‌قول تازه'}
        description="فقط متن بی‌نام و آمادهٔ بررسی را وارد کنید. تأیید حریم خصوصی و انتشار با مدیر است."
        backHref="/content"
        backLabel="بازگشت به محتوای وب‌سایت"
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}

      <Panel>
        <form
          method="post"
          action={isEdit ? '/api/content/testimonials/update' : '/api/content/testimonials/create'}
          className="flex flex-col gap-5"
        >
          <input type="hidden" name="csrfToken" value={csrfToken} />
          {isEdit ? <input type="hidden" name="id" value={testimonial.id} /> : null}

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
                defaultValue={testimonial?.authorLabel ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          <Field
            id="body"
            label="متن نقل‌قول"
            help="متن ساده و بدون نام یا اطلاعات قابل شناسایی."
            required
          >
            {({ id, className, describedBy }) => (
              <textarea
                id={id}
                name="body"
                rows={9}
                required
                maxLength={20000}
                defaultValue={testimonial?.body ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          <FormActions>
            <SubmitButton>{isEdit ? 'ذخیرهٔ پیش‌نویس' : 'ساخت پیش‌نویس'}</SubmitButton>
          </FormActions>
        </form>
      </Panel>
    </PageShell>
  );
}
