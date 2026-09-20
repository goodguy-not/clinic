import type { MediaAsset, ServicePublicCopy } from '@clinic/contracts';
import { MediaUploadFraming } from '@/components/media-upload-framing';
import { Alert, Badge, Panel, SubmitButton } from '@/components/ui';
import { cropImageStyle, MEDIA_TARGET_SHAPE_PRESETS } from '@/media/framing';

export type AttachedServiceImage = {
  asset: MediaAsset;
  attachment: MediaAsset['attachments'][number];
};

export function imageForService(
  media: readonly MediaAsset[],
  serviceId: string,
): AttachedServiceImage | null {
  return (
    media
      .flatMap((asset) =>
        asset.attachments
          .filter(
            (attachment) =>
              attachment.ownerType === 'PUBLIC_SERVICE' && attachment.ownerId === serviceId,
          )
          .map((attachment) => ({ asset, attachment })),
      )
      .sort(
        (left, right) =>
          left.attachment.position - right.attachment.position ||
          left.attachment.attachedAt.localeCompare(right.attachment.attachedAt),
      )[0] ?? null
  );
}

function previewRendition(asset: MediaAsset) {
  return (
    asset.renditions
      .filter((rendition) => rendition.format === 'webp')
      .sort((left, right) => right.width - left.width)[0] ??
    [...asset.renditions].sort((left, right) => right.width - left.width)[0]
  );
}

export function ServiceImageEditor({
  copy,
  image,
  csrfToken,
  canPublishMedia,
  loadError,
}: {
  copy: ServicePublicCopy;
  image: AttachedServiceImage | null;
  csrfToken: string;
  canPublishMedia: boolean;
  loadError: string | null;
}) {
  const rendition = image === null ? undefined : previewRendition(image.asset);

  return (
    <Panel title="عکس این خدمت">
      <p className="text-sm leading-6 text-slate-600">
        یک عکس روشن و مرتبط با خود خدمت انتخاب کنید، بخش مهم آن را داخل قاب نگه دارید و برای کسانی
        که عکس را نمی‌بینند توضیح روشنی بنویسید. ذخیرهٔ عکس آن را روی سایت منتشر نمی‌کند.
      </p>

      {loadError !== null ? (
        <Alert>{loadError}</Alert>
      ) : image === null ? (
        <MediaUploadFraming
          csrfToken={csrfToken}
          targetShapes={[MEDIA_TARGET_SHAPE_PRESETS.landscape, MEDIA_TARGET_SHAPE_PRESETS.wide]}
          attachmentTarget={{
            ownerType: 'PUBLIC_SERVICE',
            ownerId: copy.serviceId,
            position: 0,
          }}
        />
      ) : (
        <div className="grid gap-4 border-t border-slate-200 pt-4 md:grid-cols-[minmax(0,20rem)_1fr] md:items-center">
          <div
            className="relative aspect-[3/2] overflow-hidden rounded-lg bg-slate-100"
            aria-label="پیش‌نمایش ذخیره‌شدهٔ عکس خدمت"
          >
            {rendition === undefined ? (
              <span className="flex size-full items-center justify-center px-4 text-center text-sm text-slate-600">
                پیش‌نمایش این عکس آماده نیست.
              </span>
            ) : (
              // The same-origin handler authorises these private bytes on every request.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/media/renditions/${rendition.id}/preview`}
                alt={image.asset.altText}
                width={rendition.width}
                height={rendition.height}
                loading="lazy"
                style={cropImageStyle(image.attachment.framing)}
              />
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">{image.asset.altText}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone={image.attachment.publishedAt === null ? 'warning' : 'success'}>
                  {image.attachment.publishedAt === null
                    ? 'آماده؛ در انتظار انتشار مدیر'
                    : 'عکس منتشرشده'}
                </Badge>
                {image.attachment.publishedAt !== null && !copy.isPublic ? (
                  <Badge tone="neutral">تا نمایش عمومی خدمت برای بازدیدکننده دیده نمی‌شود</Badge>
                ) : null}
              </div>
            </div>

            {canPublishMedia ? (
              <form method="post" action="/api/media/publication">
                <input type="hidden" name="csrfToken" value={csrfToken} />
                <input type="hidden" name="attachmentId" value={image.attachment.id} />
                <input type="hidden" name="serviceId" value={copy.serviceId} />
                <input
                  type="hidden"
                  name="isPublished"
                  value={image.attachment.publishedAt === null ? 'true' : 'false'}
                />
                <SubmitButton tone={image.attachment.publishedAt === null ? 'primary' : 'danger'}>
                  {image.attachment.publishedAt === null
                    ? 'انتشار عکس پس از بررسی'
                    : 'برداشتن عکس از سایت'}
                </SubmitButton>
              </form>
            ) : (
              <p className="text-sm text-slate-600">
                {image.attachment.publishedAt === null
                  ? 'عکس و قاب آن ذخیره شده و برای بررسی و انتشار مدیر آماده است.'
                  : 'این عکس اکنون منتشر است؛ برداشتن آن از سایت فقط با مدیر است.'}
              </p>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
