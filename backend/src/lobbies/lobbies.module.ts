import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LobbiesController } from './lobbies.controller';
import { LobbiesService } from './lobbies.service';

@Module({ imports: [AuthModule], controllers: [LobbiesController], providers: [LobbiesService] })
export class LobbiesModule {}
