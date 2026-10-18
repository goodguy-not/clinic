import request from 'supertest';
import { publicClinicProfileResponseSchema } from '@clinic/contracts';
import {
  createHarness,
  internalHeaders,
  resetDatabase,
  type Harness,
  ownerPrisma,
} from './harness';
import { as, auditActionsFor, loginAs } from './website-support';

/**
 * The clinic's own public profile, maintained through the real manager path.
 *
 * Milestone 9, checkpoint A2, closing the last A1 column with no writer. The
 * question this suite answers is the one the checkpoint plan asked: can the
 * clinic change the address on its own website without SQL, a seed or a
 * deployment?
 *
 * EVERY VALUE HERE IS OBVIOUSLY SYNTHETIC. This repository does not hold the
 * clinic's real name, address, telephone number, hours or links, and no fixture
 * may invent one.
 */
describe('clinic public profile (real PostgreSQL)', () => {
  let harness: Harness;
  let manager: string;
  let receptionist: string;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    manager = await loginAs(harness, 'MANAGER');
    receptionist = await loginAs(harness, 'RECEPTIONIST');

    await harness.prisma.$executeRaw`
      UPDATE clinic_public_profile
      SET display_name = NULL, tagline = NULL, about = NULL, address_line = NULL,
          city_label = NULL, phone_primary = NULL, phone_secondary = NULL, email = NULL,
          working_hours_note = NULL, map_latitude = NULL, map_longitude = NULL,
          instagram_url = NULL, telegram_url = NULL
      WHERE singleton_key = 1
    `;
  });

  const server = () => harness.app.getHttpServer();

  const EMPTY = {
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

  const FILLED = {
    ...EMPTY,
    displayName: 'Synthetic Clinic Name',
    tagline: 'Synthetic tagline for a clinic that does not exist.',
    addressLine: 'Synthetic address line, number 0',
    cityLabel: 'Synthetic City',
    phonePrimary: '000-0000000',
    email: 'synthetic@example.invalid',
    workingHoursNote: 'Synthetic hours line.',
    mapLatitude: 35.5,
    mapLongitude: 51.5,
    instagramUrl: 'https://example.invalid/synthetic',
  };

  const save = (session: string, body: Record<string, unknown>) =>
    request(server()).put('/content/clinic-profile').set(as(session)).send(body);

  describe('the authority', () => {
    it('refuses a receptionist both the read and the write', async () => {
      // Not draftable content: there is one profile, it is always live, and
      // editing it IS publishing — so the drafting authority A2 gave this role
      // deliberately does not reach here.
      const read = await request(server()).get('/content/clinic-profile').set(as(receptionist));
      const write = await save(receptionist, FILLED);

      expect(read.status).toBe(403);
      expect(write.status).toBe(403);
      expect(write.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('lets a manager read the empty profile and fill it in', async () => {
      const before = await request(server()).get('/content/clinic-profile').set(as(manager));
      const saved = await save(manager, FILLED);

      expect(publicClinicProfileResponseSchema.parse(before.body).clinic).toEqual(EMPTY);
      expect(saved.status).toBe(200);
      expect(publicClinicProfileResponseSchema.parse(saved.body).clinic).toEqual(FILLED);
    });
  });

  describe('what the website then says', () => {
    it('reaches the public read with no further act', async () => {
      // There is no publication step here, and that is the point of the
      // decision: the clinic's contact facts are always live, so a manager
      // saving the form IS the publication.
      await save(manager, FILLED);

      const published = await request(server())
        .get('/public/clinic-profile')
        .set(internalHeaders());

      expect(publicClinicProfileResponseSchema.parse(published.body).clinic).toEqual(FILLED);
    });

    it('empties a field when the manager clears it', async () => {
      await save(manager, FILLED);
      await save(manager, { ...FILLED, phonePrimary: null });

      const published = await request(server())
        .get('/public/clinic-profile')
        .set(internalHeaders());

      expect(
        publicClinicProfileResponseSchema.parse(published.body).clinic.phonePrimary,
      ).toBeNull();
    });
  });

  describe('what may be saved', () => {
    it('refuses a plaintext link, half a map pin, and a coordinate off the planet', async () => {
      const attempts = [
        { ...FILLED, instagramUrl: 'http://example.invalid/synthetic' },
        { ...FILLED, mapLatitude: 35.5, mapLongitude: null },
        { ...FILLED, mapLatitude: 950, mapLongitude: 51.5 },
        { ...FILLED, email: 'not-an-email' },
      ];

      for (const body of attempts) {
        const response = await save(manager, body);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('leaves a telephone number exactly as it was typed', async () => {
      // Never normalised and never validated against a national format: this is
      // the number printed on the door, and rewriting it would be the product
      // deciding it knows better than the owner.
      const saved = await save(manager, { ...FILLED, phonePrimary: '۰۲۱ ۰۰۰ ۰۰ ۰۰' });

      expect(publicClinicProfileResponseSchema.parse(saved.body).clinic.phonePrimary).toBe(
        '۰۲۱ ۰۰۰ ۰۰ ۰۰',
      );
    });
  });

  describe('the audit trail', () => {
    it('records one action naming no row id, with eleven facts in full', async () => {
      await save(manager, FILLED);

      expect(await auditActionsFor(harness, 'clinic_public_profile', null)).toEqual([
        'clinic_public_profile.updated',
      ]);

      const rows = await harness.prisma.$queryRaw<
        {
          before: Record<string, unknown>;
          after: Record<string, unknown>;
          metadata: Record<string, unknown>;
        }[]
      >`
        SELECT before, after, metadata FROM audit_log
        WHERE entity_type = 'clinic_public_profile'
      `;

      const withoutNumbers = (profile: Record<string, unknown>) => {
        const { phonePrimary: _p, phoneSecondary: _s, ...rest } = profile;
        return rest;
      };

      expect(rows[0]!.before).toEqual(withoutNumbers(EMPTY));
      expect(rows[0]!.after).toEqual(withoutNumbers(FILLED));
    });

    it('records that the published numbers changed, and never the numbers', async () => {
      // `audit_log` refuses an unmasked value under a telephone-shaped key, in
      // the application guard and in the database, and that Milestone 3 privacy
      // rule is not relaxed for this table. What the trail records instead is
      // the FACT of the change, with its actor and its instant; the number
      // itself is on the row and on the website, in the clear, which is where a
      // published telephone number belongs.
      await save(manager, FILLED);
      await save(manager, { ...FILLED, workingHoursNote: 'Synthetic revised hours line.' });

      const rows = await harness.prisma.$queryRaw<{ metadata: Record<string, unknown> }[]>`
        SELECT metadata FROM audit_log
        WHERE entity_type = 'clinic_public_profile'
        ORDER BY id ASC
      `;

      expect(rows[0]!.metadata).toEqual({ contactNumbersChanged: true });
      expect(rows[1]!.metadata).toEqual({ contactNumbersChanged: false });

      const everything = await harness.prisma.$queryRaw<{ payload: string }[]>`
        SELECT coalesce(before::text, '') || coalesce(after::text, '') AS payload
        FROM audit_log WHERE entity_type = 'clinic_public_profile'
      `;

      for (const row of everything) {
        expect(row.payload).not.toContain('000-0000000');
        expect(row.payload).not.toContain('phonePrimary');
      }
    });

    it('refuses to delete the profile row', async () => {
      await expect(
        ownerPrisma().$executeRaw`DELETE FROM clinic_public_profile WHERE singleton_key = 1`,
      ).rejects.toThrow();
    });
  });
});
