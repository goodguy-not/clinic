import { z } from 'zod';
import { publicMediaPathSchema } from '../website/common';

/**
 * The media vocabulary both tiers have to agree on, and nothing else.
 *
 * Milestone 9.5, checkpoint A5. Everything in this directory describes ONE
 * workflow: a member of staff photographs something on an ordinary telephone,
 * the API takes the bytes, and a stranger eventually sees a small, fast,
 * metadata-free copy of them — or, much more often, does not.
 *
 * THE ORIGINAL PHOTOGRAPH IS NOT A THING THIS CONTRACT CAN NAME. There is no
 * shape here for it, no identifier for it and no path to it, because the API
 * never writes it to disk: the uploaded bytes exist in one process's memory for
 * the length of one request and are replaced by a re-encoded, re-oriented,
 * metadata-free master before anything is stored. A contract that could refer
 * to the original would be a contract somebody could later serve.
 *
 * WHAT THE WEB TIER GETS IS `publicImageSchema` AND NOTHING BELOW IT. It never
 * learns an attachment id, a storage key, an upload actor, a publication
 * instant or the internal state machine that decided the image is public. It
 * gets an alt text, an intrinsic size, and a list of renditions to put in a
 * `srcset`.
 */

/**
 * What the uploader accepts, decided from the BYTES and never from a filename
 * or a browser-supplied content type.
 *
 * THREE FORMATS, AND SVG IS NOT ONE OF THEM. An SVG is a document with a script
 * engine attached, not a photograph: serving one from the clinic's own origin
 * would put uploader-authored markup on the clinic's own domain, which is the
 * whole of the same-origin problem in a single file upload. This workflow is
 * for photographs, and the accepted brand and logo artwork stays static in the
 * web tier where a human reviewed it.
 *
 * HEIC/HEIF IS ALSO ABSENT, and deliberately rather than by oversight: it is
 * what a current iPhone stores by default, but every route by which a
 * photograph reaches a clinic receptionist in practice — a messaging
 * application, a download, an email — has already converted it to JPEG.
 * Accepting it is a decision with a licensing question behind it, and nobody
 * has taken that decision.
 */
export const MEDIA_ACCEPTED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type MediaContentType = (typeof MEDIA_ACCEPTED_CONTENT_TYPES)[number];

/**
 * Twelve mebibytes: comfortably above a full-resolution photograph from a
 * current telephone, and comfortably below a size at which one request can hurt
 * the process.
 *
 * The cap is enforced while the body is still being read, so an oversized
 * upload is refused rather than buffered whole and then rejected.
 */
export const MEDIA_SOURCE_MAX_BYTES = 12 * 1024 * 1024;

/**
 * A ceiling on DECODED pixels, which is a different attack from a ceiling on
 * bytes. A few hundred kilobytes of highly compressible PNG can decode to
 * gigabytes of bitmap; the byte cap says nothing about that, and this does.
 */
export const MEDIA_SOURCE_MAX_PIXELS = 50_000_000;

/**
 * Below this, on either side, it is not a photograph anybody can put on a page.
 * Refused rather than upscaled: enlarging somebody's thumbnail and publishing
 * the result is the product deciding it knows better than the person who chose
 * the file.
 */
export const MEDIA_SOURCE_MIN_DIMENSION = 200;

/**
 * The longest edge of the stored master.
 *
 * The master is the ONLY copy the clinic keeps, it is what every rendition is
 * derived from, and it is never served. 2560 is large enough that a rendition
 * width nobody has thought of yet can still be produced without going back to a
 * photograph that no longer exists, and small enough that a shelf of them is an
 * ordinary amount of disk.
 */
export const MEDIA_MASTER_MAX_DIMENSION = 2560;

/**
 * The responsive ladder, in intrinsic CSS pixels of width.
 *
 * A rendition is produced for every width in this list that is SMALLER than the
 * master, plus one at the master's own width. Nothing is ever enlarged, so a
 * modest photograph produces two or three renditions rather than five, and the
 * largest rendition of any image is exactly as sharp as its master and never
 * sharper than the photograph that was uploaded.
 */
export const MEDIA_RENDITION_WIDTHS = [320, 640, 960, 1280, 1920] as const;

/**
 * TWO FORMATS, AND THE SECOND IS THE REASON THE FIRST IS SAFE. WebP is markedly
 * smaller at the same quality and is supported by everything the clinic's
 * visitors realistically use; JPEG is the floor that cannot fail. The web tier
 * emits both in one `picture` element and lets the browser choose.
 *
 * AVIF IS NOT HERE. It is smaller again, and it costs an order of magnitude
 * more processor time per rendition on the clinic's own single machine. That is
 * a trade worth revisiting when there is a measurement to revisit it against.
 */
export const MEDIA_RENDITION_FORMATS = ['webp', 'jpeg'] as const;

export type MediaRenditionFormat = (typeof MEDIA_RENDITION_FORMATS)[number];

export const MEDIA_RENDITION_CONTENT_TYPE: Record<MediaRenditionFormat, MediaContentType> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
};

