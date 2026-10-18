import type { CatalogStatus, MediaAsset, ServicePublicCopy } from '@clinic/contracts';
import { PublicationReadiness } from '@/components/publication-readiness';
import {
  Alert,
  Badge,
  ButtonLink,
  Field,
  FormActions,
  PageHeader,
  PageShell,
  Panel,
  SubmitButton,
} from '@/components/ui';
import { imageForService, ServiceImageEditor } from './service-image-editor';

export function ServiceCopyEditor({
  copy,
  csrfToken,
  canPublish,
  canPublishMedia,
  media,
  mediaLoadError,
  message,
  serviceStatus,
}: {
  copy: ServicePublicCopy;
  csrfToken: string;
  canPublish: boolean;
  canPublishMedia: boolean;
  media: readonly MediaAsset[];
  mediaLoadError: string | null;
  message: string | null;
  serviceStatus: CatalogStatus;
}) {
  const image = imageForService(media, copy.serviceId);
  const imageIsPublished =
    image !== null && image.asset.status === 'ACTIVE' && image.attachment.publishedAt !== null;
  const serviceIsReachable = serviceStatus === 'ACTIVE' && copy.isPublic;

  return (
    <PageShell>
      <PageHeader title={`معرفی خدمت «${copy.name}»`} backHref="/content" backLabel="بازگشت" />
      <Alert tone="info">
        متن این صفحه ابتدا آماده می‌شود. ذخیره کردن آن، نسخه‌ای را که بازدیدکننده می‌بیند تغییر
        نمی‌دهد.
      </Alert>
      {message !== null ? <Alert tone="info">{message}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        <Badge tone={copy.publishedDescription === null ? 'neutral' : 'success'}>
          {copy.publishedDescription === null ? 'هنوز منتشر نشده' : 'نسخهٔ منتشرشده'}
        </Badge>
        {copy.hasUnpublishedChanges ? <Badge tone="warning">تغییرات آمادهٔ انتشار</Badge> : null}
      </div>

      {canPublish ? (
        <PublicationReadiness
          items={[
            {
              label: 'فعال‌بودن خدمت',
              ready: serviceStatus === 'ACTIVE',
              detail:
                serviceStatus === 'ACTIVE'
                  ? 'خدمت در فهرست داخلی فعال است.'
                  : 'خدمت غیرفعال است و روی سایت نمایش داده نمی‌شود.',
            },
            {
              label: 'نمایش عمومی خدمت',
              ready: copy.isPublic,
              detail: copy.isPublic
                ? 'خدمت برای نمایش روی سایت علامت خورده است.'
                : 'خدمت در تنظیمات کاتالوگ هنوز عمومی نشده است.',
            },
            {
              label: 'توضیح منتشرشده',
              ready: copy.publishedDescription !== null,
              detail:
                copy.publishedDescription !== null
                  ? 'توضیح فعلی روی سایت منتشر شده است.'
                  : serviceIsReachable
                    ? 'توضیحی منتشر نشده است؛ نام و صفحهٔ خدمت همچنان روی سایت دیده می‌شود.'
                    : 'توضیح عمومی هنوز منتشر نشده است؛ این بخش اختیاری است.',
              optional: true,
            },
            {
              label: 'عکس منتشرشده',
              ready: imageIsPublished,
              detail: imageIsPublished
                ? 'عکس فعال این خدمت منتشر شده است.'
                : 'عکس خدمت هنوز منتشر نشده است؛ صفحه می‌تواند بدون عکس نمایش داده شود.',
              optional: true,
            },
          ]}
        />
      ) : null}

      <Panel title="متن آماده‌شده">
        <form
          method="post"
          action="/api/content/service-copy/update"
          className="flex flex-col gap-5"
        >
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="id" value={copy.serviceId} />
          <Field
            id="description"
            label="توضیح خدمت برای وب‌سایت"
            help="متنی ساده و روشن برای خانواده‌ها؛ بدون نشانه‌گذاری یا کد."
          >
            {({ id, className, describedBy }) => (
              <textarea
                id={id}
                name="description"
                rows={7}
                maxLength={2000}
                defaultValue={copy.description ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>
          <FormActions>
            <SubmitButton>ذخیرهٔ متن آماده</SubmitButton>
          </FormActions>
        </form>
      </Panel>

      <ServiceImageEditor
        copy={copy}
        image={image}
        csrfToken={csrfToken}
        canPublishMedia={canPublishMedia}
        loadError={mediaLoadError}
      />

      <Panel title="نسخهٔ منتشرشده">
        {copy.publishedDescription === null ? (
          <p className="text-sm text-slate-600">هنوز توضیحی از این خدمت منتشر نشده است.</p>
        ) : (
          <p className="whitespace-pre-line text-sm leading-7 text-slate-800">
            {copy.publishedDescription}
          </p>
        )}

        {canPublish ? (
          <div className="flex flex-col gap-4 border-t border-slate-200 pt-4">
            {copy.publicFirstPublishedAt === null ? (
              <Alert tone="info">
                پیش از نخستین انتشار: نشانی عمومی این صفحه پس از انتشار دائمی می‌شود و دیگر قابل
                تغییر نیست.
              </Alert>
            ) : (
              <div className="flex flex-col gap-1 text-sm text-slate-700">
                <span className="font-semibold">نشانی ثابت صفحه</span>
                <span dir="ltr" className="text-start">
                  /services/{copy.publicSlug}
                </span>
              </div>
            )}
            {copy.publicFirstPublishedAt === null ? (
              <ButtonLink href={`/catalog/services/${copy.serviceId}/edit`} tone="secondary">
                تنظیم نشانی و نمایش عمومی خدمت
              </ButtonLink>
            ) : null}
            <form method="post" action="/api/content/service-copy/publication">
              <input type="hidden" name="csrfToken" value={csrfToken} />
              <input type="hidden" name="id" value={copy.serviceId} />
              <input
                type="hidden"
                name="isPublished"
                value={
                  copy.publishedDescription === null || copy.hasUnpublishedChanges
                    ? 'true'
                    : 'false'
                }
              />
              <SubmitButton
                tone={
                  copy.publishedDescription !== null && !copy.hasUnpublishedChanges
                    ? 'danger'
                    : 'primary'
                }
              >
                {copy.hasUnpublishedChanges
                  ? 'انتشار تغییرات آماده'
                  : copy.publishedDescription === null
                    ? 'انتشار متن آماده'
                    : 'برداشتن توضیح منتشرشده'}
              </SubmitButton>
            </form>
          </div>
        ) : (
          <p className="border-t border-slate-200 pt-4 text-sm text-slate-600">
            بررسی و انتشار این متن با مدیر است.
          </p>
        )}
      </Panel>
    </PageShell>
  );
}
