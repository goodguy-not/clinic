import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import type {
  PublicClinicProfile,
  PublicServiceSummary,
  PublicTherapistProfile,
} from '@clinic/contracts';
import { ArrowIcon } from '@/components/public-chrome';
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
      <Hero clinic={clinic} />
      <Journey />
      <Services read={home.services} />
      <Team read={home.team} />
      <AboutAndContact clinic={clinic} profileStatus={home.clinic.status} />
    </main>
  );
}

function Hero({ clinic }: { clinic: PublicClinicProfile }) {
  const primaryHref = clinic.phonePrimary === null ? '#contact' : `tel:${clinic.phonePrimary}`;
  const primaryLabel = clinic.phonePrimary === null ? 'راه‌های ارتباطی' : 'تماس با کلینیک';

  return (
    <section className="public-hero" aria-labelledby="hero-title">
      <div className="public-shell public-hero__grid">
        <div className="public-hero__copy public-enter">
          <p className="public-eyebrow">
            <span aria-hidden="true" />
            کلینیک توانبخشی والا
          </p>
          <h1 id="hero-title">برای هر قدم، یک مسیر روشن‌تر</h1>
          <p className="public-hero__lead">
            در والا می‌توانید با خدمات منتشرشده، تیم درمان و راه‌های ارتباط با کلینیک آشنا شوید؛
            ساده، شفاف و بدون پیچیدگی.
          </p>
          <div className="public-hero__actions">
            <a href={primaryHref} className="public-focus public-button public-button--primary">
              {primaryLabel}
              <ArrowIcon />
            </a>
            <a href="#services" className="public-focus public-button public-button--quiet">
              آشنایی با خدمات
            </a>
          </div>
          <ul className="public-promises" aria-label="ویژگی‌های تجربهٔ وب‌سایت">
            <li>
              <CheckIcon /> اطلاعات روشن
            </li>
            <li>
              <CheckIcon /> معرفی تیم با رضایت
            </li>
            <li>
              <CheckIcon /> مسیر تماس ساده
            </li>
          </ul>
        </div>

        <div className="public-hero-art public-enter public-enter--late" aria-hidden="true">
          <div className="public-hero-art__sun" />
          <div className="public-hero-art__orb public-hero-art__orb--one" />
          <div className="public-hero-art__orb public-hero-art__orb--two" />
          <svg className="public-hero-art__path" viewBox="0 0 560 500" focusable="false">
            <path d="M104 414c42-112 90-62 128-154 43-104 106 25 148-82 20-51 48-69 86-77" />
            <circle cx="105" cy="413" r="8" />
            <circle cx="466" cy="101" r="8" />
          </svg>
          <div className="public-hero-art__figure">
            <span className="public-hero-art__head" />
            <span className="public-hero-art__body" />
            <span className="public-hero-art__arm" />
            <span className="public-hero-art__leg" />
          </div>
          <span className="public-hero-art__word public-hero-art__word--one">شناخت</span>
          <span className="public-hero-art__word public-hero-art__word--two">همراهی</span>
          <span className="public-hero-art__word public-hero-art__word--three">حرکت</span>
        </div>
      </div>
      <div className="public-hero__wave" aria-hidden="true" />
    </section>
  );
}

