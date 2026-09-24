import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  MEDIA_PREVIEW_CACHE_CONTROL,
  MEDIA_RENDITION_CONTENT_TYPE,
  createMediaAttachmentRequestSchema,
  mediaUploadFieldsSchema,
  updateMediaAltTextRequestSchema,
  updateMediaArchiveRequestSchema,
  updateMediaFramingRequestSchema,
  updateMediaPublicationRequestSchema,
  type CreateMediaAttachmentRequest,
  type MediaAltTextResponse,
  type MediaAssetListResponse,
  type MediaAssetResponse,
  type MediaPublicationResponse,
  type MediaUploadFields,
  type UpdateMediaAltTextRequest,
  type UpdateMediaArchiveRequest,
  type UpdateMediaFramingRequest,
  type UpdateMediaPublicationRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import { AppError } from '../common/app-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { MediaAttachmentsService } from './media-attachments.service';
import { MediaPreviewService } from './media-preview.service';
import { MediaUploadInterceptor, type UploadedImage } from './media-upload.interceptor';
import { MediaService } from './media.service';

/**
 * The staff media library. TEN ROUTES, FOUR PERMISSIONS, AND NOTHING PUBLIC.
 *
 * Milestone 9.5, checkpoint A5.
 *
 * ONE ROUTE HERE SERVES BYTES, AND ONLY TO A SESSION. Serving a photograph to
 * the world is the public surface's job, on `PublicSiteController`, under
 * `LIVE_ATTACHMENT_PREDICATE`. A5 had no staff equivalent, reasoning that a
 * second serving path would carry a second, wrong predicate. The staff-preview
 * checkpoint adds one because a manager cannot approve a picture they cannot
 * see once the uploader's browser has gone; it answers a DIFFERENT question —
 * "may this colleague read the draft this picture is on?" — and never the
 * stranger's one. See `MediaPreviewService`.
 *
 * THE AUTHORITY SPLIT, ROUTE BY ROUTE:
 *
 *   GET    /media                          media.read
 *   GET    /media/:id                      media.read
 *   GET    /media/renditions/:id/preview   media.read + the owner's read
 *   POST   /media                          media.upload
 *   POST   /media/:id/attachments          media.attach     (always a draft)
 *   PATCH  /media/attachments/:id/framing  media.attach     (refused if published)
 *   DELETE /media/attachments/:id          media.attach     (refused if published)
 *   PATCH  /media/:id/alt-text             media.attach     (+ media.publish if served)
 *   PATCH  /media/attachments/:id/publication   media.publish
 *   PATCH  /media/:id/archive                   media.publish
 *
 * THE TWO `media.publish` ROUTES ARE THE MANAGER'S ALONE AND THEY ARE THE ONLY
 * TWO THAT CAN CHANGE WHETHER A STRANGER SEES A PHOTOGRAPH. Everything above
 * them prepares. The description route changes what a stranger READS about
 * one, and so requires `media.publish` too once the photograph is served.
 *
 * NO DELETE OF AN ASSET. `DELETE` appears once, on an ATTACHMENT, and it
 * detaches rather than removes — the row survives, so anybody afterwards can
 * say when a photograph came off a page. Nothing in this application removes a
 * stored byte; see `MediaService`.
 */
