import { z } from 'zod';
import { publicImageSchema } from '../media/common';
import { PUBLIC_PLAIN_TEXT_PATTERN, publicHeadingSchema } from './common';

/**
 * THE ROUTINE EDITORIAL COPY OF THE HOME AND ABOUT PAGES, AS DATA.
 *
 * Milestone 9.5, checkpoint A8. Checkpoint A1 froze the clinic's own FACTS —
 * name, address, telephone, hours, links — and said in as many words that copy
 * blocks were not among them: "no branding assets, no copy blocks, no page
 * structure, no navigation, no SEO strings: those are content and design, they
 * belong to the checkpoints that build them, and inventing a column for each
 * would freeze a page layout in the database". This is that checkpoint, and it
 * does not answer A1 with thirty columns.
 *
 * ONE TABLE OF FIXED, NAMED SLOTS. Every editorial block the accepted public
 * design actually renders is one row in `clinic_content_entry`, addressed by a
 * SLOT and a POSITION within it. The rows exist from the migration that
 * created them — empty, exactly as the clinic profile row does — so a manager
 * FILLS THEM IN rather than inventing page structure, and the design's shape
 * (five concerns, three moments, three highlights) is a property of the
 * database rather than a convention a screen has to remember.
 *
 * NOTHING HERE IS CREATED OR DELETED AT RUNTIME. There is no create route, no
 * delete route and no `isPublic` flag. The set of slots IS the accepted design;
 * changing it is a design change and therefore a reviewed migration, not a
 * button. What a manager changes is what each slot SAYS.
 *
 * EDITING IS PUBLISHING, EXACTLY AS IT IS FOR THE PROFILE. There is no
 * draft/published column pair here and no receptionist drafting authority:
 * `clinic_profile.update` writes these rows, it is manager-only, and what a
 * manager saves is what the website says. That is the frozen rule for THIS
 * surface and is deliberately different from an article, a service description
 * or a public space, each of which has a separate publication act because each
 * has a lower authority that may prepare one.
 *
 * AN EMPTY SLOT SAYS NOTHING, AND THAT IS ONE RULE IN ONE PLACE. An entry
 * whose `heading` is null is unwritten: the public read omits it, and the media
 * predicate refuses its photograph. A clinic that has supplied no copy yet
 * therefore publishes no half-built section and no orphaned picture.
 *
 * NOTHING IN THIS FILE IS CONTENT. No default Persian string, no sample
 * heading, no placeholder paragraph and no claim about a clinic exists here or
 * in the migration behind it. The real copy is owner-supplied
 * (PROJECT_SPEC.md 17) and every fixture that fills a slot is synthetic.
 *
 * WHAT IS DELIBERATELY NOT HERE: no navigation, no route, no component name, no
 * CSS class, no image dimension, no ordering the web tier could not have
 * derived, and no page-level SEO string. The slot names say WHICH BLOCK, the
 * fields say WHAT IT SAYS, and how any of it is laid out remains the web
 * tier's.
 */

/**
 * THE BLOCKS THE ACCEPTED PUBLIC DESIGN ACTUALLY RENDERS. NINE, AND THE LIST IS
 * CLOSED.
 *
 * Each name is a block a reader can point at on the accepted home or about
 * page. A tenth would be a new section — a design decision — and would arrive
 * as a reviewed migration with the slot's size stated beside it, exactly as
 * these nine do.
 *
 * THE ORDER OF THIS LIST IS THE ORDER THE PUBLIC READ RETURNS. It is the enum's
 * declaration order in PostgreSQL, so "home first, about second, and each page
 * top to bottom" is a fact about the type rather than an ordering a query
 * chose.
 */
