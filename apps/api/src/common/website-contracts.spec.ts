import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CURRENT_PUBLIC_REQUEST_CONSENT_VERSION,
  PUBLIC_REQUEST_CONTACT_TIMES,
  PUBLIC_ARTICLE_CACHE_TAG_PREFIX,
  PUBLIC_CACHE_TAGS,
  PUBLIC_REQUEST_CONSENT_VERSIONS,
  PUBLIC_REQUEST_MAX_CHILD_AGE_YEARS,
  PUBLIC_SERVICE_CACHE_TAG_PREFIX,
  PUBLIC_SITEMAP_KINDS,
  PUBLIC_THERAPIST_CACHE_TAG_PREFIX,
  publicArticleDetailSchema,
  publicArticleSummarySchema,
  publicClinicProfileSchema,
  publicMediaPathSchema,
  publicRequestSubmissionResponseSchema,
  publicRequestSubmissionSchema,
  publicServiceDetailSchema,
  publicServiceSummarySchema,
  publicSitemapEntrySchema,
  publicSlugSchema,
  publicTestimonialSchema,
  publicTherapistProfileSchema,
  serviceSchema,
  therapistSchema,
} from '@clinic/contracts';

/**
 * The public projections, pinned field by field.
 *
 * Milestone 9, checkpoint A1. These schemas are the boundary between what the
 * clinic records and what the world reads, so the assertions here are exact
 * lists rather than subset checks: a field ADDED to a public shape has to fail
 * a test, because the failure mode this file exists to prevent is a widening
 * nobody notices — an internal column arriving on the website because somebody
 * extended a schema that looked convenient.
 */
