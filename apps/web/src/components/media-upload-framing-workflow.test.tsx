// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaWorkspace } from '@/app/(internal)/media/media-workspace';

const MEDIA_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d81';
const ATTACHMENT_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d82';

afterEach(() => vi.unstubAllGlobals());

describe('upload beside an unsaved form', () => {
  it('shows success immediately and keeps text typed elsewhere on the page', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ media: { id: MEDIA_ID, attachments: [] } }), {
            status: 201,
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ attachmentId: ATTACHMENT_ID }), { status: 201 }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              media: {
                id: MEDIA_ID,
                altText: 'نمای ساختگی اتاق',
                status: 'ACTIVE',
                width: 1200,
                height: 800,
                byteSize: 1000,
                sourceContentType: 'image/webp',
                sourceByteSize: 1000,
                isPubliclyServed: false,
                renditions: [],
                createdAt: '2026-10-18T00:00:00.000Z',
                archivedAt: null,
                bytesPurgedAt: null,
                attachments: [
                  {
                    id: ATTACHMENT_ID,
                    ownerType: 'CLINIC_SPACE',
                    ownerId: null,
                    position: 0,
                    attachedAt: '2026-10-18T00:00:00.000Z',
                    publishedAt: null,
                    ownerIsPublic: false,
                    framing: { focalX: 0.5, focalY: 0.5, crop: null },
                  },
                ],
              },
            }),
            { status: 200 },
          ),
        ),
    );
    URL.createObjectURL = vi.fn(() => 'blob:synthetic-photo');
    URL.revokeObjectURL = vi.fn();

    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <>
          <textarea aria-label="یادداشت ذخیره‌نشده" />
          <MediaWorkspace
            media={[]}
            csrfToken="synthetic"
            canPublishMedia={false}
            loadError={null}
            notice={null}
          />
        </>,
      ),
    );

    const unsaved = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="یادداشت ذخیره‌نشده"]',
    )!;
    unsaved.value = 'متن تایپ‌شده‌ای که هنوز ذخیره نشده است';
    const fileInput = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File(['photo'], 'synthetic.webp', { type: 'image/webp' })],
    });
    await act(async () => fileInput.dispatchEvent(new Event('change', { bubbles: true })));

    const description = host.querySelector<HTMLTextAreaElement>('textarea[maxlength="200"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        description,
        'نمای ساختگی اتاق',
      );
      description.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const upload = Array.from(host.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('فرستادن عکس و ذخیرهٔ قاب'),
    )!;
    expect(upload.disabled).toBe(false);
    await act(async () => upload.click());

    expect(host.textContent).toContain('عکس و قاب آن ذخیره شد');
    expect(host.textContent).toContain('نمای ساختگی اتاق');
    expect(host.textContent).not.toContain('هنوز عکسی آماده نشده است');
    expect(unsaved.value).toBe('متن تایپ‌شده‌ای که هنوز ذخیره نشده است');
    expect(fetch).toHaveBeenCalledTimes(3);
    await act(async () => root.unmount());
    host.remove();
  });
});
