import type {
  PublicArticleDetail,
  PublicServiceDetail,
  PublicSpace,
  PublicTestimonial,
  PublicTherapistProfile,
} from '@clinic/contracts';
import { PublicArticleReading } from './public-article-reading';
import { PublicServiceExplorer } from './public-service-explorer';
import { PublicSpaceTeaser } from './public-space-teaser';
import { PublicTeamTrack } from './public-team-track';
import { PublicTestimonialGrid } from './public-testimonial-grid';

export type DraftPublicPreviewData =
  | { kind: 'services'; service: PublicServiceDetail }
  | { kind: 'therapists'; therapist: PublicTherapistProfile }
  | { kind: 'articles'; article: PublicArticleDetail }
  | { kind: 'testimonials'; testimonial: PublicTestimonial }
  | { kind: 'spaces'; space: PublicSpace };

/** Existing public renderers, supplied with authenticated draft projections. */
export function DraftPublicPreview({ data }: { data: DraftPublicPreviewData }) {
  if (data.kind === 'articles') return <PublicArticleReading article={data.article} />;

  return (
    <main id="main-content" className="public-shell" data-preview-kind={data.kind}>
      <section className="b2-section-heading">
        <p className="public-kicker">پیش‌نمایش خصوصی</p>
        <h1>نمایش نسخهٔ آماده در مؤلفهٔ واقعی سایت</h1>
      </section>
      {data.kind === 'services' ? <PublicServiceExplorer services={[data.service]} /> : null}
      {data.kind === 'therapists' ? <PublicTeamTrack therapists={[data.therapist]} /> : null}
      {data.kind === 'testimonials' ? (
        <PublicTestimonialGrid testimonials={[data.testimonial]} showDevelopmentExamples={false} />
      ) : null}
      {data.kind === 'spaces' ? (
        <PublicSpaceTeaser spaces={[data.space]} full showDevelopmentExamples={false} />
      ) : null}
    </main>
  );
}
