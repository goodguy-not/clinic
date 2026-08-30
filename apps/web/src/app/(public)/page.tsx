import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type {
  PublicClinicProfile,
  PublicServiceSummary,
  PublicTherapistProfile,
} from '@clinic/contracts';
import { PublicConcernGuide } from '@/components/public-concern-guide';
import { PublicServiceExplorer } from '@/components/public-service-explorer';
import { PublicSpaceTeaser } from '@/components/public-space-teaser';
import { PublicTeamTrack } from '@/components/public-team-track';
import { getPublicHomeData, type PublicRead } from '@/server/public-site';

export const revalidate = 900;

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'کلینیک توانبخشی والا',
    description: 'آشنایی با خدمات، تیم درمان و راه‌های ارتباط با کلینیک توانبخشی والا.',
    robots: { index: true, follow: true },
  };
}

export default async function PublicHomePage() {
  const home = await getPublicHomeData();
  const clinic = home.clinic.data;

  return (
    <main id="main-content">
      <PublicConcernGuide cityLabel={clinic.cityLabel} />
      <FirstVisit />
      <Services read={home.services} />
      <Team read={home.team} />
      <Spaces clinic={clinic} />
      <FamilyExperienceBoundary />
      <EvaluationEntry clinic={clinic} profileStatus={home.clinic.status} />
    </main>
  );
}

function FirstVisit() {
  const persianMomentNumbers = ['۱', '۲', '۳'] as const;
  const moments = [
    {
      title: 'آشنا می‌شویم',
      text: 'اول گفت‌وگو می‌کنیم و فرصت می‌دهیم محیط و آدم‌ها آشناتر شوند.',
    },
    {
      title: 'شرایط را بهتر می‌فهمیم',
      text: 'آنچه خانواده می‌بیند و اطلاعاتی که همراه دارد، بخشی از ارزیابی است.',
    },
    {
      title: 'قدم بعد را روشن می‌کنیم',
      text: 'در پایان، پیشنهاد تیم و دلیل آن برای ادامهٔ مسیر توضیح داده می‌شود.',
    },
  ] as const;

  return (
    <section className="public-first-visit" aria-labelledby="first-visit-title">
      <div className="public-first-visit__layout">
        <div className="public-first-visit__copy">
          <p className="public-kicker">در والا چه می‌گذرد؟</p>
          <h2 id="first-visit-title">جلسهٔ اول، بیشتر از هر چیز، آشنا شدن است</h2>
          <div className="public-moments">
            {moments.map((moment, index) => (
              <article key={moment.title}>
                <span>{persianMomentNumbers[index]}</span>
                <h3>{moment.title}</h3>
                <p>{moment.text}</p>
              </article>
            ))}
          </div>
        </div>
        <figure className="public-first-visit__media">
          <Image
            src="/dev/vala-synthetic/12-therapist-child-interaction.jpg"
            width="980"
            height="810"
            alt=""
            sizes="(max-width: 47.99rem) 100vw, 31vw"
            loading="eager"
          />
          <figcaption>تصویر آزمایشی — نه مراجع یا درمانگر واقعی والا</figcaption>
        </figure>
      </div>
    </section>
  );
}

function Services({ read }: { read: PublicRead<PublicServiceSummary[]> }) {
  const services = read.data.slice(0, 6);

  return (
    <section id="services" className="public-services" aria-labelledby="services-title">
      <div className="public-section-heading public-shell">
        <div>
          <p className="public-kicker">خدمات</p>
          <h2 id="services-title">در والا چه کارهایی انجام می‌شود</h2>
        </div>
        <p>نام هر خدمت را انتخاب کنید؛ تصویر و توضیح تأییدشده همان‌جا تغییر می‌کند.</p>
        <Link href="/services" className="public-focus public-text-link">
          همهٔ خدمات <span aria-hidden="true">←</span>
        </Link>
      </div>

      {services.length > 0 ? (
        <PublicServiceExplorer services={services} />
      ) : (
        <div className="public-shell">
          <PublicEmpty
            unavailable={read.status === 'unavailable'}
            title="فهرست خدمات هنوز آمادهٔ نمایش نیست"
            text="پس از انتشار محتوای تأییدشدهٔ کلینیک، خدمات در این بخش دیده می‌شوند."
          />
        </div>
      )}
    </section>
  );
}

function Team({ read }: { read: PublicRead<PublicTherapistProfile[]> }) {
  return (
    <section id="team" className="public-team" aria-labelledby="team-title">
      <div className="public-shell">
        <div className="public-team__heading">
          <div>
            <p className="public-kicker">تیم درمان</p>
            <h2 id="team-title">با چه کسی کار می‌کنید؟</h2>
          </div>
          <p>
            فقط پروفایل‌های دارای رضایت برای حضور عمومی نمایش داده می‌شوند. تصاویر نشانه‌گذاری‌شده،
            موقت و آزمایشی‌اند.
          </p>
          <Link href="/team" className="public-focus public-text-link">
            همهٔ تیم درمان <span aria-hidden="true">←</span>
          </Link>
        </div>

        {read.data.length > 0 ? (
          <PublicTeamTrack therapists={read.data} />
        ) : (
          <PublicEmpty
            unavailable={read.status === 'unavailable'}
            title="پروفایل عمومی تیم هنوز منتشر نشده است"
            text="با تأیید پروفایل‌ها، اعضای تیم در این بخش معرفی می‌شوند."
          />
        )}
      </div>
    </section>
  );
}

