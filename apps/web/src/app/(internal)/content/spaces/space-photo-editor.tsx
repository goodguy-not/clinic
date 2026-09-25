import type { MediaAsset, Space } from '@clinic/contracts';
import { MediaUploadFraming } from '@/components/media-upload-framing';
import { MediaAltTextEditor } from '@/components/media-alt-text-editor';
import { Badge, Panel, SubmitButton } from '@/components/ui';
import { PublicationReadiness } from '@/components/publication-readiness';
import { MEDIA_TARGET_SHAPE_PRESETS } from '@/media/framing';

type AttachedPhoto = {
  asset: MediaAsset;
  attachment: MediaAsset['attachments'][number];
};

export function photosForSpace(media: readonly MediaAsset[], spaceId: string): AttachedPhoto[] {
  return media
    .flatMap((asset) =>
      asset.attachments
        .filter(
          (attachment) => attachment.ownerType === 'PUBLIC_SPACE' && attachment.ownerId === spaceId,
        )
        .map((attachment) => ({ asset, attachment })),
    )
    .sort(
      (left, right) =>
        left.attachment.position - right.attachment.position ||
        left.attachment.attachedAt.localeCompare(right.attachment.attachedAt),
    );
}

export function SpacePhotoEditor({
  space,
  photos,
  csrfToken,
  canPublishMedia,
  canPublishSpace,
}: {
  space: Space;
  photos: readonly AttachedPhoto[];
  csrfToken: string;
  canPublishMedia: boolean;
  canPublishSpace: boolean;
}) {
  const roles = [
    {
      position: 0,
      title: 'عکس اصلی پهن',
      guide: 'نمای کلی فضا؛ برای قاب پهن ۱۶:۹ عکس بگیرید و سوژهٔ اصلی را نزدیک مرکز نگه دارید.',
      shape: MEDIA_TARGET_SHAPE_PRESETS.wide,
    },
    {
      position: 1,
      title: 'عکس جزئیات نزدیک',
      guide: 'یک جزئیات نزدیک و قابل فهم از فضا؛ برای قاب افقی ۳:۲ عکس بگیرید.',
      shape: MEDIA_TARGET_SHAPE_PRESETS.landscape,
    },
  ] as const;
  const publishedAtPosition = (position: number) =>
    photos.some(
      ({ asset, attachment }) =>
        asset.status === 'ACTIVE' &&
        attachment.position === position &&
        attachment.publishedAt !== null,
    );

  return (
    <>
      {canPublishSpace ? (
        <PublicationReadiness
          items={[
            {
              label: 'انتشار متن فضا',
              ready: space.isPublic,
              detail: space.isPublic
                ? 'این فضا اکنون در پاسخ عمومی سایت قرار دارد.'
                : 'مدیر هنوز این فضا را روی سایت قرار نداده است.',
            },
            {
              label: 'عکس اصلی پهن',
              ready: publishedAtPosition(0),
              detail: publishedAtPosition(0)
                ? 'عکس اصلی تأیید و منتشر شده است.'
                : 'عکس اصلی هنوز منتشر نشده است؛ فضا می‌تواند بدون این عکس منتشر شود.',
              optional: true,
            },
            {
              label: 'عکس جزئیات نزدیک',
              ready: publishedAtPosition(1),
              detail: publishedAtPosition(1)
                ? 'عکس جزئیات تأیید و منتشر شده است.'
                : 'عکس جزئیات هنوز منتشر نشده است؛ این عکس اختیاری است.',
              optional: true,
            },
          ]}
        />
      ) : null}
      <Panel title="عکس‌های این فضا">
        <p className="text-sm leading-6 text-slate-600">
          عکس روشن و واضحی از خود فضا انتخاب کنید؛ بهتر است فرد یا نوشتهٔ قابل شناسایی در تصویر
          نباشد. دو جایگاه زیر کاربرد و شکل متفاوت دارند.
        </p>
        {roles.map((role) => {
          const present = photos.some(({ attachment }) => attachment.position === role.position);
          return (
            <section
              key={role.position}
              className="flex flex-col gap-4 rounded-xl border border-slate-200 p-4"
            >
              <div>
                <h3 className="font-bold text-slate-900">{role.title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{role.guide}</p>
              </div>
              {present ? (
                <p className="text-sm font-medium text-emerald-800">
                  عکس این جایگاه آماده شده است؛ وضعیت انتشار آن را پایین‌تر می‌بینید.
                </p>
              ) : (
                <MediaUploadFraming
                  csrfToken={csrfToken}
                  targetShapes={[role.shape]}
                  attachmentTarget={{
                    ownerType: 'PUBLIC_SPACE',
                    ownerId: space.id,
                    position: role.position,
                  }}
                />
              )}
            </section>
          );
        })}

        {photos.length === 0 ? (
          <p className="border-t border-slate-200 pt-4 text-sm text-slate-600">
            هنوز عکسی برای این فضا آماده نشده است.
          </p>
        ) : (
          <div className="flex flex-col gap-3 border-t border-slate-200 pt-4">
            <h3 className="font-semibold text-slate-900">عکس‌های آماده‌شده</h3>
            {photos.map(({ asset, attachment }) => (
              <div
                key={attachment.id}
                className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-slate-900">
                      {roles.find((role) => role.position === attachment.position)?.title ??
                        `عکس اضافه ${attachment.position + 1}`}
                      : {asset.altText}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <Badge tone={attachment.publishedAt === null ? 'warning' : 'success'}>
                        {attachment.publishedAt === null
                          ? 'آماده؛ هنوز منتشر نشده'
                          : 'عکس تأیید شده'}
                      </Badge>
                      {attachment.publishedAt !== null && !space.isPublic ? (
                        <Badge tone="neutral">تا انتشار فضا قابل مشاهده نیست</Badge>
                      ) : null}
                    </div>
                  </div>
                  {canPublishMedia ? (
                    <form method="post" action="/api/media/publication">
                      <input type="hidden" name="csrfToken" value={csrfToken} />
                      <input type="hidden" name="attachmentId" value={attachment.id} />
                      <input type="hidden" name="spaceId" value={space.id} />
                      <input
                        type="hidden"
                        name="isPublished"
                        value={attachment.publishedAt === null ? 'true' : 'false'}
                      />
                      <SubmitButton tone={attachment.publishedAt === null ? 'primary' : 'danger'}>
                        {attachment.publishedAt === null
                          ? 'تأیید عکس برای سایت'
                          : 'برداشتن عکس از سایت'}
                      </SubmitButton>
                    </form>
                  ) : null}
                </div>
                <MediaAltTextEditor
                  asset={asset}
                  csrfToken={csrfToken}
                  canPublishMedia={canPublishMedia}
                  returnTarget={{ type: 'space', id: space.id }}
                  instanceId={attachment.id}
                />
              </div>
            ))}
          </div>
        )}
      </Panel>

      {canPublishSpace ? (
        <Panel title="نمایش در سایت">
          <p className="text-sm leading-6 text-slate-600">
            {space.isPublic
              ? space.hasUnpublishedChanges
                ? 'نسخهٔ پیشین اکنون روی سایت است. با انتشار تغییرات، متن و جای نمایش تازه جایگزین آن می‌شود.'
                : 'این فضا اکنون روی سایت عمومی دیده می‌شود.'
              : 'پس از بررسی متن و تأیید عکس‌های لازم، این فضا را روی سایت قرار دهید.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {!space.isPublic || space.hasUnpublishedChanges ? (
              <form method="post" action="/api/content/spaces/publication">
                <input type="hidden" name="csrfToken" value={csrfToken} />
                <input type="hidden" name="id" value={space.id} />
                <input type="hidden" name="isPublic" value="true" />
                <input type="hidden" name="returnToEdit" value="true" />
                <SubmitButton>
                  {space.hasUnpublishedChanges ? 'انتشار تغییرات' : 'قرار دادن فضا روی سایت'}
                </SubmitButton>
              </form>
            ) : null}
            {space.isPublic ? (
              <form method="post" action="/api/content/spaces/publication">
                <input type="hidden" name="csrfToken" value={csrfToken} />
                <input type="hidden" name="id" value={space.id} />
                <input type="hidden" name="isPublic" value="false" />
                <input type="hidden" name="returnToEdit" value="true" />
                <SubmitButton tone="danger">برداشتن فضا از سایت</SubmitButton>
              </form>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </>
  );
}
