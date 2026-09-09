import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { framingForSlot, hasPoorCrop, MEDIA_TARGET_SHAPE_PRESETS } from '@/media/framing';
import { FramingResultPreview, MediaUploadFraming } from './media-upload-framing';

const { portrait: PORTRAIT, landscape: LANDSCAPE } = MEDIA_TARGET_SHAPE_PRESETS;

describe('Persian-first photograph controls', () => {
  it('offers gallery and camera entry points and asks for human alt text', () => {
    const html = renderToStaticMarkup(<MediaUploadFraming csrfToken="synthetic" />);

    expect(html).toContain('انتخاب از گوشی یا رایانه');
    expect(html).toContain('گرفتن عکس با دوربین');
    expect(html).toContain('capture="environment"');
    expect(html).toContain('accept="image/*"');
    expect(html).toContain('در این عکس چه چیزی دیده می‌شود؟');
    expect(html.replace(/<[^>]+>/g, ' ')).not.toMatch(
      /filename|path|pixel|codec|compression|SEO|LCP|px/i,
    );
  });

  it('renders portrait and landscape previews in their actual supplied shapes', () => {
    const portraitFraming = framingForSlot(4032, 3024, PORTRAIT.aspectRatio, 0.5, 0.5);
    const landscapeFraming = framingForSlot(4032, 3024, LANDSCAPE.aspectRatio, 0.5, 0.5);
    const portrait = renderToStaticMarkup(
      <FramingResultPreview
        previewUrl="blob:synthetic"
        framing={portraitFraming}
        targetShape={PORTRAIT}
      />,
    );
    const landscape = renderToStaticMarkup(
      <FramingResultPreview
        previewUrl="blob:synthetic"
        framing={landscapeFraming}
        targetShape={LANDSCAPE}
      />,
    );

    expect(portrait).toContain('aspect-ratio:0.8');
    expect(portrait).toContain('پیش‌نمایش قاب عمودی');
    expect(landscape).toContain('aspect-ratio:1.5');
    expect(landscape).toContain('پیش‌نمایش قاب افقی');
    expect(portraitFraming.crop).not.toEqual(landscapeFraming.crop);
  });

  it('evaluates the poor-crop warning against the selected target shape', () => {
    const portraitFraming = framingForSlot(4032, 3024, PORTRAIT.aspectRatio, 0.1, 0.5);
    const landscapeFraming = framingForSlot(4032, 3024, LANDSCAPE.aspectRatio, 0.1, 0.5);
    expect(hasPoorCrop(portraitFraming)).toBe(false);
    expect(hasPoorCrop(landscapeFraming)).toBe(true);

    const good = renderToStaticMarkup(
      <FramingResultPreview
        previewUrl="blob:synthetic"
        framing={portraitFraming}
        targetShape={PORTRAIT}
      />,
    );
    const poor = renderToStaticMarkup(
      <FramingResultPreview
        previewUrl="blob:synthetic"
        framing={landscapeFraming}
        targetShape={LANDSCAPE}
      />,
    );

    expect(good).toContain('بخش مهم عکس داخل قاب جای خوبی دارد');
    expect(poor).toContain('ممکن است خوب دیده نشود');
    expect(poor).toContain('role="alert"');
  });
});