@Controller('media')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly attachments: MediaAttachmentsService,
    private readonly preview: MediaPreviewService,
  ) {}

  @Get()
  @RequirePermissions('media.read')
  async list(): Promise<MediaAssetListResponse> {
    return { media: await this.media.list() };
  }

  /**
   * One rendition's bytes for a signed-in colleague, PUBLISHED OR NOT.
   *
   * `media.read` gets the caller in; which renditions they then receive is
   * decided per owner by `MediaPreviewService` — the owner's own draft-read
   * permission, on a standing attachment of an asset still in circulation.
   * Everything else is `MEDIA_NOT_FOUND`.
   *
   * `MEDIA_PREVIEW_CACHE_CONTROL` (`private, no-store`), NOT THE PUBLIC WINDOW,
   * and no `ETag`: there is nothing to revalidate because nothing may keep a
   * copy. `nosniff` and a filename-free `inline` disposition, as on the public
   * route, because the body is uploaded content.
   *
   * No session → `SessionGuard` refuses before this runs. The identifier is a
   * RENDITION id; the master has no rendition row and cannot be named.
   */
  @Get('renditions/:renditionId/preview')
  @RequirePermissions('media.read')
  async getPreview(
    @Param('renditionId', ParseUUIDPipe) renditionId: string,
    @CurrentSession() session: ResolvedSession,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const rendition = await this.preview.findPreviewableRendition(renditionId, session.permissions);

    response.setHeader('cache-control', MEDIA_PREVIEW_CACHE_CONTROL);
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('content-disposition', 'inline');

    return new StreamableFile(rendition.bytes, {
      type: MEDIA_RENDITION_CONTENT_TYPE[rendition.format],
      length: rendition.byteSize,
    });
  }

  /**
   * Detaching is filed BEFORE `:id` on purpose.
   *
   * Express matches in declaration order, and `attachments` is a valid UUID to
   * nobody — but `ParseUUIDPipe` on `:id` would reject it with a message about
   * a malformed identifier rather than routing here. Declaring the literal
   * segments first makes the two families of route unambiguous by construction.
   */
  @Delete('attachments/:attachmentId')
  @RequirePermissions('media.attach')
  async detach(
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<MediaAssetResponse> {
    return { media: await this.attachments.detach(attachmentId, session, context) };
  }

  /**
   * Re-frame this use of the photograph: move the subject, draw or clear a crop.
   *
   * THE ONLY WRITE IN THIS CONTROLLER THAT MOVES NO BYTE. Framing is stored as a
   * description of which part of the existing frame matters, so this changes six
   * numbers on one row: no re-upload, no re-derivation, and no possibility of
   * destroying the parts of the photograph outside the crop. It is also why the
   * web tier can preview a crop live — applying a normalised rectangle is CSS,
   * not a request.
   *
   * `media.attach`, and refused while the attachment is published, exactly as
   * detaching is: the weaker authority must not change a live page.
   */
  @Patch('attachments/:attachmentId/framing')
  @RequirePermissions('media.attach')
  async setFraming(
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Body(new ZodBodyPipe(updateMediaFramingRequestSchema)) body: UpdateMediaFramingRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<MediaAssetResponse> {
    return { media: await this.attachments.setFraming(attachmentId, body, session, context) };
  }

  /** The manager act: this photograph, in this place, may be seen. */
  @Patch('attachments/:attachmentId/publication')
  @RequirePermissions('media.publish')
  async setPublished(
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Body(new ZodBodyPipe(updateMediaPublicationRequestSchema))
    body: UpdateMediaPublicationRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<MediaPublicationResponse> {
    return this.attachments.setPublished(attachmentId, body.isPublished, session, context);
  }

  @Get(':id')
  @RequirePermissions('media.read')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<MediaAssetResponse> {
    return { media: await this.media.get(id) };
  }

  /**
   * Take a photograph into the library.
   *
   * `multipart/form-data`: one file part named `file`, and an `altText` field
   * beside it. See `MediaUploadInterceptor` for why this one route is not JSON.
   *
   * THE FILE NAME AND THE BROWSER'S CONTENT TYPE ARE NOT READ. Both are values
   * the caller chose; the type is decided from the bytes and the name is
   * recorded nowhere, because a file name is very often a family's surname.
   *
   * 201, because a row is genuinely created and the response is it.
   */
  @Post()
  @HttpCode(201)
  @RequirePermissions('media.upload')
  @UseInterceptors(MediaUploadInterceptor)
  async upload(
    @UploadedFile() file: UploadedImage | undefined,
    @Body(new ZodBodyPipe(mediaUploadFieldsSchema)) body: MediaUploadFields,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<MediaAssetResponse> {
    if (file === undefined || file.buffer.byteLength === 0) {
      throw new AppError('VALIDATION_FAILED', undefined, 'A file part named "file" is required');
    }

    return { media: await this.media.upload(file.buffer, body.altText, session, context) };
  }

  /** Attaching. ALWAYS A DRAFT — there is no field on the request that could say otherwise. */
  @Post(':id/attachments')
  @HttpCode(201)
  @RequirePermissions('media.attach')
  async attach(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(createMediaAttachmentRequestSchema)) body: CreateMediaAttachmentRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<MediaAssetResponse> {
    return { media: await this.attachments.attach(id, body, session, context) };
  }

  /**
   * Correct the description a visitor who cannot see the photograph is read.
   *
   * `media.attach` gets the caller in; once the photograph is publicly served
   * the service additionally requires `media.publish` — see
   * `MediaService.updateAltText`. `publications` tells the Web tier which live
   * pages to invalidate, and is empty when there are none.
   */
  @Patch(':id/alt-text')
  @RequirePermissions('media.attach')
  async updateAltText(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateMediaAltTextRequestSchema)) body: UpdateMediaAltTextRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<MediaAltTextResponse> {
    return this.media.updateAltText(id, body.altText, session, context);
  }

  /** Out of circulation everywhere at once, and back again. Manager-only. */
  @Patch(':id/archive')
  @RequirePermissions('media.publish')
  async setArchived(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodBodyPipe(updateMediaArchiveRequestSchema)) body: UpdateMediaArchiveRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<MediaAssetResponse> {
    return { media: await this.media.setArchived(id, body.archived, session, context) };
  }
}