/**
 * The path a rendition is served from, relative to wherever the web tier
 * publishes media: `media/` followed by the rendition id.
 *
 * IT IS A PATH RATHER THAN A URL FOR THE A1 REASON: nothing in this package
 * names a host, and resolving a relative path against the site's own origin is
 * the web tier's job. It satisfies `publicMediaPathSchema`, which is the shape
 * a manager-typed static photo path has always had, so the web tier keeps one
 * way to turn a public image reference into a `src` rather than gaining a
 * second.
 */
export const PUBLIC_MEDIA_PATH_PREFIX = 'media/';

/**
 * HOW LONG A COPY OF A PUBLISHED IMAGE MAY OUTLIVE ITS PUBLICATION, IN SECONDS,
 * IN ANY CACHE VALA CONTROLS.
 *
 * Five minutes, and this number is a promise rather than a tuning parameter.
 *
 * THE ORIGIN IS IMMEDIATE. Unpublishing an image, unpublishing the article or
 * profile it hangs off, detaching it, or archiving it makes the very next
 * anonymous request to NestJS a refusal — the serving route re-derives
 * publication from live rows on every request and holds no cached answer of its
 * own.
 *
 * WHAT THIS WINDOW BOUNDS IS EVERYTHING BETWEEN THAT ORIGIN AND THE READER.
 * Bytes are served with `max-age` and `s-maxage` of exactly this value, so the
 * Next.js tier, a reverse proxy in front of it, and any CDN the clinic later
 * puts in front of THAT will each re-ask within five minutes and be refused. A
 * publication change also drops the relevant cache tags immediately, so in
 * practice a Vala-controlled cache stops within one request; the window is what
 * remains guaranteed when tag invalidation has not reached a layer.
 *
 * IT DOES NOT AND CANNOT BOUND A COPY THAT HAS ALREADY LEFT. A browser cache, a
 * scraper, a search engine index, a corporate proxy, a screenshot: those hold
 * bytes Vala never controlled, and no header, hash or identifier retrieves
 * them. Content identity solves REPLACEMENT — a changed photograph gets new
 * rendition ids, and no cache can serve the old bytes in their place — and it
 * does not solve REVOCATION. Anybody telling a family that an image can be
 * recalled from the internet is promising something this system does not do.
 *
 * WHY NOT ZERO. `no-store` on image bytes would make the origin re-serve every
 * photograph on every page view of a Persian site whose visitors are largely on
 * mobile networks, in exchange for a revocation guarantee that is already
 * unenforceable one hop further out. Five minutes is short enough that a
 * manager who has just taken something down does not have to wonder, and long
 * enough that a page is not paying for it on every visit.
 */
export const PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS = 300;

/** The `max-age` and `s-maxage` NestJS sets on a served rendition. One number, one meaning. */
export const PUBLIC_MEDIA_MAX_AGE_SECONDS = PUBLIC_MEDIA_REVOCATION_WINDOW_SECONDS;

/**
 * `public-media:` followed by the rendition id.
 *
 * The tag a web-tier cache entry for one rendition's BYTES carries, so a
 * publication change can drop exactly that entry. It is a separate name from
 * the page tags in `PUBLIC_CACHE_TAGS` because the two have different
 * lifetimes: a page's data goes stale when its copy changes, and a rendition's
 * bytes go stale only when it stops being public.
 *
 * A MEDIA PUBLICATION CHANGE ALSO AFFECTS THE OWNER'S PAGE TAGS, because the
 * projection listing the image is part of that page's data. Publishing a
 * therapist portrait affects `public-team` and `public-therapist:` + the slug,
 * exactly as editing that profile does.
 */
export const PUBLIC_MEDIA_CACHE_TAG_PREFIX = 'public-media:';

/**
 * The Persian text a screen reader says instead of the photograph.
 *
 * REQUIRED, WITH NO EMPTY OPTION. An unlabelled image on a clinic's public site
 * is unreadable to exactly the visitors a rehabilitation clinic exists to
 * serve. Plain text and markup-free for the A2 reason: it is written by staff,
 * it is rendered to strangers, and there is no sanitiser anywhere in this
 * product because nothing is ever stored that would need one.
 */
export const mediaAltTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^<]*$/, 'must not contain markup');