export const CLINIC_CONTENT_SLOTS = [
  /** The home hero above «از کجا شروع کنیم؟»: eyebrow, heading, lead paragraph. */
  'HOME_HERO',
  /**
   * The concern-guide entries — the accepted five «از کجا شروع کنیم؟» prompts.
   *
   * ALL FOUR TEXT FIELDS ARE USED HERE, and this is the slot they exist for:
   * `label` is the prompt a visitor chooses, `eyebrow` the short category
   * beside it, `heading` the clinic's answer and `body` the paragraph under it.
   * The photograph is a published `CLINIC_CONTENT_ENTRY` attachment.
   */
  'HOME_CONCERN',
  /** The «در والا چه می‌گذرد؟» section intro, and its photograph. */
  'HOME_FIRST_VISIT',
  /** The three moments of a first session: `heading` and `body`. */
  'HOME_FIRST_VISIT_STEP',
  /**
   * The about-page introduction: eyebrow, heading and photograph.
   *
   * ITS `body` IS NOT THE ABOUT PARAGRAPH. The clinic's own description is
   * `PublicClinicProfile.about` and has one home; a second editable paragraph
   * meaning the same thing is exactly the duplication this checkpoint exists to
   * remove. `body` here is an optional extra line under that description.
   */
  'ABOUT_INTRO',
  /** The three «شخصیت والا» facts: `label` names the trait, `body` states it. */
  'ABOUT_HIGHLIGHT',
  /** The «چرا فضا این‌طور طراحی شده» block, and its photograph. */
  'ABOUT_SPACE_NOTE',
  /** The three points under it: `body` each. */
  'ABOUT_SPACE_POINT',
  /** The three steps from request to assessment: `label` and `body`. */
  'ABOUT_JOURNEY_STEP',
] as const;

export type ClinicContentSlot = (typeof CLINIC_CONTENT_SLOTS)[number];

/**
 * HOW MANY ENTRIES EACH SLOT HAS. FROZEN, AND ENFORCED IN THE DATABASE.
 *
 * These numbers are the accepted design's own — five concern prompts, three
 * first-session moments, three about highlights — and they are stated here so
 * that both tiers, the migration that seeds the rows and the CHECK constraint
 * that caps them all read the same list. A manager cannot add a sixth concern
 * and cannot remove the fifth; they can leave it unwritten, which is what
 * "we only have four things to say" looks like.
 *
 * REVISIT TRIGGER: a design change that genuinely needs a different count. It
 * is one migration — a widened CHECK and an INSERT — and it is a decision
 * somebody takes rather than a row somebody adds.
 */
export const CLINIC_CONTENT_SLOT_SIZES: Record<ClinicContentSlot, number> = {
  HOME_HERO: 1,
  HOME_CONCERN: 5,
  HOME_FIRST_VISIT: 1,
  HOME_FIRST_VISIT_STEP: 3,
  ABOUT_INTRO: 1,
  ABOUT_HIGHLIGHT: 3,
  ABOUT_SPACE_NOTE: 1,
  ABOUT_SPACE_POINT: 3,
  ABOUT_JOURNEY_STEP: 3,
};

/** A short public line: a prompt, a trait name, a step label. */
const shortLine = (max: number) =>
  z.string().trim().min(1).max(max).regex(PUBLIC_PLAIN_TEXT_PATTERN, 'must not contain markup');

/**
 * ONE EDITORIAL BLOCK, AS THE WEBSITE STATES IT.
 *
 * NO ID AND NO POSITION, for the reason `publicSpaceSchema` carries neither: a
 * block is content, not a resource an anonymous caller addresses, and the array
 * order IS the order. `slot` is present because it is the only way the web tier
 * can tell a concern prompt from an about highlight, and it names a section
 * rather than a row.
 *
 * EVERY TEXT FIELD IS NULLABLE AND ONLY `heading` IS GUARANTEED. An entry
 * reaches this shape exactly when it has a heading; the other three are as
 * sparse as the design's use of that slot.
 */
export const publicClinicContentEntrySchema = z.strictObject({
  slot: z.enum(CLINIC_CONTENT_SLOTS),
  /** The prompt or short label, where the block has one. */
  label: z.string().nullable(),
  /** The kicker above the heading, where the block has one. */
  eyebrow: z.string().nullable(),
  /** What the block is called. Non-null on every entry that reaches this shape. */
  heading: z.string(),
  /** The paragraph, where the block has one. */
  body: z.string().nullable(),
  /**
   * The photograph a manager published for this block, or none.
   *
   * ONE, AND THE FIRST IN THE CLINIC'S OWN ORDER if somebody has attached more
   * — the `firstImage` rule a therapist portrait already follows. A block is an
   * illustrated paragraph, not a gallery; the gallery of the clinic's rooms is
   * `public_space` (checkpoint A7) and is a different read.
   */
  image: publicImageSchema.nullable(),
});

