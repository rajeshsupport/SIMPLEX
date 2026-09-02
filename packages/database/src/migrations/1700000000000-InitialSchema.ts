import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Permissions Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'permissions')
      BEGIN
        CREATE TABLE permissions (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          code NVARCHAR(100) NOT NULL UNIQUE,
          name NVARCHAR(150) NOT NULL,
          category NVARCHAR(100) NOT NULL,
          description NVARCHAR(500) NULL,
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
      END
    `);

    // 2. Roles Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'roles')
      BEGIN
        CREATE TABLE roles (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          name NVARCHAR(100) NOT NULL UNIQUE,
          description NVARCHAR(500) NULL,
          isSystem BIT NOT NULL DEFAULT 0,
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          createdBy NVARCHAR(100) NULL,
          updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          updatedBy NVARCHAR(100) NULL
        );
      END
    `);

    // 3. Role Permissions Join Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'role_permissions')
      BEGIN
        CREATE TABLE role_permissions (
          role_id UNIQUEIDENTIFIER NOT NULL,
          permission_id UNIQUEIDENTIFIER NOT NULL,
          PRIMARY KEY (role_id, permission_id),
          CONSTRAINT FK_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
          CONSTRAINT FK_role_permissions_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
        );
      END
    `);

    // 4. Application Users Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'application_users')
      BEGIN
        CREATE TABLE application_users (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          username NVARCHAR(100) NOT NULL UNIQUE,
          email NVARCHAR(255) NOT NULL UNIQUE,
          fullName NVARCHAR(150) NOT NULL,
          passwordHash NVARCHAR(255) NOT NULL,
          status NVARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
          failedAttempts INT NOT NULL DEFAULT 0,
          lockoutUntil DATETIME2 NULL,
          lastLoginAt DATETIME2 NULL,
          refreshTokenHash NVARCHAR(255) NULL,
          requirePasswordChange BIT NOT NULL DEFAULT 0,
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          createdBy NVARCHAR(100) NULL,
          updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          updatedBy NVARCHAR(100) NULL
        );
      END
    `);

    // 5. User Roles Join Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'user_roles')
      BEGIN
        CREATE TABLE user_roles (
          user_id UNIQUEIDENTIFIER NOT NULL,
          role_id UNIQUEIDENTIFIER NOT NULL,
          PRIMARY KEY (user_id, role_id),
          CONSTRAINT FK_user_roles_user FOREIGN KEY (user_id) REFERENCES application_users(id) ON DELETE CASCADE,
          CONSTRAINT FK_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
        );
      END
    `);

    // 6. Clients Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'clients')
      BEGIN
        CREATE TABLE clients (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          clientCode NVARCHAR(50) NOT NULL UNIQUE,
          clientName NVARCHAR(150) NOT NULL,
          baseUrl NVARCHAR(500) NOT NULL,
          applicationPath NVARCHAR(255) NOT NULL DEFAULT '/hmc',
          environment NVARCHAR(50) NOT NULL DEFAULT 'Development',
          applicationVersion NVARCHAR(50) NOT NULL DEFAULT 'v1.0',
          loginRoute NVARCHAR(255) NOT NULL DEFAULT '/hmc/login',
          usersRoute NVARCHAR(255) NOT NULL DEFAULT '/hmc/users',
          servicesRoute NVARCHAR(255) NOT NULL DEFAULT '/hmc/services',
          status NVARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
          connectionStatus NVARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
          allowedDesktopAgentsJson NVARCHAR(MAX) NULL,
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          createdBy NVARCHAR(100) NULL,
          updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          updatedBy NVARCHAR(100) NULL
        );
      END
    `);

    // 7. Client Credentials Table (Encrypted)
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'client_credentials')
      BEGIN
        CREATE TABLE client_credentials (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          clientId UNIQUEIDENTIFIER NOT NULL UNIQUE,
          credentialName NVARCHAR(100) NOT NULL DEFAULT 'Default HMC Operator',
          encryptedUsername NVARCHAR(500) NOT NULL,
          usernameIv NVARCHAR(100) NOT NULL,
          usernameTag NVARCHAR(100) NOT NULL,
          usernameMasked NVARCHAR(150) NOT NULL,
          encryptedPassword NVARCHAR(500) NOT NULL,
          passwordIv NVARCHAR(100) NOT NULL,
          passwordTag NVARCHAR(100) NOT NULL,
          keyVersion INT NOT NULL DEFAULT 1,
          isActive BIT NOT NULL DEFAULT 1,
          lastTestedAt DATETIME2 NULL,
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          createdBy NVARCHAR(100) NULL,
          updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          updatedBy NVARCHAR(100) NULL,
          CONSTRAINT FK_client_credentials_client FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE
        );
      END
    `);

    // 8. User Client Access Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'user_client_access')
      BEGIN
        CREATE TABLE user_client_access (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          userId UNIQUEIDENTIFIER NOT NULL,
          clientId UNIQUEIDENTIFIER NOT NULL,
          accessLevel NVARCHAR(50) NOT NULL DEFAULT 'OPERATOR',
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          grantedBy NVARCHAR(100) NULL,
          CONSTRAINT UQ_user_client_access UNIQUE (userId, clientId),
          CONSTRAINT FK_user_client_access_user FOREIGN KEY (userId) REFERENCES application_users(id) ON DELETE CASCADE,
          CONSTRAINT FK_user_client_access_client FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE
        );
      END
    `);

    // 9. Automation Workflows Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'automation_workflows')
      BEGIN
        CREATE TABLE automation_workflows (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          workflowCode NVARCHAR(100) NOT NULL UNIQUE,
          name NVARCHAR(150) NOT NULL,
          description NVARCHAR(500) NULL,
          appVersion NVARCHAR(50) NOT NULL DEFAULT 'v1.0',
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          createdBy NVARCHAR(100) NULL,
          updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          updatedBy NVARCHAR(100) NULL
        );
      END
    `);

    // 10. Automation Workflow Versions Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'automation_workflow_versions')
      BEGIN
        CREATE TABLE automation_workflow_versions (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          workflowId UNIQUEIDENTIFIER NOT NULL,
          versionNumber INT NOT NULL DEFAULT 1,
          applicableAppVersion NVARCHAR(50) NOT NULL DEFAULT 'v1.0',
          pageRoute NVARCHAR(255) NOT NULL,
          stepsJson NVARCHAR(MAX) NOT NULL,
          selectorsJson NVARCHAR(MAX) NULL,
          successConditionsJson NVARCHAR(MAX) NULL,
          errorConditionsJson NVARCHAR(MAX) NULL,
          securityBlockConditionsJson NVARCHAR(MAX) NULL,
          defaultTimeoutMs INT NOT NULL DEFAULT 30000,
          maxRetries INT NOT NULL DEFAULT 2,
          isActive BIT NOT NULL DEFAULT 1,
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          createdBy NVARCHAR(100) NULL,
          CONSTRAINT UQ_workflow_version UNIQUE (workflowId, versionNumber),
          CONSTRAINT FK_workflow_version_wf FOREIGN KEY (workflowId) REFERENCES automation_workflows(id) ON DELETE CASCADE
        );
      END
    `);

    // 11. Import Jobs Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'import_jobs')
      BEGIN
        CREATE TABLE import_jobs (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          clientId UNIQUEIDENTIFIER NOT NULL,
          jobType NVARCHAR(50) NOT NULL DEFAULT 'SERVICE_MASTER',
          originalFileName NVARCHAR(255) NOT NULL,
          storedFilePath NVARCHAR(500) NULL,
          totalRows INT NOT NULL DEFAULT 0,
          processedRows INT NOT NULL DEFAULT 0,
          succeededRows INT NOT NULL DEFAULT 0,
          failedRows INT NOT NULL DEFAULT 0,
          skippedRows INT NOT NULL DEFAULT 0,
          status NVARCHAR(50) NOT NULL DEFAULT 'PENDING',
          columnMappingsJson NVARCHAR(MAX) NULL,
          oneRecordTestMode BIT NOT NULL DEFAULT 0,
          typedConfirmation NVARCHAR(100) NULL,
          summaryReportJson NVARCHAR(MAX) NULL,
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          createdBy NVARCHAR(100) NULL,
          updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          updatedBy NVARCHAR(100) NULL,
          CONSTRAINT FK_import_jobs_client FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE
        );
      END
    `);

    // 12. Import Job Rows Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'import_job_rows')
      BEGIN
        CREATE TABLE import_job_rows (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          importJobId UNIQUEIDENTIFIER NOT NULL,
          rowIndex INT NOT NULL,
          rawDataJson NVARCHAR(MAX) NOT NULL,
          mappedDataJson NVARCHAR(MAX) NULL,
          status NVARCHAR(50) NOT NULL DEFAULT 'PENDING',
          errorMessage NVARCHAR(MAX) NULL,
          resultJson NVARCHAR(MAX) NULL,
          retryCount INT NOT NULL DEFAULT 0,
          processedAt DATETIME2 NULL,
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          CONSTRAINT UQ_import_job_rows UNIQUE (importJobId, rowIndex),
          CONSTRAINT FK_import_job_rows_job FOREIGN KEY (importJobId) REFERENCES import_jobs(id) ON DELETE CASCADE
        );
      END
    `);

    // 13. Audit Logs Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'audit_logs')
      BEGIN
        CREATE TABLE audit_logs (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          actorUserId NVARCHAR(100) NULL,
          actorUsername NVARCHAR(100) NULL,
          clientId NVARCHAR(100) NULL,
          clientCode NVARCHAR(100) NULL,
          action NVARCHAR(100) NOT NULL,
          entityType NVARCHAR(100) NOT NULL,
          entityId NVARCHAR(100) NULL,
          result NVARCHAR(50) NOT NULL DEFAULT 'SUCCESS',
          ipAddress NVARCHAR(100) NULL,
          userAgent NVARCHAR(500) NULL,
          correlationId NVARCHAR(100) NULL,
          importJobId NVARCHAR(100) NULL,
          automationRunId NVARCHAR(100) NULL,
          detailsJson NVARCHAR(MAX) NULL
        );
        CREATE INDEX IX_audit_logs_timestamp ON audit_logs (timestamp);
        CREATE INDEX IX_audit_logs_actor ON audit_logs (actorUserId);
        CREATE INDEX IX_audit_logs_client ON audit_logs (clientId);
        CREATE INDEX IX_audit_logs_action ON audit_logs (action);
        CREATE INDEX IX_audit_logs_correlation ON audit_logs (correlationId);
      END
    `);

    // 14. Error Logs Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'error_logs')
      BEGIN
        CREATE TABLE error_logs (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          correlationId NVARCHAR(100) NULL,
          serviceName NVARCHAR(100) NOT NULL DEFAULT 'API',
          level NVARCHAR(50) NOT NULL DEFAULT 'ERROR',
          message NVARCHAR(MAX) NOT NULL,
          stackTrace NVARCHAR(MAX) NULL,
          contextJson NVARCHAR(MAX) NULL
        );
        CREATE INDEX IX_error_logs_timestamp ON error_logs (timestamp);
        CREATE INDEX IX_error_logs_correlation ON error_logs (correlationId);
      END
    `);

    // 15. Application Login History Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'application_login_history')
      BEGIN
        CREATE TABLE application_login_history (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          userId UNIQUEIDENTIFIER NOT NULL,
          timestamp DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          ipAddress NVARCHAR(100) NULL,
          userAgent NVARCHAR(500) NULL,
          status NVARCHAR(50) NOT NULL DEFAULT 'SUCCESS',
          failureReason NVARCHAR(255) NULL,
          CONSTRAINT FK_login_history_user FOREIGN KEY (userId) REFERENCES application_users(id) ON DELETE CASCADE
        );
        CREATE INDEX IX_login_history_userId ON application_login_history (userId);
        CREATE INDEX IX_login_history_timestamp ON application_login_history (timestamp);
      END
    `);

    // 16. Desktop Agents Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'desktop_agents')
      BEGIN
        CREATE TABLE desktop_agents (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          agentName NVARCHAR(100) NOT NULL UNIQUE,
          machineHostname NVARCHAR(150) NOT NULL,
          osInfo NVARCHAR(255) NOT NULL,
          assignedUserId UNIQUEIDENTIFIER NOT NULL,
          authTokenHash NVARCHAR(255) NOT NULL,
          status NVARCHAR(50) NOT NULL DEFAULT 'OFFLINE',
          currentTaskDescription NVARCHAR(255) NULL,
          lastHeartbeatAt DATETIME2 NULL,
          systemMetricsJson NVARCHAR(MAX) NULL,
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          CONSTRAINT FK_desktop_agents_user FOREIGN KEY (assignedUserId) REFERENCES application_users(id) ON DELETE CASCADE
        );
      END
    `);

    // 17. Automation Runs Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'automation_runs')
      BEGIN
        CREATE TABLE automation_runs (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          clientId UNIQUEIDENTIFIER NOT NULL,
          workflowId UNIQUEIDENTIFIER NULL,
          desktopAgentId UNIQUEIDENTIFIER NULL,
          triggeredByUserId NVARCHAR(100) NULL,
          runType NVARCHAR(50) NOT NULL DEFAULT 'INTERACTIVE_LOGIN',
          status NVARCHAR(50) NOT NULL DEFAULT 'PENDING',
          startedAt DATETIME2 NULL,
          completedAt DATETIME2 NULL,
          totalDurationMs INT NULL,
          correlationId NVARCHAR(100) NULL,
          importJobId NVARCHAR(100) NULL,
          errorMessage NVARCHAR(MAX) NULL,
          parametersJson NVARCHAR(MAX) NULL,
          resultSummaryJson NVARCHAR(MAX) NULL,
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          CONSTRAINT FK_automation_runs_client FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE,
          CONSTRAINT FK_automation_runs_agent FOREIGN KEY (desktopAgentId) REFERENCES desktop_agents(id) ON DELETE SET NULL
        );
        CREATE INDEX IX_automation_runs_client ON automation_runs (clientId);
        CREATE INDEX IX_automation_runs_status ON automation_runs (status);
        CREATE INDEX IX_automation_runs_correlation ON automation_runs (correlationId);
      END
    `);

    // 18. Automation Run Steps Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'automation_run_steps')
      BEGIN
        CREATE TABLE automation_run_steps (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          automationRunId UNIQUEIDENTIFIER NOT NULL,
          stepIndex INT NOT NULL,
          stepName NVARCHAR(150) NOT NULL,
          status NVARCHAR(50) NOT NULL DEFAULT 'PENDING',
          startedAt DATETIME2 NULL,
          completedAt DATETIME2 NULL,
          durationMs INT NULL,
          errorMessage NVARCHAR(MAX) NULL,
          screenshotFilePath NVARCHAR(500) NULL,
          stepDetailsJson NVARCHAR(MAX) NULL,
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          CONSTRAINT FK_automation_run_steps_run FOREIGN KEY (automationRunId) REFERENCES automation_runs(id) ON DELETE CASCADE
        );
        CREATE INDEX IX_automation_run_steps_run ON automation_run_steps (automationRunId, stepIndex);
      END
    `);

    // 19. Stored Files Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'stored_files')
      BEGIN
        CREATE TABLE stored_files (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          fileName NVARCHAR(255) NOT NULL,
          fileType NVARCHAR(100) NOT NULL,
          fileSizeBytes BIGINT NOT NULL,
          storagePath NVARCHAR(500) NOT NULL,
          mimeType NVARCHAR(150) NOT NULL DEFAULT 'application/octet-stream',
          importJobId NVARCHAR(100) NULL,
          automationRunId NVARCHAR(100) NULL,
          createdBy NVARCHAR(100) NULL,
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
      END
    `);

    // 20. Retention Policies Table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'retention_policies')
      BEGIN
        CREATE TABLE retention_policies (
          id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
          logType NVARCHAR(100) NOT NULL UNIQUE,
          retentionDays INT NOT NULL,
          isArchiveEnabled BIT NOT NULL DEFAULT 0,
          archiveDestination NVARCHAR(500) NULL,
          lastPurgedAt DATETIME2 NULL,
          createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
          updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
        );
      END
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS retention_policies;`);
    await queryRunner.query(`DROP TABLE IF EXISTS stored_files;`);
    await queryRunner.query(`DROP TABLE IF EXISTS automation_run_steps;`);
    await queryRunner.query(`DROP TABLE IF EXISTS automation_runs;`);
    await queryRunner.query(`DROP TABLE IF EXISTS desktop_agents;`);
    await queryRunner.query(`DROP TABLE IF EXISTS application_login_history;`);
    await queryRunner.query(`DROP TABLE IF EXISTS error_logs;`);
    await queryRunner.query(`DROP TABLE IF EXISTS audit_logs;`);
    await queryRunner.query(`DROP TABLE IF EXISTS import_job_rows;`);
    await queryRunner.query(`DROP TABLE IF EXISTS import_jobs;`);
    await queryRunner.query(`DROP TABLE IF EXISTS automation_workflow_versions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS automation_workflows;`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_client_access;`);
    await queryRunner.query(`DROP TABLE IF EXISTS client_credentials;`);
    await queryRunner.query(`DROP TABLE IF EXISTS clients;`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_roles;`);
    await queryRunner.query(`DROP TABLE IF EXISTS application_users;`);
    await queryRunner.query(`DROP TABLE IF EXISTS role_permissions;`);
    await queryRunner.query(`DROP TABLE IF EXISTS roles;`);
    await queryRunner.query(`DROP TABLE IF EXISTS permissions;`);
  }
}
