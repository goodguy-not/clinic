import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FramingResultPreview, MediaUploadFraming } from './media-upload-framing';

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

  it('renders the real target shape and a human warning for an edge crop', () => {
    const good = renderToStaticMarkup(
      <FramingResultPreview
        previewUrl="blob:synthetic"
        framing={{ focalX: 0.5, focalY: 0.5, crop: { x: 0, y: 0.125, width: 1, height: 0.75 } }}
      />,
    );
    const poor = renderToStaticMarkup(
      <FramingResultPreview
        previewUrl="blob:synthetic"
        framing={{ focalX: 0.5, focalY: 0, crop: { x: 0, y: 0, width: 1, height: 0.75 } }}
      />,
    );

    expect(good).toContain('aspect-ratio:1.7777777777777777');
    expect(good).toContain('بخش مهم عکس داخل قاب جای خوبی دارد');
    expect(poor).toContain('ممکن است خوب دیده نشود');
    expect(poor).toContain('role="alert"');
  });
});
