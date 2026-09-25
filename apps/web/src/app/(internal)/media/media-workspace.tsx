import type { MediaAsset } from '@clinic/contracts';
import {
  Alert,
  Badge,
  PageHeader,
  PageShell,
  Panel,
  RecordItem,
  RecordList,
  SubmitButton,
} from '@/components/ui';
import { MediaUploadFraming } from '@/components/media-upload-framing';
import { MediaAltTextEditor } from '@/components/media-alt-text-editor';

function mediaStatus(media: MediaAsset) {
  if (media.status === 'ARCHIVED') return <Badge tone="neutral">از گردش خارج شده</Badge>;
  if (media.isPubliclyServed) return <Badge tone="success">اکنون در دسترس بازدیدکننده</Badge>;
  if (media.attachments.length > 0) return <Badge tone="warning">پیش‌نویس؛ منتشر نشده</Badge>;
  return <Badge tone="neutral">هنوز به جایگاهی وصل نشده</Badge>;
}

export function MediaWorkspace({
  media,
  csrfToken,
  canPublishMedia,
  loadError,
  notice,
}: {
  media: MediaAsset[];
  csrfToken: string;
  canPublishMedia: boolean;
  loadError: string | null;
  notice: string | null;
}) {
  return (
    <PageShell wide>
      <PageHeader
        title="آماده‌سازی عکس"
        description="عکس را انتخاب کنید، بخش مهم آن را نشان دهید و نتیجه را پیش از استفاده ببینید."
      />
      <Alert tone="info">
        این صفحه فقط عکس و قاب آن را به‌صورت پیش‌نویس آماده می‌کند و جایگاه عمومی تازه‌ای نمی‌سازد.
        انتشار یا برداشتن عکس از سایت همچنان با مدیر است.
      </Alert>
      {loadError !== null ? <Alert>{loadError}</Alert> : null}
      {notice !== null ? <Alert tone="info">{notice}</Alert> : null}

      <Panel>
        <MediaUploadFraming csrfToken={csrfToken} />
      </Panel>

      <Panel title="عکس‌های تازه">
        {media.length === 0 ? (
          <p className="text-sm text-slate-600">هنوز عکسی آماده نشده است.</p>
        ) : (
          <RecordList>
            {media.map((item) => (
              <RecordItem
                key={item.id}
                title={item.altText}
                badge={mediaStatus(item)}
                details={
                  <div className="flex flex-col gap-4">
                    <MediaAltTextEditor
                      asset={item}
                      csrfToken={csrfToken}
                      canPublishMedia={canPublishMedia}
                      returnTarget={{ type: 'media-library' }}
                      instanceId={item.id}
                    />
                    {canPublishMedia ? (
                      <form method="post" action="/api/media/archive">
                        <input type="hidden" name="csrfToken" value={csrfToken} />
                        <input type="hidden" name="mediaId" value={item.id} />
                        <input
                          type="hidden"
                          name="archived"
                          value={item.status === 'ARCHIVED' ? 'false' : 'true'}
                        />
                        <SubmitButton tone={item.status === 'ARCHIVED' ? 'secondary' : 'danger'}>
                          {item.status === 'ARCHIVED'
                            ? 'بازگرداندن عکس به گردش'
                            : 'از گردش خارج کردن عکس'}
                        </SubmitButton>
                      </form>
                    ) : null}
                  </div>
                }
              />
            ))}
          </RecordList>
        )}
      </Panel>
    </PageShell>
  );
}
