import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  MediaAsset,
  PublicClinicProfile,
  ServicePublicCopy,
  TherapistProfileCopy,
  TherapistPublicProfile,
} from '@clinic/contracts';
import { ClinicProfileForm } from './content/clinic-profile/clinic-profile-form';
import { ServiceCopyEditor } from './content/services/[id]/service-copy-editor';
import { TherapistProfileEditor } from './content/therapists/[id]/therapist-profile-editor';

const CSRF = 'synthetic-editorial-csrf';
const ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a60';

const SERVICE: ServicePublicCopy = {
  serviceId: ID,
  name: 'خدمت ساختگی',
  publicSlug: null,
  isPublic: false,
  description: 'متن تازه و ساختگی',
  publishedDescription: 'متن منتشرشدهٔ ساختگی',
  hasUnpublishedChanges: true,
  publicFirstPublishedAt: null,
  publicRevisedAt: null,
};

const COPY: TherapistProfileCopy = {
  therapistId: ID,
  displayName: 'نام آمادهٔ ساختگی',
  publishedDisplayName: 'نام منتشرشدهٔ ساختگی',
  title: 'عنوان آمادهٔ ساختگی',
  publishedTitle: 'عنوان منتشرشدهٔ ساختگی',
  bio: 'معرفی آمادهٔ ساختگی',
  publishedBio: 'معرفی منتشرشدهٔ ساختگی',
  isPublic: true,
  hasUnpublishedChanges: true,
};

const PROFILE: TherapistPublicProfile = {
  therapistId: ID,
  publicSlug: 'synthetic-therapist',
  displayName: COPY.displayName,
  title: COPY.title,
  bio: COPY.bio,
  publishedDisplayName: COPY.publishedDisplayName,
  publishedTitle: COPY.publishedTitle,
  publishedBio: COPY.publishedBio,
  hasUnpublishedChanges: true,
  photoPath: null,
  displayOrder: 2,
  isPublic: true,
  firstPublishedAt: '2026-09-01T00:00:00.000Z',
  publicRevisedAt: '2026-09-01T00:00:00.000Z',
};

describe('service public-copy editor', () => {
  it('makes the prepared and published states clear while keeping receptionist controls narrow', () => {
    const html = renderToStaticMarkup(
      <ServiceCopyEditor copy={SERVICE} csrfToken={CSRF} canPublish={false} message={null} />,
    );
    expect(html).toContain('تغییرات آمادهٔ انتشار');
    expect(html).toContain(SERVICE.description);
    expect(html).toContain(SERVICE.publishedDescription);
    expect(html).toContain('/api/content/service-copy/update');
    expect(html).not.toContain('/api/content/service-copy/publication');
    expect(html).not.toContain('publicSlug');
    expect(html).not.toContain('/services/');
  });

  it('shows manager publication and the permanent-address warning before first publication', () => {
    const html = renderToStaticMarkup(
      <ServiceCopyEditor copy={SERVICE} csrfToken={CSRF} canPublish message={null} />,
    );
    expect(html).toContain('/api/content/service-copy/publication');
    expect(html).toContain('انتشار تغییرات آماده');
    expect(html).toContain('پس از انتشار دائمی می‌شود');
    expect(html).toContain(`/catalog/services/${ID}/edit`);
  });
});

describe('therapist public-profile editor', () => {
  it('lets a receptionist draft copy and a portrait without rendering manager authority', () => {
    const html = renderToStaticMarkup(
      <TherapistProfileEditor
        copy={COPY}
        profile={null}
        media={[]}
        csrfToken={CSRF}
        message={null}
      />,
    );
    for (const field of ['displayName', 'title', 'bio']) expect(html).toContain(`name="${field}"`);
    expect(html).toContain('نام منتشرشدهٔ ساختگی');
    expect(html).toContain('تغییرات آمادهٔ انتشار');
    expect(html).toContain('قاب عمودی');
    expect(html).not.toContain('قاب افقی');
    expect(html).not.toContain('name="publicSlug"');
    expect(html).not.toContain('name="isPublic"');
    expect(html).not.toContain('/visibility');
    expect(html).not.toContain('/api/media/publication');
  });

  it('renders manager-only slug, visibility, and photo publication controls', () => {
    const media = syntheticPortrait();
    const html = renderToStaticMarkup(
      <TherapistProfileEditor
        copy={COPY}
        profile={PROFILE}
        media={[media]}
        csrfToken={CSRF}
        message={null}
      />,
    );
    expect(html).toContain('/team/synthetic-therapist');
    expect(html).toContain('/api/content/therapist-profiles/visibility');
    expect(html).toContain('انتشار تغییرات آماده');
    expect(html).toContain('/api/media/publication');
    expect(html).toContain('عکس آمادهٔ انتشار');
  });
});

describe('clinic profile boundary', () => {
  it('renders exactly the thirteen currently accepted fields', () => {
    const html = renderToStaticMarkup(
      <ClinicProfileForm clinic={emptyClinic()} csrfToken={CSRF} message={null} />,
    );
    const fields = [
      'displayName',
      'tagline',
      'about',
      'addressLine',
      'cityLabel',
      'phonePrimary',
      'phoneSecondary',
      'email',
      'workingHoursNote',
      'mapLatitude',
      'mapLongitude',
      'instagramUrl',
      'telegramUrl',
    ];
    for (const field of fields) expect(html).toContain(`name="${field}"`);
    expect(
      html.match(
        /<(?:input|textarea)[^>]+name="(?:displayName|tagline|about|addressLine|cityLabel|phonePrimary|phoneSecondary|email|workingHoursNote|mapLatitude|mapLongitude|instagramUrl|telegramUrl)"/g,
      ),
    ).toHaveLength(13);
    expect(html).not.toContain('privacy');
    expect(html).not.toContain('ownerCopy');
  });
});

function emptyClinic(): PublicClinicProfile {
  return {
    displayName: null,
    tagline: null,
    about: null,
    addressLine: null,
    cityLabel: null,
    phonePrimary: null,
    phoneSecondary: null,
    email: null,
    workingHoursNote: null,
    mapLatitude: null,
    mapLongitude: null,
    instagramUrl: null,
    telegramUrl: null,
  };
}

function syntheticPortrait(): MediaAsset {
  return {
    id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a61',
    altText: 'چهرهٔ ساختگی',
    status: 'ACTIVE',
    width: 800,
    height: 1000,
    byteSize: 1000,
    sourceContentType: 'image/jpeg',
    sourceByteSize: 1200,
    isPubliclyServed: false,
    renditions: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    archivedAt: null,
    bytesPurgedAt: null,
    attachments: [
      {
        id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a62',
        ownerType: 'THERAPIST_PROFILE',
        ownerId: ID,
        position: 0,
        attachedAt: '2026-09-01T00:00:00.000Z',
        publishedAt: null,
        ownerIsPublic: true,
        framing: { focalX: 0.5, focalY: 0.5, crop: null },
      },
    ],
  };
}
