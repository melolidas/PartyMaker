import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LobbiesController } from './lobbies.controller';
import { LobbiesService } from './lobbies.service';
import { LobbyMessagesController } from './lobby-messages.controller';
import { LobbyMessagesService } from './lobby-messages.service';

@Module({ imports: [AuthModule], controllers: [LobbiesController, LobbyMessagesController], providers: [LobbiesService, LobbyMessagesService] })
export class LobbiesModule {}
