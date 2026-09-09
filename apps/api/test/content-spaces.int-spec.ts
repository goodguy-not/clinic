import request from 'supertest';
import {
  publicSpaceListResponseSchema,
  spaceListResponseSchema,
  spaceResponseSchema,
} from '@clinic/contracts';
import { createHarness, resetDatabase, type Harness } from './harness';
import { as, asVisitor, auditActionsFor, loginAs, spaceDraft } from './website-support';

/**
 * Public spaces: who may describe one, who may publish it, and what a visitor
 * can never learn from it.
 *
 * Milestone 9.5, checkpoint A7, over real HTTP against real PostgreSQL.
 *
 * THE SUITE IS ORGANISED AROUND THE TWO DEFECTS THIS CHECKPOINT CANNOT SHIP
 * WITH:
 *
 *   1. A DRAFT BECOMING VISIBLE without a manager deciding it should — the A2
 *      failure, applied to a new kind of content.
 *   2. THE PUBLIC WEBSITE AND THE DIARY BECOMING ONE THING — an operational
 *      room publishing itself, or a published space carrying an operational
 *      fact.
 *
 * Every authority test therefore has both halves, and the separation tests
 * attack the boundary from BOTH sides: a room act must change no space, and a
 * space read must expose no room.
 *
 * Everything is synthetic. No real clinic room, address or photograph appears.
 */
