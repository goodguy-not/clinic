import {
  MEDIA_ACCEPTED_CONTENT_TYPES,
  MEDIA_ASSET_STATUSES,
  MEDIA_ATTACHMENT_OWNERS,
  MEDIA_MASTER_MAX_DIMENSION,
  MEDIA_RENDITION_CONTENT_TYPE,
  MEDIA_RENDITION_FORMATS,
  MEDIA_RENDITION_WIDTHS,
  MEDIA_SOURCE_MAX_BYTES,
  MEDIA_SOURCE_MAX_PIXELS,
  MEDIA_SOURCE_MIN_DIMENSION,
  PUBLIC_MEDIA_CACHE_TAG_PREFIX,
  PUBLIC_MEDIA_MAX_AGE_SECONDS,
  PUBLIC_MEDIA_PATH_PREFIX,
  PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS,
  createMediaAttachmentRequestSchema,
  mediaAltTextSchema,
  mediaAssetSchema,
  mediaAttachmentSchema,
  mediaUploadFieldsSchema,
  publicImageSchema,
  publicMediaPathSchema,
  updateMediaArchiveRequestSchema,
  updateMediaPublicationRequestSchema,
} from '@clinic/contracts';

/**
 * The media contracts, pinned field by field.
 *
 * Milestone 9.5, checkpoint A5. The same discipline `website-contracts.spec.ts`
 * applies to the public projections, applied to the shapes this checkpoint
 * adds: exact key lists rather than subset checks, because the failure this
 * file exists to prevent is a widening nobody notices.
 *
 * THE ONE THAT MATTERS IS `publicImageSchema`. It is what a stranger receives,
 * and every field NOT on it is a field a visitor cannot learn: no attachment,
 * no publication instant, no uploader, no storage key, no original file name,
 * no master. A key added there has to fail here.
 */