/**
 * HOW A PHOTOGRAPH IS FRAMED WHERE IT IS USED — NOT HOW IT IS STORED.
 *
 * Milestone 9.5, checkpoint A5 (coordinator revision). Framing is the answer to
 * "this portrait is fine, but her face is off to the left in the round avatar".
 *
 * IT NEVER TOUCHES A PIXEL. Nothing here is applied by the encoder, nothing
 * here is baked into the master, and nothing here causes a rendition to be
 * re-derived. The stored renditions are always the WHOLE FRAME; these numbers
 * tell the renderer which part of that frame matters. Three consequences fall
 * straight out, and all three are product requirements:
 *
 *  1. FRAMING CHANGES WITHOUT RE-UPLOADING. It is one field update on one row.
 *  2. THE MASTER IS NEVER REWRITTEN OR DESTROYED BY RE-FRAMING. A crop is a
 *     description, so it is reversible for ever; a crop encoded into the stored
 *     bytes would throw away the parts of the photograph outside it, and the
 *     only way back would be to ask a family for the picture again.
 *  3. THE WEB TIER CAN PREVIEW IT LIVE. Applying a normalised rectangle and a
 *     focal point is CSS, so a crop handle can move at sixty frames a second
 *     with no request in the loop.
 *
 * IT BELONGS TO THE ATTACHMENT, NOT THE ASSET. One photograph of the therapy
 * room may be a wide banner on one page and a square tile on another, and those
 * are two attachments with two framings over one master. Framing on the asset
 * would make the second use silently re-frame the first.
 *
 * EVERY NUMBER IS A FRACTION OF THE FRAME, 0 TO 1, NEVER A PIXEL. Pixels would
 * be a coordinate system that means something different on each of the five
 * rendition widths, so a crop chosen against one would be wrong on the rest.
 */

/**
 * The rectangle worth showing, as fractions of the whole frame, or null for
 * "the whole frame" — which is the normal state and the default.
 */
export const mediaCropSchema = z
  .strictObject({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .refine(
    (crop) => crop.x + crop.width <= 1 + 1e-9 && crop.y + crop.height <= 1 + 1e-9,
    'the crop rectangle must lie inside the frame',
  );

export type MediaCrop = z.infer<typeof mediaCropSchema>;

/**
 * The subject, and optionally the rectangle around it.
 *
 * `focalX`/`focalY` ARE THE POINT THAT MUST SURVIVE ANY CROP THE LAYOUT
 * IMPOSES. A responsive page crops images itself — a wide photograph in a
 * square tile, a portrait in a wide banner — and the browser's default is to
 * take the middle, which is how a clinic ends up publishing a photograph of
 * somebody's shoulder. The centre, 0.5/0.5, is the default and is exactly the
 * behaviour of an image nobody has framed.
 *
 * `crop` IS THE STRONGER STATEMENT: not "keep this in view" but "show only
 * this". Null unless somebody has drawn one.
 */
export const mediaFramingSchema = z.strictObject({
  focalX: z.number().min(0).max(1),
  focalY: z.number().min(0).max(1),
  crop: mediaCropSchema.nullable(),
});

export type MediaFraming = z.infer<typeof mediaFramingSchema>;

/** What an unframed photograph means, stated once so both tiers agree. */
export const DEFAULT_MEDIA_FRAMING: MediaFraming = { focalX: 0.5, focalY: 0.5, crop: null };

/**
 * One servable copy of one photograph.
 *
 * `path` is what goes in a `srcset`; `width` is the `w` descriptor beside it.
 * `byteSize` is here so a page budget is measurable without fetching anything.
 */
export const publicImageRenditionSchema = z.strictObject({
  path: publicMediaPathSchema,
  format: z.enum(MEDIA_RENDITION_FORMATS),
  width: z.int().positive(),
  height: z.int().positive(),
  byteSize: z.int().positive(),
});

export type PublicImageRendition = z.infer<typeof publicImageRenditionSchema>;

/**
 * A published photograph, as the website states it.
 *
 * `mediaId` IS AN OPAQUE HANDLE AND NOT AN ADDRESS. Nothing is served from it;
 * the servable things are the renditions. It is here so the web tier can key a
 * list and recognise the same photograph appearing in two projections without
 * comparing paths.
 *
 * `width` AND `height` ARE THE INTRINSIC SIZE OF THE LARGEST RENDITION, which
 * is what a layout needs in order to reserve space before any byte arrives.
 * They are post-orientation dimensions: a photograph taken with the telephone
 * turned sideways reports the size it will actually occupy, because the
 * rotation was applied to the pixels at ingest rather than left in a metadata
 * field a renderer might or might not honour.
 *
 * ABSENT, FOR THE REASON EVERY PUBLIC PROJECTION IN THIS PRODUCT IS SHORT: the
 * uploader, the upload instant, the publication instant, the attachment, the
 * original file name, the original byte size, the master, and every internal
 * state that decided this is public at all.
 */
export const publicImageSchema = z.strictObject({
  mediaId: z.uuid(),
  alt: z.string(),
  width: z.int().positive(),
  height: z.int().positive(),
  renditions: z.array(publicImageRenditionSchema).min(1),
  /**
   * How this use of this photograph is framed. See `mediaFramingSchema`.
   *
   * IT IS ALWAYS PRESENT, never optional, and an unframed image carries
   * `DEFAULT_MEDIA_FRAMING` rather than nothing — so the renderer has one code
   * path instead of a branch it might get wrong on the image that matters.
   *
   * THE RENDITIONS ARE THE WHOLE FRAME AND THESE NUMBERS DESCRIBE PART OF IT.
   * The web tier applies them; the API does not, and no rendition is re-derived
   * when they change.
   */
  framing: mediaFramingSchema,
});

export type PublicImage = z.infer<typeof publicImageSchema>;
