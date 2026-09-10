import type { ClinicContentEntry, ClinicContentSlot, MediaAsset } from '@clinic/contracts';
import { MediaUploadFraming } from '@/components/media-upload-framing';
import { Alert, Badge, Field, FormActions, Panel, SubmitButton } from '@/components/ui';
import { MEDIA_TARGET_SHAPE_PRESETS, type MediaTargetShape } from '@/media/framing';
import { toPersianDigits } from '@/server/numerals-fa';

type SlotPresentation = {
  page: 'صفحهٔ خانه' | 'صفحهٔ دربارهٔ کلینیک';
  title: string;
  item: string;
  description: string;
};

const SLOT_PRESENTATION: Record<ClinicContentSlot, SlotPresentation> = {
  HOME_HERO: {
    page: 'صفحهٔ خانه',
    title: 'معرفی آغاز صفحه',
    item: 'معرفی آغاز صفحه',
    description: 'عبارت کوتاه، عنوان اصلی و توضیح آغاز صفحهٔ خانه.',
  },
  HOME_CONCERN: {
    page: 'صفحهٔ خانه',
    title: 'راهنمای شروع برای خانواده‌ها',
    item: 'راهنمای شروع',
    description: 'پنج انتخاب ثابت که به خانواده کمک می‌کند نزدیک‌ترین شرح را پیدا کند.',
  },
  HOME_FIRST_VISIT: {
    page: 'صفحهٔ خانه',
    title: 'آشنایی با نخستین مراجعه',
    item: 'معرفی نخستین مراجعه',
    description: 'معرفی کوتاه بخشی که روند نخستین مراجعه را توضیح می‌دهد.',
  },
  HOME_FIRST_VISIT_STEP: {
    page: 'صفحهٔ خانه',
    title: 'مرحله‌های نخستین مراجعه',
    item: 'مرحله',
    description: 'سه مرحلهٔ ثابت که مسیر جلسهٔ نخست را به زبان ساده توضیح می‌دهد.',
  },
  ABOUT_INTRO: {
    page: 'صفحهٔ دربارهٔ کلینیک',
    title: 'معرفی صفحهٔ دربارهٔ کلینیک',
    item: 'معرفی صفحهٔ دربارهٔ کلینیک',
    description:
      'عنوان و خط تکمیلی این بخش؛ متن اصلی دربارهٔ کلینیک همان خانهٔ «دربارهٔ کلینیک» در فرم بالاست.',
  },
  ABOUT_HIGHLIGHT: {
    page: 'صفحهٔ دربارهٔ کلینیک',
    title: 'ویژگی‌های کلینیک',
    item: 'ویژگی',
    description: 'سه جای ثابت برای بیان ویژگی‌هایی که مدیر تأیید کرده است.',
  },
  ABOUT_SPACE_NOTE: {
    page: 'صفحهٔ دربارهٔ کلینیک',
    title: 'توضیح طراحی فضا',
    item: 'توضیح طراحی فضا',
    description: 'معرفی کوتاه دربارهٔ تجربهٔ حضور و طراحی فضای کلینیک.',
  },
  ABOUT_SPACE_POINT: {
    page: 'صفحهٔ دربارهٔ کلینیک',
    title: 'نکته‌های مربوط به فضا',
    item: 'نکته',
    description: 'سه نکتهٔ ثابت زیر توضیح طراحی فضا.',
  },
  ABOUT_JOURNEY_STEP: {
    page: 'صفحهٔ دربارهٔ کلینیک',
    title: 'مسیر درخواست تا ارزیابی',
    item: 'گام',
    description: 'سه گام ثابت از فرستادن درخواست تا هماهنگی ارزیابی.',
  },
};

const CONTENT_IMAGE_SHAPE: Partial<Record<ClinicContentSlot, MediaTargetShape>> = {
  HOME_CONCERN: MEDIA_TARGET_SHAPE_PRESETS.wide,
  HOME_FIRST_VISIT: MEDIA_TARGET_SHAPE_PRESETS.landscape,
  ABOUT_INTRO: MEDIA_TARGET_SHAPE_PRESETS.landscape,
  ABOUT_SPACE_NOTE: MEDIA_TARGET_SHAPE_PRESETS.landscape,
};

const OPEN_GRAPH_SHAPES = [MEDIA_TARGET_SHAPE_PRESETS.wide] as const;

type AttachmentView = {
  asset: MediaAsset;
  attachment: MediaAsset['attachments'][number];
};

