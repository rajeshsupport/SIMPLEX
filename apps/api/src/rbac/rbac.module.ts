import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role, Permission } from '@hmc/database';
import { RbacService } from './rbac.service.js';
import { RbacController } from './rbac.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Role, Permission])],
  providers: [RbacService],
  controllers: [RbacController],
  exports: [RbacService],
})
export class RbacModule {}
