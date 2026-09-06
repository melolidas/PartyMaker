import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { LobbyHistoryService } from './lobby-history.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService, LobbyHistoryService],
})
export class UsersModule {}