function attachmentsFor(
  media: readonly MediaAsset[],
  ownerType: 'CLINIC_CONTENT_ENTRY' | 'CLINIC_OPEN_GRAPH',
  ownerId: string | null,
): AttachmentView[] {
  return media.flatMap((asset) =>
    asset.attachments
      .filter((attachment) => attachment.ownerType === ownerType && attachment.ownerId === ownerId)
      .map((attachment) => ({ asset, attachment })),
  );
}

function AttachedImageList({
  attachments,
  csrfToken,
}: {
  attachments: readonly AttachmentView[];
  csrfToken: string;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-slate-200 pt-4">
      <h4 className="font-semibold text-slate-900">عکس‌های آماده‌شده برای این بخش</h4>
      {attachments.map(({ asset, attachment }) => (
        <div
          key={attachment.id}
          className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold text-slate-900">{asset.altText}</span>
            <Badge tone={attachment.publishedAt === null ? 'warning' : 'success'}>
              {attachment.publishedAt === null ? 'عکس آمادهٔ انتشار' : 'عکس منتشرشده'}
            </Badge>
          </div>
          <form method="post" action="/api/media/publication">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="attachmentId" value={attachment.id} />
            <input type="hidden" name="clinicProfile" value="true" />
            <input
              type="hidden"
              name="isPublished"
              value={attachment.publishedAt === null ? 'true' : 'false'}
            />
            <SubmitButton tone={attachment.publishedAt === null ? 'primary' : 'danger'}>
              {attachment.publishedAt === null ? 'انتشار عکس' : 'برداشتن عکس از سایت'}
            </SubmitButton>
          </form>
        </div>
      ))}
    </div>
  );
}

