import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MediaAttachmentsService } from './media-attachments.service';
import { MediaErasureService } from './media-erasure.service';
import { MediaPreviewService } from './media-preview.service';
import { MediaStorageService } from './media-storage.service';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { PublicMediaService } from './public-media.service';

/**
 * The media subsystem: the bytes, the rules about them, and the one predicate
 * that decides what a stranger may see.
 *
 * Milestone 9.5, checkpoint A5.
 *
 * IT OWNS `media_asset`, `media_rendition` AND `media_attachment`, and it is
 * the only code in the application that writes any of them. It also owns the
 * directory the photographs live in — `MediaStorageService` is the ONLY class
 * anywhere in `apps/api` that opens a file, which is what makes "the API owns
 * the bytes on persistent disk" a reviewable claim rather than a description.
 *
 * IT READS THREE TABLES IT DOES NOT OWN, AND ONLY THEIR PUBLICATION FLAG.
 * `therapist`, `public_article` and `public_testimonial` belong to
 * `CatalogModule` and `WebsiteModule`, which remain the only code that writes
 * them. The read here is one boolean per row inside one predicate, and it
 * exists because the fourth condition of the serving rule — the owner is itself
 * public — cannot be answered any other way. Sharing a wider read with those
 * modules would put the public site one widened `SELECT` away from a leak,
 * which is the A2 reasoning applied in the opposite direction.
 *
 * `PublicMediaService` IS EXPORTED AND HAS NO CONTROLLER OF ITS OWN. Its one
 * anonymous route — the bytes — is declared on `PublicSiteController`, in
 * `WebsiteModule`, deliberately: that file answers "what can the world see?"
 * and has to go on answering it completely. A media module that grew its own
 * public controller would be the second place a reviewer had to look, and the
 * second place is the one nobody looks at.
 *
 * `MediaPreviewService` IS NOT EXPORTED EITHER. It serves unpublished bytes to
 * a session through this module's own controller, and a second module able to
 * reach it would be a second route to a draft.
 *
 * `MediaAttachmentsService` IS NOT EXPORTED. Attaching, detaching and
 * publishing are reached through this module's own controller and by nothing
 * else; a second module able to publish a photograph would be a second
 * authority over what the website shows.
 *
 * `AuditModule` IS IMPORTED because every write here is audited in the same
 * transaction as the change, as every write in this application is. Serving a
 * published photograph is NOT audited and writes no row: it is a read of
 * something the clinic has already decided to publish, and a table that gained
 * one permanent, undeletable row per image request would be a visitor log this
 * product has deliberately never had.
 */
@Module({
  imports: [AuditModule],
  controllers: [MediaController],
  providers: [
    MediaService,
    MediaAttachmentsService,
    MediaErasureService,
    MediaPreviewService,
    MediaStorageService,
    PublicMediaService,
  ],
  exports: [PublicMediaService, MediaErasureService, MediaStorageService],
})
export class MediaModule {}
