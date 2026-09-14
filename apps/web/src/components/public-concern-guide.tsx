'use client';

import type { PublicClinicContentEntry } from '@clinic/contracts';
import { useState } from 'react';
import { PublicMediaImage } from './public-media-image';

export type PublicConcernContent = Omit<PublicClinicContentEntry, 'slot'>;

export function PublicConcernGuide({
  clinicName,
  cityLabel,
  hero,
  concerns,
}: {
  clinicName: string | null;
  cityLabel: string | null;
  hero: PublicConcernContent;
  concerns: PublicConcernContent[];
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = concerns[activeIndex] ?? concerns[0];
  const identity = [clinicName, cityLabel].filter(Boolean).join(' · ');

  return (
    <section className="public-start" aria-labelledby="start-title">
      <div className="public-start__glow" aria-hidden="true" />
      <div className="public-shell public-start__layout">
        <div className="public-start__questions">
          {hero.eyebrow || identity ? (
            <p className="public-eyebrow">
              <span aria-hidden="true" />
              {hero.eyebrow ?? identity}
            </p>
          ) : null}
          <h1 id="start-title">{hero.heading}</h1>
          {hero.body ? <p className="public-start__lead">{hero.body}</p> : null}
          {concerns.length ? (
            <div className="public-concerns" aria-label="انتخاب نزدیک‌ترین شرح به شرایط شما">
              {concerns.map((concern, index) => (
                <button
                  key={`${concern.label ?? concern.heading}-${index}`}
                  type="button"
                  className="public-focus public-concern"
                  aria-pressed={index === activeIndex}
                  aria-controls="public-concern-answer"
                  onClick={() => setActiveIndex(index)}
                >
                  <span>{concern.label ?? concern.heading}</span>
                  {concern.eyebrow ? <small>{concern.eyebrow}</small> : null}
                </button>
              ))}
            </div>
          ) : null}
          {concerns.length > 1 ? (
            <p className="public-start__help">با انتخاب هر جمله، راهنمای روبه‌رو تغییر می‌کند.</p>
          ) : null}
        </div>

        {active ? (
          <article id="public-concern-answer" className="public-answer" aria-live="polite">
            <div className="public-answer__media">
              {active.image ? (
                <PublicMediaImage
                  key={active.image.mediaId}
                  image={active.image}
                  sizes="(max-width: 47.99rem) 100vw, 44vw"
                  priority
                />
              ) : (
                <span className="public-media-empty">تصویر عمومی منتشر نشده است</span>
              )}
            </div>
            <div className="public-answer__copy">
              {active.eyebrow ? (
                <p className="public-kicker public-kicker--gold">{active.eyebrow}</p>
              ) : null}
              <h2>{active.heading}</h2>
              {active.body ? <p>{active.body}</p> : null}
              <div className="public-answer__actions">
                <a href="/request" className="public-focus public-button public-button--gold">
                  درخواست ارزیابی
                  <span aria-hidden="true">←</span>
                </a>
                <a
                  href="#services"
                  className="public-focus public-text-link public-text-link--light"
                >
                  آشنایی با خدمات منتشرشده
                </a>
              </div>
              <p className="public-answer__truth">
                اطلاعات شما ثبت می‌شود، کلینیک آن را بررسی می‌کند و برای هماهنگی ارزیابی تماس
                می‌گیرد. نوبتی خودکار رزرو نمی‌شود.
              </p>
            </div>
          </article>
        ) : null}
      </div>
    </section>
  );
}
