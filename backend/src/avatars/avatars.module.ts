import { Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { AuthModule } from '../auth/auth.module';
import { AVATAR_DIRECTORY, AvatarFiles } from './avatar-files.service';
import { AvatarImage } from './avatar-image.service';
import { AvatarsController } from './avatars.controller';
import { AvatarsService } from './avatars.service';

@Module({
  imports: [AuthModule], controllers: [AvatarsController],
  providers: [AvatarsService, AvatarFiles, AvatarImage, { provide: AVATAR_DIRECTORY, useFactory: () => resolve(process.cwd(), 'uploads', 'avatars') }],
})
export class AvatarsModule {}
