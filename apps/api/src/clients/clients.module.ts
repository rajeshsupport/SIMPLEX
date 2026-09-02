import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client, ClientCredential, UserClientAccess } from '@hmc/database';
import { ClientsService } from './clients.service.js';
import { ClientsController } from './clients.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Client, ClientCredential, UserClientAccess])],
  providers: [ClientsService],
  controllers: [ClientsController],
  exports: [ClientsService],
})
export class ClientsModule {}
