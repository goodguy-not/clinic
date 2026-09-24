import type { MediaAsset, Space } from '@clinic/contracts';
import { MediaUploadFraming } from '@/components/media-upload-framing';
import { MediaAltTextEditor } from '@/components/media-alt-text-editor';
import { Badge, Panel, SubmitButton } from '@/components/ui';
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
  return (
    <>
      <Panel title="عکس‌های این فضا">
        <p className="text-sm leading-6 text-slate-600">
          عکس روشن و واضحی از خود فضا انتخاب کنید؛ بهتر است فرد یا نوشتهٔ قابل شناسایی در تصویر
          نباشد. قاب پهن، شکل اصلی نمایش در صفحهٔ خانواده‌هاست.
        </p>
        <MediaUploadFraming
          csrfToken={csrfToken}
          targetShapes={[MEDIA_TARGET_SHAPE_PRESETS.landscape, MEDIA_TARGET_SHAPE_PRESETS.wide]}
          attachmentTarget={{
            ownerType: 'PUBLIC_SPACE',
            ownerId: space.id,
            position: photos.length,
          }}
        />

        {photos.length === 0 ? (
          <p className="border-t border-slate-200 pt-4 text-sm text-slate-600">
            هنوز عکسی برای این فضا آماده نشده است.
          </p>
        ) : (
          <div className="flex flex-col gap-3 border-t border-slate-200 pt-4">
            <h3 className="font-semibold text-slate-900">عکس‌های آماده‌شده</h3>
            {photos.map(({ asset, attachment }, index) => (
              <div
                key={attachment.id}
                className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-slate-900">
                      عکس {index + 1}: {asset.altText}
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
