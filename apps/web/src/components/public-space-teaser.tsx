'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { PublicImage, PublicSpace } from '@clinic/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PublicMediaImage } from './public-media-image';
import { toPersianNumber } from './public-content';

const HOVER_INTENT_MS = 90;

const DEVELOPMENT_SPACES = [
  {
    name: 'فضای کودک — نمونهٔ بصری',
    description: 'پیش‌نمایش چیدمان برای آزمودن زبان تصویری صفحه؛ نه نمایش فضای واقعی کلینیک.',
    image: '/dev/vala-synthetic/03-pediatric-room.jpg',
    detail: '/dev/vala-synthetic/12-therapist-child-interaction.jpg',
  },
  {
    name: 'فضای تمرین — نمونهٔ بصری',
    description: 'پیش‌نمایش توسعه برای سنجش قاب، نور و مقیاس؛ نه نمایش فضای واقعی کلینیک.',
    image: '/dev/vala-synthetic/02-rehab-gym.jpg',
    detail: '/dev/vala-synthetic/11-balance-therapy.jpg',
  },
] as const;

type SpaceView = {
  name: string;
  description: string | null;
  image: PublicImage | null;
  detail: PublicImage | null;
  developmentImage?: string;
  developmentDetail?: string;
};

export function PublicSpaceTeaser({
  spaces,
  full = false,
  showDevelopmentExamples = false,
}: {
  spaces: PublicSpace[];
  full?: boolean;
  showDevelopmentExamples?: boolean;
}) {
  const displayed: SpaceView[] = spaces.length
    ? spaces.map((space) => ({
        name: space.name,
        description: space.description,
        image: space.images[0] ?? null,
        detail: space.images[1] ?? null,
      }))
    : showDevelopmentExamples
      ? DEVELOPMENT_SPACES.map((space) => ({
          name: space.name,
          description: space.description,
          image: null,
          detail: null,
          developmentImage: space.image,
          developmentDetail: space.detail,
        }))
      : [];
  const viewportRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hoverTimerRef = useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const goTo = useCallback(
    (index: number) => {
      const nextIndex = Math.max(0, Math.min(index, displayed.length - 1));
      setActiveIndex(nextIndex);

      if (window.matchMedia('(max-width: 63.99rem)').matches) {
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const viewport = viewportRef.current;
        const target = panelRefs.current[nextIndex];
        if (viewport !== null && target !== null && target !== undefined) {
          const inlineDelta =
            target.getBoundingClientRect().right - viewport.getBoundingClientRect().right;
          viewport.scrollBy({ left: inlineDelta, behavior: reduceMotion ? 'auto' : 'smooth' });
        }
      }
    },
    [displayed.length],
  );

  const clearHoverIntent = useCallback(() => {
    if (hoverTimerRef.current === null) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }, []);

  const openOnHover = useCallback(
    (index: number, pointerType: string) => {
      if (
        pointerType === 'touch' ||
        !window.matchMedia('(hover: hover) and (pointer: fine)').matches ||
        !window.matchMedia('(min-width: 64rem)').matches
      ) {
        return;
      }
      clearHoverIntent();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return goTo(index);
      hoverTimerRef.current = window.setTimeout(() => {
        hoverTimerRef.current = null;
        goTo(index);
      }, HOVER_INTENT_MS);
    },
    [clearHoverIntent, goTo],
  );

  useEffect(() => clearHoverIntent, [clearHoverIntent]);

  if (displayed.length === 0) return null;
  const hasPrevious = activeIndex > 0;
  const hasNext = activeIndex < displayed.length - 1;

  return (
    <div
      className="public-space-browser"
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' && hasNext) {
          event.preventDefault();
          goTo(activeIndex + 1);
        }
        if (event.key === 'ArrowRight' && hasPrevious) {
          event.preventDefault();
          goTo(activeIndex - 1);
        }
      }}
    >
      <div ref={viewportRef} className="public-space-browser__panels" aria-label="فضاهای کلینیک">
        {displayed.map((space, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={`${space.name}-${index}`}
              ref={(node) => {
                panelRefs.current[index] = node;
              }}
              type="button"
              className="public-focus public-space-panel"
              aria-pressed={active}
              onPointerEnter={(event) => openOnHover(index, event.pointerType)}
              onPointerLeave={clearHoverIntent}
              onClick={() => {
                clearHoverIntent();
                goTo(index);
              }}
              onFocus={() => {
                clearHoverIntent();
                goTo(index);
              }}
            >
              {space.image ? (
                <PublicMediaImage
                  image={space.image}
                  sizes="(max-width: 47.99rem) 82vw, (max-width: 63.99rem) 68vw, 46vw"
                />
              ) : space.developmentImage ? (
                <Image
                  src={space.developmentImage}
                  fill
                  alt=""
                  sizes="(max-width: 47.99rem) 82vw, (max-width: 63.99rem) 68vw, 46vw"
                />
              ) : (
                <span className="public-media-empty">تصویر عمومی منتشر نشده است</span>
              )}
              <span className="public-space-panel__veil" aria-hidden="true" />
              <span className="public-space-panel__index">
                {toPersianNumber(String(index + 1).padStart(2, '0'))}
              </span>
              <span className="public-space-panel__copy">
                <strong>{space.name}</strong>
                {space.description ? <small>{space.description}</small> : null}
              </span>
              {space.detail || space.developmentDetail ? (
                <span className="public-space-panel__detail" aria-hidden="true">
                  {space.detail ? (
                    <PublicMediaImage image={space.detail} sizes="112px" />
                  ) : (
                    <Image src={space.developmentDetail!} fill alt="" sizes="112px" />
                  )}
                </span>
              ) : null}
              {space.developmentImage ? (
                <span className="public-photo-note">
                  تصویر نمونهٔ آزمایشی — نه فضای واقعی کلینیک
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="public-shell public-space-browser__controls-bar">
        <p aria-live="polite">
          فضای {toPersianNumber(String(activeIndex + 1).padStart(2, '0'))} از{' '}
          {toPersianNumber(String(displayed.length).padStart(2, '0'))}
        </p>
        <div className="public-track-dots" aria-label="انتخاب فضای کلینیک">
          {displayed.map((space, index) => (
            <button
              key={`${space.name}-${index}`}
              type="button"
              className="public-focus"
              data-active={activeIndex === index || undefined}
              onClick={() => goTo(index)}
              aria-label={`انتخاب ${space.name}`}
              aria-current={activeIndex === index ? 'true' : undefined}
            />
          ))}
        </div>
        <div className="public-team-track__controls" aria-label="پیمایش فضاها">
          <button
            type="button"
            className="public-focus public-track-button"
            onClick={() => goTo(activeIndex + 1)}
            disabled={!hasNext}
            aria-label="مشاهدهٔ فضای بعدی"
          >
            <span aria-hidden="true">←</span>
          </button>
          <button
            type="button"
            className="public-focus public-track-button"
            onClick={() => goTo(activeIndex - 1)}
            disabled={!hasPrevious}
            aria-label="مشاهدهٔ فضای قبلی"
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
      <div className="public-space-browser__footer">
        {spaces.length ? (
          <p>تصاویر و توضیحات منتشرشدهٔ فضاهای کلینیک</p>
        ) : (
          <p>نمونه‌های توسعه؛ نه فضای واقعی کلینیک</p>
        )}
        {!full ? (
          <Link href="/about#spaces" className="public-focus public-space-browser__future">
            <strong>دربارهٔ کلینیک و فضاها</strong>
            <small>دیدن تجربهٔ کامل فضاها</small>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
