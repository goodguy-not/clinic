'use client';

import Image from 'next/image';
import { useState } from 'react';

const concerns = [
  {
    label: 'فرزندم در گفتن یا ارتباط گرفتن دشواری دارد',
    hint: 'گفتار و ارتباط',
    title: 'اول شرایط را می‌شنویم و مسیر ارزیابی را روشن می‌کنیم',
    body: 'لازم نیست نام تخصصی مسئله را بدانید. اطلاعات اولیه کمک می‌کند تیم والا بعد از بررسی، برای هماهنگی قدم بعدی با شما تماس بگیرد.',
    image: '/dev/vala-synthetic/03-pediatric-room.jpg',
  },
  {
    label: 'انجام کارهای روزمره یا بازی برای فرزندم سخت است',
    hint: 'مهارت‌های روزمره',
    title: 'از کارهایی شروع می‌کنیم که در زندگی روزمره مهم‌اند',
    body: 'در ارزیابی، شرایط خانواده و فعالیت‌های روزانه کنار هم دیده می‌شوند تا پیشنهاد بعدی بر پایهٔ نیاز واقعی باشد، نه حدس از راه دور.',
    image: '/dev/vala-synthetic/12-therapist-child-interaction.jpg',
  },
  {
    label: 'بعد از آسیب، جراحی یا بیماری به ادامهٔ مسیر نیاز دارم',
    hint: 'حرکت و بازگشت',
    title: 'اطلاعات فعلی شما نقطهٔ شروع گفت‌وگوست',
    body: 'تیم والا اطلاعات فرستاده‌شده را مرور می‌کند و برای هماهنگی ارزیابی تماس می‌گیرد؛ این درخواست به معنی رزرو خودکار نوبت نیست.',
    image: '/dev/vala-synthetic/11-balance-therapy.jpg',
  },
  {
    label: 'درد یا محدودیت حرکت دارم',
    hint: 'حرکت و فعالیت',
    title: 'ارزیابی کمک می‌کند قدم بعد بر پایهٔ شرایط شما انتخاب شود',
    body: 'به‌جای انتخاب عجولانهٔ یک خدمت، می‌توانید شرح کوتاهی ثبت کنید تا تیم والا آن را بررسی و مسیر هماهنگی را با شما دنبال کند.',
    image: '/dev/vala-synthetic/13-hand-therapy-detail.jpg',
  },
  {
    label: 'چیز دیگری است یا هنوز مطمئن نیستم',
    hint: 'راهنمایی می‌کنیم',
    title: 'ندانستن نام خدمت، مانع شروع نیست',
    body: 'اگر هنوز مطمئن نیستید از کجا شروع کنید، همان چیزی را که می‌بینید یا تجربه می‌کنید برای ما بنویسید. انتخاب خدمت اجباری نیست.',
    image: '/dev/vala-synthetic/01-reception.jpg',
  },
] as const;

export function PublicConcernGuide({ cityLabel }: { cityLabel: string | null }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = concerns[activeIndex]!;

  return (
    <section className="public-start" aria-labelledby="start-title">
      <div className="public-start__glow" aria-hidden="true" />
      <div className="public-shell public-start__layout">
        <div className="public-start__questions">
          <p className="public-eyebrow">
            <span aria-hidden="true" />
            کلینیک توانبخشی والا{cityLabel !== null ? ` · ${cityLabel}` : ''}
          </p>
          <h1 id="start-title">از کجا شروع کنیم؟</h1>
          <p className="public-start__lead">
            اسم تخصصی مسئله را لازم نیست بدانید. یکی از این جمله‌ها را انتخاب کنید تا مسیر شروع
            روشن‌تر شود.
          </p>
          <div className="public-concerns" aria-label="انتخاب نزدیک‌ترین شرح به شرایط شما">
            {concerns.map((concern, index) => (
              <button
                key={concern.label}
                type="button"
                className="public-focus public-concern"
                aria-pressed={index === activeIndex}
                aria-controls="public-concern-answer"
                onClick={() => setActiveIndex(index)}
              >
                <span>{concern.label}</span>
                <small>{concern.hint}</small>
              </button>
            ))}
          </div>
          <p className="public-start__help">با انتخاب هر جمله، راهنمای روبه‌رو تغییر می‌کند.</p>
        </div>

        <article id="public-concern-answer" className="public-answer" aria-live="polite">
          <div className="public-answer__media">
            <Image
              key={active.image}
              src={active.image}
              width="760"
              height="450"
              alt=""
              loading="eager"
              sizes="(max-width: 47.99rem) 100vw, 44vw"
            />
            <span className="public-photo-note">تصویر آزمایشی — نه فضای واقعی والا</span>
          </div>
          <div className="public-answer__copy">
            <p className="public-kicker public-kicker--gold">برای این شرایط، در والا…</p>
            <h2>{active.title}</h2>
            <p>{active.body}</p>
            <div className="public-answer__actions">
              <a href="#request" className="public-focus public-button public-button--gold">
                درخواست ارزیابی
                <span aria-hidden="true">←</span>
              </a>
              <a href="#services" className="public-focus public-text-link public-text-link--light">
                آشنایی با خدمات منتشرشده
              </a>
            </div>
            <p className="public-answer__truth">
              اطلاعات شما ثبت می‌شود، تیم والا آن را بررسی می‌کند و برای هماهنگی ارزیابی تماس
              می‌گیرد. نوبتی خودکار رزرو نمی‌شود.
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}