describe('public spaces (real PostgreSQL)', () => {
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

  async function createSpace(
    session: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const response = await request(server())
      .post('/content/spaces')
      .set(as(session))
      .send(spaceDraft(overrides));

    expect(response.status).toBe(201);
    return spaceResponseSchema.parse(response.body).space.id;
  }

  async function publish(session: string, id: string, isPublic: boolean) {
    return request(server())
      .patch(`/content/spaces/${id}/publication`)
      .set(as(session))
      .send({ isPublic });
  }

  async function publicSpaces() {
    const response = await request(server()).get('/public/spaces').set(asVisitor());
    expect(response.status).toBe(200);
    return publicSpaceListResponseSchema.parse(response.body).spaces;
  }

  describe('the authority split', () => {
    it('lets a receptionist create, read and edit a draft', async () => {
      const id = await createSpace(receptionist);

      const list = await request(server()).get('/content/spaces').set(as(receptionist));
      const one = await request(server()).get(`/content/spaces/${id}`).set(as(receptionist));
      const edited = await request(server())
        .patch(`/content/spaces/${id}`)
        .set(as(receptionist))
        .send(spaceDraft({ name: 'Synthetic corrected name' }));

      expect(list.status).toBe(200);
      expect(spaceListResponseSchema.parse(list.body).spaces).toHaveLength(1);
      expect(one.status).toBe(200);
      expect(edited.status).toBe(200);
      expect(spaceResponseSchema.parse(edited.body).space.name).toBe('Synthetic corrected name');
    });

    it('creates every space as a draft, whoever created it', async () => {
      // Not "defaults to": there is no field on the request that could say
      // otherwise, which is what makes the rule hold for a caller nobody has
      // written yet.
      const byReceptionist = await request(server())
        .post('/content/spaces')
        .set(as(receptionist))
        .send(spaceDraft());
      const byManager = await request(server())
        .post('/content/spaces')
        .set(as(manager))
        .send(spaceDraft({ name: 'Synthetic second space' }));

      expect(spaceResponseSchema.parse(byReceptionist.body).space.isPublic).toBe(false);
      expect(spaceResponseSchema.parse(byManager.body).space.isPublic).toBe(false);
    });

    it('refuses a receptionist the publication route, server-side', async () => {
      // THE DIRECT ATTEMPT. Not "the UI hides the control": the request is made
      // with a real receptionist session against the real route, and
      // `PermissionsGuard` refuses it before a statement runs.
      const id = await createSpace(receptionist);

      const refused = await publish(receptionist, id, true);

      expect(refused.status).toBe(403);
      expect(await publicSpaces()).toHaveLength(0);
    });

    it('refuses a receptionist the withdrawal of a live space too', async () => {
      // The other direction, and it matters as much: taking the clinic's words
      // off the website is the same authority as putting them there.
      const id = await createSpace(receptionist);
      await publish(manager, id, true);

      const refused = await publish(receptionist, id, false);

      expect(refused.status).toBe(403);
      expect(await publicSpaces()).toHaveLength(1);
    });

    it('lets a manager publish and withdraw', async () => {
      const id = await createSpace(receptionist);

      const published = await publish(manager, id, true);
      expect(published.status).toBe(200);
      expect(await publicSpaces()).toHaveLength(1);

      const withdrawn = await publish(manager, id, false);
      expect(withdrawn.status).toBe(200);
      expect(await publicSpaces()).toHaveLength(0);
    });
  });

  describe('what a visitor can reach', () => {
    it('does not return a draft space', async () => {
      await createSpace(receptionist);

      expect(await publicSpaces()).toEqual([]);
    });

    it('returns a published space through a clean editorial projection', async () => {
      const id = await createSpace(receptionist, {
        name: 'Synthetic therapy room',
        description: 'Synthetic description written for a test.',
      });
      await publish(manager, id, true);

      const spaces = await publicSpaces();

      // The whole projection, asserted as an exact object: a key arriving here
      // that nobody decided on fails this test rather than reaching a browser.
      expect(spaces).toEqual([
        {
          name: 'Synthetic therapy room',
          description: 'Synthetic description written for a test.',
          images: [],
        },
      ]);
    });

    it('does not move the live page when a receptionist edits a published space', async () => {
      // THE PUBLICATION AUTHORITY, SEEN FROM THE WEBSITE. The draft and the
      // published copy are different values from this moment until a manager
      // publishes again, and the visitor goes on reading the approved one.
      const id = await createSpace(receptionist, { name: 'Synthetic approved name' });
      await publish(manager, id, true);

      await request(server())
        .patch(`/content/spaces/${id}`)
        .set(as(receptionist))
        .send(spaceDraft({ name: 'Synthetic unreviewed rewrite' }));

      expect((await publicSpaces())[0]?.name).toBe('Synthetic approved name');

      const staff = await request(server()).get(`/content/spaces/${id}`).set(as(receptionist));
      const space = spaceResponseSchema.parse(staff.body).space;

      expect(space.name).toBe('Synthetic unreviewed rewrite');
      expect(space.hasUnpublishedChanges).toBe(true);
    });

    it('publishes the prepared change when the manager publishes again', async () => {
      const id = await createSpace(receptionist, { name: 'Synthetic approved name' });
      await publish(manager, id, true);
      await request(server())
        .patch(`/content/spaces/${id}`)
        .set(as(receptionist))
        .send(spaceDraft({ name: 'Synthetic revised name' }));

      await publish(manager, id, true);

      expect((await publicSpaces())[0]?.name).toBe('Synthetic revised name');
    });

    it('orders the gallery by the PUBLISHED order, not the draft one', async () => {
      // Reordering is a change a visitor sees, so it waits for the manager act
      // exactly as the words do.
      const first = await createSpace(receptionist, { name: 'Synthetic A', displayOrder: 0 });
      const second = await createSpace(receptionist, { name: 'Synthetic B', displayOrder: 1 });
      await publish(manager, first, true);
      await publish(manager, second, true);

      expect((await publicSpaces()).map((space) => space.name)).toEqual([
        'Synthetic A',
        'Synthetic B',
      ]);

      await request(server())
        .patch(`/content/spaces/${first}`)
        .set(as(receptionist))
        .send(spaceDraft({ name: 'Synthetic A', displayOrder: 5 }));

      // The draft order moved; the gallery did not.
      expect((await publicSpaces()).map((space) => space.name)).toEqual([
        'Synthetic A',
        'Synthetic B',
      ]);

      await publish(manager, first, true);

      expect((await publicSpaces()).map((space) => space.name)).toEqual([
        'Synthetic B',
        'Synthetic A',
      ]);
    });
  });

  describe('a public space is not an operational room', () => {
    /**
     * THE SEPARATION PROOF, FROM BOTH SIDES.
     *
     * The first two tests attack it as a WORKFLOW question — can a room act
     * produce a published space? The third attacks it as a DATA question — can
     * a room fact reach a visitor? The fourth is the strongest of the three
     * because it does not depend on any projection being written correctly: it
     * asks PostgreSQL whether the two tables can be joined at all.
     */

    async function createRoom(name: string): Promise<string> {
      const response = await request(server())
        .post('/catalog/rooms')
        .set(as(manager))
        .send({ name, allowedServiceIds: [] });

      expect(response.status).toBe(201);
      return response.body.room.id as string;
    }

    it('publishes nothing when a room is created', async () => {
      await createRoom('Synthetic operational room');

      expect(await publicSpaces()).toEqual([]);

      const staff = await request(server()).get('/content/spaces').set(as(manager));
      expect(spaceListResponseSchema.parse(staff.body).spaces).toEqual([]);
    });

    it('changes no space when a room is renamed or deactivated', async () => {
      const roomId = await createRoom('Synthetic operational room');
      const spaceId = await createSpace(receptionist, { name: 'Synthetic published space' });
      await publish(manager, spaceId, true);

      await request(server())
        .patch(`/catalog/rooms/${roomId}`)
        .set(as(manager))
        .send({ name: 'Synthetic renamed room', allowedServiceIds: [] });
      await request(server())
        .patch(`/catalog/rooms/${roomId}/status`)
        .set(as(manager))
        .send({ status: 'INACTIVE' });

      // The space is exactly as it was: still published, still saying what the
      // manager approved. A room's life has no consequence here.
      expect(await publicSpaces()).toEqual([
        {
          name: 'Synthetic published space',
          description: 'Synthetic description of a space that does not exist. It names nobody.',
          images: [],
        },
      ]);

      // And the trail says so: the only actions against this space are the ones
      // somebody performed on it deliberately.
      expect(await auditActionsFor(harness, 'public_space', spaceId)).toEqual([
        'public_space.created',
        'public_space.published',
      ]);
    });

    it('leaks no operational fact through the public projection', async () => {
      // THE LEAK TEST. A room exists, carrying a name, a status, a
      // deactivation instant, an internal id and a service restriction; a
      // space is published beside it. The public response is then searched, as
      // raw JSON, for every one of those facts.
      const roomId = await createRoom('Synthetic operational room');
      await request(server())
        .patch(`/catalog/rooms/${roomId}/status`)
        .set(as(manager))
        .send({ status: 'INACTIVE' });

      const spaceId = await createSpace(receptionist);
      await publish(manager, spaceId, true);

      const response = await request(server()).get('/public/spaces').set(asVisitor());
      const body = JSON.stringify(response.body);

      // No internal identifier of any kind — not the room's, and not the
      // space's own.
      expect(body).not.toContain(roomId);
      expect(body).not.toContain(spaceId);
      // No room name, no operational status vocabulary, no scheduling meaning.
      expect(body).not.toContain('Synthetic operational room');
      expect(body).not.toContain('INACTIVE');
      expect(body).not.toContain('ACTIVE');
      expect(body).not.toContain('deactivated');
      expect(body).not.toContain('room');
      expect(body).not.toContain('service');
      expect(body).not.toContain('availability');
      // And no publication machinery either: the flag, the order and the
      // timestamps are internal.
      expect(body).not.toContain('isPublic');
      expect(body).not.toContain('displayOrder');
      expect(body).not.toContain('publishedAt');

      // The keys are exactly the three the contract carries.
      const spaces = publicSpaceListResponseSchema.parse(response.body).spaces;
      expect(Object.keys(spaces[0] as object).sort()).toEqual(['description', 'images', 'name']);
    });

    it('holds no column joining the two tables, in either direction', async () => {
      // THE STRUCTURAL PROOF, AND THE ONE THAT DOES NOT DEPEND ON A PROJECTION
      // BEING WRITTEN CORRECTLY. A leak through a widened `SELECT` is only
      // possible if there is something to join to; there is not, and this asks
      // the catalogue rather than the code.
      const foreignKeys = await harness.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count
        FROM pg_constraint
        WHERE contype = 'f'
          AND (
            (conrelid::regclass::text = 'public_space' AND confrelid::regclass::text = 'room')
            OR (conrelid::regclass::text = 'room' AND confrelid::regclass::text = 'public_space')
          )
      `;

      expect(Number(foreignKeys[0]?.count)).toBe(0);

      // And no column on either table so much as names the other concept, so a
      // future join cannot be added without a migration somebody reviews.
      const columns = await harness.prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (
            (table_name = 'public_space' AND column_name LIKE '%room%')
            OR (table_name = 'room' AND column_name LIKE '%space%')
          )
      `;

      expect(columns).toEqual([]);
    });
  });

  describe('the trail', () => {
    it('records drafting and publication as separate facts', async () => {
      const id = await createSpace(receptionist);
      await request(server())
        .patch(`/content/spaces/${id}`)
        .set(as(receptionist))
        .send(spaceDraft({ name: 'Synthetic edited name' }));
      await publish(manager, id, true);
      await publish(manager, id, false);

      expect(await auditActionsFor(harness, 'public_space', id)).toEqual([
        'public_space.created',
        'public_space.updated',
        'public_space.published',
        'public_space.unpublished',
      ]);
    });

    it('writes nothing when a publication changes nothing', async () => {
      // Idempotent on the whole act: a double-clicked button does not fill the
      // trail with entries whose before and after agree.
      const id = await createSpace(receptionist);
      await publish(manager, id, true);
      await publish(manager, id, true);

      expect(await auditActionsFor(harness, 'public_space', id)).toEqual([
        'public_space.created',
        'public_space.published',
      ]);
    });
  });

  describe('refusals', () => {
    it('answers PUBLIC_SPACE_NOT_FOUND for a space nobody created', async () => {
      const response = await request(server())
        .get('/content/spaces/00000000-0000-4000-8000-000000000000')
        .set(as(manager));

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('PUBLIC_SPACE_NOT_FOUND');
    });

    it('refuses a creation request that tries to publish itself', async () => {
      // The request is a strict object, so a publication flag is a validation
      // failure rather than an ignored field — "I sent it and it was dropped"
      // is how a lower authority believes it performed a higher act.
      const response = await request(server())
        .post('/content/spaces')
        .set(as(receptionist))
        .send({ ...spaceDraft(), isPublic: true });

      expect(response.status).toBe(400);
      expect(await publicSpaces()).toHaveLength(0);
    });

    it('refuses a space that names a room', async () => {
      // There is no such field, and a strict object says so rather than
      // silently accepting and discarding it.
      const response = await request(server())
        .post('/content/spaces')
        .set(as(receptionist))
        .send({ ...spaceDraft(), roomId: '00000000-0000-4000-8000-000000000000' });

      expect(response.status).toBe(400);
    });

    it('refuses markup in the copy', async () => {
      const response = await request(server())
        .post('/content/spaces')
        .set(as(receptionist))
        .send(spaceDraft({ description: 'Synthetic <script>alert(1)</script> text' }));

      expect(response.status).toBe(400);
    });
  });
});
