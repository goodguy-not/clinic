import type { MediaAsset, TherapistProfileCopy, TherapistPublicProfile } from '@clinic/contracts';
import { MediaUploadFraming } from '@/components/media-upload-framing';
import { MediaAltTextEditor } from '@/components/media-alt-text-editor';
import {
  Alert,
  Badge,
  Field,
  FormActions,
  PageHeader,
  PageShell,
  Panel,
  SubmitButton,
} from '@/components/ui';
import { MEDIA_TARGET_SHAPE_PRESETS } from '@/media/framing';

const PORTRAIT_SHAPE = [MEDIA_TARGET_SHAPE_PRESETS.portrait] as const;

export function TherapistProfileEditor({
  copy,
  profile,
  media,
  csrfToken,
  canPublishMedia,
  message,
}: {
  copy: TherapistProfileCopy;
  profile: TherapistPublicProfile | null;
  media: MediaAsset[];
  csrfToken: string;
  canPublishMedia: boolean;
  message: string | null;
}) {
  const canPublish = profile !== null;
  const portraits = media.flatMap((asset) =>
    asset.attachments
      .filter(
        (attachment) =>
          attachment.ownerType === 'THERAPIST_PROFILE' && attachment.ownerId === copy.therapistId,
      )
      .map((attachment) => ({ asset, attachment })),
  );

  return (
    <PageShell wide>
      <PageHeader
        title="معرفی عمومی درمانگر"
        description="نام نمایشی، عنوان و زندگی‌نامه را آماده کنید و نسخهٔ منتشرشده را کنار آن ببینید."
        backHref="/content"
        backLabel="بازگشت"
      />
      <Alert tone="info">
        ذخیرهٔ متن و آماده‌سازی عکس چیزی را عمومی نمی‌کند. نمایش عمومی و انتشار فقط با تصمیم مدیر
        انجام می‌شود.
      </Alert>
      {message !== null ? <Alert tone="info">{message}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        <Badge tone={copy.isPublic ? 'success' : 'neutral'}>
          {copy.isPublic ? 'نسخهٔ منتشرشده' : 'هنوز منتشر نشده'}
        </Badge>
        {copy.hasUnpublishedChanges ? <Badge tone="warning">تغییرات آمادهٔ انتشار</Badge> : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="متن آماده‌شده">
          <form
            method="post"
            action="/api/content/therapist-profiles/update"
            className="flex flex-col gap-5"
          >
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="id" value={copy.therapistId} />
            <Field id="displayName" label="نام نمایشی" help="نامی که خانواده‌ها روی سایت می‌بینند.">
              {({ id, className, describedBy }) => (
                <input
                  id={id}
                  name="displayName"
                  type="text"
                  maxLength={120}
                  defaultValue={copy.displayName ?? ''}
                  aria-describedby={describedBy}
                  className={className}
                />
              )}
            </Field>
            <Field id="title" label="عنوان حرفه‌ای">
              {({ id, className }) => (
                <input
                  id={id}
                  name="title"
                  type="text"
                  maxLength={120}
                  defaultValue={copy.title ?? ''}
                  className={className}
                />
              )}
            </Field>
            <Field id="bio" label="معرفی کوتاه" help="متن ساده و بدون نشانه‌گذاری یا کد.">
              {({ id, className, describedBy }) => (
                <textarea
                  id={id}
                  name="bio"
                  rows={9}
                  maxLength={4000}
                  defaultValue={copy.bio ?? ''}
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

        <Panel title="نسخهٔ منتشرشده">
          {!copy.isPublic ? (
            <p className="text-sm text-slate-600">
              این درمانگر هنوز در وب‌سایت عمومی نمایش داده نمی‌شود.
            </p>
          ) : (
            <dl className="flex flex-col gap-4 text-sm">
              <div>
                <dt className="font-semibold text-slate-700">نام نمایشی</dt>
                <dd className="mt-1 text-slate-900">{copy.publishedDisplayName ?? '—'}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-700">عنوان</dt>
                <dd className="mt-1 text-slate-900">{copy.publishedTitle ?? '—'}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-700">معرفی</dt>
                <dd className="mt-1 whitespace-pre-line leading-7 text-slate-900">
                  {copy.publishedBio ?? '—'}
                </dd>
              </div>
            </dl>
          )}
          {!canPublish ? (
            <p className="border-t border-slate-200 pt-4 text-sm text-slate-600">
              بررسی و انتشار این نمایه با مدیر است.
            </p>
          ) : null}
        </Panel>
      </div>

      <Panel title="عکس چهره">
        <p className="text-sm text-slate-600">
          عکس را در قاب عمودی واقعی تنظیم کنید. نام فایل، اندازه و جزئیات فنی لازم نیست.
        </p>
        <MediaUploadFraming
          csrfToken={csrfToken}
          targetShapes={PORTRAIT_SHAPE}
          attachmentTarget={{
            ownerType: 'THERAPIST_PROFILE',
            ownerId: copy.therapistId,
            position: 0,
          }}
        />
        {portraits.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-slate-200 pt-4">
            <h3 className="font-semibold text-slate-900">عکس‌های وصل‌شده به این نمایه</h3>
            {portraits.map(({ asset, attachment }) => (
              <div
                key={attachment.id}
                className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-slate-900">{asset.altText}</span>
                    <Badge tone={attachment.publishedAt === null ? 'warning' : 'success'}>
                      {attachment.publishedAt === null ? 'عکس آمادهٔ انتشار' : 'عکس منتشرشده'}
                    </Badge>
                  </div>
                  {canPublish ? (
                    <form method="post" action="/api/media/publication">
                      <input type="hidden" name="csrfToken" value={csrfToken} />
                      <input type="hidden" name="attachmentId" value={attachment.id} />
                      <input type="hidden" name="therapistId" value={copy.therapistId} />
                      <input
                        type="hidden"
                        name="isPublished"
                        value={attachment.publishedAt === null ? 'true' : 'false'}
                      />
                      <SubmitButton tone={attachment.publishedAt === null ? 'primary' : 'danger'}>
                        {attachment.publishedAt === null ? 'انتشار عکس' : 'برداشتن عکس از سایت'}
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
                <MediaAltTextEditor
                  asset={asset}
                  csrfToken={csrfToken}
                  canPublishMedia={canPublishMedia}
                  returnTarget={{ type: 'therapist', id: copy.therapistId }}
                  instanceId={attachment.id}
                />
              </div>
            ))}
          </div>
        ) : null}
      </Panel>

      {profile !== null ? (
        <Panel title="تنظیمات و نمایش عمومی — فقط مدیر">
          {profile.firstPublishedAt === null ? (
            <Alert tone="info">
              پیش از نخستین انتشار: نشانی عمومی این صفحه پس از انتشار دائمی می‌شود و دیگر قابل تغییر
              نیست.
            </Alert>
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">نشانی ثابت صفحه</span>
              <span dir="ltr" className="text-start">
                /team/{profile.publicSlug}
              </span>
            </div>
          )}
          <form
            method="post"
            action="/api/content/therapist-profiles/settings"
            className="flex flex-col gap-5"
          >
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="id" value={copy.therapistId} />
            {profile.firstPublishedAt === null ? (
              <Field
                id="publicSlug"
                label="نشانی صفحهٔ عمومی"
                help="فقط حروف انگلیسی کوچک، عدد و خط تیره؛ نمونه: sara-ahmadi"
              >
                {({ id, className, describedBy }) => (
                  <input
                    id={id}
                    name="publicSlug"
                    type="text"
                    dir="ltr"
                    maxLength={80}
                    defaultValue={profile.publicSlug ?? ''}
                    aria-describedby={describedBy}
                    className={`${className} text-start`}
                  />
                )}
              </Field>
            ) : (
              <input type="hidden" name="publicSlug" value={profile.publicSlug ?? ''} />
            )}
            <Field id="displayOrder" label="جایگاه در فهرست درمانگران">
              {({ id, className }) => (
                <input
                  id={id}
                  name="displayOrder"
                  type="number"
                  min={-1000}
                  max={1000}
                  defaultValue={profile.displayOrder}
                  className={className}
                />
              )}
            </Field>
            <FormActions>
              <SubmitButton tone="secondary">ذخیرهٔ تنظیمات</SubmitButton>
            </FormActions>
          </form>
          <div className="border-t border-slate-200 pt-4">
            {!profile.isPublic ? (
              <p className="mb-3 text-sm font-medium text-slate-800">
                فعال‌کردن نمایش عمومی یک تصمیم صریح مدیر است و متن آماده را منتشر می‌کند.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {!profile.isPublic || copy.hasUnpublishedChanges ? (
                <form method="post" action="/api/content/therapist-profiles/visibility">
                  <input type="hidden" name="csrfToken" value={csrfToken} />
                  <input type="hidden" name="id" value={copy.therapistId} />
                  <input type="hidden" name="isPublic" value="true" />
                  <SubmitButton>
                    {copy.hasUnpublishedChanges
                      ? 'تأیید و انتشار تغییرات آماده'
                      : 'تأیید و فعال‌کردن نمایش عمومی'}
                  </SubmitButton>
                </form>
              ) : null}
              {profile.isPublic ? (
                <form method="post" action="/api/content/therapist-profiles/visibility">
                  <input type="hidden" name="csrfToken" value={csrfToken} />
                  <input type="hidden" name="id" value={copy.therapistId} />
                  <input type="hidden" name="isPublic" value="false" />
                  <SubmitButton tone="danger">برداشتن نمایه از سایت</SubmitButton>
                </form>
              ) : null}
            </div>
          </div>
        </Panel>
      ) : null}
    </PageShell>
  );
}
