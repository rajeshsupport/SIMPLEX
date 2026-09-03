import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Client,
  ClientUserSnapshot,
  ClientCredential,
  AutomationRun,
  AuditLog,
} from '@hmc/database';
import { ClientUsersController } from './client-users.controller.js';
import { ClientUsersService } from './client-users.service.js';
import { AgentsModule } from '../agents/agents.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Client,
      ClientUserSnapshot,
      ClientCredential,
      AutomationRun,
      AuditLog,
    ]),
    AgentsModule,
  ],
  controllers: [ClientUsersController],
  providers: [ClientUsersService],
  exports: [ClientUsersService],
})
export class ClientUsersModule {}
