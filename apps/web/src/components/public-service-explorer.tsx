'use client';

import { useState } from 'react';
import type { PublicServiceSummary } from '@clinic/contracts';
import Image from 'next/image';

const DEVELOPMENT_IMAGES = [
  '/dev/vala-synthetic/12-therapist-child-interaction.jpg',
  '/dev/vala-synthetic/13-hand-therapy-detail.jpg',
  '/dev/vala-synthetic/11-balance-therapy.jpg',
  '/dev/vala-synthetic/03-pediatric-room.jpg',
  '/dev/vala-synthetic/02-rehab-gym.jpg',
  '/dev/vala-synthetic/04-treatment-room.jpg',
] as const;

export function PublicServiceExplorer({ services }: { services: PublicServiceSummary[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = services[activeIndex] ?? services[0];

  if (active === undefined) return null;

  const select = (index: number) => setActiveIndex(index);

  return (
    <div className="public-service-explorer">
      <div className="public-service-explorer__list" aria-label="انتخاب خدمت برای مشاهدهٔ توضیح">
        {services.map((service, index) => (
          <button
            type="button"
            key={service.slug}
            className="public-service-choice public-focus"
            aria-pressed={index === activeIndex}
            aria-controls="public-service-stage"
            onClick={() => select(index)}
            onFocus={() => select(index)}
            onMouseEnter={() => select(index)}
          >
            <span className="public-service-choice__marker" aria-hidden="true" />
            <span>{service.name}</span>
            <span className="public-service-choice__arrow" aria-hidden="true">
              ↙
            </span>
          </button>
        ))}
      </div>

      <article id="public-service-stage" className="public-service-stage" aria-live="polite">
        <div className="public-service-stage__image">
          <Image
            key={active.slug}
            src={DEVELOPMENT_IMAGES[activeIndex % DEVELOPMENT_IMAGES.length]!}
            width="700"
            height="470"
            alt=""
            sizes="(max-width: 54rem) 100vw, 55vw"
          />
          <span className="public-photo-note">تصویر آزمایشی</span>
        </div>
        <div className="public-service-stage__copy">
          <p>خدمت انتخاب‌شده</p>
          <h3>{active.name}</h3>
          <p>
            {active.description ??
              'توضیح تأییدشدهٔ این خدمت پس از تکمیل محتوای کلینیک در همین بخش نمایش داده می‌شود.'}
          </p>
        </div>
      </article>
    </div>
  );
}