describe('media contracts', () => {
  const keysOf = (schema: { shape: Record<string, unknown> }) => Object.keys(schema.shape).sort();

  describe('the public projection is exactly these fields', () => {
    it('states five facts about a published photograph, and no internal one', () => {
      expect(keysOf(publicImageSchema)).toEqual([
        'alt',
        'height',
        'mediaId',
        'renditions',
        'width',
      ]);
    });

    it('refuses every internal fact the media rows actually carry', () => {
      // Strict objects, so each of these is a parse failure rather than a field
      // that rides along and is quietly serialised to a visitor.
      const image = {
        mediaId: '0199a0f9-0000-7000-8000-000000000000',
        alt: 'یک عکس',
        width: 640,
        height: 960,
        renditions: [
          {
            path: 'media/0199a0f9-0000-7000-8000-000000000001',
            format: 'webp',
            width: 640,
            height: 960,
            byteSize: 1,
          },
        ],
      };

      for (const leak of [
        { storageKey: 'aa/bb/x/master.jpg' },
        { masterStorageKey: 'aa/bb/x/master.jpg' },
        { status: 'ACTIVE' },
        { attachments: [] },
        { publishedAt: '2026-09-08T00:00:00.000Z' },
        { createdByUserId: '0199a0f9-0000-7000-8000-000000000000' },
        { sourceFileName: 'IMG_2043.jpg' },
        { sourceByteSize: 1 },
      ]) {
        expect(publicImageSchema.safeParse({ ...image, ...leak }).success).toBe(false);
      }
    });

    it('has no path that could point anywhere but this origin', () => {
      // Reuses the A1 media-path shape, so a rendition path is validated by the
      // same rule a manager-typed static path always was.
      expect(
        publicMediaPathSchema.safeParse('media/0199a0f9-0000-7000-8000-000000000001').success,
      ).toBe(true);

      for (const invalid of [
        '/media/x',
        '../media/x',
        'https://example.invalid/media/x',
        'media/../../etc/passwd',
      ]) {
        expect(publicMediaPathSchema.safeParse(invalid).success).toBe(false);
      }
    });

    it('requires at least one rendition, because an image with none is not renderable', () => {
      expect(
        publicImageSchema.safeParse({
          mediaId: '0199a0f9-0000-7000-8000-000000000000',
          alt: 'یک عکس',
          width: 640,
          height: 960,
          renditions: [],
        }).success,
      ).toBe(false);
    });
  });

  describe('the staff shapes', () => {
    it('states the twelve facts a colleague needs about one photograph', () => {
      expect(keysOf(mediaAssetSchema)).toEqual(
        [
          'altText',
          'archivedAt',
          'attachments',
          'byteSize',
          'createdAt',
          'id',
          'isPubliclyServed',
          'renditions',
          'sourceByteSize',
          'sourceContentType',
          'status',
          'width',
          'height',
        ].sort(),
      );
    });

    it('states the two gates separately on an attachment', () => {
      // `publishedAt` is the manager's decision and `ownerIsPublic` is the
      // world's state. Both must hold for a visitor to see anything, and the
      // library shows them apart so a colleague can tell WHICH gate is closed.
      expect(keysOf(mediaAttachmentSchema)).toEqual([
        'attachedAt',
        'id',
        'ownerId',
        'ownerIsPublic',
        'ownerType',
        'position',
        'publishedAt',
      ]);
    });

    it('gives the attach request no way to publish', () => {
      // The authority boundary as a shape: a caller holding only `media.attach`
      // has no field through which to ask for visibility.
      expect(keysOf(createMediaAttachmentRequestSchema)).toEqual([
        'ownerId',
        'ownerType',
        'position',
      ]);

      expect(
        createMediaAttachmentRequestSchema.safeParse({
          ownerType: 'CLINIC_SPACE',
          ownerId: null,
          isPublished: true,
        }).success,
      ).toBe(false);
    });

    it('defaults an attachment to the front of the order', () => {
      const parsed = createMediaAttachmentRequestSchema.parse({
        ownerType: 'CLINIC_SPACE',
        ownerId: null,
      });

      expect(parsed.position).toBe(0);
    });

    it('keeps the two manager requests to one boolean each', () => {
      expect(keysOf(updateMediaPublicationRequestSchema)).toEqual(['isPublished']);
      expect(keysOf(updateMediaArchiveRequestSchema)).toEqual(['archived']);
    });

    it('asks an upload for an alt text and nothing else', () => {
      expect(keysOf(mediaUploadFieldsSchema)).toEqual(['altText']);
    });
  });

  describe('the alt text', () => {
    it('accepts ordinary Persian', () => {
      expect(mediaAltTextSchema.safeParse('اتاق کاردرمانی کلینیک').success).toBe(true);
    });

    it('refuses an empty label, because an unlabelled image is unreadable', () => {
      for (const invalid of ['', '   ', 'a'.repeat(201)]) {
        expect(mediaAltTextSchema.safeParse(invalid).success).toBe(false);
      }
    });

    it('refuses markup, for the reason no public column in this product stores any', () => {
      expect(mediaAltTextSchema.safeParse('<img src=x onerror=alert(1)>').success).toBe(false);
    });
  });

  describe('the frozen vocabulary', () => {
    it('accepts three photograph formats and never SVG', () => {
      expect([...MEDIA_ACCEPTED_CONTENT_TYPES]).toEqual(['image/jpeg', 'image/png', 'image/webp']);
      expect([...MEDIA_ACCEPTED_CONTENT_TYPES]).not.toContain('image/svg+xml');
    });

    it('names four owners and two asset states', () => {
      expect([...MEDIA_ATTACHMENT_OWNERS]).toEqual([
        'THERAPIST_PROFILE',
        'PUBLIC_ARTICLE',
        'PUBLIC_TESTIMONIAL',
        'CLINIC_SPACE',
      ]);
      expect([...MEDIA_ASSET_STATUSES]).toEqual(['ACTIVE', 'ARCHIVED']);
    });

    it('emits two formats, each with a content type', () => {
      expect([...MEDIA_RENDITION_FORMATS]).toEqual(['webp', 'jpeg']);

      for (const format of MEDIA_RENDITION_FORMATS) {
        expect(MEDIA_ACCEPTED_CONTENT_TYPES).toContain(MEDIA_RENDITION_CONTENT_TYPE[format]);
      }
    });

    it('keeps the ladder ascending and below the master ceiling', () => {
      const widths = [...MEDIA_RENDITION_WIDTHS];

      expect(widths).toEqual([...widths].sort((a, b) => a - b));
      expect(Math.max(...widths)).toBeLessThanOrEqual(MEDIA_MASTER_MAX_DIMENSION);
      expect(Math.min(...widths)).toBeGreaterThanOrEqual(MEDIA_SOURCE_MIN_DIMENSION);
    });

    it('bounds bytes and pixels separately, because they are different attacks', () => {
      // A few hundred kilobytes of compressible PNG can decode to gigabytes of
      // bitmap, so the byte cap says nothing about the pixel cap.
      expect(MEDIA_SOURCE_MAX_BYTES).toBe(12 * 1024 * 1024);
      expect(MEDIA_SOURCE_MAX_PIXELS).toBe(50_000_000);
    });
  });

  describe('the cache and revocation vocabulary', () => {
    it('serves media for exactly the stated revocation window', () => {
      // ONE NUMBER, ONE MEANING. The `max-age` NestJS sets and the window Vala
      // promises are the same value by construction, so a future edit that
      // lengthened the cache without re-stating the promise cannot happen
      // quietly.
      expect(PUBLIC_MEDIA_MAX_AGE_SECONDS).toBe(PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS);
      expect(PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS).toBe(300);
    });

    it('freezes the two prefixes both tiers concatenate', () => {
      expect(PUBLIC_MEDIA_PATH_PREFIX).toBe('media/');
      expect(PUBLIC_MEDIA_CACHE_TAG_PREFIX).toBe('public-media:');
    });
  });
});