function Journey() {
  const steps = [
    {
      number: '۱',
      title: 'خدمات را بشناسید',
      text: 'فهرست خدمات منتشرشده را ببینید و تصویر اولیه‌ای از مسیرهای موجود پیدا کنید.',
      href: '#services',
      tone: 'coral',
    },
    {
      number: '۲',
      title: 'با تیم آشنا شوید',
      text: 'پروفایل‌هایی را بخوانید که با رضایت درمانگران برای وب‌سایت تأیید شده‌اند.',
      href: '#team',
      tone: 'violet',
    },
    {
      number: '۳',
      title: 'مستقیم تماس بگیرید',
      text: 'از راه‌های ثبت‌شدهٔ کلینیک برای پرسیدن سؤال و پیگیری گام بعد استفاده کنید.',
      href: '#contact',
      tone: 'green',
    },
  ] as const;

  return (
    <section className="public-journey public-section" aria-labelledby="journey-title">
      <div className="public-shell">
        <div className="public-section-heading public-section-heading--center">
          <p className="public-kicker">شروع بدون سردرگمی</p>
          <h2 id="journey-title">از کجا شروع کنیم؟</h2>
          <p>سه مسیر کوتاه برای رسیدن به اطلاعاتی که بیشتر خانواده‌ها در ابتدا می‌خواهند.</p>
        </div>
        <ol className="public-journey__grid">
          {steps.map((step) => (
            <li key={step.number} className={`public-step public-step--${step.tone}`}>
              <span className="public-step__number">{step.number}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
                <a href={step.href} className="public-focus public-text-link">
                  ادامهٔ مسیر <ArrowIcon />
                </a>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Services({ read }: { read: PublicRead<PublicServiceSummary[]> }) {
  const services = read.data.slice(0, 6);

  return (
    <section
      id="services"
      className="public-services public-section"
      aria-labelledby="services-title"
    >
      <div className="public-shell">
        <div className="public-section-heading public-section-heading--split">
          <div>
            <p className="public-kicker">خدمات کلینیک</p>
            <h2 id="services-title">مسیرهای مراقبت، روشن و قابل شناخت</h2>
          </div>
          <p>این فهرست مستقیماً از خدماتی می‌آید که کلینیک برای نمایش عمومی منتشر کرده است.</p>
        </div>

        {services.length > 0 ? (
          <div className="public-services__grid">
            {services.map((service, index) => (
              <article key={service.slug} className="public-service-card">
                <ServiceGlyph index={index} />
                <p className="public-service-card__index">
                  خدمت {(index + 1).toLocaleString('fa-IR')}
                </p>
                <h3>{service.name}</h3>
                <p>
                  {service.description ??
                    'توضیح عمومی این خدمت پس از تکمیل محتوای کلینیک در همین بخش نمایش داده می‌شود.'}
                </p>
              </article>
            ))}
          </div>
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
    <section id="team" className="public-team public-section" aria-labelledby="team-title">
      <div className="public-shell">
        <div className="public-section-heading public-section-heading--split public-section-heading--light">
          <div>
            <p className="public-kicker">آدم‌های این مسیر</p>
            <h2 id="team-title">آشنایی با تیم درمان</h2>
          </div>
          <p>تنها پروفایل‌هایی نمایش داده می‌شوند که برای حضور عمومی در وب‌سایت تأیید شده‌اند.</p>
        </div>

        {team.length > 0 ? (
          <div className="public-team__grid">
            {team.map((person, index) => (
              <article key={person.slug} className="public-person-card">
                <div
                  className={`public-person-card__portrait public-person-card__portrait--${index % 4}`}
                >
                  <span>{firstCharacter(person.displayName)}</span>
                  <i aria-hidden="true" />
                </div>
                <div className="public-person-card__copy">
                  <h3>{person.displayName}</h3>
                  {person.title !== null ? (
                    <p className="public-person-card__title">{person.title}</p>
                  ) : null}
                  {person.bio !== null ? (
                    <p className="public-person-card__bio">{person.bio}</p>
                  ) : null}
                </div>
              </article>
            ))}
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

function AboutAndContact({
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
    <section id="about" className="public-about public-section" aria-labelledby="about-title">
      <div className="public-shell public-about__grid">
        <div className="public-about__story">
          <p className="public-kicker">دربارهٔ کلینیک</p>
          <h2 id="about-title">فضایی برای شناخت پیش از تماس</h2>
          <p>
            {clinic.about ??
              'معرفی تأییدشدهٔ کلینیک پس از تکمیل محتوای مالک در این بخش قرار می‌گیرد. تا آن زمان، خدمات و پروفایل‌های منتشرشده در همین صفحه قابل مشاهده‌اند.'}
          </p>
          <div className="public-about__motif" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>

        <div id="contact" className="public-contact-card" aria-labelledby="contact-title">
          <p className="public-kicker">گام بعدی</p>
          <h2 id="contact-title">ارتباط با کلینیک</h2>
          {hasContact ? (
            <dl className="public-contact-list">
              {clinic.phonePrimary !== null ? (
                <ContactRow label="تلفن اصلی">
                  <a href={`tel:${clinic.phonePrimary}`} className="public-focus">
                    <bdi dir="ltr">{clinic.phonePrimary}</bdi>
                  </a>
                </ContactRow>
              ) : null}
              {clinic.phoneSecondary !== null ? (
                <ContactRow label="تلفن دیگر">
                  <a href={`tel:${clinic.phoneSecondary}`} className="public-focus">
                    <bdi dir="ltr">{clinic.phoneSecondary}</bdi>
                  </a>
                </ContactRow>
              ) : null}
              {clinic.email !== null ? (
                <ContactRow label="ایمیل">
                  <a href={`mailto:${clinic.email}`} className="public-focus">
                    <bdi dir="ltr">{clinic.email}</bdi>
                  </a>
                </ContactRow>
              ) : null}
              {clinic.addressLine !== null || clinic.cityLabel !== null ? (
                <ContactRow label="نشانی">
                  <span>{[clinic.cityLabel, clinic.addressLine].filter(Boolean).join('، ')}</span>
                </ContactRow>
              ) : null}
              {clinic.workingHoursNote !== null ? (
                <ContactRow label="ساعت پاسخ‌گویی">
                  <span>{clinic.workingHoursNote}</span>
                </ContactRow>
              ) : null}
            </dl>
          ) : (
            <div className="public-contact-card__empty" role="status">
              <span aria-hidden="true">…</span>
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

function ContactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
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
      <span aria-hidden="true">{unavailable ? '↻' : '○'}</span>
      <div>
        <h3>{unavailable ? 'نمایش اطلاعات موقتاً ممکن نیست' : title}</h3>
        <p>{unavailable ? 'صفحه همچنان در دسترس است؛ لطفاً کمی بعد دوباره بررسی کنید.' : text}</p>
      </div>
    </div>
  );
}

function ServiceGlyph({ index }: { index: number }) {
  return (
    <span className={`public-service-glyph public-service-glyph--${index % 3}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path d="m4 9 3 3 7-7" />
    </svg>
  );
}

function firstCharacter(value: string): string {
  return Array.from(value.trim())[0] ?? '•';
}
