import type { Metadata } from 'next';
import Image from 'next/image';
import type { ReactNode } from 'react';
import type {
  PublicClinicProfile,
  PublicServiceSummary,
  PublicTherapistProfile,
} from '@clinic/contracts';
import { ArrowIcon } from '@/components/public-chrome';
import { PublicServiceExplorer } from '@/components/public-service-explorer';
import { getPublicHomeData, type PublicRead } from '@/server/public-site';

export const revalidate = 900;

const SYNTHETIC_PORTRAITS = [
  '/dev/vala-synthetic/08-therapist-portrait-b.jpg',
  '/dev/vala-synthetic/07-therapist-portrait-a.jpg',
  '/dev/vala-synthetic/10-therapist-portrait-d.jpg',
  '/dev/vala-synthetic/09-therapist-portrait-c.jpg',
] as const;

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
      <Hero clinic={clinic} />
      <Introduction />
      <Services read={home.services} />
      <Team read={home.team} />
      <About clinic={clinic} />
      <Request clinic={clinic} profileStatus={home.clinic.status} />
    </main>
  );
}

function Hero({ clinic }: { clinic: PublicClinicProfile }) {
  return (
    <section className="public-hero" aria-labelledby="hero-title">
      <div className="public-hero__media public-enter public-enter--image">
        <Image
          src="/dev/vala-synthetic/05-corridor.jpg"
          width="940"
          height="480"
          alt=""
          className="public-hero__main-image"
          priority
          sizes="(max-width: 54rem) 100vw, 47vw"
        />
        <div className="public-hero__detail">
          <Image
            src="/dev/vala-synthetic/13-hand-therapy-detail.jpg"
            width="365"
            height="217"
            alt=""
            sizes="(max-width: 36rem) 10rem, 18rem"
          />
        </div>
        <span className="public-photo-note public-hero__photo-note">تصاویر آزمایشی</span>
      </div>

      <div className="public-shell public-hero__layout">
        <div className="public-hero__copy public-enter">
          <p className="public-eyebrow">
            <span aria-hidden="true" />
            کلینیک توانبخشی والا
          </p>
          <h1 id="hero-title">
            <span>توانایی، یک‌باره</span>
            <span>ساخته نمی‌شود.</span>
            <em>اما قدم بعدی می‌تواند روشن باشد.</em>
          </h1>
          <p className="public-hero__lead">
            {clinic.tagline ??
              'اینجا می‌توانید خدمات منتشرشده را بشناسید، با تیم درمان آشنا شوید و برای ادامهٔ مسیر درخواست پیگیری بفرستید.'}
          </p>
          <div className="public-hero__actions">
            <a href="#request" className="public-focus public-button public-button--primary">
              درخواست پیگیری
              <ArrowIcon />
            </a>
            <a href="#services" className="public-focus public-inline-link">
              شناخت خدمات
              <ArrowIcon />
            </a>
          </div>
          {clinic.phonePrimary !== null ? (
            <p className="public-hero__direct">
              تماس مستقیم{' '}
              <a href={`tel:${clinic.phonePrimary}`} className="public-focus">
                <bdi dir="ltr">{clinic.phonePrimary}</bdi>
              </a>
            </p>
          ) : null}
        </div>
      </div>

      <a href="#introduction" className="public-focus public-hero__scroll" aria-label="ادامهٔ صفحه">
        <span aria-hidden="true" />
        ادامه
      </a>
    </section>
  );
}

function Introduction() {
  return (
    <section id="introduction" className="public-introduction" aria-labelledby="intro-title">
      <div className="public-shell public-introduction__layout">
        <p className="public-introduction__aside">
          شناخت
          <span aria-hidden="true" />
          همراهی
          <span aria-hidden="true" />
          ادامه
        </p>
        <div>
          <p className="public-kicker">شروع بدون سردرگمی</p>
          <h2 id="intro-title">لازم نیست از همان ابتدا همه‌چیز را بدانید.</h2>
          <p>
            ابتدا محدودهٔ خدمات را ببینید. بعد آدم‌های این مسیر و فضای کلینیک را بشناسید. اگر هنوز
            پرسشی باقی بود، یک درخواست کوتاه برای شروع گفت‌وگو کافی است.
          </p>
        </div>
      </div>
    </section>
  );
}

