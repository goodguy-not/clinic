'use client';

import Image from 'next/image';
import { useCallback, useRef, useState } from 'react';

const spaces = [
  {
    name: 'فضای کودک — نمونهٔ بصری',
    caption: 'پیش‌نمایش چیدمان برای آزمودن زبان تصویری صفحه؛ نه نمایش فضای واقعی والا.',
    image: '/dev/vala-synthetic/03-pediatric-room.jpg',
    detail: '/dev/vala-synthetic/12-therapist-child-interaction.jpg',
  },
  {
    name: 'فضای تمرین — نمونهٔ بصری',
    caption: 'پیش‌نمایش توسعه برای سنجش قاب، نور و مقیاس؛ نه نمایش فضای واقعی والا.',
    image: '/dev/vala-synthetic/02-rehab-gym.jpg',
    detail: '/dev/vala-synthetic/11-balance-therapy.jpg',
  },
  {
    name: 'فضای درمان — نمونهٔ بصری',
    caption: 'پیش‌نمایش توسعه برای ترکیب عکس اصلی و جزئیات نزدیک؛ نه یک ادعای کلینیکی.',
    image: '/dev/vala-synthetic/04-treatment-room.jpg',
    detail: '/dev/vala-synthetic/13-hand-therapy-detail.jpg',
  },
  {
    name: 'پذیرش — نمونهٔ بصری',
    caption: 'پیش‌نمایش توسعه برای آشنایی پیش از مراجعه؛ مشخصات واقعی هنوز منتشر نشده است.',
    image: '/dev/vala-synthetic/01-reception.jpg',
    detail: '/dev/vala-synthetic/06-brand-wall.jpg',
  },
  {
    name: 'مسیر ورود — نمونهٔ بصری',
    caption: 'پیش‌نمایش توسعه برای آزمودن مسیر روایت فضاها؛ نه نمایش ساختمان واقعی والا.',
    image: '/dev/vala-synthetic/05-corridor.jpg',
    detail: '/dev/vala-synthetic/01-reception.jpg',
  },
] as const;

const persianIndices = ['۰۱', '۰۲', '۰۳', '۰۴', '۰۵'] as const;

export function PublicSpaceTeaser() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const goTo = useCallback((index: number) => {
    const nextIndex = Math.max(0, Math.min(index, spaces.length - 1));
    setActiveIndex(nextIndex);

    if (window.matchMedia('(max-width: 63.99rem)').matches) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const viewport = viewportRef.current;
      const target = panelRefs.current[nextIndex];
      if (viewport !== null && target !== null && target !== undefined) {
        const inlineDelta =
          target.getBoundingClientRect().right - viewport.getBoundingClientRect().right;
        viewport.scrollBy({
          left: inlineDelta,
          behavior: reduceMotion ? 'auto' : 'smooth',
        });
      }
    }
  }, []);

  const hasPrevious = activeIndex > 0;
  const hasNext = activeIndex < spaces.length - 1;

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
      <div className="public-shell public-space-browser__toolbar">
        <p aria-live="polite">
          فضای {persianIndices[activeIndex]} از {persianIndices.at(-1)}
        </p>
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
      <div
        ref={viewportRef}
        className="public-space-browser__panels"
        aria-label="پیش‌نمایش فضاهای کلینیک"
      >
        {spaces.map((space, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={space.name}
              ref={(node) => {
                panelRefs.current[index] = node;
              }}
              type="button"
              className="public-focus public-space-panel"
              aria-pressed={active}
              onClick={() => goTo(index)}
              onFocus={() => goTo(index)}
            >
              <Image
                src={space.image}
                fill
                alt=""
                sizes="(max-width: 47.99rem) 82vw, (max-width: 63.99rem) 68vw, 46vw"
                priority={index === 0}
              />
              <span className="public-space-panel__veil" aria-hidden="true" />
              <span className="public-space-panel__index">{persianIndices[index]}</span>
              <span className="public-space-panel__copy">
                <strong>{space.name}</strong>
                <small>{space.caption}</small>
              </span>
              <span className="public-space-panel__detail" aria-hidden="true">
                <Image src={space.detail} fill alt="" sizes="112px" />
              </span>
            </button>
          );
        })}
      </div>
      <div className="public-space-browser__footer">
        <p>تصاویر آزمایشی‌اند و فضای واقعی کلینیک والا را نشان نمی‌دهند.</p>
        <span className="public-space-browser__future">
          <strong>دربارهٔ والا و فضاها</strong>
          <small>معرفی کامل فضاها هنوز منتشر نشده است.</small>
        </span>
        <div className="public-track-dots" aria-label="انتخاب فضای پیش‌نمایش">
          {spaces.map((space, index) => (
            <button
              key={space.name}
              type="button"
              className="public-focus"
              data-active={activeIndex === index || undefined}
              onClick={() => goTo(index)}
              aria-label={`انتخاب ${space.name}`}
              aria-current={activeIndex === index ? 'true' : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
