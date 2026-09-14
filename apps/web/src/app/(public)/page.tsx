import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type {
  PublicClinicContentEntry,
  PublicClinicProfile,
  PublicSpace,
  PublicServiceSummary,
  PublicTherapistProfile,
} from '@clinic/contracts';
import { PublicConcernGuide, type PublicConcernContent } from '@/components/public-concern-guide';
import { PublicServiceExplorer } from '@/components/public-service-explorer';
import { PublicSpaceTeaser } from '@/components/public-space-teaser';
import { PublicTeamTrack } from '@/components/public-team-track';
import { PublicMediaImage } from '@/components/public-media-image';
import { publicMetadata } from '@/server/public-seo';
import { getPublicHomeData, getPublicMetadataContext, type PublicRead } from '@/server/public-site';

export const revalidate = 900;

export async function generateMetadata(): Promise<Metadata> {
  const { clinicName, openGraphImage } = await getPublicMetadataContext();
  return publicMetadata({
    title: clinicName ?? 'کلینیک',
    description: 'آشنایی با خدمات، تیم درمان و راه‌های ارتباط با کلینیک.',
    path: '/',
    clinicName,
    image: openGraphImage,
  });
}

export default async function PublicHomePage() {
  const home = await getPublicHomeData();
  const clinic = home.clinic.data;
  const entry = (slot: PublicClinicContentEntry['slot']) =>
    home.content.data.entries.filter((item) => item.slot === slot);
  const hero = entry('HOME_HERO')[0];
  const firstVisit = entry('HOME_FIRST_VISIT')[0];
  const publicConcern = ({
    label,
    eyebrow,
    heading,
    body,
    image,
  }: PublicClinicContentEntry): PublicConcernContent => ({
    label,
    eyebrow,
    heading,
    body,
    image,
  });

  return (
    <main id="main-content">
      {hero ? (
        <PublicConcernGuide
          clinicName={clinic.displayName}
          cityLabel={clinic.cityLabel}
          hero={publicConcern(hero)}
          concerns={entry('HOME_CONCERN').map(publicConcern)}
        />
      ) : null}
      {firstVisit ? (
        <FirstVisit intro={firstVisit} moments={entry('HOME_FIRST_VISIT_STEP')} />
      ) : null}
      <Services read={home.services} clinicName={clinic.displayName} />
      <Team read={home.team} />
      <Spaces clinic={clinic} spaces={home.spaces} />
      <FamilyExperienceBoundary />
      <EvaluationEntry clinic={clinic} profileStatus={home.clinic.status} />
    </main>
  );
}

function FirstVisit({
  intro,
  moments,
}: {
  intro: PublicClinicContentEntry;
  moments: PublicClinicContentEntry[];
}) {
  const persianMomentNumbers = ['۱', '۲', '۳'] as const;

  return (
    <section className="public-first-visit" aria-labelledby="first-visit-title">
      <div className="public-first-visit__layout">
        <div className="public-first-visit__copy">
          {intro.eyebrow ? <p className="public-kicker">{intro.eyebrow}</p> : null}
          <h2 id="first-visit-title">{intro.heading}</h2>
          {intro.body ? <p>{intro.body}</p> : null}
          {moments.length ? (
            <div className="public-moments">
              {moments.map((moment, index) => (
                <article key={`${moment.heading}-${index}`}>
                  <span>{persianMomentNumbers[index]}</span>
                  <h3>{moment.heading}</h3>
                  {moment.body ? <p>{moment.body}</p> : null}
                </article>
              ))}
            </div>
          ) : null}
        </div>
        <figure className="public-first-visit__media">
          {intro.image ? (
            <PublicMediaImage image={intro.image} sizes="(max-width: 47.99rem) 100vw, 31vw" />
          ) : (
            <span className="public-media-empty">تصویر عمومی منتشر نشده است</span>
          )}
        </figure>
      </div>
    </section>
  );
}

function Services({
  read,
  clinicName,
}: {
  read: PublicRead<PublicServiceSummary[]>;
  clinicName: string | null;
}) {
  const services = read.data.slice(0, 6);

  return (
    <section id="services" className="public-services" aria-labelledby="services-title">
      <div className="public-section-heading public-shell">
        <div>
          <p className="public-kicker">خدمات</p>
          <h2 id="services-title">در {clinicName ?? 'کلینیک'} چه کارهایی انجام می‌شود</h2>
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

function Spaces({
  clinic,
  spaces,
}: {
  clinic: PublicClinicProfile;
  spaces: PublicRead<PublicSpace[]>;
}) {
  if (spaces.data.length === 0 && process.env.NODE_ENV === 'production') return null;
  return (
    <section id="about" className="public-spaces" aria-labelledby="spaces-title">
      <div className="public-shell public-spaces__heading">
        <div>
          <p className="public-kicker">آشنایی پیش از مراجعه</p>
          <h2 id="spaces-title">فضاهای {clinic.displayName ?? 'کلینیک'}</h2>
        </div>
        {clinic.about ? <p>{clinic.about}</p> : null}
      </div>
      <PublicSpaceTeaser
        spaces={spaces.data}
        showDevelopmentExamples={process.env.NODE_ENV !== 'production'}
      />
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
            اطلاعات شما ثبت می‌شود، کلینیک آن را بررسی می‌کند و برای هماهنگی ارزیابی با خانواده تماس
            می‌گیرد. این کار به معنی رزرو یا تأیید نوبت نیست.
          </p>
          <Link href="/request" className="public-focus public-button public-button--gold">
            شروع درخواست ارزیابی
            <span aria-hidden="true">←</span>
          </Link>
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
