import type { Article } from '@clinic/contracts';
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

export function ArticleForm({
  article,
  csrfToken,
  errorMessage,
  children,
}: {
  article?: Article;
  csrfToken: string;
  errorMessage: string | null;
  children?: ReactNode;
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

          <Alert tone="info">
            {article?.publicSlug
              ? `نشانی ثابت مطلب: /articles/${article.publicSlug}`
              : 'نشانی مطلب هنگام ساخت به‌طور خودکار تعیین می‌شود و تغییر نمی‌کند.'}
          </Alert>

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
      {children}
    </PageShell>
  );
}
