import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { API_ENV } from '../config/config.module';
import type { ApiEnv } from '../config/env';
import { AppError } from '../common/app-error';
import { uuidv7 } from '../common/uuid';

/**
 * The directory the API owns, and the only code in this application that reads
 * or writes a file.
 *
 * Milestone 9.5, checkpoint A5. THE FROZEN OWNER DECISION FOR THE PILOT IS THAT
 * NESTJS OWNS THE BYTES ON PERSISTENT DISK. Not PostgreSQL — image data in a
 * relational database bloats every backup, every dump and every replica for no
 * query anybody makes — and not object storage, which is a dependency, a
 * credential and a second failure domain a single-site clinic does not have.
 * Next.js never sees this directory, exactly as it never sees the database.
 *
 * WHAT A STORAGE KEY IS. A relative POSIX path under the configured root,
 * generated here and stored in the row that owns it. Stored rather than derived
 * from the id, so that a future change to the directory layout leaves what is
 * already on disk addressable instead of orphaning it.
 *
 * `resolveKey` IS THE CONTAINMENT CHECK AND IT RUNS ON EVERY READ AND WRITE.
 * The keys this file generates cannot escape the root, but a key that reached
 * the database another way — a hand-written UPDATE, a restored backup, a future
 * import — must not be able to make the serving route hand out `/etc/passwd`.
 * A path that does not resolve inside the root is `MEDIA_NOT_FOUND`, the same
 * refusal an anonymous caller gets for everything else, so a probe learns
 * nothing from the difference.
 *
 * WRITES ARE WRITE-THEN-RENAME. A rendition file is written under a temporary
 * name in its final directory and renamed into place, so a process killed
 * mid-write leaves a stray temporary file rather than a truncated image the
 * serving route would go on offering forever with a `Content-Length` that
 * matches a row.
 *
 * NOTHING HERE DELETES. There is no `remove`, no `purge` and no unlink of a
 * stored file anywhere in this checkpoint, and the absence is the point: how
 * long the clinic keeps a photograph nobody publishes any more is a retention
 * decision the owner has not taken. Adding the capability before the policy
 * would be adding the risk before the reason.
 */
@Injectable()
export class MediaStorageService {
  private readonly root: string;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.root = resolve(env.MEDIA_STORAGE_DIR);
  }

  /**
   * Where one asset's files live: two levels of fan-out taken from the asset
   * id, then the id itself.
   *
   * The fan-out exists because a clinic that runs for ten years accumulates
   * thousands of assets, and every one of them has a master plus up to ten
   * renditions. A single flat directory of tens of thousands of entries is slow
   * to list on every filesystem and painful to inspect on any of them.
   */
  keyFor(assetId: string, fileName: string): string {
    const flat = assetId.replace(/-/g, '');

    return `${flat.slice(0, 2)}/${flat.slice(2, 4)}/${assetId}/${fileName}`;
  }

  async write(key: string, bytes: Buffer): Promise<void> {
    const target = this.resolveKey(key);
    const directory = target.slice(0, target.lastIndexOf(sep));

    await mkdir(directory, { recursive: true });

    // The temporary name is in the SAME directory as the target, so the rename
    // is within one filesystem and is therefore atomic. A temporary directory
    // elsewhere would turn it into a copy, which is not.
    const temporary = `${target}.${uuidv7()}.part`;

    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, target);
  }

  /**
   * The bytes behind one key, or `MEDIA_NOT_FOUND`.
   *
   * A missing file is the same refusal as an unpublished rendition, and
   * deliberately: the serving route has already decided the caller may have
   * this, so a distinguishable "the row exists but the file is gone" would tell
   * an anonymous caller about the clinic's operational state.
   */
  async read(key: string): Promise<Buffer> {
    try {
      return await readFile(this.resolveKey(key));
    } catch {
      throw new AppError('MEDIA_NOT_FOUND');
    }
  }

  /**
   * A key resolved against the root, with the containment check that makes the
   * whole design safe. See the class note.
   */
  private resolveKey(key: string): string {
    if (key === '' || isAbsolute(key) || key.includes('\0') || key.split(/[\\/]/).includes('..')) {
      throw new AppError('MEDIA_NOT_FOUND');
    }

    const target = resolve(this.root, ...key.split('/'));

    if (target !== this.root && !target.startsWith(join(this.root, sep))) {
      throw new AppError('MEDIA_NOT_FOUND');
    }

    return target;
  }
}
