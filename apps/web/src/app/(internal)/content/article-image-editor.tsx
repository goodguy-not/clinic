import type { Article, MediaAsset } from '@clinic/contracts';
import { MediaUploadFraming } from '@/components/media-upload-framing';
import { MediaAltTextEditor } from '@/components/media-alt-text-editor';
import { PublicationReadiness } from '@/components/publication-readiness';
import { Badge, Panel, SubmitButton } from '@/components/ui';
import { cropImageStyle, MEDIA_TARGET_SHAPE_PRESETS } from '@/media/framing';

export type AttachedArticleImage = {
  asset: MediaAsset;
  attachment: MediaAsset['attachments'][number];
};

export function imagesForArticle(
  media: readonly MediaAsset[],
  articleId: string,
): AttachedArticleImage[] {
  return media
    .flatMap((asset) =>
      asset.bytesPurgedAt === null
        ? asset.attachments
            .filter(
              (attachment) =>
                attachment.ownerType === 'PUBLIC_ARTICLE' && attachment.ownerId === articleId,
            )
            .map((attachment) => ({ asset, attachment }))
        : [],
    )
    .sort(
      (left, right) =>
        left.attachment.position - right.attachment.position ||
        left.attachment.attachedAt.localeCompare(right.attachment.attachedAt),
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

export function ArticleImageEditor({
  article,
  images,
  csrfToken,
  canPublishMedia,
  canPublishArticle,
}: {
  article: Article;
  images: readonly AttachedArticleImage[];
  csrfToken: string;
  canPublishMedia: boolean;
  canPublishArticle: boolean;
}) {
  const heroIsPublished = images.some(
    ({ asset, attachment }) =>
      asset.status === 'ACTIVE' && attachment.position === 0 && attachment.publishedAt !== null,
  );

  return (
    <>
      {canPublishArticle ? (
        <PublicationReadiness
          items={[
            {
              label: 'انتشار مطلب',
              ready: article.isPublic,
              detail: article.isPublic
                ? article.hasUnpublishedChanges
                  ? 'نسخهٔ قبلی روی سایت است و تغییرهای تازه هنوز منتشر نشده‌اند.'
                  : 'نسخهٔ فعلی مطلب روی سایت است.'
                : 'این مطلب هنوز فقط پیش‌نویس است.',
            },
            {
              label: 'عکس اصلی و تصویر اشتراک‌گذاری',
              ready: heroIsPublished,
              detail: heroIsPublished
                ? 'اولین عکس فعال منتشر شده و تصویر اشتراک‌گذاری همین مطلب است.'
                : 'عکس اصلی هنوز منتشر نشده است؛ مطلب می‌تواند بدون تصویر منتشر شود.',
              optional: true,
            },
          ]}
        />
      ) : null}
      <Panel title="عکس‌های این مطلب">
        <p className="text-sm leading-6 text-slate-600">
          عکس و قاب آن را اینجا آماده کنید. عکس اصلی در کارت معرفی مطلب ایستاده‌تر و در صفحهٔ مطلب
          پهن‌تر دیده می‌شود؛ نوشته یا سوژهٔ مهم را نزدیک مرکز نگه دارید. ذخیرهٔ عکس چیزی را روی
          سایت نشان نمی‌دهد و انتشار آن فقط پس از بررسی مدیر انجام می‌شود.
        </p>
        <MediaUploadFraming
          csrfToken={csrfToken}
          targetShapes={[MEDIA_TARGET_SHAPE_PRESETS.landscape, MEDIA_TARGET_SHAPE_PRESETS.wide]}
          attachmentTarget={{
            ownerType: 'PUBLIC_ARTICLE',
            ownerId: article.id,
            position: images.length,
          }}
        />

        {images.length === 0 ? (
          <p className="border-t border-slate-200 pt-4 text-sm text-slate-600">
            هنوز عکسی برای این مطلب آماده نشده است.
          </p>
        ) : (
          <div className="flex flex-col gap-4 border-t border-slate-200 pt-4">
            <div>
              <h3 className="font-semibold text-slate-900">عکس‌های آماده‌شده</h3>
              <p className="mt-1 text-sm text-slate-600">
                این پیش‌نمایش ذخیره‌شده فقط برای همکاران مجاز درمانگاه دیده می‌شود.
              </p>
            </div>
            {images.map(({ asset, attachment }, index) => {
              const rendition = previewRendition(asset);
              return (
                <article
                  key={attachment.id}
                  className="grid gap-4 rounded-xl border border-slate-200 p-3 md:grid-cols-[minmax(0,20rem)_1fr] md:items-center"
                >
                  <div
                    className="relative aspect-video overflow-hidden rounded-lg bg-slate-100"
                    aria-label={`پیش‌نمایش ذخیره‌شدهٔ عکس ${index + 1}`}
                  >
                    {rendition === undefined ? (
                      <span className="flex size-full items-center justify-center px-4 text-center text-sm text-slate-600">
                        پیش‌نمایش این عکس آماده نیست.
                      </span>
                    ) : (
                      // The same-origin handler re-authorises every byte request
                      // and cannot fall back to the public rendition route.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/media/renditions/${rendition.id}/preview`}
                        alt={asset.altText ?? ''}
                        width={rendition.width}
                        height={rendition.height}
                        loading="lazy"
                        style={cropImageStyle(attachment.framing)}
                      />
                    )}
                  </div>

                  <div className="flex flex-col gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        عکس {index + 1}: {asset.altText}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge tone={attachment.publishedAt === null ? 'warning' : 'success'}>
                          {attachment.publishedAt === null
                            ? 'آماده؛ در انتظار انتشار مدیر'
                            : 'عکس منتشرشده'}
                        </Badge>
                        {attachment.publishedAt !== null && !article.isPublic ? (
                          <Badge tone="neutral">تا انتشار مطلب برای بازدیدکننده دیده نمی‌شود</Badge>
                        ) : null}
                      </div>
                    </div>

                    <MediaAltTextEditor
                      asset={asset}
                      csrfToken={csrfToken}
                      canPublishMedia={canPublishMedia}
                      returnTarget={{ type: 'article', id: article.id }}
                      instanceId={attachment.id}
                    />

                    {canPublishMedia ? (
                      <form method="post" action="/api/media/publication">
                        <input type="hidden" name="csrfToken" value={csrfToken} />
                        <input type="hidden" name="attachmentId" value={attachment.id} />
                        <input type="hidden" name="articleId" value={article.id} />
                        <input
                          type="hidden"
                          name="isPublished"
                          value={attachment.publishedAt === null ? 'true' : 'false'}
                        />
                        <SubmitButton tone={attachment.publishedAt === null ? 'primary' : 'danger'}>
                          {attachment.publishedAt === null
                            ? 'انتشار عکس پس از بررسی'
                            : 'برداشتن عکس از سایت'}
                        </SubmitButton>
                      </form>
                    ) : (
                      <p className="text-sm text-slate-600">
                        این عکس هنوز عمومی نیست و برای بررسی و انتشار مدیر آماده شده است.
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </>
  );
}
