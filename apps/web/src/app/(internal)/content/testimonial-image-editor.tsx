import type { MediaAsset, Testimonial } from '@clinic/contracts';
import { MediaUploadFraming } from '@/components/media-upload-framing';
import { Badge, Panel, SubmitButton } from '@/components/ui';
import { cropImageStyle, MEDIA_TARGET_SHAPE_PRESETS } from '@/media/framing';

export type AttachedTestimonialImage = {
  asset: MediaAsset;
  attachment: MediaAsset['attachments'][number];
};

export function imagesForTestimonial(
  media: readonly MediaAsset[],
  testimonialId: string,
): AttachedTestimonialImage[] {
  return media
    .flatMap((asset) =>
      asset.attachments
        .filter(
          (attachment) =>
            attachment.ownerType === 'PUBLIC_TESTIMONIAL' && attachment.ownerId === testimonialId,
        )
        .map((attachment) => ({ asset, attachment })),
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

export function TestimonialImageEditor({
  testimonial,
  images,
  csrfToken,
  canApprove,
  canPublishMedia,
}: {
  testimonial: Testimonial;
  images: readonly AttachedTestimonialImage[];
  csrfToken: string;
  canApprove: boolean;
  canPublishMedia: boolean;
}) {
  const handwritten = testimonial.kind === 'HANDWRITTEN';

  return (
    <>
      <Panel title="عکس دست‌نوشته">
        {!handwritten ? (
          <p className="text-sm leading-6 text-slate-600">
            این نقل‌قول «تایپ‌شده» است و به عکس نیاز ندارد. برای آماده‌کردن یادداشت تصویری، نوع را
            «دست‌نویس» کنید و پیش‌نویس را ذخیره کنید.
          </p>
        ) : (
          <>
            <p className="text-sm leading-6 text-slate-600">
              عکس فقط همراه رونویسی نمایش داده می‌شود و جای متن را نمی‌گیرد. نوشته را کامل داخل قاب
              نگه دارید و برای کسانی که عکس را نمی‌بینند، توضیح روشن بنویسید.
            </p>
            {testimonial.status === 'DRAFT' && images.length === 0 ? (
              <MediaUploadFraming
                csrfToken={csrfToken}
                targetShapes={[MEDIA_TARGET_SHAPE_PRESETS.portrait]}
                attachmentTarget={{
                  ownerType: 'PUBLIC_TESTIMONIAL',
                  ownerId: testimonial.id,
                  position: 0,
                }}
              />
            ) : null}

            {images.length === 0 ? (
              <p className="border-t border-slate-200 pt-4 text-sm text-slate-600">
                هنوز عکس دست‌نوشته‌ای آماده نشده است. بدون رونویسی و عکسِ بررسی‌شده، این حالت برای
                انتشار آماده نیست.
              </p>
            ) : (
              <div className="flex flex-col gap-4 border-t border-slate-200 pt-4">
                <div>
                  <h3 className="font-semibold text-slate-900">پیش‌نمایش ذخیره‌شده</h3>
                  <p className="mt-1 text-sm text-slate-600">
                    این تصویر خصوصی است و بدون انتشار موقت برای همکاران مجاز نمایش داده می‌شود.
                  </p>
                </div>
                {images.map(({ asset, attachment }) => {
                  const rendition = previewRendition(asset);
                  return (
                    <article
                      key={attachment.id}
                      className="grid gap-4 rounded-xl border border-slate-200 p-3 md:grid-cols-[minmax(0,18rem)_1fr] md:items-center"
                    >
                      <div
                        className="relative aspect-[4/5] overflow-hidden rounded-lg bg-slate-100"
                        aria-label="پیش‌نمایش ذخیره‌شدهٔ دست‌نوشته"
                      >
                        {rendition === undefined ? (
                          <span className="flex size-full items-center justify-center px-4 text-center text-sm text-slate-600">
                            پیش‌نمایش این عکس آماده نیست.
                          </span>
                        ) : (
                          // This same-origin route re-authorises the private bytes on every request.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`/api/media/renditions/${rendition.id}/preview`}
                            alt={asset.altText}
                            width={rendition.width}
                            height={rendition.height}
                            loading="lazy"
                            style={cropImageStyle(attachment.framing)}
                          />
                        )}
                      </div>

                      <div className="flex flex-col gap-3">
                        <p className="text-sm font-semibold text-slate-900">{asset.altText}</p>
                        <div className="flex flex-wrap gap-2">
                          <Badge tone={attachment.publishedAt === null ? 'warning' : 'success'}>
                            {attachment.publishedAt === null
                              ? 'آماده؛ در انتظار انتشار مدیر'
                              : 'عکس منتشرشده'}
                          </Badge>
                          {!testimonial.isPublic ? (
                            <Badge tone="neutral">نقل‌قول هنوز روی سایت نیست</Badge>
                          ) : null}
                        </div>
                        {canPublishMedia ? (
                          <form method="post" action="/api/media/publication">
                            <input type="hidden" name="csrfToken" value={csrfToken} />
                            <input type="hidden" name="attachmentId" value={attachment.id} />
                            <input type="hidden" name="testimonialId" value={testimonial.id} />
                            <input
                              type="hidden"
                              name="isPublished"
                              value={attachment.publishedAt === null ? 'true' : 'false'}
                            />
                            <SubmitButton
                              tone={attachment.publishedAt === null ? 'primary' : 'danger'}
                            >
                              {attachment.publishedAt === null
                                ? 'انتشار عکس پس از بررسی'
                                : 'برداشتن عکس از سایت'}
                            </SubmitButton>
                          </form>
                        ) : (
                          <p className="text-sm text-slate-600">
                            این عکس هنوز عمومی نیست و برای بررسی مدیر آماده شده است.
                          </p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Panel>

      {canApprove ? (
        <Panel title="بررسی مدیر و انتشار">
          <p className="text-sm leading-6 text-slate-600">
            تصویر بالا را با رونویسی زیر مقایسه کنید. تأیید حریم خصوصی، انتشار عکس و قرار دادن
            نقل‌قول روی سایت سه اقدام جدا هستند.
          </p>
          <blockquote className="whitespace-pre-line rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-900">
            {testimonial.body}
          </blockquote>
          <div className="flex flex-wrap gap-2">
            <form method="post" action="/api/content/testimonials/approval">
              <input type="hidden" name="csrfToken" value={csrfToken} />
              <input type="hidden" name="id" value={testimonial.id} />
              <input
                type="hidden"
                name="approved"
                value={testimonial.status === 'APPROVED' ? 'false' : 'true'}
              />
              <input type="hidden" name="returnToEdit" value="true" />
              <SubmitButton tone={testimonial.status === 'APPROVED' ? 'danger' : 'primary'}>
                {testimonial.status === 'APPROVED'
                  ? 'برداشتن تأیید حریم خصوصی'
                  : 'تأیید پس از مقایسه و بررسی'}
              </SubmitButton>
            </form>
            {testimonial.status === 'APPROVED' ? (
              <form method="post" action="/api/content/testimonials/publication">
                <input type="hidden" name="csrfToken" value={csrfToken} />
                <input type="hidden" name="id" value={testimonial.id} />
                <input
                  type="hidden"
                  name="isPublic"
                  value={testimonial.isPublic ? 'false' : 'true'}
                />
                <input type="hidden" name="returnToEdit" value="true" />
                <SubmitButton tone={testimonial.isPublic ? 'danger' : 'secondary'}>
                  {testimonial.isPublic ? 'برداشتن نقل‌قول از سایت' : 'قرار دادن نقل‌قول روی سایت'}
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </>
  );
}
