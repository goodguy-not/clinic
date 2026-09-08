import { describe, expect, it } from 'vitest';
import { framingForSlot, hasPoorCrop, MEDIA_PREVIEW_ASPECT } from './framing';
import { nextMediaWorkflowStep } from './workflow';

describe('media slot framing', () => {
  it('creates the exact visible rectangle for landscape and portrait phone photographs', () => {
    const landscape = framingForSlot(4032, 3024, MEDIA_PREVIEW_ASPECT, 0.5, 0.5);
    const portrait = framingForSlot(3024, 4032, MEDIA_PREVIEW_ASPECT, 0.5, 0.5);

    expect(landscape.crop).toMatchObject({ x: 0, width: 1 });
    expect(landscape.crop?.height).toBeCloseTo(0.75);
    expect(landscape.crop?.y).toBeCloseTo(0.125);
    expect(portrait.crop).toMatchObject({ x: 0, width: 1 });
    expect(portrait.crop?.height).toBeCloseTo(0.421875);
    expect(portrait.crop?.y).toBeCloseTo(0.2890625);
  });

  it('moves the crop around the marked subject without changing the source', () => {
    const top = framingForSlot(3024, 4032, MEDIA_PREVIEW_ASPECT, 0.5, 0.1);
    const bottom = framingForSlot(3024, 4032, MEDIA_PREVIEW_ASPECT, 0.5, 0.9);

    expect(top.crop?.y).toBe(0);
    expect(bottom.crop?.y).toBeCloseTo(1 - (bottom.crop?.height ?? 0));
    expect(top.focalY).toBe(0.1);
    expect(bottom.focalY).toBe(0.9);
  });

  it('warns when the marked subject falls against the visible edge', () => {
    expect(hasPoorCrop(framingForSlot(4000, 3000, MEDIA_PREVIEW_ASPECT, 0.5, 0.5))).toBe(false);
    expect(hasPoorCrop(framingForSlot(4000, 3000, MEDIA_PREVIEW_ASPECT, 0.5, 0))).toBe(true);
  });
});

describe('retry progression', () => {
  it('resumes attachment and framing without returning to upload', () => {
    expect(nextMediaWorkflowStep({ mediaId: null, attachmentId: null, framingSaved: false })).toBe(
      'upload',
    );
    expect(
      nextMediaWorkflowStep({ mediaId: 'media', attachmentId: null, framingSaved: false }),
    ).toBe('attach');
    expect(
      nextMediaWorkflowStep({ mediaId: 'media', attachmentId: 'attachment', framingSaved: false }),
    ).toBe('frame');
    expect(
      nextMediaWorkflowStep({ mediaId: 'media', attachmentId: 'attachment', framingSaved: true }),
    ).toBe('complete');
  });
});
