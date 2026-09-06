import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LobbiesController } from './lobbies.controller';
import { LobbiesService } from './lobbies.service';
import { LobbyMessagesController } from './lobby-messages.controller';
import { LobbyMessagesService } from './lobby-messages.service';
import { ChatsController } from '../chats/chats.controller';
import { ChatsService } from '../chats/chats.service';
import { LobbyMembersController } from './lobby-members.controller';
import { LobbyMembersService } from './lobby-members.service';

@Module({ imports: [AuthModule], controllers: [LobbiesController, LobbyMessagesController, LobbyMembersController, ChatsController], providers: [LobbiesService, LobbyMessagesService, LobbyMembersService, ChatsService] })
export class LobbiesModule {}
