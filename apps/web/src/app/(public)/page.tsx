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
      <Orientation />
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
      <div className="public-shell public-hero__layout">
        <div className="public-hero__copy public-enter">
          <p className="public-eyebrow">کلینیک توانبخشی والا</p>
          <h1 id="hero-title">
            <span>قدم‌به‌قدم،</span>
            <span className="public-hero__title-accent">رو به توانایی.</span>
          </h1>
          <p className="public-hero__lead">
            والا جایی برای شناخت روشن مسیر توانبخشی، آشنایی با درمانگران و برداشتن یک قدم قابل‌فهم
            برای ادامه است.
          </p>
          <div className="public-hero__actions">
            <a href="#request" className="public-focus public-button public-button--primary">
              درخواست پیگیری
              <ArrowIcon />
            </a>
            <a href="#services" className="public-focus public-inline-link">
              ابتدا خدمات را ببینید
              <ArrowIcon />
            </a>
          </div>
          {clinic.phonePrimary !== null ? (
            <p className="public-hero__direct">
              برای تماس مستقیم:‌{' '}
              <a href={`tel:${clinic.phonePrimary}`} className="public-focus">
                <bdi dir="ltr">{clinic.phonePrimary}</bdi>
              </a>
            </p>
          ) : null}
        </div>

        <div className="public-hero__manifesto public-enter public-enter--late">
          <p>مسیر والا</p>
          <ol aria-label="مسیر آشنایی و پیگیری در والا">
            <li>
              <span>۰۱</span>
              <strong>شناخت</strong>
              <small>بدانید چه خدماتی در دسترس است.</small>
            </li>
            <li>
              <span>۰۲</span>
              <strong>همراهی</strong>
              <small>با آدم‌های این مسیر آشنا شوید.</small>
            </li>
            <li>
              <span>۰۳</span>
              <strong>ادامه</strong>
              <small>برای پیگیری، یک درخواست کوتاه بفرستید.</small>
            </li>
          </ol>
        </div>
      </div>
      <a href="#orientation" className="public-focus public-hero__scroll" aria-label="ادامهٔ صفحه">
        <span aria-hidden="true" />
        ادامه
      </a>
    </section>
  );
}

