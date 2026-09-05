import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientResources1700000000003 implements MigrationInterface {
  name = 'AddClientResources1700000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add route columns to clients table if not present
    const checkAndAddCol = async (colName: string, colDef: string) => {
      const col = await queryRunner.query(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'clients' AND COLUMN_NAME = '${colName}'
      `);
      if (col.length === 0) {
        await queryRunner.query(`ALTER TABLE clients ADD ${colName} ${colDef};`);
      }
    };

    await checkAndAddCol('quickResourceRoute', "NVARCHAR(255) NULL CONSTRAINT DF_clients_quickResourceRoute DEFAULT '/addResourceParentDetails'");
    await checkAndAddCol('resourceUserRoute', "NVARCHAR(255) NULL CONSTRAINT DF_clients_resourceUserRoute DEFAULT '/addParentResourceUser'");
    await checkAndAddCol('resourceDirectoryRoute', 'NVARCHAR(255) NULL');

    // 2. Create client_resource_snapshots table if not present
    const snapshotTable = await queryRunner.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'client_resource_snapshots'
    `);

    if (snapshotTable.length === 0) {
      await queryRunner.query(`
        CREATE TABLE client_resource_snapshots (
          id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_client_resource_snapshots_id DEFAULT NEWID(),
          clientId UNIQUEIDENTIFIER NOT NULL,
          clientCode NVARCHAR(50) NOT NULL,
          remoteResourceId NVARCHAR(100) NOT NULL,
          resourceName NVARCHAR(250) NOT NULL,
          isResourceHuman BIT NOT NULL CONSTRAINT DF_client_resource_snapshots_isHuman DEFAULT 1,
          remoteResourceTypeId NVARCHAR(100) NULL,
          resourceTypeName NVARCHAR(150) NULL,
          remoteSpecialtyId NVARCHAR(100) NULL,
          specialtyName NVARCHAR(150) NULL,
          colorIdentificationCode NVARCHAR(10) NOT NULL CONSTRAINT DF_client_resource_snapshots_color DEFAULT 'FFFFFF',
          operatingFrom NVARCHAR(10) NOT NULL CONSTRAINT DF_client_resource_snapshots_from DEFAULT '00:00',
          operatingTo NVARCHAR(10) NOT NULL CONSTRAINT DF_client_resource_snapshots_to DEFAULT '23:55',
          selectAllDepartments BIT NOT NULL CONSTRAINT DF_client_resource_snapshots_allDepts DEFAULT 1,
          selectAllServices BIT NOT NULL CONSTRAINT DF_client_resource_snapshots_allServs DEFAULT 1,
          linkedRemoteUserId NVARCHAR(100) NULL,
          linkedUsername NVARCHAR(100) NULL,
          isShownInRegistration BIT NOT NULL CONSTRAINT DF_client_resource_snapshots_shownReg DEFAULT 1,
          branchId NVARCHAR(100) NULL,
          branchName NVARCHAR(150) NULL,
          remoteStatus NVARCHAR(50) NOT NULL CONSTRAINT DF_client_resource_snapshots_status DEFAULT 'ACTIVE',
          isPresentRemotely BIT NOT NULL CONSTRAINT DF_client_resource_snapshots_isPresent DEFAULT 1,
          lastVerifiedAt DATETIME2 NOT NULL CONSTRAINT DF_client_resource_snapshots_verifiedAt DEFAULT SYSUTCDATETIME(),
          lastSyncedAt DATETIME2 NOT NULL CONSTRAINT DF_client_resource_snapshots_syncedAt DEFAULT SYSUTCDATETIME(),
          createdAt DATETIME2 NOT NULL CONSTRAINT DF_client_resource_snapshots_createdAt DEFAULT SYSUTCDATETIME(),
          updatedAt DATETIME2 NOT NULL CONSTRAINT DF_client_resource_snapshots_updatedAt DEFAULT SYSUTCDATETIME(),
          CONSTRAINT PK_client_resource_snapshots PRIMARY KEY (id),
          CONSTRAINT FK_client_resource_snapshots_clientId FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE
        );

        CREATE UNIQUE INDEX IDX_client_resource_remote_id ON client_resource_snapshots(clientId, remoteResourceId);
        CREATE INDEX IDX_client_resource_clientId ON client_resource_snapshots(clientId);
      `);
    }

    // 3. Create client_resource_departments child table
    const deptsTable = await queryRunner.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'client_resource_departments'
    `);
    if (deptsTable.length === 0) {
      await queryRunner.query(`
        CREATE TABLE client_resource_departments (
          id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_client_resource_departments_id DEFAULT NEWID(),
          resourceId UNIQUEIDENTIFIER NOT NULL,
          departmentCode NVARCHAR(100) NOT NULL,
          departmentName NVARCHAR(250) NOT NULL,
          CONSTRAINT PK_client_resource_departments PRIMARY KEY (id),
          CONSTRAINT FK_client_resource_departments_resId FOREIGN KEY (resourceId) REFERENCES client_resource_snapshots(id) ON DELETE CASCADE
        );
        CREATE INDEX IDX_res_dept ON client_resource_departments(resourceId, departmentCode);
      `);
    }

    // 4. Create client_resource_services child table
    const servsTable = await queryRunner.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'client_resource_services'
    `);
    if (servsTable.length === 0) {
      await queryRunner.query(`
        CREATE TABLE client_resource_services (
          id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_client_resource_services_id DEFAULT NEWID(),
          resourceId UNIQUEIDENTIFIER NOT NULL,
          serviceCode NVARCHAR(100) NOT NULL,
          serviceName NVARCHAR(250) NOT NULL,
          CONSTRAINT PK_client_resource_services PRIMARY KEY (id),
          CONSTRAINT FK_client_resource_services_resId FOREIGN KEY (resourceId) REFERENCES client_resource_snapshots(id) ON DELETE CASCADE
        );
        CREATE INDEX IDX_res_serv ON client_resource_services(resourceId, serviceCode);
      `);
    }

    // 5. Create resource_import_jobs table
    const jobsTable = await queryRunner.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'resource_import_jobs'
    `);
    if (jobsTable.length === 0) {
      await queryRunner.query(`
        CREATE TABLE resource_import_jobs (
          id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_resource_import_jobs_id DEFAULT NEWID(),
          clientId UNIQUEIDENTIFIER NOT NULL,
          clientCode NVARCHAR(50) NOT NULL,
          fileName NVARCHAR(255) NOT NULL,
          status NVARCHAR(50) NOT NULL CONSTRAINT DF_resource_import_jobs_status DEFAULT 'PENDING',
          totalRows INT NOT NULL CONSTRAINT DF_resource_import_jobs_total DEFAULT 0,
          completedRows INT NOT NULL CONSTRAINT DF_resource_import_jobs_completed DEFAULT 0,
          failedRows INT NOT NULL CONSTRAINT DF_resource_import_jobs_failed DEFAULT 0,
          skippedRows INT NOT NULL CONSTRAINT DF_resource_import_jobs_skipped DEFAULT 0,
          createdBy NVARCHAR(100) NOT NULL,
          createdAt DATETIME2 NOT NULL CONSTRAINT DF_resource_import_jobs_createdAt DEFAULT SYSUTCDATETIME(),
          updatedAt DATETIME2 NOT NULL CONSTRAINT DF_resource_import_jobs_updatedAt DEFAULT SYSUTCDATETIME(),
          CONSTRAINT PK_resource_import_jobs PRIMARY KEY (id),
          CONSTRAINT FK_resource_import_jobs_clientId FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE
        );
        CREATE INDEX IDX_res_job_client ON resource_import_jobs(clientId, status);
      `);
    }

    // 6. Create resource_import_rows table
    const rowsTable = await queryRunner.query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'resource_import_rows'
    `);
    if (rowsTable.length === 0) {
      await queryRunner.query(`
        CREATE TABLE resource_import_rows (
          id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_resource_import_rows_id DEFAULT NEWID(),
          jobId UNIQUEIDENTIFIER NOT NULL,
          rowNumber INT NOT NULL,
          resourceName NVARCHAR(250) NOT NULL,
          isResourceHuman BIT NOT NULL CONSTRAINT DF_resource_import_rows_isHuman DEFAULT 1,
          remoteResourceId NVARCHAR(100) NULL,
          remoteUserId NVARCHAR(100) NULL,
          username NVARCHAR(100) NULL,
          stage NVARCHAR(50) NOT NULL CONSTRAINT DF_resource_import_rows_stage DEFAULT 'NOT_STARTED',
          status NVARCHAR(50) NOT NULL CONSTRAINT DF_resource_import_rows_status DEFAULT 'PENDING',
          retryStartingPoint NVARCHAR(100) NULL,
          safeErrorCode NVARCHAR(100) NULL,
          safeErrorMessage NVARCHAR(MAX) NULL,
          rawRowJson NVARCHAR(MAX) NULL,
          CONSTRAINT PK_resource_import_rows PRIMARY KEY (id),
          CONSTRAINT FK_resource_import_rows_jobId FOREIGN KEY (jobId) REFERENCES resource_import_jobs(id) ON DELETE CASCADE
        );
        CREATE INDEX IDX_res_row_job ON resource_import_rows(jobId, rowNumber);
        CREATE INDEX IDX_res_row_stage ON resource_import_rows(jobId, stage);
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      IF OBJECT_ID('resource_import_rows', 'U') IS NOT NULL DROP TABLE resource_import_rows;
      IF OBJECT_ID('resource_import_jobs', 'U') IS NOT NULL DROP TABLE resource_import_jobs;
      IF OBJECT_ID('client_resource_services', 'U') IS NOT NULL DROP TABLE client_resource_services;
      IF OBJECT_ID('client_resource_departments', 'U') IS NOT NULL DROP TABLE client_resource_departments;
      IF OBJECT_ID('client_resource_snapshots', 'U') IS NOT NULL DROP TABLE client_resource_snapshots;

      ALTER TABLE clients DROP CONSTRAINT IF EXISTS DF_clients_quickResourceRoute;
      ALTER TABLE clients DROP COLUMN IF EXISTS quickResourceRoute;

      ALTER TABLE clients DROP CONSTRAINT IF EXISTS DF_clients_resourceUserRoute;
      ALTER TABLE clients DROP COLUMN IF EXISTS resourceUserRoute;

      ALTER TABLE clients DROP COLUMN IF EXISTS resourceDirectoryRoute;
    `);
  }
}
