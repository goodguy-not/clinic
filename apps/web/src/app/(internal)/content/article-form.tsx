import type { Article } from '@clinic/contracts';
import {
  Alert,
  Field,
  FormActions,
  PageHeader,
  PageShell,
  Panel,
  SubmitButton,
} from '@/components/ui';

export function ArticleForm({
  article,
  csrfToken,
  errorMessage,
}: {
  article?: Article;
  csrfToken: string;
  errorMessage: string | null;
}) {
  const isEdit = article !== undefined;

  return (
    <PageShell>
      <PageHeader
        title={isEdit ? 'ویرایش پیش‌نویس مطلب' : 'مطلب تازه'}
        description="ذخیره‌کردن این فرم چیزی را منتشر نمی‌کند. انتشار نسخهٔ فعلی فقط با مدیر است."
        backHref="/content"
        backLabel="بازگشت به محتوای وب‌سایت"
      />

      {errorMessage !== null ? <Alert>{errorMessage}</Alert> : null}
      {article?.isPublic ? (
        <Alert tone="info">
          این مطلب اکنون روی سایت عمومی است. تغییرهای این فرم فقط در پیش‌نویس می‌ماند تا مدیر آن‌ها
          را منتشر کند.
        </Alert>
      ) : null}

      <Panel>
        <form
          method="post"
          action={isEdit ? '/api/content/articles/update' : '/api/content/articles/create'}
          className="flex flex-col gap-5"
        >
          <input type="hidden" name="csrfToken" value={csrfToken} />
          {isEdit ? <input type="hidden" name="id" value={article.id} /> : null}

          <Field
            id="publicSlug"
            label="نشانی مطلب"
            help={
              article?.firstPublishedAt
                ? 'نشانی پس از نخستین انتشار تغییر نمی‌کند.'
                : 'فقط حروف کوچک انگلیسی، عدد و خط تیره؛ نمونهٔ آزمایشی: synthetic-guide'
            }
            required
          >
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="publicSlug"
                type="text"
                dir="ltr"
                required
                minLength={2}
                maxLength={80}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                readOnly={
                  article?.firstPublishedAt !== null && article?.firstPublishedAt !== undefined
                }
                defaultValue={article?.publicSlug ?? ''}
                aria-describedby={describedBy}
                className={`${className} text-start`}
              />
            )}
          </Field>

          <Field id="title" label="عنوان" required>
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="title"
                type="text"
                required
                maxLength={200}
                defaultValue={article?.title ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          <Field id="summary" label="خلاصه" help="اختیاری؛ این متن در فهرست مطالب دیده می‌شود.">
            {({ id, className, describedBy }) => (
              <textarea
                id={id}
                name="summary"
                rows={3}
                maxLength={400}
                defaultValue={article?.summary ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>

          <Field
            id="body"
            label="متن مطلب"
            help="متن ساده بنویسید؛ برای جداکردن بندها یک خط خالی بگذارید."
            required
          >
            {({ id, className, describedBy }) => (
              <textarea
                id={id}
                name="body"
                rows={16}
                required
                maxLength={20000}
                defaultValue={article?.body ?? ''}
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