function Spaces({ clinic }: { clinic: PublicClinicProfile }) {
  return (
    <section id="about" className="public-spaces" aria-labelledby="spaces-title">
      <div className="public-shell public-spaces__heading">
        <div>
          <p className="public-kicker">آشنایی پیش از مراجعه</p>
          <h2 id="spaces-title">فضاهای والا</h2>
        </div>
        <p>
          {clinic.about ??
            'این پیش‌نمایش فقط زبان تصویری بخش فضاها را نشان می‌دهد. معرفی و تصاویر تأییدشدهٔ کلینیک در مرحلهٔ محتوای عمومی جایگزین می‌شوند.'}
        </p>
      </div>
      <PublicSpaceTeaser />
    </section>
  );
}

function FamilyExperienceBoundary() {
  return (
    <section
      id="family-experience"
      className="public-family-boundary"
      aria-labelledby="family-experience-title"
    >
      <div className="public-shell public-family-boundary__layout">
        <div>
          <p className="public-kicker">تجربهٔ خانواده‌ها</p>
          <h2 id="family-experience-title">روایت خانواده، فقط با تأیید و بدون اطلاعات شناسایی</h2>
        </div>
        <p>
          این بخش در صفحهٔ اصلی جای خود را حفظ کرده است، اما تا زمان انتشار روایت‌های تأییدشده، هیچ
          نقل‌قول یا خانوادهٔ ساختگی نمایش نمی‌دهیم.
        </p>
        <Link href="/testimonials" className="public-focus public-text-link">
          تجربه‌های منتشرشده <span aria-hidden="true">←</span>
        </Link>
      </div>
    </section>
  );
}

function EvaluationEntry({
  clinic,
  profileStatus,
}: {
  clinic: PublicClinicProfile;
  profileStatus: PublicRead<unknown>['status'];
}) {
  const hasContact = [
    clinic.addressLine,
    clinic.cityLabel,
    clinic.phonePrimary,
    clinic.phoneSecondary,
    clinic.email,
    clinic.workingHoursNote,
  ].some((value) => value !== null);

  return (
    <section id="request" className="public-request" aria-labelledby="request-title">
      <div className="public-shell public-request__layout">
        <div className="public-request__intro">
          <p className="public-kicker public-kicker--gold">درخواست ارزیابی</p>
          <h2 id="request-title">اگر هنوز مطمئن نیستید، همین‌جا شروع کنید.</h2>
          <p>
            اطلاعات شما ثبت می‌شود، تیم والا آن را بررسی می‌کند و برای هماهنگی ارزیابی با خانواده
            تماس می‌گیرد. این کار به معنی رزرو یا تأیید نوبت نیست.
          </p>
          <div className="public-request__status" role="status">
            <span aria-hidden="true" />
            فرم درخواست در مرحلهٔ بعد فعال می‌شود
          </div>
        </div>

        <div id="contact" className="public-request__contact" aria-labelledby="contact-title">
          <p id="contact-title">راه‌های ارتباطی تأییدشده</p>
          {hasContact ? (
            <div className="public-contact-list">
              {clinic.phonePrimary !== null ? (
                <ContactItem label="تلفن اصلی">
                  <a href={`tel:${clinic.phonePrimary}`} className="public-focus public-text-link">
                    <bdi dir="ltr">{clinic.phonePrimary}</bdi>
                  </a>
                </ContactItem>
              ) : null}
              {clinic.phoneSecondary !== null ? (
                <ContactItem label="تلفن دیگر">
                  <a
                    href={`tel:${clinic.phoneSecondary}`}
                    className="public-focus public-text-link"
                  >
                    <bdi dir="ltr">{clinic.phoneSecondary}</bdi>
                  </a>
                </ContactItem>
              ) : null}
              {clinic.email !== null ? (
                <ContactItem label="ایمیل">
                  <a href={`mailto:${clinic.email}`} className="public-focus public-text-link">
                    <bdi dir="ltr">{clinic.email}</bdi>
                  </a>
                </ContactItem>
              ) : null}
              {clinic.addressLine !== null || clinic.cityLabel !== null ? (
                <ContactItem label="نشانی">
                  <span>{[clinic.cityLabel, clinic.addressLine].filter(Boolean).join('، ')}</span>
                </ContactItem>
              ) : null}
              {clinic.workingHoursNote !== null ? (
                <ContactItem label="ساعت پاسخ‌گویی">
                  <span>{clinic.workingHoursNote}</span>
                </ContactItem>
              ) : null}
            </div>
          ) : (
            <div className="public-contact-empty" role="status">
              <span aria-hidden="true">—</span>
              <p>
                {profileStatus === 'unavailable'
                  ? 'دریافت اطلاعات تماس موقتاً ممکن نیست. لطفاً کمی بعد دوباره بررسی کنید.'
                  : 'اطلاعات تماس تأییدشدهٔ کلینیک پس از تکمیل در این بخش نمایش داده می‌شود.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ContactItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="public-contact-item">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

function PublicEmpty({
  unavailable,
  title,
  text,
}: {
  unavailable: boolean;
  title: string;
  text: string;
}) {
  return (
    <div className="public-empty" role="status">
      <span aria-hidden="true">{unavailable ? '↻' : '—'}</span>
      <div>
        <h3>{unavailable ? 'نمایش اطلاعات موقتاً ممکن نیست' : title}</h3>
        <p>{unavailable ? 'صفحه همچنان در دسترس است؛ لطفاً کمی بعد دوباره بررسی کنید.' : text}</p>
      </div>
    </div>
  );
}
