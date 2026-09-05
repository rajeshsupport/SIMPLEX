import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { getDataSourceOptions } from '@hmc/database';

import { AuthModule } from './auth/auth.module.js';
import { RbacModule } from './rbac/rbac.module.js';
import { UsersModule } from './users/users.module.js';
import { ClientsModule } from './clients/clients.module.js';
import { ImportsModule } from './imports/imports.module.js';
import { WorkflowsModule } from './workflows/workflows.module.js';
import { AgentsModule } from './agents/agents.module.js';
import { AuditModule } from './audit/audit.module.js';
import { RetentionModule } from './retention/retention.module.js';
import { HealthModule } from './health/health.module.js';
import { ClientUsersModule } from './client-users/client-users.module.js';
import { ClientResourcesModule } from './client-resources/client-resources.module.js';

import { CorrelationIdInterceptor } from './common/interceptors/correlation-id.interceptor.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => getDataSourceOptions(),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 120, // 120 requests per minute per IP
      },
    ]),
    AuthModule,
    RbacModule,
    UsersModule,
    ClientsModule,
    ImportsModule,
    WorkflowsModule,
    AgentsModule,
    AuditModule,
    RetentionModule,
    HealthModule,
    ClientUsersModule,
    ClientResourcesModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CorrelationIdInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
