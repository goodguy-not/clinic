import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MediaAltTextEditor } from './media-alt-text-editor';

const ASSET = {
  id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d81',
  altText: 'توضیح کنونی عکس',
  isPubliclyServed: false,
};

function render(canPublishMedia: boolean, isPubliclyServed: boolean) {
  return renderToStaticMarkup(
    <MediaAltTextEditor
      asset={{ ...ASSET, isPubliclyServed }}
      csrfToken="synthetic-csrf"
      canPublishMedia={canPublishMedia}
      returnTarget={{ type: 'article', id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d82' }}
      instanceId="synthetic-article-image"
    />,
  );
}

describe('photo description correction control', () => {
  it.each([
    ['receptionist', false, false],
    ['manager', true, false],
  ] as const)(
    'lets a %s correct a photo that is not publicly served',
    (_role, canPublish, served) => {
      const html = render(canPublish, served);

      expect(html).toContain('action="/api/media/alt-text"');
      expect(html).toContain('در این عکس چه چیزی دیده می‌شود؟');
      expect(html).toContain('>توضیح کنونی عکس</textarea>');
    },
  );

  it('shows a receptionist the current public description and no refused control', () => {
    const html = render(false, true);

    expect(html).toContain('توضیح کنونی:');
    expect(html).toContain('توضیح کنونی عکس');
    expect(html).toContain('فقط مدیر می‌تواند توضیح آن را تغییر دهد');
    expect(html).not.toContain('action="/api/media/alt-text"');
    expect(html).not.toContain('<textarea');
  });

  it('lets a manager correct a public photo and explains the asset-wide effect', () => {
    const html = render(true, true);

    expect(html).toContain('action="/api/media/alt-text"');
    expect(html).toContain('در همهٔ جاهایی که این عکس در سایت استفاده شده است');
    expect(html).toContain('name="altText"');
  });
});
