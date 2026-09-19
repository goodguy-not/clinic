import type { Space } from '@clinic/contracts';
import {
  Alert,
  Field,
  FormActions,
  PageHeader,
  PageShell,
  Panel,
  SubmitButton,
} from '@/components/ui';

export function SpaceForm({
  space,
  csrfToken,
  errorMessage,
  successMessage,
  children,
}: {
  space?: Space;
  csrfToken: string;
  errorMessage: string | null;
  successMessage?: string | null;
  children?: React.ReactNode;
}) {
  const isEdit = space !== undefined;

  return (
    <PageShell>
      <PageHeader
        title={isEdit ? 'ویرایش معرفی فضای کلینیک' : 'معرفی فضای تازه'}
        description="نام، توضیح و ترتیب نمایش را آماده کنید. ذخیره‌کردن این فرم چیزی را روی سایت منتشر نمی‌کند."
        backHref="/content/spaces"
        backLabel="بازگشت به معرفی فضاها"
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}
      {successMessage ? <Alert tone="info">{successMessage}</Alert> : null}
      {space?.isPublic ? (
        <Alert tone="info">
          این فضا اکنون روی سایت دیده می‌شود. تغییرهای این فرم تا زمان تأیید مدیر فقط در پیش‌نویس
          می‌ماند.
        </Alert>
      ) : (
        <Alert tone="info">
          این معرفی هنوز روی سایت عمومی دیده نمی‌شود و برای انتشار به تأیید مدیر نیاز دارد.
        </Alert>
      )}

      <Panel title="متن معرفی">
        <form
          method="post"
          action={isEdit ? '/api/content/spaces/update' : '/api/content/spaces/create'}
          className="flex flex-col gap-5"
        >
          <input type="hidden" name="csrfToken" value={csrfToken} />
          {isEdit ? <input type="hidden" name="id" value={space.id} /> : null}

          <Field id="name" label="نامی که خانواده‌ها می‌بینند" required>
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="name"
                type="text"
                required
                maxLength={200}
                defaultValue={space?.name ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          <Field
            id="description"
            label="توضیح کوتاه برای خانواده‌ها"
            help="اختیاری؛ با زبان ساده بگویید مراجعه‌کننده در این فضا چه می‌بیند."
          >
            {({ id, className, describedBy }) => (
              <textarea
                id={id}
                name="description"
                rows={5}
                maxLength={20000}
                defaultValue={space?.description ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          <Field
            id="displayOrder"
            label="جای نمایش در فهرست"
            help="عدد کمتر زودتر نمایش داده می‌شود؛ برای نمونه ۰ پیش از ۱ می‌آید."
            required
          >
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="displayOrder"
                type="number"
                inputMode="numeric"
                min={0}
                max={1000}
                required
                defaultValue={space?.displayOrder ?? 0}
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

      {children}
    </PageShell>
  );
}
