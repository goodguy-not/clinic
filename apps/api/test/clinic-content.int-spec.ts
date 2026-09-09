import request from 'supertest';
import {
  CLINIC_CONTENT_SLOTS,
  CLINIC_CONTENT_SLOT_SIZES,
  clinicContentEntryResponseSchema,
  clinicContentResponseSchema,
  publicClinicContentResponseSchema,
  publicClinicProfileResponseSchema,
  type ClinicContentEntry,
  type ClinicContentSlot,
} from '@clinic/contracts';
import { createHarness, internalHeaders, resetDatabase, type Harness } from './harness';
import { uploadPhoto } from './media-support';
import { as, asVisitor, auditActionsFor, loginAs } from './website-support';

/**
 * The clinic's routine public copy, maintained through the real manager path.
 *
 * Milestone 9.5, checkpoint A8. The question this suite answers is the one the
 * checkpoint exists for: can the clinic change the words on its own home and
 * about pages — and the picture a link to the site unfurls into — WITHOUT a
 * code edit, a seed or a deployment?
 *
 * EVERY VALUE HERE IS OBVIOUSLY SYNTHETIC. This repository does not hold the
 * clinic's real headings, prompts, paragraphs, claims or photographs, and no
 * fixture may invent one. Every image is generated in code by
 * `media-support.ts`.
 */
