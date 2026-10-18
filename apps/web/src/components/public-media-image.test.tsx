import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PublicMediaImage } from './public-media-image';

describe('A5 public image rendering', () => {
  it('uses exactly the available rendition widths and attachment framing', () => {
    const html = renderToStaticMarkup(
      <PublicMediaImage
        sizes="50vw"
        image={{
          alt: 'درمانگر در اتاق روشن درمانگاه',
          width: 777,
          height: 583,
          renditions: [
            {
              path: 'media/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d72',
              format: 'webp',
              width: 320,
              height: 240,
              byteSize: 1000,
            },
            {
              path: 'media/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d73',
              format: 'jpeg',
              width: 320,
              height: 240,
              byteSize: 1200,
            },
            {
              path: 'media/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d74',
              format: 'webp',
              width: 777,
              height: 583,
              byteSize: 3000,
            },
            {
              path: 'media/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d75',
              format: 'jpeg',
              width: 777,
              height: 583,
              byteSize: 3500,
            },
          ],
          framing: { focalX: 0.25, focalY: 0.5, crop: { x: 0, y: 0.1, width: 1, height: 0.75 } },
        }}
      />,
    );

    expect(html).toContain('320w');
    expect(html).toContain('777w');
    expect(html).not.toContain('640w');
    expect(html).toContain('درمانگر در اتاق روشن درمانگاه');
    expect(html).toContain('width="777"');
    expect(html).toContain('height="583"');
    expect(html).toContain('sizes="50vw"');
    expect(html).toContain('height:133.33333333333334%');
  });
});
