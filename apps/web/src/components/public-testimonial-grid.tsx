'use client';

import type { PublicTestimonial } from '@clinic/contracts';
import { useState } from 'react';
import { toPersianNumber } from './public-content';

const developmentCards = [
  {
    front: 'نمونهٔ نمایشی کارت دست‌نویس',
    back: 'در نسخهٔ واقعی، رونویسی تأییدشدهٔ دست‌نوشته در این سمت نمایش داده می‌شود.',
  },
  {
    front: 'نمونهٔ دومِ حالت دست‌نویس',
    back: 'این محتوا صرفاً رفتار و چیدمان کارت را نشان می‌دهد و روایت یک خانواده نیست.',
  },
] as const;

export function PublicTestimonialGrid({
  testimonials,
  showDevelopmentExamples,
}: {
  testimonials: PublicTestimonial[];
  showDevelopmentExamples: boolean;
}) {
  const [flipped, setFlipped] = useState<number | null>(null);

  return (
    <div className="b2-stories__grid">
      {testimonials.map((testimonial, index) => (
        <figure key={`${testimonial.body}-${index}`} className="b2-story-card b2-story-card--typed">
          <span>TEXT ONLY · {toPersianNumber(String(index + 1).padStart(2, '0'))}</span>
          <blockquote>«{testimonial.body}»</blockquote>
          {testimonial.authorLabel ? <figcaption>{testimonial.authorLabel}</figcaption> : null}
        </figure>
      ))}
      {showDevelopmentExamples
        ? developmentCards.map((card, index) => {
            const active = flipped === index;
            return (
              <button
                key={card.front}
                type="button"
                className="public-focus b2-story-card b2-story-card--handwritten"
                data-flipped={active || undefined}
                onClick={() => setFlipped(active ? null : index)}
                aria-pressed={active}
                aria-label={`${card.front}. نمایش رونویسی`}
              >
                <span className="b2-story-card__face b2-story-card__front">
                  <small>HANDWRITTEN · نمونهٔ توسعه</small>
                  <strong>{card.front}</strong>
                  <em>رونویسی تایپ‌شده ←</em>
                </span>
                <span className="b2-story-card__face b2-story-card__back">
                  <small>رونویسی نمونه</small>
                  <strong>{card.back}</strong>
                  <em>بازگشت →</em>
                </span>
              </button>
            );
          })
        : null}
    </div>
  );
}
