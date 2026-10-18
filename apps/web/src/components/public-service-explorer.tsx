'use client';

import { useState } from 'react';
import type { PublicServiceSummary } from '@clinic/contracts';
import Link from 'next/link';
import { PublicMediaImage } from './public-media-image';

export function PublicServiceExplorer({
  services,
  priorityImage = false,
}: {
  services: PublicServiceSummary[];
  priorityImage?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = services[activeIndex] ?? services[0];

  if (active === undefined) return null;

  const select = (index: number) => setActiveIndex(index);

  return (
    <div className="public-service-explorer">
      <article id="public-service-stage" className="public-service-stage" aria-live="polite">
        <div className="public-service-stage__image">
          {active.image ? (
            <PublicMediaImage image={active.image} sizes="100vw" priority={priorityImage} />
          ) : (
            <span className="public-media-empty">تصویر عمومی برای این خدمت منتشر نشده است</span>
          )}
        </div>
        <div className="public-service-stage__copy">
          <p className="public-kicker public-kicker--gold">خدمت منتشرشده</p>
          <h3>{active.name}</h3>
          <p>
            {active.description ??
              'توضیح تأییدشدهٔ این خدمت پس از تکمیل محتوای کلینیک در همین بخش نمایش داده می‌شود.'}
          </p>
          <div className="public-service-stage__actions">
            <Link
              href={`/services/${active.slug}`}
              className="public-focus public-text-link public-text-link--light"
            >
              دیدن جزئیات
            </Link>
            <Link
              href={`/request?service=${encodeURIComponent(active.slug)}`}
              className="public-focus public-button public-button--service"
            >
              درخواست ارزیابی
            </Link>
          </div>
        </div>
      </article>

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
          >
            <span>{service.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
