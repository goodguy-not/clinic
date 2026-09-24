import type { MediaAsset } from '@clinic/contracts';
import { MEDIA_ALT_TEXT_HEADING, MEDIA_ALT_TEXT_QUESTION } from './media-alt-text-copy';
import { CONTROL_CLASS } from './styles';
import { SubmitButton } from './ui';

export type MediaAltTextReturnTarget =
  | { type: 'media-library' }
  | { type: 'clinic-profile' }
  | { type: 'therapist'; id: string }
  | { type: 'service'; id: string }
  | { type: 'space'; id: string }
  | { type: 'article'; id: string }
  | { type: 'testimonial'; id: string };

function ReturnTargetInputs({ target }: { target: MediaAltTextReturnTarget }) {
  switch (target.type) {
    case 'media-library':
      return <input type="hidden" name="mediaLibrary" value="true" />;
    case 'clinic-profile':
      return <input type="hidden" name="clinicProfile" value="true" />;
    case 'therapist':
      return <input type="hidden" name="therapistId" value={target.id} />;
    case 'service':
      return <input type="hidden" name="serviceId" value={target.id} />;
    case 'space':
      return <input type="hidden" name="spaceId" value={target.id} />;
    case 'article':
      return <input type="hidden" name="articleId" value={target.id} />;
    case 'testimonial':
      return <input type="hidden" name="testimonialId" value={target.id} />;
  }
}

/**
 * Corrects the asset-wide description anywhere staff can see an uploaded image.
 *
 * The API remains authoritative. `isPubliclyServed` only keeps a receptionist
 * away from a control that is known to be refused; the mutation still checks
 * the live serving predicate under its own lock.
 */
export function MediaAltTextEditor({
  asset,
  csrfToken,
  canPublishMedia,
  returnTarget,
  instanceId,
}: {
  asset: Pick<MediaAsset, 'id' | 'altText' | 'isPubliclyServed'>;
  csrfToken: string;
  canPublishMedia: boolean;
  returnTarget: MediaAltTextReturnTarget;
  instanceId: string;
}) {
  const canCorrect = !asset.isPubliclyServed || canPublishMedia;
  const inputId = `media-alt-text-${instanceId}`;

  if (!canCorrect) {
    return (
      <section className="flex flex-col gap-2 border-t border-slate-200 pt-3">
        <h4 className="text-sm font-semibold text-slate-900">توضیح عکس</h4>
        <p className="text-sm text-slate-800">
          <span className="font-semibold">توضیح کنونی: </span>
          {asset.altText}
        </p>
        <p className="text-sm leading-6 text-slate-600">
          این عکس اکنون روی سایت دیده می‌شود و فقط مدیر می‌تواند توضیح آن را تغییر دهد.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 border-t border-slate-200 pt-3">
      <h4 className="text-sm font-bold text-slate-900">{MEDIA_ALT_TEXT_HEADING}</h4>
      {asset.isPubliclyServed ? (
        <p className="text-sm leading-6 text-slate-600">
          این عکس اکنون روی سایت دیده می‌شود. تغییر توضیح در همهٔ جاهایی که این عکس در سایت استفاده
          شده است اعمال می‌شود.
        </p>
      ) : null}
      <form method="post" action="/api/media/alt-text" className="flex flex-col gap-3">
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <input type="hidden" name="mediaId" value={asset.id} />
        <ReturnTargetInputs target={returnTarget} />
        <label htmlFor={inputId} className="text-sm font-semibold text-slate-900">
          {MEDIA_ALT_TEXT_QUESTION}
        </label>
        <textarea
          id={inputId}
          name="altText"
          defaultValue={asset.altText}
          maxLength={200}
          required
          rows={3}
          className={CONTROL_CLASS}
        />
        <div>
          <SubmitButton tone="secondary">ذخیرهٔ توضیح عکس</SubmitButton>
        </div>
      </form>
    </section>
  );
}