describe('clinic public content (real PostgreSQL)', () => {
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
    await resetDatabase(harness.prisma);
    manager = await loginAs(harness, 'MANAGER');
    receptionist = await loginAs(harness, 'RECEPTIONIST');
  });

  const server = () => harness.app.getHttpServer();

  /** The four boxes on one block's card, all synthetic. */
  const copy = (marker: string) => ({
    label: `Synthetic label ${marker}`,
    eyebrow: `Synthetic kicker ${marker}`,
    heading: `Synthetic heading ${marker}`,
    body: `Synthetic paragraph ${marker} about a clinic that does not exist.`,
  });

  const EMPTY = { label: null, eyebrow: null, heading: null, body: null };

  async function entries(session = manager): Promise<ClinicContentEntry[]> {
    const response = await request(server())
      .get('/content/clinic-profile/entries')
      .set(as(session));

    expect(response.status).toBe(200);
    return clinicContentResponseSchema.parse(response.body).entries;
  }

  async function entryIn(slot: ClinicContentSlot, position = 0): Promise<ClinicContentEntry> {
    const found = (await entries()).find(
      (entry) => entry.slot === slot && entry.position === position,
    );

    expect(found).toBeDefined();
    return found as ClinicContentEntry;
  }

  const save = (session: string, id: string, body: Record<string, unknown>) =>
    request(server()).put(`/content/clinic-profile/entries/${id}`).set(as(session)).send(body);

  const publicContent = () =>
    request(server()).get('/public/clinic-content').set(internalHeaders());

  describe('the slots', () => {
    it('ships every accepted block, empty, in the order the pages render them', async () => {
      const all = await entries();

      // The counts are the accepted design's own and they come from the
      // migration, not from anything a manager did. A clinic with nothing
      // written still has every box to fill in.
      expect(all).toHaveLength(
        Object.values(CLINIC_CONTENT_SLOT_SIZES).reduce((sum, size) => sum + size, 0),
      );

      for (const slot of CLINIC_CONTENT_SLOTS) {
        const inSlot = all.filter((entry) => entry.slot === slot);
        expect(inSlot).toHaveLength(CLINIC_CONTENT_SLOT_SIZES[slot]);
        expect(inSlot.map((entry) => entry.position)).toEqual(inSlot.map((_entry, index) => index));
      }

      // Home first, about second — the enum's declaration order, which is what
      // lets the web tier render the array as it arrives.
      const slotOrder = [...new Set(all.map((entry) => entry.slot))];
      expect(slotOrder).toEqual([...CLINIC_CONTENT_SLOTS]);

      for (const entry of all) {
        expect({
          label: entry.label,
          eyebrow: entry.eyebrow,
          heading: entry.heading,
          body: entry.body,
        }).toEqual(EMPTY);
        expect(entry.image).toBeNull();
      }
    });

    it('keeps the five concern prompts the accepted home page renders', async () => {
      // Checkpoint A8's acceptance names this number explicitly, so it is
      // asserted rather than left to the table above.
      expect(CLINIC_CONTENT_SLOT_SIZES.HOME_CONCERN).toBe(5);
      expect((await entries()).filter((entry) => entry.slot === 'HOME_CONCERN')).toHaveLength(5);
    });
  });

  describe('the authority', () => {
    it('refuses a receptionist both the read and the write, with no state change', async () => {
      const entry = await entryIn('HOME_HERO');

      const read = await request(server())
        .get('/content/clinic-profile/entries')
        .set(as(receptionist));
      const write = await save(receptionist, entry.id, copy('A'));

      expect(read.status).toBe(403);
      expect(write.status).toBe(403);
      expect(write.body.error.code).toBe('AUTH_FORBIDDEN');

      // The refusal is server-side and total: nothing was written, and the
      // public read still says nothing.
      expect((await entryIn('HOME_HERO')).heading).toBeNull();
      expect(publicClinicContentResponseSchema.parse((await publicContent()).body).entries).toEqual(
        [],
      );
    });

    it('refuses an anonymous caller the manager routes entirely', async () => {
      const entry = await entryIn('HOME_HERO');

      const read = await request(server()).get('/content/clinic-profile/entries').set(asVisitor());
      const write = await request(server())
        .put(`/content/clinic-profile/entries/${entry.id}`)
        .set(asVisitor())
        .send(copy('A'));

      expect(read.status).toBe(401);
      expect(write.status).toBe(401);
      expect((await entryIn('HOME_HERO')).heading).toBeNull();
    });

    it('lets a manager fill a block in and clear it again', async () => {
      const entry = await entryIn('HOME_CONCERN', 2);

      const saved = await save(manager, entry.id, copy('B'));
      expect(saved.status).toBe(200);
      expect(clinicContentEntryResponseSchema.parse(saved.body).entry).toMatchObject({
        id: entry.id,
        slot: 'HOME_CONCERN',
        position: 2,
        ...copy('B'),
      });

      const cleared = await save(manager, entry.id, EMPTY);
      expect(cleared.status).toBe(200);
      expect(clinicContentEntryResponseSchema.parse(cleared.body).entry).toMatchObject(EMPTY);
    });

    it('cannot move a block between slots or positions', async () => {
      // `slot` and `position` are identity, fixed by the migration. A request
      // carrying either is refused outright by the strict request schema rather
      // than quietly ignored — "I sent a slot and it was dropped" is how the
      // about page's copy ends up on the home page.
      const entry = await entryIn('ABOUT_HIGHLIGHT', 1);

      const refused = await save(manager, entry.id, { ...copy('C'), slot: 'HOME_HERO' });
      const alsoRefused = await save(manager, entry.id, { ...copy('C'), position: 0 });

      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe('VALIDATION_FAILED');
      expect(alsoRefused.status).toBe(400);

      const unchanged = await entryIn('ABOUT_HIGHLIGHT', 1);
      expect(unchanged.heading).toBeNull();
    });

    it('answers a block that is not there with its own code', async () => {
      const missing = await save(manager, '00000000-0000-4000-8000-000000000000', copy('D'));

      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('CLINIC_CONTENT_ENTRY_NOT_FOUND');
    });
  });

  describe('what the website then says', () => {
    it('reaches the public read with no further act', async () => {
      // There is no publication step here, and that is the frozen rule of this
      // surface: the clinic's routine copy is always live, so a manager saving
      // the card IS the publication.
      const entry = await entryIn('HOME_HERO');
      await save(manager, entry.id, copy('E'));

      const published = publicClinicContentResponseSchema.parse((await publicContent()).body);

      expect(published.entries).toEqual([{ slot: 'HOME_HERO', ...copy('E'), image: null }]);
    });

    it('omits a block nobody has written, and returns the written ones in order', async () => {
      const hero = await entryIn('HOME_HERO');
      const thirdConcern = await entryIn('HOME_CONCERN', 2);
      const firstConcern = await entryIn('HOME_CONCERN', 0);

      await save(manager, thirdConcern.id, copy('third'));
      await save(manager, firstConcern.id, copy('first'));
      await save(manager, hero.id, copy('hero'));

      const published = publicClinicContentResponseSchema.parse((await publicContent()).body);

      // Three of twenty-one. The eighteen unwritten blocks are absent rather
      // than present-and-empty: a website cannot render nothing.
      expect(published.entries).toHaveLength(3);
      expect(published.entries.map((entry) => [entry.slot, entry.heading])).toEqual([
        ['HOME_HERO', 'Synthetic heading hero'],
        ['HOME_CONCERN', 'Synthetic heading first'],
        ['HOME_CONCERN', 'Synthetic heading third'],
      ]);
    });

    it('takes a block off the site the moment its heading is cleared', async () => {
      const entry = await entryIn('ABOUT_INTRO');
      await save(manager, entry.id, copy('F'));

      expect(
        publicClinicContentResponseSchema.parse((await publicContent()).body).entries,
      ).toHaveLength(1);

      await save(manager, entry.id, { ...copy('F'), heading: null });

      expect(publicClinicContentResponseSchema.parse((await publicContent()).body).entries).toEqual(
        [],
      );
    });

    it('says nothing at all on a clinic that has supplied no copy', async () => {
      const published = publicClinicContentResponseSchema.parse((await publicContent()).body);

      expect(published).toEqual({ openGraphImage: null, entries: [] });
    });
  });

  describe('what may be saved', () => {
    it('refuses markup, an over-long heading and an empty box that is not null', async () => {
      const entry = await entryIn('HOME_HERO');

      const attempts = [
        // The A2 answer to stored cross-site scripting: markup cannot be
        // stored, so there is no sanitiser to misconfigure.
        { ...copy('G'), heading: '<script>alert(1)</script>' },
        { ...copy('G'), heading: 'x'.repeat(201) },
        // Clearing a box is `null`. An empty string is a different claim — "the
        // clinic says the empty string" — and the column refuses it too.
        { ...copy('G'), eyebrow: '' },
      ];

      for (const body of attempts) {
        const response = await save(manager, entry.id, body);
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_FAILED');
      }

      expect((await entryIn('HOME_HERO')).heading).toBeNull();
    });

    it('trims what a manager typed rather than refusing it', async () => {
      // The `line()` behaviour every public text contract in this product has:
      // stray whitespace around a pasted paragraph is a typing accident, not a
      // decision, and refusing the form over it would be the product being
      // pedantic at the person filling it in. The COLUMN still refuses an
      // untrimmed value written past this service — see
      // `clinic-content-schema.int-spec.ts`.
      const entry = await entryIn('HOME_HERO');

      const saved = await save(manager, entry.id, { ...copy('G'), body: '  Synthetic body.  ' });

      expect(saved.status).toBe(200);
      expect(clinicContentEntryResponseSchema.parse(saved.body).entry.body).toBe('Synthetic body.');
    });

    it('keeps Persian copy exactly as it was typed', async () => {
      // Synthetic Persian, not clinic copy: proof the column and the contract
      // are not quietly normalising what a manager writes.
      const entry = await entryIn('ABOUT_JOURNEY_STEP', 2);
      const persian = 'متن آزمایشی ۳ برای کلینیکی که وجود ندارد';

      const saved = await save(manager, entry.id, { ...copy('H'), body: persian });

      expect(clinicContentEntryResponseSchema.parse(saved.body).entry.body).toBe(persian);
    });
  });

  describe('the public projection', () => {
    it('carries no id, position, flag or timestamp', async () => {
      const entry = await entryIn('HOME_FIRST_VISIT');
      await save(manager, entry.id, copy('I'));

      const raw = (await publicContent()).body as {
        entries: Record<string, unknown>[];
        openGraphImage: unknown;
      };

      expect(Object.keys(raw.entries[0] as object).sort()).toEqual([
        'body',
        'eyebrow',
        'heading',
        'image',
        'label',
        'slot',
      ]);

      // The strict response schema is the mechanical half of the same
      // assertion: a widened projection fails to parse rather than reaching a
      // browser.
      expect(() => publicClinicContentResponseSchema.parse(raw)).not.toThrow();
      expect(JSON.stringify(raw)).not.toContain(entry.id);
    });

    it('leaks no operational or private fact, whatever the clinic is running', async () => {
      // The strongest statement available here is structural: the table behind
      // this read holds no reference to a therapist, room, service,
      // appointment, family or child, and the statement joins nothing. This
      // asserts the consequence over a database that HAS all of those.
      const entry = await entryIn('ABOUT_SPACE_NOTE');
      await save(manager, entry.id, copy('J'));

      const columns = await harness.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'clinic_content_entry'
        ORDER BY ordinal_position
      `;

      expect(columns.map((column) => column.column_name)).toEqual([
        'id',
        'slot',
        'position',
        'label',
        'eyebrow',
        'heading',
        'body',
      ]);

      const foreignKeys = await harness.prisma.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint
        WHERE contype = 'f' AND conrelid::regclass::text = 'clinic_content_entry'
      `;

      expect(foreignKeys).toEqual([]);
    });

    it('does not repeat the clinic public name', async () => {
      // The single-source rule: the name lives on the profile read, once. A
      // second copy on this read would be a second thing to keep in step.
      const raw = (await publicContent()).body as Record<string, unknown>;

      expect(Object.keys(raw).sort()).toEqual(['entries', 'openGraphImage']);
      expect(JSON.stringify(raw)).not.toContain('displayName');

      const profile = publicClinicProfileResponseSchema.parse(
        (await request(server()).get('/public/clinic-profile').set(internalHeaders())).body,
      );

      expect(Object.keys(profile.clinic)).toContain('displayName');
    });
  });

  describe('the open graph photograph', () => {
    /** Attaches a synthetic photograph to the ownerless Open Graph slot. */
    async function attachOpenGraph(session: string): Promise<string> {
      const asset = await uploadPhoto(harness, session);

      const attached = await request(server())
        .post(`/media/${asset.id}/attachments`)
        .set(as(session))
        .send({ ownerType: 'CLINIC_OPEN_GRAPH', ownerId: null, position: 0 });

      expect(attached.status).toBe(201);

      const attachment = attached.body.media.attachments.find(
        (item: { ownerType: string }) => item.ownerType === 'CLINIC_OPEN_GRAPH',
      );

      expect(attachment.ownerId).toBeNull();
      return attachment.id as string;
    }

    const publishAttachment = (attachmentId: string, isPublished: boolean) =>
      request(server())
        .patch(`/media/attachments/${attachmentId}/publication`)
        .set(as(manager))
        .send({ isPublished });

    it('shows nothing until a manager publishes the attachment', async () => {
      // Attaching is drafting, in this slot exactly as in every other: a
      // receptionist holds `media.attach` and not `media.publish`.
      const attachmentId = await attachOpenGraph(receptionist);

      expect(
        publicClinicContentResponseSchema.parse((await publicContent()).body).openGraphImage,
      ).toBeNull();

      const refused = await request(server())
        .patch(`/media/attachments/${attachmentId}/publication`)
        .set(as(receptionist))
        .send({ isPublished: true });

      expect(refused.status).toBe(403);
      expect(
        publicClinicContentResponseSchema.parse((await publicContent()).body).openGraphImage,
      ).toBeNull();
    });

    it('reaches the public read once a manager publishes it, and is revoked at once', async () => {
      const attachmentId = await attachOpenGraph(manager);
      expect((await publishAttachment(attachmentId, true)).status).toBe(200);

      const image = publicClinicContentResponseSchema.parse(
        (await publicContent()).body,
      ).openGraphImage;

      expect(image).not.toBeNull();
      expect(image?.renditions.length).toBeGreaterThan(0);

      // The bytes are anonymously reachable, which is the whole point of an
      // Open Graph image: a messaging application fetches it with no session.
      const path = image?.renditions[0]?.path as string;
      const served = await request(server()).get(`/public/${path}`).set(asVisitor());
      expect(served.status).toBe(200);

      await publishAttachment(attachmentId, false);

      expect(
        publicClinicContentResponseSchema.parse((await publicContent()).body).openGraphImage,
      ).toBeNull();
      // Immediate at the origin, with no interval and no warm-up.
      expect((await request(server()).get(`/public/${path}`).set(asVisitor())).status).toBe(404);
    });

    it('refuses an owner id on the ownerless slot', async () => {
      const asset = await uploadPhoto(harness, manager);
      const entry = await entryIn('HOME_HERO');

      const refused = await request(server())
        .post(`/media/${asset.id}/attachments`)
        .set(as(manager))
        .send({ ownerType: 'CLINIC_OPEN_GRAPH', ownerId: entry.id, position: 0 });

      expect(refused.status).toBe(400);
      expect(refused.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('a block photograph', () => {
    async function attachTo(entryId: string, session: string): Promise<string> {
      const asset = await uploadPhoto(harness, session);

      const attached = await request(server())
        .post(`/media/${asset.id}/attachments`)
        .set(as(session))
        .send({ ownerType: 'CLINIC_CONTENT_ENTRY', ownerId: entryId, position: 0 });

      expect(attached.status).toBe(201);

      const attachment = attached.body.media.attachments.find(
        (item: { ownerType: string; ownerId: string | null }) =>
          item.ownerType === 'CLINIC_CONTENT_ENTRY' && item.ownerId === entryId,
      );

      return attachment.id as string;
    }

    const publishAttachment = (attachmentId: string, isPublished: boolean) =>
      request(server())
        .patch(`/media/attachments/${attachmentId}/publication`)
        .set(as(manager))
        .send({ isPublished });

    it('needs both a published attachment and a written block', async () => {
      const entry = await entryIn('HOME_CONCERN', 0);
      const attachmentId = await attachTo(entry.id, manager);
      await publishAttachment(attachmentId, true);

      // The attachment is published; the block is not written. Neither the
      // block nor its picture is on the site.
      expect(publicClinicContentResponseSchema.parse((await publicContent()).body).entries).toEqual(
        [],
      );

      await save(manager, entry.id, copy('K'));

      const published = publicClinicContentResponseSchema.parse((await publicContent()).body);
      expect(published.entries).toHaveLength(1);
      expect(published.entries[0]?.image).not.toBeNull();
    });

    it('revokes the bytes at the origin when the heading is cleared', async () => {
      const entry = await entryIn('HOME_CONCERN', 1);
      await save(manager, entry.id, copy('L'));
      const attachmentId = await attachTo(entry.id, manager);
      await publishAttachment(attachmentId, true);

      const image = publicClinicContentResponseSchema
        .parse((await publicContent()).body)
        .entries.find((candidate) => candidate.slot === 'HOME_CONCERN')?.image;

      const path = image?.renditions[0]?.path as string;
      expect((await request(server()).get(`/public/${path}`).set(asVisitor())).status).toBe(200);

      await save(manager, entry.id, { ...copy('L'), heading: null });

      // One rule, two readers: the words leave the page and the bytes stop
      // being served, on the very next request.
      expect((await request(server()).get(`/public/${path}`).set(asVisitor())).status).toBe(404);
    });

    it('shows a manager what the site is showing, on the same block', async () => {
      const entry = await entryIn('ABOUT_SPACE_POINT', 0);
      await save(manager, entry.id, copy('M'));
      const attachmentId = await attachTo(entry.id, manager);

      // Attached but not published: the manager screen says "no picture",
      // because that is what a visitor sees.
      expect((await entryIn('ABOUT_SPACE_POINT', 0)).image).toBeNull();

      await publishAttachment(attachmentId, true);
      expect((await entryIn('ABOUT_SPACE_POINT', 0)).image).not.toBeNull();
    });

    it('refuses an attachment naming a block that does not exist', async () => {
      const asset = await uploadPhoto(harness, manager);

      const refused = await request(server())
        .post(`/media/${asset.id}/attachments`)
        .set(as(manager))
        .send({
          ownerType: 'CLINIC_CONTENT_ENTRY',
          ownerId: '00000000-0000-4000-8000-000000000000',
          position: 0,
        });

      expect(refused.status).toBe(404);
      expect(refused.body.error.code).toBe('CLINIC_CONTENT_ENTRY_NOT_FOUND');
    });
  });

  describe('the audit trail', () => {
    it('records one action per block, naming the block and what it said', async () => {
      const entry = await entryIn('HOME_FIRST_VISIT_STEP', 1);
      await save(manager, entry.id, copy('N'));

      expect(await auditActionsFor(harness, 'clinic_content_entry', entry.id)).toEqual([
        'clinic_content_entry.updated',
      ]);

      const rows = await harness.prisma.$queryRaw<
        {
          before: Record<string, unknown>;
          after: Record<string, unknown>;
          metadata: Record<string, unknown>;
        }[]
      >`
        SELECT before, after, metadata FROM audit_log
        WHERE entity_type = 'clinic_content_entry' AND entity_id = ${entry.id}::uuid
      `;

      expect(rows[0]?.before).toEqual({
        slot: 'HOME_FIRST_VISIT_STEP',
        position: 1,
        ...EMPTY,
      });
      expect(rows[0]?.after).toEqual({
        slot: 'HOME_FIRST_VISIT_STEP',
        position: 1,
        ...copy('N'),
      });
      // The publication consequence, stated outright: this edit put the block
      // on the website.
      expect(rows[0]?.metadata).toEqual({ publishedStateChanged: true });
    });

    it('distinguishes an edit that moved the page from one that did not', async () => {
      const entry = await entryIn('ABOUT_HIGHLIGHT', 0);
      await save(manager, entry.id, copy('O'));
      await save(manager, entry.id, { ...copy('O'), body: 'Synthetic revised paragraph.' });

      const rows = await harness.prisma.$queryRaw<{ metadata: Record<string, unknown> }[]>`
        SELECT metadata FROM audit_log
        WHERE entity_type = 'clinic_content_entry' AND entity_id = ${entry.id}::uuid
        ORDER BY id ASC
      `;

      expect(rows.map((row) => row.metadata)).toEqual([
        { publishedStateChanged: true },
        { publishedStateChanged: false },
      ]);
    });

    it('refuses to delete a block', async () => {
      const entry = await entryIn('HOME_HERO');

      await expect(
        harness.prisma.$executeRaw`DELETE FROM clinic_content_entry WHERE id = ${entry.id}::uuid`,
      ).rejects.toThrow();
    });
  });
});
