import type { Metadata } from 'next';
import type { PublicClinicContentEntry } from '@clinic/contracts';
import { EvaluationCallout, PageHero } from '@/components/public-content';
import { PublicMediaImage } from '@/components/public-media-image';
import { PublicSpaceTeaser } from '@/components/public-space-teaser';
import {
  getPublicClinicContent,
  getPublicClinicProfile,
  getPublicMetadataContext,
  getPublicSpaces,
} from '@/server/public-site';
import { publicMetadata, publicPageTitle } from '@/server/public-seo';

export async function generateMetadata(): Promise<Metadata> {
  const { clinicName, openGraphImage } = await getPublicMetadataContext();
  return publicMetadata({
    title: publicPageTitle('دربارهٔ کلینیک و فضاها', clinicName),
    description: 'معرفی عمومی منتشرشدهٔ کلینیک و راهنمای پیش از مراجعه.',
    path: '/about',
    clinicName,
    image: openGraphImage,
  });
}

export default async function AboutPage() {
  const [clinicRead, contentRead, spaces] = await Promise.all([
    getPublicClinicProfile(),
    getPublicClinicContent(),
    getPublicSpaces(),
  ]);
  const clinic = clinicRead.data;
  const entries = contentRead.data.entries;
  const inSlot = (slot: PublicClinicContentEntry['slot']) =>
    entries.filter((entry) => entry.slot === slot);
  const intro = inSlot('ABOUT_INTRO')[0];
  const highlights = inSlot('ABOUT_HIGHLIGHT');
  const spaceNote = inSlot('ABOUT_SPACE_NOTE')[0];
  const spacePoints = inSlot('ABOUT_SPACE_POINT');
  const journey = inSlot('ABOUT_JOURNEY_STEP');
  const showSpaces = spaces.data.length > 0 || process.env.NODE_ENV !== 'production';

  return (
    <main id="main-content">
      {intro ? (
        <PageHero
          eyebrow={intro.eyebrow ?? 'دربارهٔ کلینیک'}
          title={intro.heading}
          lead={clinic.tagline ?? undefined}
          aside={
            <nav className="b2-page-index" aria-label="در این صفحه">
              <strong>در این صفحه</strong>
              {highlights.length ? (
                <a href="#character" className="public-focus">
                  شخصیت کلینیک
                </a>
              ) : null}
              {showSpaces ? (
                <a href="#spaces" className="public-focus">
                  فضاهای کلینیک
                </a>
              ) : null}
              {spaceNote ? (
                <a href="#why-space" className="public-focus">
                  چرا فضا این‌طور طراحی شده
                </a>
              ) : null}
              {journey.length ? (
                <a href="#first-visit" className="public-focus">
                  اولین برخورد با کلینیک
                </a>
              ) : null}
            </nav>
          }
        />
      ) : null}

      {highlights.length ? (
        <section
          id="character"
          className="public-shell b2-fact-rule b2-about-facts"
          aria-label="شخصیت کلینیک"
        >
          {highlights.map((highlight, index) => (
            <div key={`${highlight.heading}-${index}`}>
              {highlight.label ? <small>{highlight.label}</small> : null}
              <strong>{highlight.body ?? highlight.heading}</strong>
            </div>
          ))}
        </section>
      ) : null}

      {intro && (clinic.about || intro.body || intro.image) ? (
        <section className="b2-about-intro" aria-label="معرفی کلینیک">
          <figure className="b2-about-intro__photo">
            {intro.image ? (
              <PublicMediaImage image={intro.image} sizes="100vw" priority />
            ) : (
              <span className="public-media-empty">تصویر عمومی منتشر نشده است</span>
            )}
          </figure>
          <div className="public-shell b2-about-intro__copy">
            {clinic.about ? <p>{clinic.about}</p> : null}
            {intro.body ? <p>{intro.body}</p> : null}
          </div>
        </section>
      ) : null}

      {showSpaces ? (
        <section id="spaces" className="b2-spaces-full" aria-labelledby="spaces-title">
          <div className="public-shell b2-spaces-full__heading">
            <div>
              <p className="public-kicker">فضاهای کلینیک</p>
              <h2 id="spaces-title">یک نگاه، پیش از اولین مراجعه</h2>
            </div>
          </div>
          <PublicSpaceTeaser
            spaces={spaces.data}
            full
            showDevelopmentExamples={process.env.NODE_ENV !== 'production'}
          />
        </section>
      ) : null}

      {spaceNote ? (
        <section
          id="why-space"
          className="public-shell b2-space-rationale"
          aria-labelledby="space-rationale-title"
        >
          <div>
            {spaceNote.eyebrow ? <p className="public-kicker">{spaceNote.eyebrow}</p> : null}
            <h2 id="space-rationale-title">{spaceNote.heading}</h2>
            {spaceNote.body ? <p>{spaceNote.body}</p> : null}
            {spacePoints.length ? (
              <ul className="b2-hairline-list">
                {spacePoints.map((point, index) => (
                  <li key={`${point.heading}-${index}`}>{point.body ?? point.heading}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <figure className="b2-space-rationale__photo">
            {spaceNote.image ? (
              <PublicMediaImage image={spaceNote.image} sizes="(max-width: 56rem) 100vw, 42vw" />
            ) : (
              <span className="public-media-empty">تصویر عمومی منتشر نشده است</span>
            )}
          </figure>
        </section>
      ) : null}

      {journey.length ? (
        <section id="first-visit" className="b2-first-visit" aria-labelledby="first-visit-title">
          <div className="public-shell">
            <p className="public-kicker">اولین برخورد با کلینیک</p>
            <h2 id="first-visit-title">از درخواست تا ارزیابی</h2>
            <div className="b2-first-visit__steps">
              {journey.map((step, index) => (
                <div key={`${step.heading}-${index}`}>
                  <span>{index + 1}</span>
                  <strong>{step.label ?? step.heading}</strong>
                  {step.body ? <p>{step.body}</p> : null}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
      <div className="public-shell b2-section-end">
        <EvaluationCallout title="می‌خواهید دربارهٔ آمدن به کلینیک بپرسید؟" />
      </div>
    </main>
  );
}
