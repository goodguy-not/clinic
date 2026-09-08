'use client';

import type { PublicTherapistProfile } from '@clinic/contracts';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PublicMediaImage } from './public-media-image';

const SYNTHETIC_PORTRAITS = [
  '/dev/vala-synthetic/08-therapist-portrait-b.jpg',
  '/dev/vala-synthetic/07-therapist-portrait-a.jpg',
  '/dev/vala-synthetic/10-therapist-portrait-d.jpg',
  '/dev/vala-synthetic/09-therapist-portrait-c.jpg',
] as const;

function getVisibleCount(width: number) {
  if (width >= 1182) return 4;
  if (width >= 940) return 3;
  if (width >= 620) return 2;
  return 1;
}

function toPersianNumber(value: number) {
  return String(value).replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]!);
}

export function PublicTeamTrack({ therapists }: { therapists: PublicTherapistProfile[] }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const scrollFrameRef = useRef<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(4);
  const [startIndex, setStartIndex] = useState(0);
  const [spotlightIndex, setSpotlightIndex] = useState<number | null>(null);

  const maxStart = Math.max(0, therapists.length - visibleCount);
  const pageStarts = useMemo(() => {
    const starts: number[] = [0];
    const step = Math.max(1, Math.min(2, visibleCount));
    for (let index = step; index < maxStart; index += step) starts.push(index);
    if (starts.at(-1) !== maxStart) starts.push(maxStart);
    return starts;
  }, [maxStart, visibleCount]);

  const goTo = useCallback(
    (index: number) => {
      const targetIndex = Math.max(0, Math.min(index, maxStart));
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const viewport = viewportRef.current;
      const target = itemRefs.current[targetIndex];
      if (viewport !== null && target !== null && target !== undefined) {
        const inlineDelta =
          target.getBoundingClientRect().right - viewport.getBoundingClientRect().right;
        viewport.scrollBy({
          left: inlineDelta,
          behavior: reduceMotion ? 'auto' : 'smooth',
        });
      }
      setStartIndex(targetIndex);
    },
    [maxStart],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;

    const update = () => {
      const nextCount = getVisibleCount(viewport.clientWidth);
      setVisibleCount(nextCount);
      setStartIndex((current) => Math.min(current, Math.max(0, therapists.length - nextCount)));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [therapists.length]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    },
    [],
  );

  const syncStartFromScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (viewport === null) return;

      const viewportRight = viewport.getBoundingClientRect().right;
      let closestIndex = 0;
      let closestDistance = Number.POSITIVE_INFINITY;
      itemRefs.current.forEach((item, index) => {
        if (item === null) return;
        const distance = Math.abs(item.getBoundingClientRect().right - viewportRight);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });

      const boundedIndex = Math.min(closestIndex, maxStart);
      const closestPage = pageStarts.reduce((closest, pageStart) =>
        Math.abs(pageStart - boundedIndex) < Math.abs(closest - boundedIndex) ? pageStart : closest,
      );
      setStartIndex(closestPage);
    });
  }, [maxStart, pageStarts]);

  const hasPrevious = startIndex > 0;
  const hasNext = startIndex < maxStart;
  const previousStart = [...pageStarts].reverse().find((pageStart) => pageStart < startIndex) ?? 0;
  const nextStart = pageStarts.find((pageStart) => pageStart > startIndex) ?? maxStart;

  return (
    <div
      className="public-team-track"
      onPointerLeave={() => setSpotlightIndex(null)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setSpotlightIndex(null);
      }}
    >
      <div className="public-team-track__toolbar">
        <p aria-live="polite">
          نمایش {toPersianNumber(Math.min(startIndex + 1, therapists.length))} تا{' '}
          {toPersianNumber(Math.min(startIndex + visibleCount, therapists.length))} از{' '}
          {toPersianNumber(therapists.length)} درمانگر
        </p>
        <div className="public-team-track__controls" aria-label="پیمایش تیم درمان">
          <button
            type="button"
            className="public-focus public-track-button"
            onClick={() => goTo(nextStart)}
            disabled={!hasNext}
            aria-label="مشاهدهٔ درمانگران بعدی"
          >
            <span aria-hidden="true">←</span>
          </button>
          <button
            type="button"
            className="public-focus public-track-button"
            onClick={() => goTo(previousStart)}
            disabled={!hasPrevious}
            aria-label="مشاهدهٔ درمانگران قبلی"
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="public-team-track__viewport"
        role="region"
        aria-label="فهرست افقی درمانگران"
        tabIndex={0}
        onPointerUp={syncStartFromScroll}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' && hasNext) {
            event.preventDefault();
            goTo(nextStart);
          }
          if (event.key === 'ArrowRight' && hasPrevious) {
            event.preventDefault();
            goTo(previousStart);
          }
        }}
      >
        <div className="public-team-track__rail">
          {therapists.map((person, index) => {
            const hasRealPhoto = person.photo !== null || person.photoPath !== null;
            const photo = hasRealPhoto
              ? person.photoPath === null
                ? ''
                : `/${person.photoPath}`
              : SYNTHETIC_PORTRAITS[index % SYNTHETIC_PORTRAITS.length]!;
            const isActive = spotlightIndex === index;
            const isReceded = spotlightIndex !== null && !isActive;

            return (
              <Link
                key={person.slug}
                href={`/team/${person.slug}`}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                className="public-person-card"
                data-active={isActive || undefined}
                data-receded={isReceded || undefined}
                aria-label={`${person.displayName}${person.title !== null ? `، ${person.title}` : ''}`}
                onPointerEnter={() => setSpotlightIndex(index)}
                onPointerDown={() => setSpotlightIndex(index)}
                onFocusCapture={() => setSpotlightIndex(index)}
              >
                <div className="public-person-card__media">
                  {person.photo !== null ? (
                    <PublicMediaImage
                      image={person.photo}
                      sizes="(max-width: 39rem) 76vw, (max-width: 74rem) 31vw, 22vw"
                    />
                  ) : (
                    <Image
                      src={photo}
                      width="620"
                      height="780"
                      alt={hasRealPhoto ? person.displayName : ''}
                      sizes="(max-width: 39rem) 76vw, (max-width: 74rem) 31vw, 22vw"
                    />
                  )}
                  {!hasRealPhoto ? (
                    <span className="public-photo-note">تصویر آزمایشی — این درمانگر نیست</span>
                  ) : null}
                </div>
                <div className="public-person-card__body">
                  <h3>{person.displayName}</h3>
                  {person.title !== null ? <p>{person.title}</p> : <p aria-hidden="true">&nbsp;</p>}
                  {person.bio !== null ? (
                    <small>{person.bio}</small>
                  ) : (
                    <small aria-hidden="true">&nbsp;</small>
                  )}
                  <span className="public-person-card__future">
                    دیدن پروفایل <span aria-hidden="true">←</span>
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="public-team-track__footer">
        <Link href="/team" className="public-focus public-team-track__future">
          <strong>همهٔ تیم درمان</strong>
          <small>دیدن همهٔ پروفایل‌های عمومی</small>
        </Link>
        {pageStarts.length > 1 ? (
          <div className="public-track-dots" aria-label="صفحه‌های تیم درمان">
            {pageStarts.map((pageStart, index) => (
              <button
                key={pageStart}
                type="button"
                className="public-focus"
                data-active={startIndex === pageStart || undefined}
                onClick={() => goTo(pageStart)}
                aria-label={`صفحهٔ ${toPersianNumber(index + 1)} تیم درمان`}
                aria-current={startIndex === pageStart ? 'true' : undefined}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