describe('public website contracts', () => {
  const keysOf = (schema: { shape: Record<string, unknown> }) => Object.keys(schema.shape).sort();

  /**
   * The clinic profile as it reads before anybody has supplied anything: every
   * owner-typed fact null, and the gallery an empty array rather than a null.
   *
   * Built from the schema's own keys rather than written out, so a column added
   * to the profile is covered here automatically — with the one array key named
   * explicitly, because "null" is not a valid empty gallery.
   */
  const emptyClinicProfile = (): Record<string, unknown> => ({
    ...Object.fromEntries(Object.keys(publicClinicProfileSchema.shape).map((key) => [key, null])),
    spacePhotos: [],
  });

  describe('the projections are exactly these fields', () => {
    it('states three facts about a listed service', () => {
      expect(keysOf(publicServiceSummarySchema)).toEqual(['description', 'name', 'slug']);
    });

    it('adds session lengths, and only that, on the detail', () => {
      expect(keysOf(publicServiceDetailSchema)).toEqual([
        'description',
        'name',
        'sessionDurationsMinutes',
        'slug',
      ]);
    });

    it('states six facts about a published therapist', () => {
      // `photo` is the sixth, added in Milestone 9.5 checkpoint A5. It sits
      // BESIDE `photoPath` rather than replacing it because the two are
      // different facts: a path a manager typed to a file a developer placed,
      // and a photograph the clinic uploaded through the media subsystem.
      expect(keysOf(publicTherapistProfileSchema)).toEqual([
        'bio',
        'displayName',
        'photo',
        'photoPath',
        'slug',
        'title',
      ]);
    });

    it('states five facts about a listed article and one more on the detail', () => {
      // `publishedAt` is the ONE timestamp this surface projects, and it is a
      // deliberate exception: the date an article was published is editorial
      // content a reader judges it by, unlike "when was this service entered".
      expect(keysOf(publicArticleSummarySchema)).toEqual([
        'images',
        'publishedAt',
        'slug',
        'summary',
        'title',
      ]);
      expect(keysOf(publicArticleDetailSchema)).toEqual([
        'body',
        'images',
        'publishedAt',
        'slug',
        'summary',
        'title',
      ]);
    });

    it('states three facts about a testimonial, and none identifies anybody', () => {
      // No slug, no id, no date, no status, no family, no child, no service, no
      // therapist and no outcome. PROJECT_SPEC.md 11 forbids publishing
      // identifying child or clinical data, and the narrowest way to obey a
      // rule about a category of data is not to hold it.
      expect(keysOf(publicTestimonialSchema)).toEqual(['authorLabel', 'body', 'image']);
    });

    it('states three facts per sitemap entry, and no path or host', () => {
      // The route structure belongs to the web tier, which owns its router and
      // is the only tier that can be wrong about it.
      expect(keysOf(publicSitemapEntrySchema)).toEqual(['kind', 'lastModified', 'slug']);
      expect(PUBLIC_SITEMAP_KINDS).toEqual(['service', 'therapist', 'article']);
    });

    it('states thirteen owner-supplied facts about the clinic, and one gallery', () => {
      // `spacePhotos` is the fourteenth key and the only one that is not
      // owner-typed text: it is a projection of published media attachments,
      // and it is an array rather than a nullable because an empty gallery is
      // the normal state and is not an absence anybody has to render around.
      expect(keysOf(publicClinicProfileSchema)).toEqual([
        'about',
        'addressLine',
        'cityLabel',
        'displayName',
        'email',
        'instagramUrl',
        'mapLatitude',
        'mapLongitude',
        'phonePrimary',
        'phoneSecondary',
        'spacePhotos',
        'tagline',
        'telegramUrl',
        'workingHoursNote',
      ]);
    });
  });

  describe('a public shape is not an internal shape', () => {
    it('shares exactly one field name with the internal service, and none with the therapist', () => {
      // A SERVICE and a THERAPIST are published differently on purpose, and the
      // difference is visible here.
      //
      // A service's name IS its public name — Milestone 2 recorded
      // `publicDescription` and `isPublic` on that row precisely because the
      // service is the thing the clinic advertises — so `name` is the one field
      // the two shapes share, and it is shared deliberately.
      //
      // A THERAPIST SHARES NOTHING. `fullName` and `specialty` are the
      // personnel record; the website reads `displayName` and `title`, which
      // are separate, approved content. That is what makes "no fallback"
      // structural rather than a rule somebody has to remember: there is no
      // field for an internal value to fall back INTO.
      const serviceKeys = new Set(keysOf(serviceSchema));
      const therapistKeys = new Set(keysOf(therapistSchema));

      expect(keysOf(publicServiceDetailSchema).filter((key) => serviceKeys.has(key))).toEqual([
        'name',
      ]);
      expect(keysOf(publicTherapistProfileSchema).filter((key) => therapistKeys.has(key))).toEqual(
        [],
      );
    });

    it('refuses every internal field the catalog rows actually carry', () => {
      // Strict objects, so each of these is a parse failure rather than a field
      // that rides along and is quietly serialised.
      const service = { slug: 'speech-therapy', name: 'X', description: null };
      const therapist = {
        slug: 'a-therapist',
        displayName: 'X',
        title: null,
        bio: null,
        photoPath: null,
        photo: null,
      };

      for (const leak of [
        { id: '0199a0f9-0000-7000-8000-000000000000' },
        { status: 'ACTIVE' },
        { isPublic: true },
        { deactivatedAt: null },
        { createdAt: '2026-08-21T00:00:00.000Z' },
        { createdByUserId: '0199a0f9-0000-7000-8000-000000000000' },
      ]) {
        expect(publicServiceSummarySchema.safeParse({ ...service, ...leak }).success).toBe(false);
        expect(publicTherapistProfileSchema.safeParse({ ...therapist, ...leak }).success).toBe(
          false,
        );
      }
    });

    it('refuses financial, family and clinical vocabulary outright', () => {
      // None of these is a field anybody would add on purpose. They are here
      // because the cost of the mistake is a family fact on a public website,
      // and a strict schema is the cheapest place to make it impossible.
      for (const leak of [
        { familyId: '0199a0f9-0000-7000-8000-000000000000' },
        { childName: 'X' },
        { amountToman: '1000' },
        { therapistSharePercent: '40' },
        { specialty: 'X' },
        { fullName: 'X' },
        { supportedServiceIds: [] },
      ]) {
        expect(
          publicTherapistProfileSchema.safeParse({
            slug: 'a-therapist',
            displayName: 'X',
            title: null,
            bio: null,
            photoPath: null,
            photo: null,
            ...leak,
          }).success,
        ).toBe(false);
      }
    });

    it('carries no price and no availability on a service', () => {
      const detail = keysOf(publicServiceDetailSchema);

      for (const absent of ['priceToman', 'tariff', 'availability', 'slots', 'therapists']) {
        expect(detail).not.toContain(absent);
      }
    });
  });

  describe('the slug', () => {
    it('accepts lowercase ASCII words joined by single hyphens', () => {
      for (const valid of ['ab', 'speech-therapy', 'clinic2', 'a1-b2-c3']) {
        expect(publicSlugSchema.safeParse(valid).success).toBe(true);
      }
    });

    it('refuses everything that would make one page two strings', () => {
      for (const invalid of [
        'A',
        'a',
        'Speech-Therapy',
        'speech_therapy',
        'speech--therapy',
        '-speech',
        'speech-',
        'speech therapy',
        'گفتاردرمانی',
        'speech/therapy',
        'speech.therapy',
        '',
        'a'.repeat(81),
      ]) {
        expect(publicSlugSchema.safeParse(invalid).success).toBe(false);
      }
    });
  });

  describe('the photo path', () => {
    it('accepts a relative lowercase path', () => {
      expect(publicMediaPathSchema.safeParse('team/therapist-1.jpg').success).toBe(true);
    });

    it('refuses anything that could point somewhere else', () => {
      for (const invalid of [
        '/team/photo.jpg',
        '../secrets/photo.jpg',
        'team/../../etc/passwd',
        'https://example.invalid/photo.jpg',
        'Team/Photo.JPG',
        'team/photo .jpg',
        '',
      ]) {
        expect(publicMediaPathSchema.safeParse(invalid).success).toBe(false);
      }
    });
  });

  describe('the cache vocabulary', () => {
    it('freezes the names both tiers have to agree on', () => {
      // Frozen because a page tagged `public-services` and a revalidation
      // clearing `publicServices` is a bug nothing fails on: the site simply
      // goes stale and nobody knows for how long.
      //
      // A2 ADDS THREE AND RENAMES NONE. An added tag is a new public
      // collection; a CHANGED one would silently strip the invalidation from
      // every page already tagged with the old name, which is why this is an
      // exact-equality assertion rather than a subset check.
      expect(PUBLIC_CACHE_TAGS).toEqual({
        services: 'public-services',
        team: 'public-team',
        clinicProfile: 'public-clinic-profile',
        articles: 'public-articles',
        testimonials: 'public-testimonials',
        sitemap: 'public-sitemap',
      });

      expect(PUBLIC_SERVICE_CACHE_TAG_PREFIX).toBe('public-service:');
      expect(PUBLIC_THERAPIST_CACHE_TAG_PREFIX).toBe('public-therapist:');
      expect(PUBLIC_ARTICLE_CACHE_TAG_PREFIX).toBe('public-article:');
    });

    it('keeps the tag vocabulary out of apps/api entirely', () => {
      // The A1 decision, still true after A2 gave the API write paths: nothing
      // in `apps/api` reads a cache tag or returns one. The web tier derives
      // which tags a successful mutation invalidated from the row the mutation
      // RETURNED — its slug and its publication flag — and an API that named
      // them in a response would be a second, quieter answer to a question the
      // body already answers, and would put a web caching concern inside the
      // domain layer.
      //
      // Asserted by reading the source rather than by convention, because the
      // convention is one import away from being broken silently.
      const sourceRoot = join(__dirname, '..');
      const offenders: string[] = [];

      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
            continue;
          }
          if (!entry.name.endsWith('.ts')) continue;
          // This file is the one that states the vocabulary in order to pin it.
          if (full === __filename) continue;

          const text = readFileSync(full, 'utf8');
          for (const tag of Object.values(PUBLIC_CACHE_TAGS)) {
            if (text.includes(`'${tag}'`) || text.includes(`"${tag}"`)) offenders.push(full);
          }
        }
      };

      walk(sourceRoot);

      expect(offenders).toEqual([]);
    });
  });

  describe('the clinic profile', () => {
    it('reads as thirteen nulls and an empty gallery before the owner supplies anything', () => {
      expect(publicClinicProfileSchema.safeParse(emptyClinicProfile()).success).toBe(true);
    });

    it('refuses a coordinate outside the world and a link that is not one', () => {
      const empty = emptyClinicProfile();

      expect(publicClinicProfileSchema.safeParse({ ...empty, mapLatitude: 91 }).success).toBe(
        false,
      );
      expect(publicClinicProfileSchema.safeParse({ ...empty, mapLongitude: -181 }).success).toBe(
        false,
      );
      expect(publicClinicProfileSchema.safeParse({ ...empty, instagramUrl: 'nope' }).success).toBe(
        false,
      );
      expect(publicClinicProfileSchema.safeParse({ ...empty, email: 'nope' }).success).toBe(false);
    });
  });
  describe('the public request submission (checkpoint A3)', () => {
    const valid = {
      contactName: 'سرپرست نمونه',
      contactMobile: '09120000001',
      serviceSlug: null,
      childAgeYears: 6,
      childSex: 'UNSPECIFIED',
      consent: true,
      consentVersion: CURRENT_PUBLIC_REQUEST_CONSENT_VERSION,
    };

    it('asks for exactly these ten things and no clinical question', () => {
      // An exact list rather than a subset check, for the reason every other
      // assertion in this file is one: the failure mode is a field ADDED to a
      // shape that collects a stranger's personal data, and a widening nobody
      // notices is exactly what has to fail a test. Nothing here is a
      // diagnosis, a referral, a screening instrument, a severity or a history.
      expect(keysOf(publicRequestSubmissionSchema)).toEqual([
        'childAgeYears',
        'childName',
        'childSex',
        'consent',
        'consentVersion',
        'contactMobile',
        'contactName',
        'note',
        'preferredContactTime',
        'serviceSlug',
      ]);
    });

    it('tells the visitor one thing, and no identifier', () => {
      // An id would be a handle an anonymous caller could keep, quote or
      // enumerate, and the product has no route that would answer.
      expect(keysOf(publicRequestSubmissionResponseSchema)).toEqual(['received']);
      expect(publicRequestSubmissionResponseSchema.safeParse({ received: false }).success).toBe(
        false,
      );
    });

    it('requires the six required fields and tolerates the four optional ones', () => {
      expect(publicRequestSubmissionSchema.safeParse(valid).success).toBe(true);

      for (const key of Object.keys(valid)) {
        const without = { ...valid } as Record<string, unknown>;
        delete without[key];
        expect(publicRequestSubmissionSchema.safeParse(without).success).toBe(false);
      }

      expect(
        publicRequestSubmissionSchema.safeParse({
          ...valid,
          childName: 'کودک نمونه',
          preferredContactTime: 'EVENING',
          note: 'متن نمونه.',
        }).success,
      ).toBe(true);
    });

    it('treats "not sure" as a value and an absent service as a broken form', () => {
      expect(publicRequestSubmissionSchema.safeParse({ ...valid, serviceSlug: null }).success).toBe(
        true,
      );
      expect(
        publicRequestSubmissionSchema.safeParse({ ...valid, serviceSlug: 'a-service' }).success,
      ).toBe(true);
    });

    it('accepts all three child-sex values and refuses an absent one', () => {
      for (const childSex of ['FEMALE', 'MALE', 'UNSPECIFIED']) {
        expect(publicRequestSubmissionSchema.safeParse({ ...valid, childSex }).success).toBe(true);
      }

      const omitted = { ...valid } as Record<string, unknown>;
      delete omitted['childSex'];
      expect(publicRequestSubmissionSchema.safeParse(omitted).success).toBe(false);
      expect(publicRequestSubmissionSchema.safeParse({ ...valid, childSex: null }).success).toBe(
        false,
      );
    });

    it('bounds the age broadly and encodes no eligibility rule', () => {
      // Every one of these is a person somebody could be. Refusing any of them
      // would be this clinic declining to hear from them, decided by a schema.
      for (const childAgeYears of [0, 3, 7, 14, 17, 18, 40, PUBLIC_REQUEST_MAX_CHILD_AGE_YEARS]) {
        expect(publicRequestSubmissionSchema.safeParse({ ...valid, childAgeYears }).success).toBe(
          true,
        );
      }

      for (const childAgeYears of [-1, 121, 6.5, '6']) {
        expect(publicRequestSubmissionSchema.safeParse({ ...valid, childAgeYears }).success).toBe(
          false,
        );
      }
    });

    it('refuses a consent that was declined or given under wording nobody agreed', () => {
      expect(publicRequestSubmissionSchema.safeParse({ ...valid, consent: false }).success).toBe(
        false,
      );
      expect(
        publicRequestSubmissionSchema.safeParse({ ...valid, consentVersion: 'anything' }).success,
      ).toBe(false);
      expect(PUBLIC_REQUEST_CONSENT_VERSIONS).toContain(CURRENT_PUBLIC_REQUEST_CONSENT_VERSION);
    });

    it('takes the preferred contact time from the frozen four, or not at all', () => {
      // OPTIONAL AND CLOSED, WHICH ARE DIFFERENT PROPERTIES. A short form need
      // not ask; a form that does ask may not send a sentence.
      expect(PUBLIC_REQUEST_CONTACT_TIMES).toEqual([
        'MORNING',
        'AFTERNOON',
        'EVENING',
        'NO_PREFERENCE',
      ]);

      for (const preferredContactTime of PUBLIC_REQUEST_CONTACT_TIMES) {
        expect(
          publicRequestSubmissionSchema.safeParse({ ...valid, preferredContactTime }).success,
        ).toBe(true);
      }

      // Omission and `null` both stay valid, and `NO_PREFERENCE` is a THIRD,
      // different fact: a parent saying any time suits them.
      const without = { ...valid } as Record<string, unknown>;
      expect(publicRequestSubmissionSchema.safeParse(without).success).toBe(true);
      expect(
        publicRequestSubmissionSchema.safeParse({ ...valid, preferredContactTime: null }).success,
      ).toBe(true);
    });

    it('refuses free text, a clock time and an invented bucket in that field', () => {
      // The whole point of closing the vocabulary. «صبح‌ها بعد از ۹» is a
      // sentence somebody has to read; a colleague scanning an inbox needs a
      // value they can sort by.
      for (const preferredContactTime of [
        'عصرها',
        'mornings',
        'morning',
        '09:00-12:00',
        'LATE_NIGHT',
        'ANY',
        '',
      ]) {
        expect(
          publicRequestSubmissionSchema.safeParse({ ...valid, preferredContactTime }).success,
        ).toBe(false);
      }
    });

    it('attaches no clock range to any of the four', () => {
      // Stated as an assertion because it is a product rule rather than an
      // omission: times behind these names would be a second, quieter answer to
      // "when is the clinic open?", and nothing may derive one from the other.
      // The contract exports the names and nothing else.
      const exported = JSON.stringify(PUBLIC_REQUEST_CONTACT_TIMES);

      expect(exported).not.toMatch(/\d/);
    });

    it('refuses markup in every free-text field', () => {
      for (const key of ['contactName', 'childName', 'note']) {
        expect(
          publicRequestSubmissionSchema.safeParse({ ...valid, [key]: '<script>x</script>' })
            .success,
        ).toBe(false);
      }
    });

    it('refuses a field the contract does not name', () => {
      expect(
        publicRequestSubmissionSchema.safeParse({ ...valid, diagnosis: 'anything' }).success,
      ).toBe(false);
      expect(
        publicRequestSubmissionSchema.safeParse({ ...valid, nationalId: '0000000000' }).success,
      ).toBe(false);
      expect(publicRequestSubmissionSchema.safeParse({ ...valid, familyId: 'x' }).success).toBe(
        false,
      );
    });
  });
});
