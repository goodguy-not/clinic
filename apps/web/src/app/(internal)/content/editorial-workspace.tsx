import type { Article, Testimonial, TestimonialConsentWithdrawal } from '@clinic/contracts';
import {
  Alert,
  Badge,
  ButtonLink,
  EmptyState,
  PageHeader,
  PageShell,
  Panel,
  RecordItem,
  RecordList,
  SubmitButton,
} from '@/components/ui';
import { formatContentDate, TESTIMONIAL_STATUS_LABEL } from './presentation';
import { ConsentWithdrawalForm } from './consent-withdrawal-form';

type WorkspaceProps = {
  articles: Article[];
  testimonials: Testimonial[];
  withdrawals?: TestimonialConsentWithdrawal[];
  csrfToken: string;
  errorMessage: string | null;
  successMessage: string | null;
  canDraftArticles: boolean;
  canPublishArticles: boolean;
  canDraftTestimonials: boolean;
  canApproveTestimonials: boolean;
};

export function EditorialWorkspace(props: WorkspaceProps) {
  const managerAuthority = props.canPublishArticles && props.canApproveTestimonials;

  return (
    <PageShell wide>
      <PageHeader
        title="محتوای وب‌سایت"
        description="پیش‌نویس مطالب و نقل‌قول‌ها را اینجا آماده و وضعیت انتشار را بررسی کنید."
      />

      <Alert tone="info">
        {managerAuthority
          ? 'در نقش مدیر، کنترل‌های بررسی، انتشار و برداشتن از سایت در دسترس شماست.'
          : 'ذخیرهٔ پیش‌نویس چیزی را عمومی نمی‌کند. بررسی حریم خصوصی و انتشار فقط با مدیر است.'}
      </Alert>
      {props.errorMessage !== null ? <Alert>{props.errorMessage}</Alert> : null}
      {props.successMessage !== null ? <Alert tone="info">{props.successMessage}</Alert> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel>
          <section aria-labelledby="articles-heading" className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 id="articles-heading" className="text-lg font-bold text-slate-900">
                  مطالب
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  نسخهٔ پیش‌نویس از نسخه‌ای که بازدیدکننده می‌بیند جداست.
                </p>
              </div>
              {props.canDraftArticles ? (
                <ButtonLink href="/content/articles/new">مطلب تازه</ButtonLink>
              ) : null}
            </div>

            {props.articles.length === 0 ? (
              <EmptyState
                message="هنوز مطلبی ثبت نشده است."
                action={
                  props.canDraftArticles ? (
                    <ButtonLink href="/content/articles/new">ساخت پیش‌نویس</ButtonLink>
                  ) : undefined
                }
              />
            ) : (
              <RecordList>
                {props.articles.map((article) => (
                  <RecordItem
                    key={article.id}
                    title={article.title}
                    badge={
                      <>
                        <Badge tone={article.isPublic ? 'success' : 'neutral'}>
                          {article.isPublic ? 'منتشرشده' : 'پیش‌نویس؛ منتشر نشده'}
                        </Badge>
                        {article.hasUnpublishedChanges ? (
                          <Badge tone="warning">تغییرات منتشرنشده</Badge>
                        ) : null}
                      </>
                    }
                    details={
                      <>
                        <span dir="ltr" className="text-start">
                          /articles/{article.publicSlug}
                        </span>
                        <span>
                          {article.hasUnpublishedChanges
                            ? 'سایت اکنون نسخهٔ پیشین را نشان می‌دهد.'
                            : article.isPublic
                              ? article.publicRevisedAt === null
                                ? 'نسخهٔ عمومی به‌روز است.'
                                : `نسخهٔ عمومی به‌روز است · ${formatContentDate(article.publicRevisedAt)}`
                              : 'در سایت عمومی دیده نمی‌شود.'}
                        </span>
                        {article.summary !== null ? (
                          <span className="line-clamp-2">{article.summary}</span>
                        ) : null}
                      </>
                    }
                    actions={
                      <>
                        {props.canDraftArticles ? (
                          <ButtonLink
                            href={`/content/articles/${article.id}/edit`}
                            tone="secondary"
                          >
                            ویرایش پیش‌نویس
                          </ButtonLink>
                        ) : null}
                        {props.canPublishArticles ? (
                          <>
                            {!article.isPublic || article.hasUnpublishedChanges ? (
                              <form method="post" action="/api/content/articles/publication">
                                <input type="hidden" name="csrfToken" value={props.csrfToken} />
                                <input type="hidden" name="id" value={article.id} />
                                <input type="hidden" name="isPublic" value="true" />
                                <SubmitButton>
                                  {article.hasUnpublishedChanges ? 'انتشار تغییرات' : 'انتشار مطلب'}
                                </SubmitButton>
                              </form>
                            ) : null}
                            {article.isPublic ? (
                              <form method="post" action="/api/content/articles/publication">
                                <input type="hidden" name="csrfToken" value={props.csrfToken} />
                                <input type="hidden" name="id" value={article.id} />
                                <input type="hidden" name="isPublic" value="false" />
                                <SubmitButton tone="danger">برداشتن از سایت</SubmitButton>
                              </form>
                            ) : null}
                          </>
                        ) : null}
                      </>
                    }
                  />
                ))}
              </RecordList>
            )}
          </section>
        </Panel>

        <Panel>
          <section aria-labelledby="testimonials-heading" className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 id="testimonials-heading" className="text-lg font-bold text-slate-900">
                  نقل‌قول‌ها
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  تأیید حریم خصوصی و قرارگرفتن روی سایت دو وضعیت جدا هستند.
                </p>
              </div>
              {props.canDraftTestimonials ? (
                <ButtonLink href="/content/testimonials/new">نقل‌قول تازه</ButtonLink>
              ) : null}
            </div>

            {props.testimonials.length === 0 ? (
              <EmptyState
                message="هنوز نقل‌قولی ثبت نشده است."
                action={
                  props.canDraftTestimonials ? (
                    <ButtonLink href="/content/testimonials/new">ساخت پیش‌نویس</ButtonLink>
                  ) : undefined
                }
              />
            ) : (
              <RecordList>
                {props.testimonials.map((testimonial) => (
                  <RecordItem
                    key={testimonial.id}
                    title={testimonial.authorLabel ?? 'بدون عنوان گوینده'}
                    badge={
                      <>
                        <Badge tone={testimonial.status === 'APPROVED' ? 'success' : 'warning'}>
                          {TESTIMONIAL_STATUS_LABEL[testimonial.status]}
                        </Badge>
                        <Badge tone={testimonial.isPublic ? 'success' : 'neutral'}>
                          {testimonial.isPublic ? 'روی سایت' : 'روی سایت نیست'}
                        </Badge>
                      </>
                    }
                    details={
                      <span className="line-clamp-3 whitespace-pre-line">{testimonial.body}</span>
                    }
                    actions={
                      <>
                        {props.canDraftTestimonials && testimonial.status === 'DRAFT' ? (
                          <ButtonLink
                            href={`/content/testimonials/${testimonial.id}/edit`}
                            tone="secondary"
                          >
                            ویرایش پیش‌نویس
                          </ButtonLink>
                        ) : null}
                        {props.canApproveTestimonials ? (
                          <>
                            <form method="post" action="/api/content/testimonials/approval">
                              <input type="hidden" name="csrfToken" value={props.csrfToken} />
                              <input type="hidden" name="id" value={testimonial.id} />
                              <input
                                type="hidden"
                                name="approved"
                                value={testimonial.status === 'APPROVED' ? 'false' : 'true'}
                              />
                              <SubmitButton
                                tone={testimonial.status === 'APPROVED' ? 'danger' : 'primary'}
                              >
                                {testimonial.status === 'APPROVED'
                                  ? 'برداشتن تأیید'
                                  : 'تأیید پس از بررسی'}
                              </SubmitButton>
                            </form>
                            {testimonial.status === 'APPROVED' ? (
                              <form method="post" action="/api/content/testimonials/publication">
                                <input type="hidden" name="csrfToken" value={props.csrfToken} />
                                <input type="hidden" name="id" value={testimonial.id} />
                                <input
                                  type="hidden"
                                  name="isPublic"
                                  value={testimonial.isPublic ? 'false' : 'true'}
                                />
                                <SubmitButton tone={testimonial.isPublic ? 'danger' : 'secondary'}>
                                  {testimonial.isPublic ? 'برداشتن از سایت' : 'قرار دادن روی سایت'}
                                </SubmitButton>
                              </form>
                            ) : null}
                            <ConsentWithdrawalForm
                              id={testimonial.id}
                              csrfToken={props.csrfToken}
                            />
                          </>
                        ) : null}
                      </>
                    }
                  />
                ))}
              </RecordList>
            )}
            {props.canApproveTestimonials && (props.withdrawals?.length ?? 0) > 0 ? (
              <section aria-label="سوابق پس‌گرفتن رضایت" className="border-t border-slate-200 pt-4">
                <h3 className="font-semibold text-slate-900">سوابق پس‌گرفتن رضایت</h3>
                <p className="mt-1 text-sm text-slate-600">
                  متن، نام یا عنوان گوینده و عکس‌های وصل‌شده معمولاً همان شب و در هر صورت حداکثر تا
                  ۷ روز پس از ثبت پس‌گرفتن رضایت برای همیشه پاک می‌شوند.
                </p>
                <ul className="mt-2 list-disc space-y-1 pe-5 text-sm text-slate-700">
                  {props.withdrawals?.map((record) => (
                    <li key={record.id}>
                      رضایت در {formatContentDate(record.consentWithdrawnAt)} پس گرفته شد؛{' '}
                      {record.contentErasedAt === null
                        ? `در انتظار پاک‌سازی؛ حداکثر تا ${formatContentDate(record.erasureDueBy)}`
                        : `پاک‌شده در ${formatContentDate(record.contentErasedAt)}`}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </section>
        </Panel>
      </div>
    </PageShell>
  );
}
