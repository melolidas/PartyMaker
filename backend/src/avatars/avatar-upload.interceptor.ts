import { BadRequestException, HttpException, Injectable, PayloadTooLargeException } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_AVATAR_BYTES } from './avatar-image.service';

@Injectable()
export class AvatarUploadInterceptor implements NestInterceptor {
  private readonly parser = new (FileInterceptor('file', {
    // Busboy marks the file truncated on reaching the limit, not only when exceeding it.
    // One extra transport byte permits exactly MAX; normalize still rejects > MAX.
    limits: { fileSize: MAX_AVATAR_BYTES + 1, files: 1, fields: 0, parts: 2, fieldNameSize: 32, headerPairs: 32 },
  }))();

  async intercept(context: ExecutionContext, next: CallHandler) {
    try { return await this.parser.intercept(context, next); }
    catch (error: unknown) {
      if (error instanceof HttpException && error.getStatus() === 413) {
        throw new PayloadTooLargeException({ code: 'AVATAR_TOO_LARGE', message: 'Maximum input size is 5 MiB' });
      }
      throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Exactly one multipart file named file and no additional fields are required' });
    }
  }
}
