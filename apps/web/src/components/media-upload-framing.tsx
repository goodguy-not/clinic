'use client';

import type { CreateMediaAttachmentRequest, MediaFraming } from '@clinic/contracts';
import { useEffect, useId, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import {
  cropImageStyle,
  DEFAULT_MEDIA_TARGET_SHAPES,
  framingForSlot,
  hasPoorCrop,
  type MediaTargetShape,
} from '@/media/framing';
import { nextMediaWorkflowStep, type MediaWorkflowStep } from '@/media/workflow';
import { MEDIA_ALT_TEXT_HEADING, MEDIA_ALT_TEXT_QUESTION } from './media-alt-text-copy';
import { CONTROL_CLASS, FOCUS_RING } from './styles';

const DEFAULT_FRAMING: MediaFraming = { focalX: 0.5, focalY: 0.5, crop: null };

type ApiAnswer = {
  media?: { id: string; attachments: Array<{ id: string; framing: MediaFraming }> };
  attachmentId?: string;
  error?: { code: string; message: string };
};

async function answerFrom(response: Response): Promise<ApiAnswer> {
  return (await response.json().catch(() => ({
    error: {
      code: 'API_UNREACHABLE',
      message: 'سامانه در دسترس نیست. کمی بعد دوباره تلاش کنید.',
    },
  }))) as ApiAnswer;
}

export function FramingResultPreview({
  previewUrl,
  framing,
  targetShape,
  headingId = 'frame-heading',
}: {
  previewUrl: string;
  framing: MediaFraming;
  targetShape: MediaTargetShape;
  headingId?: string;
}) {
  const poorCrop = hasPoorCrop(framing);

  return (
    <section className="flex flex-col gap-3" aria-labelledby={headingId}>
      <div>
        <h2 id={headingId} className="font-bold text-slate-900">
          ۳. نتیجه را در قاب واقعی ببینید
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          همین بخش از عکس در این جایگاه دیده می‌شود؛ اصل عکس دست‌نخورده می‌ماند.
        </p>
      </div>
      <div
        className="relative overflow-hidden rounded-xl bg-slate-200 shadow-inner"
        style={{ aspectRatio: String(targetShape.aspectRatio) }}
        aria-label={`پیش‌نمایش ${targetShape.label}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={previewUrl} alt="" style={cropImageStyle(framing)} />
      </div>
      {poorCrop ? (
        <p
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950"
        >
          بخش مهم عکس به لبهٔ قاب نزدیک است و ممکن است خوب دیده نشود. نشان سبز را کمی به میانهٔ عکس
          ببرید یا عکس دیگری انتخاب کنید.
        </p>
      ) : (
        <p role="status" className="text-sm text-emerald-800">
          بخش مهم عکس داخل قاب جای خوبی دارد.
        </p>
      )}
    </section>
  );
}

export function MediaUploadFraming({
  csrfToken,
  targetShapes = DEFAULT_MEDIA_TARGET_SHAPES,
  attachmentTarget = { ownerType: 'CLINIC_SPACE', ownerId: null, position: 0 },
}: {
  csrfToken: string;
  targetShapes?: readonly [MediaTargetShape, ...MediaTargetShape[]];
  attachmentTarget?: CreateMediaAttachmentRequest;
}) {
  const idPrefix = useId();
  const focusHeadingId = `${idPrefix}-focus-heading`;
  const frameHeadingId = `${idPrefix}-frame-heading`;
  const altHeadingId = `${idPrefix}-alt-heading`;
  const altInputId = `${idPrefix}-media-alt`;
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [altText, setAltText] = useState('');
  const [framing, setFraming] = useState<MediaFraming>(DEFAULT_FRAMING);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [attachmentId, setAttachmentId] = useState<string | null>(null);
  const [framingSaved, setFramingSaved] = useState(false);
  const [busyStep, setBusyStep] = useState<Exclude<MediaWorkflowStep, 'complete'> | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [targetShapeId, setTargetShapeId] = useState(targetShapes[0].id);
  const urlRef = useRef<string | null>(null);
  const targetShape =
    targetShapes.find((candidate) => candidate.id === targetShapeId) ?? targetShapes[0];

  useEffect(
    () => () => {
      if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    if (selected === null) return;

    if (urlRef.current !== null) URL.revokeObjectURL(urlRef.current);
    const nextUrl = URL.createObjectURL(selected);
    urlRef.current = nextUrl;
    setFile(selected);
    setPreviewUrl(nextUrl);
    setPreviewUnavailable(false);
    setSourceSize(null);
    setFraming(DEFAULT_FRAMING);
    setMediaId(null);
    setAttachmentId(null);
    setFramingSaved(false);
    setErrorMessage(null);
    setComplete(false);
  }

  function moveFocus(focalX: number, focalY: number) {
    setFramingSaved(false);
    if (sourceSize === null) {
      setFraming({ focalX, focalY, crop: null });
      return;
    }
    setFraming(
      framingForSlot(sourceSize.width, sourceSize.height, targetShape.aspectRatio, focalX, focalY),
    );
  }

  function chooseTargetShape(nextShape: MediaTargetShape) {
    setTargetShapeId(nextShape.id);
    setFramingSaved(false);
    setComplete(false);
    if (sourceSize !== null) {
      setFraming(
        framingForSlot(
          sourceSize.width,
          sourceSize.height,
          nextShape.aspectRatio,
          framing.focalX,
          framing.focalY,
        ),
      );
    }
  }

  function pointAt(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    moveFocus(
      Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    );
  }

  async function runWorkflow() {
    if (file === null || altText.trim() === '') return;
    setErrorMessage(null);
    setComplete(false);

    let currentMediaId = mediaId;
    let currentAttachmentId = attachmentId;
    let step = nextMediaWorkflowStep({ mediaId, attachmentId, framingSaved });

    try {
      if (step === 'upload') {
        setBusyStep('upload');
        const body = new FormData();
        body.set('file', file);
        body.set('altText', altText.trim());
        body.set('csrfToken', csrfToken);
        const response = await fetch('/api/media/upload', { method: 'POST', body });
        const answer = await answerFrom(response);
        if (!response.ok || answer.media === undefined) {
          setErrorMessage(answer.error?.message ?? 'این عکس ارسال نشد. دوباره تلاش کنید.');
          return;
        }
        currentMediaId = answer.media.id;
        setMediaId(currentMediaId);
        step = 'attach';
      }

      if (step === 'attach' && currentMediaId !== null) {
        setBusyStep('attach');
        const response = await fetch('/api/media/draft-attachment', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ csrfToken, mediaId: currentMediaId, ...attachmentTarget }),
        });
        const answer = await answerFrom(response);
        if (!response.ok || answer.attachmentId === undefined) {
          setErrorMessage(
            answer.error?.message ??
              'عکس فرستاده شد، اما آماده‌سازی قاب کامل نشد. دوباره تلاش کنید.',
          );
          return;
        }
        currentAttachmentId = answer.attachmentId;
        setAttachmentId(currentAttachmentId);
        step = 'frame';
      }

      if (step === 'frame' && currentAttachmentId !== null) {
        setBusyStep('frame');
        const crop = framing.crop;
        const response = await fetch('/api/media/framing', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            csrfToken,
            attachmentId: currentAttachmentId,
            focalX: framing.focalX,
            focalY: framing.focalY,
            cropX: crop?.x ?? '',
            cropY: crop?.y ?? '',
            cropWidth: crop?.width ?? '',
            cropHeight: crop?.height ?? '',
          }),
        });
        const answer = await answerFrom(response);
        if (!response.ok || answer.media === undefined) {
          setErrorMessage(
            answer.error?.message ?? 'قاب عکس ذخیره نشد. عکس دوباره فرستاده نمی‌شود؛ تلاش کنید.',
          );
          return;
        }
        const persisted = answer.media.attachments.find(
          (attachment) => attachment.id === currentAttachmentId,
        )?.framing;
        if (persisted !== undefined) setFraming(persisted);
        setFramingSaved(true);
        setComplete(true);
        window.location.reload();
      }
    } catch {
      setErrorMessage(
        step === 'upload'
          ? 'ارتباط هنگام فرستادن عکس قطع شد. دوباره تلاش کنید.'
          : 'ارتباط قطع شد. عکس دوباره فرستاده نمی‌شود؛ از همین مرحله ادامه دهید.',
      );
    } finally {
      setBusyStep(null);
    }
  }

  const busy = busyStep !== null;
  const buttonLabel =
    busyStep === 'upload'
      ? 'در حال فرستادن عکس…'
      : busyStep === 'attach'
        ? 'در حال آماده‌سازی…'
        : busyStep === 'frame'
          ? 'در حال ذخیرهٔ قاب…'
          : errorMessage !== null
            ? 'تلاش دوباره از همین مرحله'
            : mediaId === null
              ? 'فرستادن عکس و ذخیرهٔ قاب'
              : 'ذخیرهٔ قاب';

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3 border-0 p-0">
        <legend className="text-base font-bold text-slate-900">۱. عکس را انتخاب کنید</legend>
        <p className="text-sm text-slate-600">
          می‌توانید از عکس‌های گوشی انتخاب کنید یا، اگر دستگاه اجازه می‌دهد، همان‌جا عکس بگیرید.
        </p>
        {targetShapes.length === 1 ? (
          <p className="text-sm font-medium text-slate-700">قاب هدف: {targetShape.label}</p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <label
            className={`inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 ${FOCUS_RING}`}
          >
            انتخاب از گوشی یا رایانه
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label="انتخاب عکس از گوشی یا رایانه"
              onChange={chooseFile}
            />
          </label>
          <label
            className={`inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 ${FOCUS_RING}`}
          >
            گرفتن عکس با دوربین
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              aria-label="گرفتن عکس با دوربین دستگاه"
              onChange={chooseFile}
            />
          </label>
        </div>
      </fieldset>

      {previewUrl !== null ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="flex flex-col gap-3" aria-labelledby={focusHeadingId}>
            <div>
              <h2 id={focusHeadingId} className="font-bold text-slate-900">
                ۲. بخش مهم عکس را نشان دهید
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                روی چهره یا بخش مهم عکس بزنید. نشان سبز را می‌توانید هر زمان جابه‌جا کنید.
              </p>
            </div>
            <button
              type="button"
              className={`relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-xl border border-slate-300 bg-slate-100 ${FOCUS_RING}`}
              aria-label="انتخاب بخش مهم عکس"
            >
              <div
                className="relative max-h-full max-w-full"
                onPointerDown={pointAt}
                style={
                  sourceSize === null
                    ? { width: '100%', height: '100%' }
                    : sourceSize.width / sourceSize.height > 16 / 10
                      ? { width: '100%', aspectRatio: `${sourceSize.width} / ${sourceSize.height}` }
                      : {
                          height: '100%',
                          aspectRatio: `${sourceSize.width} / ${sourceSize.height}`,
                        }
                }
              >
                {/* A local object URL is the immediate, pre-upload preview. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="پیش‌نمایش عکس انتخاب‌شده"
                  className="size-full object-contain"
                  onLoad={(event) => {
                    const size = {
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    };
                    setSourceSize(size);
                    setPreviewUnavailable(false);
                    setFraming(
                      framingForSlot(
                        size.width,
                        size.height,
                        targetShape.aspectRatio,
                        framing.focalX,
                        framing.focalY,
                      ),
                    );
                  }}
                  onError={() => setPreviewUnavailable(true)}
                />
                {!previewUnavailable ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-brand-600 shadow"
                    style={{ left: `${framing.focalX * 100}%`, top: `${framing.focalY * 100}%` }}
                  />
                ) : null}
              </div>
            </button>
            {previewUnavailable ? (
              <p
                role="status"
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
              >
                پیش‌نمایش این عکس در این دستگاه باز نشد. می‌توانید آن را بفرستید؛ اگر قابل استفاده
                نباشد، راه انتخاب عکس دیگری را نشان می‌دهیم.
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-800">
                جابه‌جایی افقی بخش مهم
                <input
                  dir="ltr"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={framing.focalX}
                  className="accent-brand-700"
                  onChange={(event) => moveFocus(Number(event.target.value), framing.focalY)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-800">
                جابه‌جایی عمودی بخش مهم
                <input
                  dir="ltr"
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={framing.focalY}
                  className="accent-brand-700"
                  onChange={(event) => moveFocus(framing.focalX, Number(event.target.value))}
                />
              </label>
            </div>
          </section>

          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2 border-0 p-0">
              <legend className="text-sm font-semibold text-slate-900">
                عکس در کدام شکل دیده می‌شود؟
              </legend>
              <div className="flex flex-wrap gap-2">
                {targetShapes.map((shape) => (
                  <button
                    key={shape.id}
                    type="button"
                    aria-pressed={shape.id === targetShape.id}
                    onClick={() => chooseTargetShape(shape)}
                    className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-semibold ${FOCUS_RING} ${
                      shape.id === targetShape.id
                        ? 'border-brand-700 bg-brand-50 text-brand-900'
                        : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    {shape.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <FramingResultPreview
              previewUrl={previewUrl}
              framing={framing}
              targetShape={targetShape}
              headingId={frameHeadingId}
            />
          </div>
        </div>
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby={altHeadingId}>
        <h2 id={altHeadingId} className="font-bold text-slate-900">
          ۴. {MEDIA_ALT_TEXT_HEADING}
        </h2>
        <label htmlFor={altInputId} className="text-sm font-semibold text-slate-900">
          {MEDIA_ALT_TEXT_QUESTION}
        </label>
        <textarea
          id={altInputId}
          value={altText}
          maxLength={200}
          required
          rows={3}
          className={CONTROL_CLASS}
          onChange={(event) => setAltText(event.target.value)}
        />
      </section>

      {errorMessage !== null ? (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-900"
        >
          {errorMessage}
        </p>
      ) : null}
      {complete ? (
        <p
          role="status"
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-950"
        >
          عکس و قاب آن ذخیره شد. این عکس هنوز منتشر نشده است.
        </p>
      ) : null}

      <button
        type="button"
        disabled={file === null || altText.trim() === '' || busy}
        onClick={runWorkflow}
        className={`inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-700 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-slate-400 sm:self-start ${FOCUS_RING}`}
      >
        {buttonLabel}
      </button>
    </div>
  );
}