function Orientation() {
  return (
    <section id="orientation" className="public-orientation" aria-labelledby="orientation-title">
      <div className="public-shell public-orientation__layout">
        <div className="public-orientation__heading">
          <p className="public-kicker">شروع بدون سردرگمی</p>
          <h2 id="orientation-title">لازم نیست از همان ابتدا همه‌چیز را بدانید.</h2>
        </div>
        <p className="public-orientation__intro">
          برای شروع، همین سه چیز کافی است: محدودهٔ خدمات را بشناسید، دربارهٔ تیم بخوانید و اگر آماده
          بودید، راه پیگیری را انتخاب کنید.
        </p>
      </div>
      <div className="public-shell">
        <ol className="public-route">
          <li>
            <span className="public-route__number">۱</span>
            <div>
              <strong>خدمت مناسب را پیدا کنید</strong>
              <p>توضیح‌های منتشرشده کمک می‌کنند یک تصویر اولیه و ساده داشته باشید.</p>
            </div>
          </li>
          <li>
            <span className="public-route__number">۲</span>
            <div>
              <strong>زمینهٔ تیم را بشناسید</strong>
              <p>فقط اطلاعاتی نمایش داده می‌شود که برای حضور عمومی تأیید شده است.</p>
            </div>
          </li>
          <li>
            <span className="public-route__number">۳</span>
            <div>
              <strong>پیگیری را به والا بسپارید</strong>
              <p>یک درخواست کوتاه، شروع گفت‌وگو را ساده و مشخص می‌کند.</p>
            </div>
          </li>
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
            <p className="public-kicker">خدمات</p>
            <h2 id="services-title">هر مسیر، از یک شناخت روشن شروع می‌شود.</h2>
          </div>
          <p>فهرست زیر مستقیماً از خدماتی می‌آید که کلینیک برای نمایش عمومی منتشر کرده است.</p>
        </div>

        {services.length > 0 ? (
          <ol className="public-services__list">
            {services.map((service, index) => (
              <li key={service.slug} className="public-service-row">
                <span className="public-service-row__index">
                  {(index + 1).toLocaleString('fa-IR', { minimumIntegerDigits: 2 })}
                </span>
                <h3>{service.name}</h3>
                <p>
                  {service.description ??
                    'توضیح عمومی این خدمت پس از تکمیل محتوای کلینیک در همین بخش نمایش داده می‌شود.'}
                </p>
              </li>
            ))}
          </ol>
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
      <div className="public-shell public-team__layout">
        <div className="public-team__intro">
          <p className="public-kicker">تیم درمان</p>
          <h2 id="team-title">درمان، پیش از هر چیز یک رابطهٔ انسانی است.</h2>
          <p>
            در اینجا فقط پروفایل‌هایی دیده می‌شوند که درمانگر برای نمایش عمومی آن‌ها رضایت داده است.
          </p>
        </div>

        {team.length > 0 ? (
          <div className="public-team__list">
            {team.map((person, index) => (
              <article key={person.slug} className="public-person-row">
                <span className="public-person-row__index" aria-hidden="true">
                  {(index + 1).toLocaleString('fa-IR', { minimumIntegerDigits: 2 })}
                </span>
                <div>
                  <h3>{person.displayName}</h3>
                  {person.title !== null ? (
                    <p className="public-person-row__title">{person.title}</p>
                  ) : null}
                  {person.bio !== null ? (
                    <p className="public-person-row__bio">{person.bio}</p>
                  ) : null}
                </div>
                <span className="public-person-row__mark" aria-hidden="true">
                  {firstCharacter(person.displayName)}
                </span>
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

function About({ clinic }: { clinic: PublicClinicProfile }) {
  return (
    <section id="about" className="public-about public-section" aria-labelledby="about-title">
      <div className="public-shell public-about__layout">
        <p className="public-about__word" aria-hidden="true">
          والا
        </p>
        <div className="public-about__copy">
          <p className="public-kicker">دربارهٔ والا</p>
          <h2 id="about-title">فضایی برای فهمیدن، پرسیدن و ادامه‌دادن.</h2>
          <p>
            {clinic.about ??
              'معرفی تأییدشدهٔ کلینیک پس از تکمیل محتوای مالک در این بخش قرار می‌گیرد. تا آن زمان، خدمات و پروفایل‌های منتشرشده در همین صفحه قابل مشاهده‌اند.'}
          </p>
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
          <p className="public-kicker">گام بعدی</p>
          <h2 id="request-title">یک درخواست کوتاه، شروع یک گفت‌وگوی روشن.</h2>
          <p>
            مسیر اصلی پیگیری در این وب‌سایت، ثبت یک درخواست کوتاه خواهد بود. تا فعال‌شدن فرم،
            می‌توانید از راه‌های تأییدشدهٔ کلینیک استفاده کنید.
          </p>
          <span className="public-request__status">فرم درخواست در مرحلهٔ بعد فعال می‌شود</span>
        </div>

        <div id="contact" className="public-request__contact" aria-labelledby="contact-title">
          <p id="contact-title">راه‌های ارتباطی</p>
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
      <span aria-hidden="true">{unavailable ? '↻' : '—'}</span>
      <div>
        <h3>{unavailable ? 'نمایش اطلاعات موقتاً ممکن نیست' : title}</h3>
        <p>{unavailable ? 'صفحه همچنان در دسترس است؛ لطفاً کمی بعد دوباره بررسی کنید.' : text}</p>
      </div>
    </div>
  );
}

function firstCharacter(value: string): string {
  return Array.from(value.trim())[0] ?? '•';
}
