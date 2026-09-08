import {
  Injectable,
  PayloadTooLargeException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';
import { MEDIA_SOURCE_MAX_BYTES } from '@clinic/contracts';
import { AppError } from '../common/app-error';

/**
 * The one multipart parser in this application, and the only reason it exists
 * is the byte cap.
 *
 * Milestone 9.5, checkpoint A5.
 *
 * WHY MULTIPART AT ALL, IN AN API THAT IS OTHERWISE ENTIRELY JSON. Because the
 * cap has to be enforced WHILE THE BODY IS ARRIVING. A base64 field inside a
 * JSON document is a third larger than the file, and the process would have to
 * buffer and parse the whole of it before it could discover that it was too
 * big — which is to say the refusal would arrive after the damage. Busboy stops
 * reading at the limit.
 *
 * ONE FILE, ONE FIELD NAME, AND A SMALL NUMBER OF TEXT PARTS. Everything else
 * about the request is refused by the parser rather than ignored by the
 * handler: a second file, an unexpected field name, an enormous field value.
 * The storage is memory, deliberately — a disk-backed multer would write the
 * uploaded photograph, EXIF and GPS intact, into a temporary directory, which
 * is precisely the file this subsystem is designed never to create.
 *
 * WHAT THIS CLASS ADDS TO `FileInterceptor` IS ONE TRANSLATION. Nest turns
 * multer's size failure into a `PayloadTooLargeException`, which the error
 * envelope would report as `VALIDATION_FAILED` with a 413 — a status and a code
 * that disagree, and a code the web tier cannot map to a sentence about file
 * size. `MEDIA_FILE_TOO_LARGE` is the stable, machine-readable refusal the
 * contract promises, so it is raised here.
 */
const Base = FileInterceptor('file', {
  limits: {
    fileSize: MEDIA_SOURCE_MAX_BYTES,
    files: 1,
    // The alt text and nothing else. A generous ceiling on a field the shared
    // contract already bounds to 200 characters, so an over-long value is a
    // readable `VALIDATION_FAILED` rather than a parser error.
    fields: 4,
    fieldSize: 8 * 1024,
  },
});

@Injectable()
export class MediaUploadInterceptor extends Base implements NestInterceptor {
  override async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    try {
      return await super.intercept(context, next);
    } catch (error) {
      if (error instanceof PayloadTooLargeException) throw new AppError('MEDIA_FILE_TOO_LARGE');
      throw error;
    }
  }
}

/**
 * The shape of a multer memory-storage file, declared here rather than pulled
 * in as `@types/multer`.
 *
 * FOUR FIELDS ARE ALL THIS PRODUCT WILL EVER READ, and two of them it reads
 * only to ignore: `originalname` and `mimetype` are chosen by the caller, and
 * the upload service consults neither — the content type is sniffed from
 * `buffer` and the file name is recorded nowhere. Declaring the type locally
 * keeps a dependency out of the manifest and makes the narrowness explicit.
 */
export type UploadedImage = {
  readonly buffer: Buffer;
  readonly size: number;
  readonly originalname: string;
  readonly mimetype: string;
};
