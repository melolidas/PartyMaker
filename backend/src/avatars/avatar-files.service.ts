import { Inject, Injectable } from '@nestjs/common';
import { mkdir, open, realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { isUUID } from 'class-validator';

export const AVATAR_DIRECTORY = Symbol('AVATAR_DIRECTORY');

@Injectable()
export class AvatarFiles {
  constructor(@Inject(AVATAR_DIRECTORY) private readonly directory: string) {}

  private path(id: string): string {
    if (!isUUID(id)) throw new Error('Invalid server media id');
    const root = resolve(this.directory), file = resolve(root, `${id}.jpg`);
    if (dirname(file) !== root || basename(file) !== `${id}.jpg`) throw new Error('Invalid avatar path');
    return file;
  }

  async prepare(id: string, bytes: Buffer): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const file = await open(this.path(id), 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    // A failed/uncertain DB commit never causes this file to be deleted.
  }

  async read(id: string): Promise<Buffer> {
    const filePath = this.path(id);
    // Do not follow a file symlink outside the configured directory.
    if (await realpath(filePath) !== resolve(await realpath(this.directory), `${id}.jpg`)) throw new Error('Unavailable avatar');
    const file = await open(filePath, 'r');
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size <= 0 || stat.size > 5 * 1024 * 1024) throw new Error('Unavailable avatar');
      return await file.readFile();
    } finally { await file.close(); }
  }
}
