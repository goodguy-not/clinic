import type { MediaFraming } from '@clinic/contracts';
import type { CSSProperties } from 'react';

export const MEDIA_PREVIEW_ASPECT = 16 / 9;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Computes the exact normalised rectangle visible in a cover-style slot.
 * Fractions are the A5 wire format, so the result can be previewed immediately
 * and sent unchanged for every rendition width.
 */
export function framingForSlot(
  sourceWidth: number,
  sourceHeight: number,
  slotAspect: number,
  focalX: number,
  focalY: number,
): MediaFraming {
  const safeX = clamp(focalX, 0, 1);
  const safeY = clamp(focalY, 0, 1);
  const imageAspect = sourceWidth / sourceHeight;

  if (imageAspect > slotAspect) {
    const width = slotAspect / imageAspect;
    return {
      focalX: safeX,
      focalY: safeY,
      crop: { x: clamp(safeX - width / 2, 0, 1 - width), y: 0, width, height: 1 },
    };
  }

  const height = imageAspect / slotAspect;
  return {
    focalX: safeX,
    focalY: safeY,
    crop: { x: 0, y: clamp(safeY - height / 2, 0, 1 - height), width: 1, height },
  };
}

/**
 * Warn when the point the colleague marked as important sits at the edge of
 * the actual visible rectangle. No subject-detection claim is made: the user
 * identifies what matters, and the warning describes only the resulting crop.
 */
export function hasPoorCrop(framing: MediaFraming): boolean {
  if (framing.crop === null) return false;
  const withinX = (framing.focalX - framing.crop.x) / framing.crop.width;
  const withinY = (framing.focalY - framing.crop.y) / framing.crop.height;
  return withinX < 0.14 || withinX > 0.86 || withinY < 0.14 || withinY > 0.86;
}

export function cropImageStyle(framing: MediaFraming): CSSProperties {
  if (framing.crop === null) {
    return {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      objectPosition: `${framing.focalX * 100}% ${framing.focalY * 100}%`,
    };
  }

  return {
    position: 'absolute',
    maxWidth: 'none',
    width: `${100 / framing.crop.width}%`,
    height: `${100 / framing.crop.height}%`,
    // Media coordinates are physically left-to-right even in the Persian UI.
    left: `${(-framing.crop.x * 100) / framing.crop.width}%`,
    top: `${(-framing.crop.y * 100) / framing.crop.height}%`,
  };
}