function Services({ read }: { read: PublicRead<PublicServiceSummary[]> }) {
  const services = read.data.slice(0, 6);

  return (
    <section id="services" className="public-services" aria-labelledby="services-title">
      <div className="public-shell">
        <div className="public-section-heading public-section-heading--services">
          <div>
            <p className="public-kicker">خدمات</p>
            <h2 id="services-title">مسیرهای متفاوت، یک نقطهٔ شروع روشن.</h2>
          </div>
          <p>
            نام و توضیح هر خدمت مستقیماً از محتوایی می‌آید که کلینیک برای نمایش عمومی منتشر کرده
            است.
          </p>
        </div>

        {services.length > 0 ? (
          <PublicServiceExplorer services={services} />
        ) : (
          <PublicEmpty
            unavailable={read.status === 'unavailable'}
            title="فهرست خدمات هنوز آمادهٔ نمایش نیست"
            text="پس از انتشار محتوای تأییدشدهٔ کلینیک، خدمات در این بخش دیده می‌شوند."
          />
        )}
      </div>
    </section>
  );
}

function Team({ read }: { read: PublicRead<PublicTherapistProfile[]> }) {
  const team = read.data.slice(0, 4);

  return (
    <section id="team" className="public-team" aria-labelledby="team-title">
      <div className="public-shell">
        <div className="public-team__heading">
          <p className="public-kicker public-kicker--light">تیم درمان</p>
          <h2 id="team-title">این مسیر را آدم‌ها می‌سازند.</h2>
          <p>
            فقط پروفایل‌هایی نمایش داده می‌شوند که درمانگر برای حضور عمومی آن‌ها رضایت داده است.
            تصاویر نشانه‌گذاری‌شده، موقت و آزمایشی‌اند.
          </p>
        </div>

        {team.length > 0 ? (
          <div className="public-team__portraits">
            {team.map((person, index) => {
              const hasRealPhoto = person.photoPath !== null;
              const photo =
                person.photoPath === null
                  ? SYNTHETIC_PORTRAITS[index % SYNTHETIC_PORTRAITS.length]!
                  : `/${person.photoPath}`;

              return (
                <article key={person.slug} className="public-person">
                  <div className="public-person__image">
                    <Image
                      src={photo}
                      width="460"
                      height="560"
                      alt={hasRealPhoto ? person.displayName : ''}
                      sizes="(max-width: 36rem) 100vw, (max-width: 54rem) 50vw, 38vw"
                    />
                    {!hasRealPhoto ? (
                      <span className="public-photo-note">تصویر آزمایشی — این درمانگر نیست</span>
                    ) : null}
                  </div>
                  <div className="public-person__copy">
                    <h3>{person.displayName}</h3>
                    {person.title !== null ? (
                      <p className="public-person__title">{person.title}</p>
                    ) : null}
                    {person.bio !== null ? (
                      <p className="public-person__bio">{person.bio}</p>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <PublicEmpty
            unavailable={read.status === 'unavailable'}
            title="پروفایل عمومی تیم هنوز منتشر نشده است"
            text="با تأیید پروفایل‌ها، اعضای تیم در این بخش معرفی می‌شوند."
            dark
          />
        )}
      </div>
    </section>
  );
}

function About({ clinic }: { clinic: PublicClinicProfile }) {
  return (
    <section id="about" className="public-about" aria-labelledby="about-title">
      <div className="public-shell public-about__layout">
        <div className="public-about__copy">
          <p className="public-kicker">فضای والا</p>
          <h2 id="about-title">یک کلینیک، پیش از هر چیز باید قابل شناختن باشد.</h2>
          <p>
            {clinic.about ??
              'معرفی تأییدشدهٔ کلینیک پس از تکمیل محتوای مالک در این بخش قرار می‌گیرد. تصاویر فعلی فقط برای سنجش ترکیب‌بندی، برش و رفتار واکنش‌گرا استفاده شده‌اند.'}
          </p>
        </div>

        <div className="public-about__essay" aria-label="تصاویر آزمایشی از فضای کلینیک">
          <figure className="public-about__image public-about__image--main">
            <Image
              src="/dev/vala-synthetic/01-reception.jpg"
              width="630"
              height="390"
              alt=""
              sizes="(max-width: 54rem) 85vw, 40vw"
            />
          </figure>
          <figure className="public-about__image public-about__image--detail">
            <Image
              src="/dev/vala-synthetic/06-brand-wall.jpg"
              width="420"
              height="300"
              alt=""
              sizes="(max-width: 54rem) 48vw, 25vw"
            />
          </figure>
          <figure className="public-about__image public-about__image--room">
            <Image
              src="/dev/vala-synthetic/04-treatment-room.jpg"
              width="420"
              height="280"
              alt=""
              sizes="(max-width: 54rem) 63vw, 28vw"
            />
          </figure>
          <span className="public-photo-note public-about__photo-note">
            تصاویر آزمایشی — نه کلینیک والا
          </span>
        </div>
      </div>
    </section>
  );
}

function Request({
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
          <p className="public-kicker public-kicker--light">قدم بعدی</p>
          <h2 id="request-title">اگر هنوز مطمئن نیستید، از همین‌جا شروع کنید.</h2>
          <p>
            مسیر اصلی پیگیری در این وب‌سایت، ثبت یک درخواست کوتاه خواهد بود. تا فعال‌شدن فرم،
            راه‌های تأییدشدهٔ ارتباطی در همین بخش نمایش داده می‌شوند.
          </p>
          <span className="public-request__status">
            <span aria-hidden="true" />
            فرم درخواست در مرحلهٔ بعد فعال می‌شود
          </span>
        </div>

        <div id="contact" className="public-request__contact" aria-labelledby="contact-title">
          <p id="contact-title">راه‌های ارتباطی</p>
          {hasContact ? (
            <div className="public-contact-cloud">
              {clinic.phonePrimary !== null ? (
                <ContactItem label="تلفن اصلی">
                  <a href={`tel:${clinic.phonePrimary}`} className="public-focus">
                    <bdi dir="ltr">{clinic.phonePrimary}</bdi>
                  </a>
                </ContactItem>
              ) : null}
              {clinic.phoneSecondary !== null ? (
                <ContactItem label="تلفن دیگر">
                  <a href={`tel:${clinic.phoneSecondary}`} className="public-focus">
                    <bdi dir="ltr">{clinic.phoneSecondary}</bdi>
                  </a>
                </ContactItem>
              ) : null}
              {clinic.email !== null ? (
                <ContactItem label="ایمیل">
                  <a href={`mailto:${clinic.email}`} className="public-focus">
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
                  : 'اطلاعات تماس تأییدشدهٔ کلینیک پس از تکمیل، در این بخش نمایش داده می‌شود.'}
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
  dark = false,
}: {
  unavailable: boolean;
  title: string;
  text: string;
  dark?: boolean;
}) {
  return (
    <div className={`public-empty${dark ? ' public-empty--dark' : ''}`} role="status">
      <span aria-hidden="true">{unavailable ? '↻' : '—'}</span>
      <div>
        <h3>{unavailable ? 'نمایش اطلاعات موقتاً ممکن نیست' : title}</h3>
        <p>{unavailable ? 'صفحه همچنان در دسترس است؛ لطفاً کمی بعد دوباره بررسی کنید.' : text}</p>
      </div>
    </div>
  );
}
