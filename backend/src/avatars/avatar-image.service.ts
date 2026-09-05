import { BadRequestException, Injectable, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import sharp from 'sharp';

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;

@Injectable()
export class AvatarImage {
  async normalize(buffer: Buffer, declaredMime: string): Promise<Buffer> {
    if (buffer.length > MAX_AVATAR_BYTES) throw new PayloadTooLargeException({ code: 'AVATAR_TOO_LARGE', message: 'Maximum input size is 5 MiB' });
    const unsupported = () => new UnsupportedMediaTypeException({ code: 'AVATAR_UNSUPPORTED_FORMAT', message: 'A single static JPEG or PNG with matching MIME is required' });
    const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
    if ((!png && !jpeg) || declaredMime !== (png ? 'image/png' : 'image/jpeg')) throw unsupported();
    // libvips may decode only APNG's first frame: reject its animation control chunk explicitly.
    if (png) for (let offset = 8; offset + 12 <= buffer.length;) {
      const size = buffer.readUInt32BE(offset);
      if (size > buffer.length - offset - 12) break; // Decoder reports corruption below.
      if (buffer.toString('ascii', offset + 4, offset + 8) === 'acTL') throw unsupported();
      offset += size + 12;
    }
    try {
      const image = sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: 'warning' }).timeout({ seconds: 5 });
      const meta = await image.metadata();
      if ((meta.pages ?? 1) !== 1 || !['jpeg', 'png'].includes(meta.format)) throw unsupported();
      // No keepMetadata/withMetadata: EXIF, GPS, XMP and original profiles are stripped.
      return await image.autoOrient().resize(512, 512, { fit: 'cover', position: 'centre' })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
    } catch (error: unknown) {
      if (error instanceof UnsupportedMediaTypeException) throw error;
      if (error instanceof Error && /pixel limit/i.test(error.message)) {
        throw new PayloadTooLargeException({ code: 'AVATAR_PIXEL_LIMIT', message: 'Maximum decoded image size is 20 megapixels' });
      }
      throw new BadRequestException({ code: 'AVATAR_INVALID_IMAGE', message: 'Image could not be safely decoded' });
    }
  }
}
