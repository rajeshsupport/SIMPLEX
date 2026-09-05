import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
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
  const port = parseInt(process.env.MSSQL_PORT || '1433', 10);
  const database = process.env.MSSQL_DATABASE || 'HMC_CENTRAL_AUTOMATION';
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

export const AppDataSource = new DataSource(getDataSourceOptions());
