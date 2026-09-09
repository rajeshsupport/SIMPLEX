import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { EnvelopeEncryption } from '@hmc/database';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function validateStartupSecrets() {
  const isProd = process.env.NODE_ENV === 'production';
  const logger = new Logger('SecretAudit');

  const encryptionKey = process.env.ENCRYPTION_MASTER_KEY;
  if (!encryptionKey) {
    logger.error('[FATAL] ENCRYPTION_MASTER_KEY is required but not defined.');
    process.exit(1);
  }
  try {
    EnvelopeEncryption.validateMasterKeyEntropy(encryptionKey);
  } catch (err: any) {
    logger.error(`[FATAL] Invalid ENCRYPTION_MASTER_KEY: ${err.message}`);
    process.exit(1);
  }

  if (isProd) {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret || jwtSecret.length < 32 || jwtSecret.includes('change_me') || jwtSecret.includes('dev_secret')) {
      logger.error('[FATAL] Production requires a high-entropy JWT_SECRET of at least 32 characters.');
      process.exit(1);
    }

    const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
    if (!jwtRefreshSecret || jwtRefreshSecret.length < 32 || jwtRefreshSecret === jwtSecret) {
      logger.error('[FATAL] Production requires a distinct, high-entropy JWT_REFRESH_SECRET of at least 32 characters.');
      process.exit(1);
    }

    const agentSecret = process.env.AGENT_SHARED_SECRET;
    if (!agentSecret || agentSecret.length < 16 || agentSecret.includes('change_me')) {
      logger.error('[FATAL] Production requires a distinct AGENT_SHARED_SECRET of at least 16 characters.');
      process.exit(1);
    }

    if (!process.env.MSSQL_PASSWORD) {
      logger.error('[FATAL] Production requires MSSQL_PASSWORD to be explicitly defined.');
      process.exit(1);
    }
  }
}

validateStartupSecrets();

import { createRequire } from 'module';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

const platformExpressPath = require.resolve('@nestjs/platform-express');
const expressReq = createRequire(platformExpressPath);
const express = expressReq('express');

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const server = express();
  const defaultJsonParser = express.json({ limit: '100kb' });
  // Scoped parser for 100-user chunks: 500 KB (512,000 bytes) ensures 100 records with maximum permissible 4-byte UTF-8 fields (~460 KB) fit with an 11.2% safety margin, while tightly bounding memory.
  const batchJsonParser = express.json({ limit: '500kb' });
  const defaultUrlEncodedParser = express.urlencoded({ limit: '100kb', extended: true });

  // Dedicated single-parser routing middleware: exactly one JSON parser consumes any request.
  server.use((req: any, res: any, next: any) => {
    const reqPath = req.path || (req.url ? req.url.split('?')[0] : '');
    if (/^\/api\/v1\/agents\/runs\/[^/]+\/client-users\/sync-batches\/?$/.test(reqPath)) {
      return batchJsonParser(req, res, next);
    }
    return defaultJsonParser(req, res, next);
  });
  server.use(defaultUrlEncodedParser);

  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), { bodyParser: false });

  // Security Headers
  app.use(
    helmet({
      contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // Enable CORS
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Global Prefix
  app.setGlobalPrefix('api/v1');

  // Enable validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    })
  );

  // Enable graceful shutdown
  app.enableShutdownHooks();

  // Swagger OpenAPI documentation
  const config = new DocumentBuilder()
    .setTitle('HMC Central Operations Console API')
    .setDescription('Central Multi-Client Operations, RBAC, and Browser Automation Orchestration API')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port);
  logger.log(`🚀 HMC Central API is running on: http://localhost:${port}/api/v1`);
  logger.log(`📚 Swagger Documentation is available at: http://localhost:${port}/api/docs`);
}

bootstrap();
