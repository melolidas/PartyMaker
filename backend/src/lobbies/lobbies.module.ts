import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LobbiesController } from './lobbies.controller';
import { LobbiesService } from './lobbies.service';
import { LobbyMessagesController } from './lobby-messages.controller';
import { LobbyMessagesService } from './lobby-messages.service';
import { ChatsController } from '../chats/chats.controller';
import { ChatsService } from '../chats/chats.service';

@Module({ imports: [AuthModule], controllers: [LobbiesController, LobbyMessagesController, ChatsController], providers: [LobbiesService, LobbyMessagesService, ChatsService] })
export class LobbiesModule {}
