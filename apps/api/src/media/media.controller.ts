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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  createMediaAttachmentRequestSchema,
  mediaUploadFieldsSchema,
  updateMediaArchiveRequestSchema,
  updateMediaPublicationRequestSchema,
  type CreateMediaAttachmentRequest,
  type MediaAssetListResponse,
  type MediaAssetResponse,
  type MediaUploadFields,
  type UpdateMediaArchiveRequest,
  type UpdateMediaPublicationRequest,
} from '@clinic/contracts';
import { RequirePermissions } from '../auth/decorators/endpoint-access';
import { Ctx, CurrentSession } from '../auth/decorators/request.decorators';
import { AppError } from '../common/app-error';
import type { RequestContext, ResolvedSession } from '../common/request-context';
import { ZodBodyPipe } from '../common/zod-validation.pipe';
import { MediaAttachmentsService } from './media-attachments.service';
import { MediaUploadInterceptor, type UploadedImage } from './media-upload.interceptor';
import { MediaService } from './media.service';

/**
 * The staff media library. SEVEN ROUTES, FOUR PERMISSIONS, AND NOTHING PUBLIC.
 *
 * Milestone 9.5, checkpoint A5.
 *
 * NO ROUTE HERE SERVES A BYTE. Reading a photograph is the public surface's
 * job, and it lives on `PublicSiteController` with every other thing the world
 * can reach — see the note on that file. A colleague looking at this library
 * sees the same rendition paths a visitor would, and fetches them the same way
 * through the web tier; there is deliberately no privileged preview route,
 * because a route that served unpublished bytes to a session would be a second
 * serving path with a second predicate, and the second one is always the one
 * that is wrong.
 *
 * THE AUTHORITY SPLIT, ROUTE BY ROUTE:
 *
 *   GET    /media                          media.read
 *   GET    /media/:id                      media.read
 *   POST   /media                          media.upload
 *   POST   /media/:id/attachments          media.attach     (always a draft)
 *   DELETE /media/attachments/:id          media.attach     (refused if published)
 *   PATCH  /media/attachments/:id/publication   media.publish
 *   PATCH  /media/:id/archive                   media.publish
 *
 * THE TWO `media.publish` ROUTES ARE THE MANAGER'S ALONE AND THEY ARE THE ONLY
 * TWO THAT CAN CHANGE WHAT A STRANGER SEES. Everything above them prepares.
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
  ) {}

  @Get()
  @RequirePermissions('media.read')
  async list(): Promise<MediaAssetListResponse> {
    return { media: await this.media.list() };
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

  /** The manager act: this photograph, in this place, may be seen. */
  @Patch('attachments/:attachmentId/publication')
  @RequirePermissions('media.publish')
  async setPublished(
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
    @Body(new ZodBodyPipe(updateMediaPublicationRequestSchema))
    body: UpdateMediaPublicationRequest,
    @CurrentSession() session: ResolvedSession,
    @Ctx() context: RequestContext,
  ): Promise<MediaAssetResponse> {
    return {
      media: await this.attachments.setPublished(attachmentId, body.isPublished, session, context),
    };
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
