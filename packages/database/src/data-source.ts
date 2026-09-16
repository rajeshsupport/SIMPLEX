import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
// @ts-ignore
import mssql from 'mssql';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import {
  ApplicationUser,
  Role,
  Permission,
  UserClientAccess,
  Client,
  ClientCredential,
  AutomationWorkflow,
  AutomationWorkflowVersion,
  ImportJob,
  ImportJobRow,
  AuditLog,
  ErrorLog,
  ApplicationLoginHistory,
  DesktopAgent,
  AutomationRun,
  AutomationRunStep,
  StoredFile,
  RetentionPolicy,
  ClientUserSnapshot,
  ClientResourceSnapshot,
  ClientResourceDepartment,
  ClientResourceService,
  ResourceImportJob,
  ResourceImportRow,
} from './entities/index.js';

export const allEntities = [
  ApplicationUser,
  Role,
  Permission,
  UserClientAccess,
  Client,
  ClientCredential,
  AutomationWorkflow,
  AutomationWorkflowVersion,
  ImportJob,
  ImportJobRow,
  AuditLog,
  ErrorLog,
  ApplicationLoginHistory,
  DesktopAgent,
  AutomationRun,
  AutomationRunStep,
  StoredFile,
  RetentionPolicy,
  ClientUserSnapshot,
  ClientResourceSnapshot,
  ClientResourceDepartment,
  ClientResourceService,
  ResourceImportJob,
  ResourceImportRow,
];

export const getDataSourceOptions = (): DataSourceOptions => {
  const host = process.env.MSSQL_HOST || 'localhost';
  let port = parseInt(process.env.MSSQL_PORT || '1433', 10);
  // Guard: Inside Docker, simplex_db always listens on 1433 even if host port was configured as 14333
  if (host === 'simplex_db' && port !== 1433) {
    port = 1433;
  }
  const database = process.env.MSSQL_DATABASE || 'SIMPLEX_CENTRAL_DB';
  const username = process.env.MSSQL_USER || 'sa';
  const password = process.env.MSSQL_PASSWORD || 'Rajesh@123';
  const encrypt = process.env.MSSQL_ENCRYPT === 'true';
  const trustServerCertificate = process.env.MSSQL_TRUST_SERVER_CERTIFICATE !== 'false';

  return {
    type: 'mssql',
    host,
    port,
    database,
    username,
    password,
    options: {
      encrypt,
      trustServerCertificate,
      enableArithAbort: true,
      cryptoCredentialsDetails: {
        minVersion: 'TLSv1.2',
      },
    },
    entities: allEntities,
    synchronize: false, // Strict: Never use synchronize in production
    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  };
};

export async function ensureDatabaseExists(): Promise<void> {
  const host = process.env.MSSQL_HOST || 'localhost';
  let port = parseInt(process.env.MSSQL_PORT || '1433', 10);
  if (host === 'simplex_db' && port !== 1433) {
    port = 1433;
  }
  const database = process.env.MSSQL_DATABASE || 'SIMPLEX_CENTRAL_DB';
  const username = process.env.MSSQL_USER || 'sa';
  const password = process.env.MSSQL_PASSWORD || 'Rajesh@123';
  const encrypt = process.env.MSSQL_ENCRYPT === 'true';
  const trustServerCertificate = process.env.MSSQL_TRUST_SERVER_CERTIFICATE !== 'false';

  const config: mssql.config = {
    server: host,
    port,
    user: username,
    password,
    database: 'master', // Always connect to master first to verify target database
    options: {
      encrypt,
      trustServerCertificate,
      enableArithAbort: true,
    },
    connectionTimeout: 5000,
  };

  console.log(`[DATABASE] Connecting to SQL Server master on ${host}:${port} to verify [${database}]...`);
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      const pool = await new mssql.ConnectionPool(config).connect();
      await pool.request().query(`
        IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'${database}')
        BEGIN
          PRINT 'Creating database [${database}]...';
          CREATE DATABASE [${database}];
        END
      `);
      await pool.close();
      console.log(`[DATABASE] Database [${database}] is verified and ready.`);
      return;
    } catch (err: any) {
      if (attempt === 20) {
        console.warn(`[DATABASE] Could not pre-verify database via master: ${err.message}`);
        return;
      }
      console.log(`[DATABASE] Waiting for SQL Server at ${host}:${port} to become ready (attempt ${attempt}/20)...`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

export const AppDataSource = new DataSource(getDataSourceOptions());
