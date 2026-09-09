import {
  DEFAULT_MEDIA_FRAMING,
  mediaFramingSchema,
  updateMediaFramingRequestSchema,
  MEDIA_ACCEPTED_CONTENT_TYPES,
  MEDIA_ASSET_STATUSES,
  MEDIA_ATTACHMENT_OWNERS,
  MEDIA_OWNERLESS_ATTACHMENT_OWNERS,
  isOwnerlessMediaAttachment,
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
        'framing',
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
          'bytesPurgedAt',
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
        'framing',
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

  /**
   * FRAMING IS A DESCRIPTION, AND THESE ASSERTIONS ARE WHAT KEEP IT ONE.
   *
   * The product rule is that framing can change without re-uploading, cannot
   * destroy the master, and can be previewed live by the web tier. All three
   * follow from one property: the numbers are normalised fractions that no
   * encoder ever reads. What is pinned here is the SHAPE — fractions, bounded,
   * inside the frame, all-or-nothing; `media-framing.int-spec.ts` pins the
   * behaviour against a real database and real files.
   */
  describe('framing', () => {
    const frame = (overrides: Record<string, unknown> = {}) => ({
      focalX: 0.5,
      focalY: 0.5,
      crop: null,
      ...overrides,
    });

    it('defaults to the centre of the frame with no crop', () => {
      // What an unframed image means, and it is exactly what a browser does to
      // an image nobody has framed — so an attachment nobody touches behaves as
      // it always did.
      expect(DEFAULT_MEDIA_FRAMING).toEqual({ focalX: 0.5, focalY: 0.5, crop: null });
      expect(mediaFramingSchema.safeParse(DEFAULT_MEDIA_FRAMING).success).toBe(true);
    });

    it('is fractions of the frame and refuses anything outside it', () => {
      // Pixels would mean something different on each of the five rendition
      // widths, so a crop chosen against one would be wrong on the rest.
      expect(mediaFramingSchema.safeParse(frame({ focalX: 0, focalY: 1 })).success).toBe(true);
      expect(mediaFramingSchema.safeParse(frame({ focalX: -0.01 })).success).toBe(false);
      expect(mediaFramingSchema.safeParse(frame({ focalY: 1.01 })).success).toBe(false);
      expect(mediaFramingSchema.safeParse(frame({ focalX: 640 })).success).toBe(false);
    });

    it('accepts a crop that lies inside the frame and refuses one that runs off it', () => {
      expect(
        mediaFramingSchema.safeParse(frame({ crop: { x: 0.25, y: 0, width: 0.5, height: 1 } }))
          .success,
      ).toBe(true);
      expect(
        mediaFramingSchema.safeParse(frame({ crop: { x: 0.6, y: 0, width: 0.5, height: 1 } }))
          .success,
      ).toBe(false);
      // A zero-area crop is an invisible image, which is never what somebody
      // dragging a handle meant.
      expect(
        mediaFramingSchema.safeParse(frame({ crop: { x: 0, y: 0, width: 0, height: 1 } })).success,
      ).toBe(false);
    });

    it('treats a crop as one indivisible fact', () => {
      // A rectangle with a width and no origin is not a partly specified crop,
      // it is a bug that renders full-frame on one page and a sliver on another.
      expect(
        mediaFramingSchema.safeParse(frame({ crop: { x: 0, y: 0, width: 0.5 } })).success,
      ).toBe(false);
    });

    it('is the whole of the re-framing request, so no other state can ride along', () => {
      // Re-framing must not be able to publish, detach, reposition or re-point
      // an attachment. The request carrying nothing but framing is that promise
      // as a shape.
      expect(keysOf(updateMediaFramingRequestSchema)).toEqual(['crop', 'focalX', 'focalY']);
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

    it('names seven owners and two asset states', () => {
      // `PUBLIC_SPACE` is Milestone 9.5 checkpoint A7's addition, and it is
      // APPENDED rather than replacing `CLINIC_SPACE`. The two are opposites
      // despite the names: `CLINIC_SPACE` stays A5's ownerless slot that no
      // public projection reads, and `PUBLIC_SPACE` names a real
      // `public_space` row whose own publication gates the photograph. A future
      // edit that collapses them has to change this list deliberately.
      //
      // The last two are checkpoint A8's and are appended for the same reason.
      // `CLINIC_CONTENT_ENTRY` names an editorial block of the home or about
      // page; `CLINIC_OPEN_GRAPH` is the site's social-preview photograph and
      // is OWNERLESS, so it joins `CLINIC_SPACE` rather than the four types
      // with rows.
      expect([...MEDIA_ATTACHMENT_OWNERS]).toEqual([
        'THERAPIST_PROFILE',
        'PUBLIC_ARTICLE',
        'PUBLIC_TESTIMONIAL',
        'CLINIC_SPACE',
        'PUBLIC_SPACE',
        'CLINIC_CONTENT_ENTRY',
        'CLINIC_OPEN_GRAPH',
      ]);
      expect([...MEDIA_ASSET_STATUSES]).toEqual(['ACTIVE', 'ARCHIVED']);
    });

    it('names exactly the two owner types that carry no owner id', () => {
      // Milestone 9.5, checkpoint A8. Until A8 there was one ownerless type and
      // every caller wrote `!== 'CLINIC_SPACE'`; the list exists so that a
      // third would be one edit rather than a search. Every other owner type
      // MUST carry an id, which `media_attachment_owner_chk` enforces in the
      // database over all seven branches.
      expect([...MEDIA_OWNERLESS_ATTACHMENT_OWNERS]).toEqual(['CLINIC_SPACE', 'CLINIC_OPEN_GRAPH']);

      for (const owner of MEDIA_ATTACHMENT_OWNERS) {
        expect(isOwnerlessMediaAttachment(owner)).toBe(
          (MEDIA_OWNERLESS_ATTACHMENT_OWNERS as readonly string[]).includes(owner),
        );
      }
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
