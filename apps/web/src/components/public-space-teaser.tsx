'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';

const spaces = [
  {
    name: 'فضای کودک',
    caption: 'نمونهٔ چیدمان برای آشنایی پیش از مراجعه',
    image: '/dev/vala-synthetic/03-pediatric-room.jpg',
  },
  {
    name: 'فضای تمرین',
    caption: 'نمونهٔ تصویری برای نمایش زبان فضایی آینده',
    image: '/dev/vala-synthetic/02-rehab-gym.jpg',
  },
  {
    name: 'فضای درمان',
    caption: 'نمونهٔ تصویری؛ اطلاعات واقعی پس از تأیید مالک جایگزین می‌شود',
    image: '/dev/vala-synthetic/04-treatment-room.jpg',
  },
] as const;

const persianIndices = ['۰۱', '۰۲', '۰۳'] as const;

export function PublicSpaceTeaser() {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <div className="public-space-browser">
      <div className="public-space-browser__panels" aria-label="پیش‌نمایش فضاهای کلینیک">
        {spaces.map((space, index) => {
          const active = index === activeIndex;
          return (
            <button
              key={space.name}
              type="button"
              className="public-focus public-space-panel"
              aria-pressed={active}
              onClick={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
            >
              <Image
                src={space.image}
                fill
                alt=""
                sizes="(max-width: 47.99rem) 82vw, 48vw"
                priority={index === 0}
              />
              <span className="public-space-panel__veil" aria-hidden="true" />
              <span className="public-space-panel__index">{persianIndices[index]}</span>
              <span className="public-space-panel__copy">
                <strong>{space.name}</strong>
                <small>{space.caption}</small>
              </span>
            </button>
          );
        })}
      </div>
      <div className="public-space-browser__footer">
        <p>تصاویر آزمایشی‌اند و فضای واقعی کلینیک والا را نشان نمی‌دهند.</p>
        <Link href="/about" className="public-focus public-text-link">
          دربارهٔ والا و فضاها
        </Link>
      </div>
    </div>
  );
}