export type PublicClinicContentEntry = z.infer<typeof publicClinicContentEntrySchema>;

/**
 * The clinic's editorial content and its social-preview photograph, in one read.
 *
 * `openGraphImage` IS SITE-WIDE AND BELONGS TO NO BLOCK. It is the picture a
 * link to any page of this site unfurls into, it is a photograph through the
 * accepted A5 media system, and it is null until a manager publishes one — at
 * which point the web tier has an Open Graph image without a deployment, which
 * is the whole reason it is here. THE BRAND MARK IS NOT THIS: the accepted Vala
 * SVG logos stay static in the web tier, SVG is refused by the uploader, and no
 * staff surface uploads a logo.
 */
export const publicClinicContentResponseSchema = z.strictObject({
  openGraphImage: publicImageSchema.nullable(),
  entries: z.array(publicClinicContentEntrySchema),
});

export type PublicClinicContentResponse = z.infer<typeof publicClinicContentResponseSchema>;

/**
 * One editorial block as the manager maintaining it sees it — WHICH IS EVERY
 * SLOT, WRITTEN OR NOT.
 *
 * The public read omits an unwritten entry because a website cannot render
 * nothing; this read must show it, because an empty box is precisely what a
 * manager has come to fill in. That difference is the only one between the two
 * shapes, plus the `id` a write needs to address.
 */
export const clinicContentEntrySchema = z.strictObject({
  id: z.uuid(),
  slot: z.enum(CLINIC_CONTENT_SLOTS),
  /** Where in its slot, ascending from zero. Fixed by the migration; never written. */
  position: z.int().min(0),
  label: z.string().nullable(),
  eyebrow: z.string().nullable(),
  heading: z.string().nullable(),
  body: z.string().nullable(),
  /**
   * The photograph the WEBSITE is currently showing for this block, or none.
   *
   * Derived from the same media predicate the public read applies, so this
   * screen cannot say "no picture" about one the origin is serving. It is not
   * writable here: photographs are attached under `media.attach` and published
   * under `media.publish`, in the media library, and nothing on this surface
   * changes one.
   */
  image: publicImageSchema.nullable(),
});

export type ClinicContentEntry = z.infer<typeof clinicContentEntrySchema>;

export const clinicContentResponseSchema = z.strictObject({
  entries: z.array(clinicContentEntrySchema),
});

export type ClinicContentResponse = z.infer<typeof clinicContentResponseSchema>;

export const clinicContentEntryResponseSchema = z.strictObject({
  entry: clinicContentEntrySchema,
});

export type ClinicContentEntryResponse = z.infer<typeof clinicContentEntryResponseSchema>;

/**
 * What a manager may write into one block. ALL FOUR FIELDS, EVERY TIME.
 *
 * The `updateClinicProfileRequest` discipline, applied to a smaller form: a
 * partial update would have to distinguish "leave the kicker alone" from "clear
 * it", and this is four boxes on one screen. What is submitted is what the
 * block says.
 *
 * NEITHER `slot` NOR `position` IS HERE. They are the identity of the block,
 * fixed by the migration that created it, and a request that could change one
 * would be a request that could move the about page's copy onto the home page.
 *
 * NO IMAGE FIELD EITHER. A photograph is attached and published through the
 * media library under its own two permissions; a picture appearing because
 * somebody saved a text form would be the A5 draft/publish split undone.
 *
 * THE PLAIN-TEXT RULE IS A2'S. This copy is written by staff and rendered to
 * strangers, and the answer this product gives to stored cross-site scripting
 * is that there is nothing to sanitise because markup cannot be stored.
 */
export const updateClinicContentEntryRequestSchema = z.strictObject({
  label: shortLine(200).nullable(),
  eyebrow: shortLine(120).nullable(),
  /**
   * Null is a real editorial act: it means "this block says nothing", and it
   * takes the block — and any photograph on it — off the website at once.
   */
  heading: publicHeadingSchema.nullable(),
  body: shortLine(4000).nullable(),
});

export type UpdateClinicContentEntryRequest = z.infer<typeof updateClinicContentEntryRequestSchema>;