function EntryEditor({
  entry,
  ordinal,
  groupIndex,
  groupSize,
  media,
  csrfToken,
}: {
  entry: ClinicContentEntry;
  ordinal: number;
  groupIndex: number;
  groupSize: number;
  media: readonly MediaAsset[];
  csrfToken: string;
}) {
  const presentation = SLOT_PRESENTATION[entry.slot];
  const formPrefix = `clinic-entry-${ordinal}`;
  const title =
    groupSize === 1
      ? presentation.item
      : `${presentation.item} ${toPersianDigits(String(groupIndex + 1))}`;
  const targetShape = CONTENT_IMAGE_SHAPE[entry.slot];
  const attachments = attachmentsFor(media, 'CLINIC_CONTENT_ENTRY', entry.id);

  return (
    <details className="rounded-xl border border-slate-200 bg-white p-4" open={ordinal === 0}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-slate-900">
        <span>{title}</span>
        <Badge tone={entry.heading === null ? 'neutral' : 'success'}>
          {entry.heading === null ? 'هنوز نوشته نشده' : 'روی سایت نمایش داده می‌شود'}
        </Badge>
      </summary>
      <div className="mt-5 flex flex-col gap-6 border-t border-slate-200 pt-5">
        <form
          method="post"
          action="/api/content/clinic-profile/entries/update"
          className="flex flex-col gap-5"
        >
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="id" value={entry.id} />
          <Field
            id={`${formPrefix}-label`}
            label="برچسب کوتاه"
            help="در صورت نیاز؛ مانند نام یک گام یا انتخاب."
          >
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="label"
                type="text"
                maxLength={200}
                defaultValue={entry.label ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>
          <Field
            id={`${formPrefix}-eyebrow`}
            label="عبارت کوتاه بالای عنوان"
            help="در صورت نیاز؛ یک راهنمای کوتاه برای خواننده."
          >
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="eyebrow"
                type="text"
                maxLength={120}
                defaultValue={entry.eyebrow ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>
          <Field
            id={`${formPrefix}-heading`}
            label="عنوان بخش"
            help="عنوان، مرز نمایش این بخش است؛ اگر خالی بماند، بخش و عکس آن روی سایت دیده نمی‌شود."
          >
            {({ id, className, describedBy }) => (
              <input
                id={id}
                name="heading"
                type="text"
                maxLength={200}
                defaultValue={entry.heading ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>
          <Field
            id={`${formPrefix}-body`}
            label="متن تکمیلی"
            help="در صورت نیاز؛ متن ساده و بدون نشانه‌گذاری یا کد."
          >
            {({ id, className, describedBy }) => (
              <textarea
                id={id}
                name="body"
                rows={5}
                maxLength={4000}
                defaultValue={entry.body ?? ''}
                aria-describedby={describedBy}
                className={className}
              />
            )}
          </Field>
          <FormActions>
            <SubmitButton>ذخیرهٔ این بخش</SubmitButton>
          </FormActions>
        </form>

        {targetShape !== undefined ? (
          <div className="flex flex-col gap-5 border-t border-slate-200 pt-5">
            <div>
              <h4 className="font-semibold text-slate-900">عکس این بخش</h4>
              <p className="mt-1 text-sm text-slate-600">
                عکس پس از تنظیم قاب، آماده می‌شود و فقط با دکمهٔ انتشار مدیر روی سایت دیده خواهد شد.
              </p>
            </div>
            <MediaUploadFraming
              csrfToken={csrfToken}
              targetShapes={[targetShape]}
              attachmentTarget={{
                ownerType: 'CLINIC_CONTENT_ENTRY',
                ownerId: entry.id,
                position: 0,
              }}
            />
            <AttachedImageList attachments={attachments} csrfToken={csrfToken} />
          </div>
        ) : null}
      </div>
    </details>
  );
}

export function ClinicContentEditor({
  entries,
  media,
  csrfToken,
  mediaLoadError,
}: {
  entries: readonly ClinicContentEntry[];
  media: readonly MediaAsset[];
  csrfToken: string;
  mediaLoadError: string | null;
}) {
  const groups: Array<{ slot: ClinicContentSlot; entries: ClinicContentEntry[] }> = [];
  for (const entry of entries) {
    const current = groups.at(-1);
    if (current?.slot === entry.slot) current.entries.push(entry);
    else groups.push({ slot: entry.slot, entries: [entry] });
  }
  let entryOrdinal = 0;
  const openGraphAttachments = attachmentsFor(media, 'CLINIC_OPEN_GRAPH', null);

  return (
    <section
      className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-12 sm:px-6"
      aria-labelledby="clinic-content-heading"
    >
      <div>
        <p className="text-sm font-semibold text-brand-800">صفحهٔ خانه و دربارهٔ کلینیک</p>
        <h2 id="clinic-content-heading" className="mt-1 text-2xl font-black text-slate-950">
          متن‌ها و عکس‌های عمومی
        </h2>
        <p className="mt-2 max-w-3xl leading-7 text-slate-600">
          جای بخش‌ها از پیش مشخص است. متن هر کارت را کامل کنید؛ امکان افزودن، حذف یا جابه‌جایی
          بخش‌ها وجود ندارد.
        </p>
      </div>
      <Alert tone="info">
        این بخش پیش‌نویس جداگانه ندارد. ذخیرهٔ مدیر همان لحظه محتوای عمومی را تغییر می‌دهد. کارت
        بدون عنوان روی سایت نمایش داده نمی‌شود.
      </Alert>
      {mediaLoadError !== null ? <Alert>{mediaLoadError}</Alert> : null}

      {groups.map((group) => {
        const presentation = SLOT_PRESENTATION[group.slot];
        const startOrdinal = entryOrdinal;
        entryOrdinal += group.entries.length;
        return (
          <Panel key={group.slot} title={`${presentation.page} — ${presentation.title}`}>
            <p className="text-sm leading-6 text-slate-600">{presentation.description}</p>
            <div className="flex flex-col gap-3">
              {group.entries.map((entry, index) => (
                <EntryEditor
                  key={entry.id}
                  entry={entry}
                  ordinal={startOrdinal + index}
                  groupIndex={index}
                  groupSize={group.entries.length}
                  media={media}
                  csrfToken={csrfToken}
                />
              ))}
            </div>
          </Panel>
        );
      })}

      <Panel title="عکس هنگام اشتراک‌گذاری سایت">
        <p className="text-sm leading-6 text-slate-600">
          وقتی پیوند سایت در پیام‌رسان‌ها یا شبکه‌های اجتماعی فرستاده می‌شود، این عکس کنار معرفی
          سایت دیده می‌شود. این عکس لوگو نیست.
        </p>
        <MediaUploadFraming
          csrfToken={csrfToken}
          targetShapes={OPEN_GRAPH_SHAPES}
          attachmentTarget={{ ownerType: 'CLINIC_OPEN_GRAPH', ownerId: null, position: 0 }}
        />
        <AttachedImageList attachments={openGraphAttachments} csrfToken={csrfToken} />
      </Panel>
    </section>
  );
}
