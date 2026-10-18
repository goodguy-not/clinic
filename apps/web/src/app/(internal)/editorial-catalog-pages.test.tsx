import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  ClinicContentEntry,
  MediaAsset,
  PublicClinicProfile,
  ServicePublicCopy,
  TherapistProfileCopy,
  TherapistPublicProfile,
} from '@clinic/contracts';
import { ClinicContentEditor } from './content/clinic-profile/clinic-content-editor';
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
  displayOrder: 2,
  isPublic: true,
  firstPublishedAt: '2026-09-01T00:00:00.000Z',
  publicRevisedAt: '2026-09-01T00:00:00.000Z',
};

describe('service public-copy editor', () => {
  it('makes the prepared and published states clear while keeping receptionist controls narrow', () => {
    const html = renderToStaticMarkup(
      <ServiceCopyEditor
        copy={SERVICE}
        csrfToken={CSRF}
        canPublish={false}
        canPublishMedia={false}
        media={[]}
        mediaLoadError={null}
        message={null}
        serviceStatus="ACTIVE"
      />,
    );
    expect(html).toContain('تغییرات آمادهٔ انتشار');
    expect(html).toContain(SERVICE.description);
    expect(html).toContain(SERVICE.publishedDescription);
    expect(html).toContain('/api/content/service-copy/update');
    expect(html).not.toContain('/api/content/service-copy/publication');
    expect(html).not.toContain('publicSlug');
    expect(html).not.toContain('/services/');
    expect(html).toContain('عکس این خدمت');
    expect(html).toContain('انتخاب از گوشی یا رایانه');
    expect(html).toContain('ذخیرهٔ عکس آن را روی سایت منتشر نمی‌کند');
    expect(html).not.toContain('PUBLIC_SERVICE');
    expect(html).not.toContain('/api/media/publication');
  });

  it('shows manager publication and the permanent-address warning before first publication', () => {
    const html = renderToStaticMarkup(
      <ServiceCopyEditor
        copy={SERVICE}
        csrfToken={CSRF}
        canPublish
        canPublishMedia
        media={[]}
        mediaLoadError={null}
        message={null}
        serviceStatus="ACTIVE"
      />,
    );
    expect(html).toContain('/api/content/service-copy/publication');
    expect(html).toContain('انتشار تغییرات آماده');
    expect(html).toContain('پس از انتشار دائمی می‌شود');
    expect(html).toContain(`/catalog/services/${ID}/edit`);
  });

  it('previews the persisted prepared image privately and keeps publication manager-only', () => {
    const media = syntheticServiceImage();
    const receptionist = renderToStaticMarkup(
      <ServiceCopyEditor
        copy={SERVICE}
        csrfToken={CSRF}
        canPublish={false}
        canPublishMedia={false}
        media={[media]}
        mediaLoadError={null}
        message={null}
        serviceStatus="ACTIVE"
      />,
    );
    expect(receptionist).toContain(`/api/media/renditions/${media.renditions[0]!.id}/preview`);
    expect(receptionist).toContain('آماده؛ در انتظار انتشار مدیر');
    expect(receptionist).toContain('برای بررسی و انتشار مدیر آماده است');
    expect(receptionist).not.toContain('/api/media/publication');
    expect(receptionist).toContain('/api/media/alt-text');
    expect(receptionist).toContain(media.id);

    const manager = renderToStaticMarkup(
      <ServiceCopyEditor
        copy={SERVICE}
        csrfToken={CSRF}
        canPublish
        canPublishMedia
        media={[media]}
        mediaLoadError={null}
        message={null}
        serviceStatus="ACTIVE"
      />,
    );
    expect(manager).toContain('/api/media/publication');
    expect(manager).toContain('name="serviceId"');
    expect(manager).toContain('انتشار عکس پس از بررسی');
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
        canPublishMedia={false}
        message={null}
        therapistStatus="ACTIVE"
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
        canPublishMedia
        message={null}
        therapistStatus="ACTIVE"
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

  it('renders A8 fixed slots in API order without row or ordering controls', () => {
    const entries = syntheticClinicEntries();
    const html = renderToStaticMarkup(
      <ClinicContentEditor
        entries={entries}
        media={[]}
        csrfToken={CSRF}
        canPublishMedia
        mediaLoadError={null}
      />,
    );

    expect(html.indexOf('معرفی آغاز صفحه')).toBeLessThan(html.indexOf('راهنمای شروع'));
    expect(html.indexOf('راهنمای شروع')).toBeLessThan(html.indexOf('معرفی صفحهٔ دربارهٔ کلینیک'));
    expect(html).toContain('عنوان، مرز نمایش این بخش است');
    expect(html).toContain('/api/content/clinic-profile/entries/update');
    expect(html).not.toContain('name="slot"');
    expect(html).not.toContain('name="position"');
    expect(html).not.toContain('/create');
    expect(html).not.toContain('/delete');
  });

  it('reuses distinct B5 controls for content and sharing images with manager publication', () => {
    const entries = syntheticClinicEntries();
    const contentImage = syntheticClinicImage('CLINIC_CONTENT_ENTRY', entries[1]!.id, false, '71');
    const openGraphImage = syntheticClinicImage('CLINIC_OPEN_GRAPH', null, true, '81');
    const html = renderToStaticMarkup(
      <ClinicContentEditor
        entries={entries}
        media={[contentImage, openGraphImage]}
        csrfToken={CSRF}
        canPublishMedia
        mediaLoadError={null}
      />,
    );

    expect(html).toContain('عکس هنگام اشتراک‌گذاری سایت');
    expect(html).toContain('این عکس لوگو نیست');
    expect(html).toContain('قاب پهن');
    expect(html).toContain('عکس به‌صورت پهن پشت متن دیده می‌شود');
    expect(html).toContain('در گوشی ممکن است بخش‌های کناری عکس کمتر دیده');
    expect(html).toContain('عکس آمادهٔ انتشار');
    expect(html).toContain('عکس منتشرشده');
    expect(html).toContain('action="/api/media/publication"');
    expect(html).toContain('name="clinicProfile" value="true"');

    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
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

function syntheticServiceImage(): MediaAsset {
  return {
    id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a63',
    altText: 'اتاق روشن گفتاردرمانی با میز و صندلی',
    status: 'ACTIVE',
    width: 1200,
    height: 800,
    byteSize: 24000,
    sourceContentType: 'image/jpeg',
    sourceByteSize: 36000,
    isPubliclyServed: false,
    renditions: [
      {
        id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a64',
        path: 'media/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a64',
        format: 'webp',
        width: 960,
        height: 640,
        byteSize: 18000,
        contentHash: 'synthetic-service-image-hash',
      },
    ],
    createdAt: '2026-09-01T00:00:00.000Z',
    archivedAt: null,
    bytesPurgedAt: null,
    attachments: [
      {
        id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a65',
        ownerType: 'PUBLIC_SERVICE',
        ownerId: ID,
        position: 0,
        attachedAt: '2026-09-01T00:00:00.000Z',
        publishedAt: null,
        ownerIsPublic: false,
        framing: { focalX: 0.4, focalY: 0.6, crop: null },
      },
    ],
  };
}

function syntheticClinicEntries(): ClinicContentEntry[] {
  return [
    {
      id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a70',
      slot: 'HOME_HERO',
      position: 0,
      label: null,
      eyebrow: null,
      heading: null,
      body: null,
      image: null,
    },
    {
      id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a71',
      slot: 'HOME_CONCERN',
      position: 0,
      label: 'انتخاب ساختگی',
      eyebrow: 'راهنمای ساختگی',
      heading: 'عنوان ساختگی',
      body: 'متن ساختگی',
      image: null,
    },
    {
      id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a72',
      slot: 'ABOUT_INTRO',
      position: 0,
      label: null,
      eyebrow: null,
      heading: null,
      body: null,
      image: null,
    },
  ];
}

function syntheticClinicImage(
  ownerType: 'CLINIC_CONTENT_ENTRY' | 'CLINIC_OPEN_GRAPH',
  ownerId: string | null,
  published: boolean,
  suffix: string,
): MediaAsset {
  return {
    id: `0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a${suffix}`,
    altText: `عکس ساختگی ${suffix}`,
    status: 'ACTIVE',
    width: 1200,
    height: 800,
    byteSize: 1000,
    sourceContentType: 'image/jpeg',
    sourceByteSize: 1200,
    isPubliclyServed: published,
    renditions: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    archivedAt: null,
    bytesPurgedAt: null,
    attachments: [
      {
        id: `0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a${Number(suffix) + 1}`,
        ownerType,
        ownerId,
        position: 0,
        attachedAt: '2026-09-01T00:00:00.000Z',
        publishedAt: published ? '2026-09-01T00:00:00.000Z' : null,
        ownerIsPublic: true,
        framing: { focalX: 0.5, focalY: 0.5, crop: null },
      },
    ],
  };
}
