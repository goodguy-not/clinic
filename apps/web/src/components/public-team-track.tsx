'use client';

import type { PublicTherapistProfile } from '@clinic/contracts';
import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SYNTHETIC_PORTRAITS = [
  '/dev/vala-synthetic/08-therapist-portrait-b.jpg',
  '/dev/vala-synthetic/07-therapist-portrait-a.jpg',
  '/dev/vala-synthetic/10-therapist-portrait-d.jpg',
  '/dev/vala-synthetic/09-therapist-portrait-c.jpg',
] as const;

function getVisibleCount(width: number) {
  if (width >= 1180) return 4;
  if (width >= 880) return 3;
  if (width >= 620) return 2;
  return 1;
}

function toPersianNumber(value: number) {
  return String(value).replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]!);
}

export function PublicTeamTrack({ therapists }: { therapists: PublicTherapistProfile[] }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const [visibleCount, setVisibleCount] = useState(4);
  const [startIndex, setStartIndex] = useState(0);
  const [spotlightIndex, setSpotlightIndex] = useState<number | null>(null);

  const maxStart = Math.max(0, therapists.length - visibleCount);
  const pageStarts = useMemo(() => {
    const starts: number[] = [];
    for (let index = 0; index < maxStart; index += 2) starts.push(index);
    if (starts.at(-1) !== maxStart) starts.push(maxStart);
    return starts.length > 0 ? starts : [0];
  }, [maxStart]);

  const goTo = useCallback(
    (index: number) => {
      const targetIndex = Math.max(0, Math.min(index, maxStart));
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      itemRefs.current[targetIndex]?.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'nearest',
        inline: 'start',
      });
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

  const step = Math.max(1, Math.min(2, visibleCount));
  const hasPrevious = startIndex > 0;
  const hasNext = startIndex < maxStart;

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
            onClick={() => goTo(startIndex + step)}
            disabled={!hasNext}
            aria-label="مشاهدهٔ درمانگران بعدی"
          >
            <span aria-hidden="true">←</span>
          </button>
          <button
            type="button"
            className="public-focus public-track-button"
            onClick={() => goTo(startIndex - step)}
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
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' && hasNext) {
            event.preventDefault();
            goTo(startIndex + step);
          }
          if (event.key === 'ArrowRight' && hasPrevious) {
            event.preventDefault();
            goTo(startIndex - step);
          }
        }}
      >
        <div className="public-team-track__rail">
          {therapists.map((person, index) => {
            const hasRealPhoto = person.photoPath !== null;
            const photo = hasRealPhoto
              ? `/${person.photoPath}`
              : SYNTHETIC_PORTRAITS[index % SYNTHETIC_PORTRAITS.length]!;
            const isActive = spotlightIndex === index;
            const isReceded = spotlightIndex !== null && !isActive;

            return (
              <article
                key={person.slug}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                className="public-person-card"
                data-active={isActive || undefined}
                data-receded={isReceded || undefined}
                onPointerEnter={() => setSpotlightIndex(index)}
                onPointerDown={() => setSpotlightIndex(index)}
                onFocusCapture={() => setSpotlightIndex(index)}
              >
                <div className="public-person-card__media">
                  <Image
                    src={photo}
                    width="620"
                    height="780"
                    alt={hasRealPhoto ? person.displayName : ''}
                    sizes="(max-width: 39rem) 76vw, (max-width: 74rem) 31vw, 22vw"
                  />
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
                  <Link
                    href={`/team/${person.slug}`}
                    className="public-focus public-text-link public-person-card__link"
                    aria-label={`مشاهدهٔ پروفایل ${person.displayName}`}
                  >
                    پروفایل درمانگر
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div className="public-team-track__footer">
        <Link href="/team" className="public-focus public-text-link">
          همهٔ تیم درمان
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
