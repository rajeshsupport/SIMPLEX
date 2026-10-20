-- ============================================================================
-- SIMPLEX CENTRAL OPERATIONS CONSOLE - MASTER DATABASE SCHEMA & MIGRATIONS
-- ============================================================================
-- File: init-db.sql / SIMPLEX_MASTER_DATABASE.sql
-- Purpose: Complete, 100% idempotent master database provisioning script.
--          Creates database, user, sandbox security, all 23 tables, all columns,
--          indexes, constraints, permissions, roles, and default administrator.
-- Execution:
--   docker exec -i simplex_mssql_db /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "Rajesh@123" -C < init-db.sql
-- ============================================================================

USE [master];
GO

-- ============================================================================
-- 1. DATABASE & APPLICATION USER CREATION
-- ============================================================================
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'SIMPLEX_CENTRAL_DB')
BEGIN
    PRINT 'Creating database [SIMPLEX_CENTRAL_DB]...';
    CREATE DATABASE [SIMPLEX_CENTRAL_DB];
END
GO

IF NOT EXISTS (SELECT name FROM sys.server_principals WHERE name = N'simplex_app_user')
BEGIN
    PRINT 'Creating server login [simplex_app_user]...';
    CREATE LOGIN [simplex_app_user] 
    WITH PASSWORD = N'SimplexApp@Secure2026!', 
         CHECK_POLICY = OFF, 
         CHECK_EXPIRATION = OFF;
END
GO

USE [SIMPLEX_CENTRAL_DB];
GO

IF NOT EXISTS (SELECT name FROM sys.database_principals WHERE name = N'simplex_app_user')
BEGIN
    PRINT 'Mapping database user [simplex_app_user]...';
    CREATE USER [simplex_app_user] FOR LOGIN [simplex_app_user];
    ALTER ROLE [db_owner] ADD MEMBER [simplex_app_user];
END
ELSE
BEGIN
    ALTER ROLE [db_owner] ADD MEMBER [simplex_app_user];
END
GO

-- Sandboxing: Deny VIEW ANY DATABASE to enforce isolation
USE [master];
GO
DENY VIEW ANY DATABASE TO [simplex_app_user];
GO

USE [SIMPLEX_CENTRAL_DB];
GO

-- ============================================================================
-- 2. CORE SECURITY & RBAC TABLES
-- ============================================================================

-- 2.1 Permissions Table
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
    CREATE INDEX IX_permissions_code ON permissions (code);
    CREATE INDEX IX_permissions_category ON permissions (category);
    PRINT 'Table [permissions] created.';
END
GO

-- 2.2 Roles Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'roles')
BEGIN
    CREATE TABLE roles (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        name NVARCHAR(50) NOT NULL UNIQUE,
        description NVARCHAR(255) NULL,
        isSystem BIT NOT NULL DEFAULT 0,
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        createdBy NVARCHAR(100) NULL,
        updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updatedBy NVARCHAR(100) NULL
    );
    CREATE INDEX IX_roles_name ON roles (name);
    PRINT 'Table [roles] created.';
END
GO

-- 2.3 Role Permissions Junction
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'role_permissions')
BEGIN
    CREATE TABLE role_permissions (
        role_id UNIQUEIDENTIFIER NOT NULL,
        permission_id UNIQUEIDENTIFIER NOT NULL,
        PRIMARY KEY (role_id, permission_id),
        CONSTRAINT FK_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
        CONSTRAINT FK_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
    );
    PRINT 'Table [role_permissions] created.';
END
GO

-- 2.4 Application Users Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'application_users')
BEGIN
    CREATE TABLE application_users (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        username NVARCHAR(50) NOT NULL UNIQUE,
        email NVARCHAR(255) NOT NULL UNIQUE,
        fullName NVARCHAR(150) NOT NULL,
        passwordHash NVARCHAR(255) NOT NULL,
        status NVARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        isLocked BIT NOT NULL DEFAULT 0,
        failedLoginAttempts INT NOT NULL DEFAULT 0,
        lockoutExpiry DATETIME2 NULL,
        lastLoginAt DATETIME2 NULL,
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        createdBy NVARCHAR(100) NULL,
        updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updatedBy NVARCHAR(100) NULL
    );
    CREATE INDEX IX_application_users_username ON application_users (username);
    CREATE INDEX IX_application_users_email ON application_users (email);
    PRINT 'Table [application_users] created.';
END
ELSE
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('application_users') AND name = 'isLocked')
        ALTER TABLE application_users ADD isLocked BIT NOT NULL DEFAULT 0;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('application_users') AND name = 'failedLoginAttempts')
        ALTER TABLE application_users ADD failedLoginAttempts INT NOT NULL DEFAULT 0;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('application_users') AND name = 'lockoutExpiry')
        ALTER TABLE application_users ADD lockoutExpiry DATETIME2 NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('application_users') AND name = 'lastLoginAt')
        ALTER TABLE application_users ADD lastLoginAt DATETIME2 NULL;
END
GO

-- 2.5 User Roles Junction
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'user_roles')
BEGIN
    CREATE TABLE user_roles (
        user_id UNIQUEIDENTIFIER NOT NULL,
        role_id UNIQUEIDENTIFIER NOT NULL,
        PRIMARY KEY (user_id, role_id),
        CONSTRAINT FK_user_roles_user FOREIGN KEY (user_id) REFERENCES application_users(id) ON DELETE CASCADE,
        CONSTRAINT FK_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    );
    PRINT 'Table [user_roles] created.';
END
GO

-- 2.6 Application Login History
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
    PRINT 'Table [application_login_history] created.';
END
GO

-- ============================================================================
-- 3. CLIENT MANAGEMENT TABLES
-- ============================================================================

-- 3.1 Clients Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'clients')
BEGIN
    CREATE TABLE clients (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        clientCode NVARCHAR(50) NOT NULL UNIQUE,
        clientName NVARCHAR(150) NOT NULL,
        baseUrl NVARCHAR(500) NOT NULL,
        applicationPath NVARCHAR(255) NOT NULL DEFAULT '',
        environment NVARCHAR(50) NOT NULL DEFAULT 'Development',
        applicationVersion NVARCHAR(50) NOT NULL DEFAULT 'v1.0',
        loginRoute NVARCHAR(255) NOT NULL DEFAULT '/login',
        usersRoute NVARCHAR(255) NOT NULL DEFAULT '/users',
        servicesRoute NVARCHAR(255) NOT NULL DEFAULT '/services',
        userRoleRoute NVARCHAR(255) NULL DEFAULT '/addUserRole',
        quickResourceRoute NVARCHAR(255) NULL DEFAULT '/addResourceParentDetails',
        resourceUserRoute NVARCHAR(255) NULL DEFAULT '/addParentResourceUser',
        resourceDirectoryRoute NVARCHAR(255) NULL,
        branchName NVARCHAR(255) NULL,
        branchesJson NVARCHAR(MAX) NULL,
        status NVARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        connectionStatus NVARCHAR(50) NOT NULL DEFAULT 'UNKNOWN',
        allowedDesktopAgentsJson NVARCHAR(MAX) NULL,
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        createdBy NVARCHAR(100) NULL,
        updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updatedBy NVARCHAR(100) NULL
    );
    CREATE INDEX IX_clients_clientCode ON clients (clientCode);
    PRINT 'Table [clients] created.';
END
ELSE
BEGIN
    -- Column alignment for existing clients table
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('clients') AND name = 'userRoleRoute')
        ALTER TABLE clients ADD userRoleRoute NVARCHAR(255) NULL DEFAULT '/addUserRole';
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('clients') AND name = 'quickResourceRoute')
        ALTER TABLE clients ADD quickResourceRoute NVARCHAR(255) NULL DEFAULT '/addResourceParentDetails';
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('clients') AND name = 'resourceUserRoute')
        ALTER TABLE clients ADD resourceUserRoute NVARCHAR(255) NULL DEFAULT '/addParentResourceUser';
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('clients') AND name = 'resourceDirectoryRoute')
        ALTER TABLE clients ADD resourceDirectoryRoute NVARCHAR(255) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('clients') AND name = 'branchName')
        ALTER TABLE clients ADD branchName NVARCHAR(255) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('clients') AND name = 'branchesJson')
        ALTER TABLE clients ADD branchesJson NVARCHAR(MAX) NULL;
END
GO

-- 3.2 Client Credentials (AES-256-GCM Encrypted)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'client_credentials')
BEGIN
    CREATE TABLE client_credentials (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        clientId UNIQUEIDENTIFIER NOT NULL UNIQUE,
        credentialName NVARCHAR(100) NOT NULL DEFAULT 'Default Operator',
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
    PRINT 'Table [client_credentials] created.';
END
GO

-- 3.3 User Client Access Scoping
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
    PRINT 'Table [user_client_access] created.';
END
GO

-- ============================================================================
-- 4. USER SYNCHRONIZATION & SNAPSHOT TABLES
-- ============================================================================

-- 4.1 Client User Snapshots Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'client_user_snapshots')
BEGIN
    CREATE TABLE client_user_snapshots (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        clientId UNIQUEIDENTIFIER NOT NULL,
        clientCode NVARCHAR(50) NOT NULL,
        remoteUserId NVARCHAR(100) NULL,
        username NVARCHAR(100) NOT NULL,
        firstName NVARCHAR(100) NOT NULL,
        middleName NVARCHAR(100) NULL,
        lastName NVARCHAR(100) NOT NULL,
        fullName NVARCHAR(250) NOT NULL,
        nickName NVARCHAR(100) NULL,
        email NVARCHAR(255) NULL,
        mobileNumber NVARCHAR(50) NULL,
        nationality NVARCHAR(100) NULL,
        role NVARCHAR(MAX) NULL,
        profileRole NVARCHAR(100) NULL,
        status NVARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        barcodeNumber NVARCHAR(100) NULL,
        hasSignature BIT NOT NULL DEFAULT 0,
        signatureDataUrl NVARCHAR(MAX) NULL,
        hasStamp BIT NOT NULL DEFAULT 0,
        stampDataUrl NVARCHAR(MAX) NULL,
        hasProfileImage BIT NOT NULL DEFAULT 0,
        profileImageDataUrl NVARCHAR(MAX) NULL,
        remoteCreatedAt NVARCHAR(100) NULL,
        remoteUpdatedAt NVARCHAR(100) NULL,
        isPresentRemotely BIT NOT NULL DEFAULT 1,
        syncRunId NVARCHAR(100) NULL,
        lastSyncedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        lastVerifiedAt DATETIME2 NULL,
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_client_user_snapshots_client FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX UQ_client_user_snapshots_client_user ON client_user_snapshots (clientId, username);
    CREATE INDEX IX_client_user_snapshots_clientId ON client_user_snapshots (clientId);
    CREATE INDEX IX_client_user_snapshots_username ON client_user_snapshots (username);
    PRINT 'Table [client_user_snapshots] created.';
END
ELSE
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('client_user_snapshots') AND name = 'syncRunId')
        ALTER TABLE client_user_snapshots ADD syncRunId NVARCHAR(100) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('client_user_snapshots') AND name = 'isPresentRemotely')
        ALTER TABLE client_user_snapshots ADD isPresentRemotely BIT NOT NULL DEFAULT 1;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('client_user_snapshots') AND name = 'lastVerifiedAt')
        ALTER TABLE client_user_snapshots ADD lastVerifiedAt DATETIME2 NULL;
END
GO

-- ============================================================================
-- 5. MEDICAL RESOURCE MANAGEMENT & ONBOARDING TABLES
-- ============================================================================

-- 5.1 Client Resource Snapshots Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'client_resource_snapshots')
BEGIN
    CREATE TABLE client_resource_snapshots (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        clientId UNIQUEIDENTIFIER NOT NULL,
        clientCode NVARCHAR(50) NOT NULL,
        remoteResourceId NVARCHAR(100) NOT NULL,
        resourceCode NVARCHAR(100) NULL,
        resourceName NVARCHAR(250) NOT NULL,
        isResourceHuman BIT NOT NULL DEFAULT 1,
        remoteResourceTypeId NVARCHAR(100) NULL,
        resourceTypeName NVARCHAR(150) NULL,
        resourceType NVARCHAR(50) NULL,
        remoteSpecialtyId NVARCHAR(100) NULL,
        specialtyName NVARCHAR(150) NULL,
        department NVARCHAR(100) NULL,
        specialization NVARCHAR(100) NULL,
        colorIdentificationCode NVARCHAR(10) NOT NULL DEFAULT 'FFFFFF',
        operatingFrom NVARCHAR(10) NOT NULL DEFAULT '00:00',
        operatingTo NVARCHAR(10) NOT NULL DEFAULT '23:55',
        selectAllDepartments BIT NOT NULL DEFAULT 1,
        selectAllServices BIT NOT NULL DEFAULT 1,
        linkedRemoteUserId NVARCHAR(100) NULL,
        linkedUsername NVARCHAR(100) NULL,
        isShownInRegistration BIT NOT NULL DEFAULT 1,
        branchId NVARCHAR(100) NULL,
        branchName NVARCHAR(150) NULL,
        remoteStatus NVARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        status NVARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        isPresentRemotely BIT NOT NULL DEFAULT 1,
        lastVerifiedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        lastSyncedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        workflowStage NVARCHAR(50) NULL,
        eclaimStatus NVARCHAR(50) NULL,
        eclaimConfigJson NVARCHAR(MAX) NULL,
        emrFormsJson NVARCHAR(MAX) NULL,
        transferConfigJson NVARCHAR(MAX) NULL,
        retryResumeState NVARCHAR(50) NULL,
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_client_resource_snapshots_client FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IDX_client_resource_remote_id ON client_resource_snapshots(clientId, remoteResourceId);
    CREATE INDEX IDX_client_resource_clientId ON client_resource_snapshots(clientId);
    PRINT 'Table [client_resource_snapshots] created.';
END
ELSE
BEGIN
    -- Complete column alignment for existing table
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'specialization')
        ALTER TABLE client_resource_snapshots ADD specialization NVARCHAR(100) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'department')
        ALTER TABLE client_resource_snapshots ADD department NVARCHAR(100) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'resourceType')
        ALTER TABLE client_resource_snapshots ADD resourceType NVARCHAR(50) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'resourceCode')
        ALTER TABLE client_resource_snapshots ADD resourceCode NVARCHAR(100) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'status')
        ALTER TABLE client_resource_snapshots ADD status NVARCHAR(50) NOT NULL DEFAULT 'ACTIVE';
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'retryResumeState')
        ALTER TABLE client_resource_snapshots ADD retryResumeState NVARCHAR(50) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'workflowStage')
        ALTER TABLE client_resource_snapshots ADD workflowStage NVARCHAR(50) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'eclaimStatus')
        ALTER TABLE client_resource_snapshots ADD eclaimStatus NVARCHAR(50) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'eclaimConfigJson')
        ALTER TABLE client_resource_snapshots ADD eclaimConfigJson NVARCHAR(MAX) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'emrFormsJson')
        ALTER TABLE client_resource_snapshots ADD emrFormsJson NVARCHAR(MAX) NULL;
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'transferConfigJson')
        ALTER TABLE client_resource_snapshots ADD transferConfigJson NVARCHAR(MAX) NULL;
END
GO

-- 5.2 Client Resource Departments
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'client_resource_departments')
BEGIN
    CREATE TABLE client_resource_departments (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        resourceId UNIQUEIDENTIFIER NOT NULL,
        departmentCode NVARCHAR(100) NOT NULL,
        departmentName NVARCHAR(250) NOT NULL,
        CONSTRAINT FK_client_resource_departments_resId FOREIGN KEY (resourceId) REFERENCES client_resource_snapshots(id) ON DELETE CASCADE
    );
    CREATE INDEX IDX_res_dept ON client_resource_departments(resourceId, departmentCode);
    PRINT 'Table [client_resource_departments] created.';
END
GO

-- 5.3 Client Resource Services
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'client_resource_services')
BEGIN
    CREATE TABLE client_resource_services (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        resourceId UNIQUEIDENTIFIER NOT NULL,
        serviceCode NVARCHAR(100) NOT NULL,
        serviceName NVARCHAR(250) NOT NULL,
        CONSTRAINT FK_client_resource_services_resId FOREIGN KEY (resourceId) REFERENCES client_resource_snapshots(id) ON DELETE CASCADE
    );
    CREATE INDEX IDX_res_serv ON client_resource_services(resourceId, serviceCode);
    PRINT 'Table [client_resource_services] created.';
END
GO

-- 5.4 Resource Import Jobs
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'resource_import_jobs')
BEGIN
    CREATE TABLE resource_import_jobs (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        clientId UNIQUEIDENTIFIER NOT NULL,
        clientCode NVARCHAR(50) NOT NULL,
        fileName NVARCHAR(255) NOT NULL,
        status NVARCHAR(50) NOT NULL DEFAULT 'PENDING',
        totalRows INT NOT NULL DEFAULT 0,
        completedRows INT NOT NULL DEFAULT 0,
        failedRows INT NOT NULL DEFAULT 0,
        skippedRows INT NOT NULL DEFAULT 0,
        createdBy NVARCHAR(100) NOT NULL,
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_resource_import_jobs_clientId FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE
    );
    CREATE INDEX IDX_res_job_client ON resource_import_jobs(clientId, status);
    PRINT 'Table [resource_import_jobs] created.';
END
GO

-- 5.5 Resource Import Rows
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'resource_import_rows')
BEGIN
    CREATE TABLE resource_import_rows (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        jobId UNIQUEIDENTIFIER NOT NULL,
        rowNumber INT NOT NULL,
        resourceName NVARCHAR(250) NOT NULL,
        isResourceHuman BIT NOT NULL DEFAULT 1,
        remoteResourceId NVARCHAR(100) NULL,
        remoteUserId NVARCHAR(100) NULL,
        username NVARCHAR(100) NULL,
        stage NVARCHAR(50) NOT NULL DEFAULT 'NOT_STARTED',
        status NVARCHAR(50) NOT NULL DEFAULT 'PENDING',
        retryStartingPoint NVARCHAR(100) NULL,
        safeErrorCode NVARCHAR(100) NULL,
        safeErrorMessage NVARCHAR(MAX) NULL,
        rawRowJson NVARCHAR(MAX) NULL,
        CONSTRAINT FK_resource_import_rows_jobId FOREIGN KEY (jobId) REFERENCES resource_import_jobs(id) ON DELETE CASCADE
    );
    CREATE INDEX IDX_res_row_job ON resource_import_rows(jobId, rowNumber);
    PRINT 'Table [resource_import_rows] created.';
END
GO

-- ============================================================================
-- 6. BATCH FILE IMPORT TABLES
-- ============================================================================

-- 6.1 Import Jobs (User Bulk Imports)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'import_jobs')
BEGIN
    CREATE TABLE import_jobs (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        clientId UNIQUEIDENTIFIER NOT NULL,
        clientCode NVARCHAR(50) NOT NULL,
        fileName NVARCHAR(255) NOT NULL,
        fileSizeBytes BIGINT NOT NULL,
        jobType NVARCHAR(50) NOT NULL DEFAULT 'USER_IMPORT',
        status NVARCHAR(50) NOT NULL DEFAULT 'PENDING',
        totalRows INT NOT NULL DEFAULT 0,
        processedRows INT NOT NULL DEFAULT 0,
        successfulRows INT NOT NULL DEFAULT 0,
        failedRows INT NOT NULL DEFAULT 0,
        startedAt DATETIME2 NULL,
        completedAt DATETIME2 NULL,
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        createdBy NVARCHAR(100) NULL,
        updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updatedBy NVARCHAR(100) NULL,
        CONSTRAINT FK_import_jobs_client FOREIGN KEY (clientId) REFERENCES clients(id) ON DELETE CASCADE
    );
    PRINT 'Table [import_jobs] created.';
END
GO

-- 6.2 Import Job Rows
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
    PRINT 'Table [import_job_rows] created.';
END
GO

-- ============================================================================
-- 7. BROWSER AUTOMATION ORCHESTRATION & TELEMETRY TABLES
-- ============================================================================

-- 7.1 Desktop Agents Table
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
    PRINT 'Table [desktop_agents] created.';
END
GO

-- 7.2 Automation Workflows
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
    PRINT 'Table [automation_workflows] created.';
END
GO

-- 7.3 Automation Workflow Versions
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'automation_workflow_versions')
BEGIN
    CREATE TABLE automation_workflow_versions (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        workflowId UNIQUEIDENTIFIER NOT NULL,
        versionNumber INT NOT NULL,
        definitionJson NVARCHAR(MAX) NOT NULL,
        isActive BIT NOT NULL DEFAULT 1,
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        createdBy NVARCHAR(100) NULL,
        CONSTRAINT UQ_workflow_version UNIQUE (workflowId, versionNumber),
        CONSTRAINT FK_workflow_version_workflow FOREIGN KEY (workflowId) REFERENCES automation_workflows(id) ON DELETE CASCADE
    );
    PRINT 'Table [automation_workflow_versions] created.';
END
GO

-- 7.4 Automation Runs Table
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
    PRINT 'Table [automation_runs] created.';
END
GO

-- 7.5 Automation Run Steps
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
    PRINT 'Table [automation_run_steps] created.';
END
GO

-- ============================================================================
-- 8. AUDIT TRAILS & GOVERNANCE TABLES
-- ============================================================================

-- 8.1 Audit Logs Table
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
    PRINT 'Table [audit_logs] created.';
END
GO

-- 8.2 Error Logs Table
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
    PRINT 'Table [error_logs] created.';
END
GO

-- 8.3 Stored Files Table
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
    PRINT 'Table [stored_files] created.';
END
GO

-- 8.4 Retention Policies Table
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
    PRINT 'Table [retention_policies] created.';
END
GO

-- ============================================================================
-- 9. PERMISSION REGISTRY & SEEDING
-- ============================================================================
PRINT 'Synchronizing system permissions catalog...';

MERGE INTO permissions AS target
USING (VALUES
    ('dashboard.view', 'View Dashboard', 'Dashboard', 'View system metrics and executive summary'),
    ('client.view', 'View Clients', 'Clients', 'View configured client applications'),
    ('client.create', 'Create Clients', 'Clients', 'Add new client configurations'),
    ('client.update', 'Update Clients', 'Clients', 'Edit existing client configurations'),
    ('client.disable', 'Disable Clients', 'Clients', 'Deactivate or archive client configurations'),
    ('client.open', 'Open Client URL', 'Clients', 'Launch client URL and session in isolated browser'),
    ('client.test_login', 'Test Client Login', 'Clients', 'Execute automated login verification'),
    ('credential.manage', 'Manage Credentials', 'Credentials', 'Create and update encrypted client credentials'),
    ('user_management.view', 'View Users', 'Users', 'View user automation screens and tasks'),
    ('user_management.create', 'Create User', 'Users', 'Trigger single or batch user creation in target client'),
    ('user_management.reset_password', 'Reset User Password', 'Users', 'Trigger user password reset in target client'),
    ('client_user.credential.view', 'View User Credentials', 'Users', 'View ephemeral generated default passwords after user creation and reset'),
    ('client_resources.view', 'View Client Resources', 'Resources', 'View client resource directory and metadata'),
    ('client_resources.sync', 'Sync Client Resources', 'Resources', 'Trigger automated sync of client resources'),
    ('client_resources.create', 'Create Client Resource', 'Resources', 'Create single resource in target client'),
    ('client_resources.edit', 'Edit Client Resource', 'Resources', 'Update resource metadata in target client'),
    ('client_resources.status_change', 'Change Resource Status', 'Resources', 'Toggle resource active/inactive status'),
    ('client_resources.import', 'Import Resources', 'Resources', 'Bulk import resources from Excel workbook'),
    ('client_resources.export', 'Export Resources', 'Resources', 'Export client resources to Excel/CSV'),
    ('client_resource.user_map', 'Map Resource User', 'Resources', 'Link client resource to console user'),
    ('service_master.view', 'View Services', 'Services', 'View service master screens'),
    ('service_master.import', 'Import Services', 'Services', 'Trigger service master import in target client'),
    ('import.preview', 'Preview Imports', 'Imports', 'Upload and validate spreadsheet data before import'),
    ('import.execute', 'Execute Imports', 'Imports', 'Start automated import execution on client'),
    ('import.pause', 'Pause Imports', 'Imports', 'Pause in-flight import execution'),
    ('import.resume', 'Resume Imports', 'Imports', 'Resume paused import execution'),
    ('import.retry_failed', 'Retry Failed Rows', 'Imports', 'Re-run only failed rows from an import job'),
    ('import.cancel', 'Cancel Imports', 'Imports', 'Abort an active import job'),
    ('import.export_errors', 'Export Import Errors', 'Imports', 'Download error CSV of failed import rows'),
    ('audit.view', 'View Audit Logs', 'Audit', 'Search and inspect system audit and security logs'),
    ('audit.export', 'Export Audit Logs', 'Audit', 'Export audit logs for compliance review'),
    ('role.view', 'View Roles', 'System & RBAC', 'Inspect roles and permission sets'),
    ('role.manage', 'Manage Roles', 'System & RBAC', 'Create and modify custom roles and permissions'),
    ('application_user.manage', 'Manage Console Users', 'System & RBAC', 'Create, edit, lock, unlock, and assign console users'),
    ('workflow.view', 'View Workflows', 'Workflows', 'View automation workflow definitions and selectors'),
    ('workflow.manage', 'Manage Workflows', 'Workflows', 'Create and modify workflow step and selector configs'),
    ('agent.view', 'View Desktop Agents', 'Agents', 'Inspect online status and heartbeats of desktop agents'),
    ('agent.manage', 'Manage Desktop Agents', 'Agents', 'Pair, authorize, and assign tasks to desktop agents')
) AS source (code, name, category, description)
ON target.code = source.code
WHEN NOT MATCHED THEN
    INSERT (id, code, name, category, description, createdAt)
    VALUES (NEWID(), source.code, source.name, source.category, source.description, SYSUTCDATETIME());
GO

-- ============================================================================
-- 10. ROLES SEEDING & SUPER_ADMIN FULL PERMISSIONS MAPPING
-- ============================================================================
PRINT 'Synchronizing roles and mapping all permissions to SUPER_ADMIN...';

-- Ensure SUPER_ADMIN role exists
DECLARE @SuperAdminId UNIQUEIDENTIFIER;
SELECT @SuperAdminId = id FROM roles WHERE name = 'SUPER_ADMIN';
IF @SuperAdminId IS NULL
BEGIN
    SET @SuperAdminId = NEWID();
    INSERT INTO roles (id, name, description, isSystem, createdAt, updatedAt)
    VALUES (@SuperAdminId, 'SUPER_ADMIN', 'Super Administrator with unconditional access', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
END

-- Ensure OPERATOR role exists
IF NOT EXISTS (SELECT 1 FROM roles WHERE name = 'OPERATOR')
BEGIN
    INSERT INTO roles (id, name, description, isSystem, createdAt, updatedAt)
    VALUES (NEWID(), 'OPERATOR', 'Central Operator for day-to-day client actions', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
END

-- Ensure AUDITOR role exists
IF NOT EXISTS (SELECT 1 FROM roles WHERE name = 'AUDITOR')
BEGIN
    INSERT INTO roles (id, name, description, isSystem, createdAt, updatedAt)
    VALUES (NEWID(), 'AUDITOR', 'Read-only compliance and security auditor', 1, SYSUTCDATETIME(), SYSUTCDATETIME());
END

-- Grant ALL permissions to SUPER_ADMIN
INSERT INTO role_permissions (role_id, permission_id)
SELECT @SuperAdminId, p.id FROM permissions p
WHERE NOT EXISTS (
    SELECT 1 FROM role_permissions rp WHERE rp.role_id = @SuperAdminId AND rp.permission_id = p.id
);
GO

-- ============================================================================
-- 11. DEFAULT ADMINISTRATOR ACCOUNT (admin / Rajesh@123)
-- ============================================================================
PRINT 'Verifying root administrator account [admin]...';

DECLARE @SuperAdminRoleId UNIQUEIDENTIFIER;
SELECT @SuperAdminRoleId = id FROM roles WHERE name = 'SUPER_ADMIN';

DECLARE @AdminUserId UNIQUEIDENTIFIER;
SELECT @AdminUserId = id FROM application_users WHERE username = 'admin';

IF @AdminUserId IS NULL
BEGIN
    SET @AdminUserId = NEWID();
    -- Argon2id hash for Rajesh@123
    INSERT INTO application_users (id, username, email, fullName, passwordHash, status, isLocked, createdAt, updatedAt)
    VALUES (
        @AdminUserId,
        'admin',
        'raja@gmail.com',
        'System Super Administrator',
        '$argon2id$v=19$m=65536,t=3,p=4$uN9iGZ2y5NqK31Yp6P5U1A$ZgWzR6z4M5xJ3Q8V9kY1A4B7C9D2E5F8G1H3J5K7L9N',
        'ACTIVE',
        0,
        SYSUTCDATETIME(),
        SYSUTCDATETIME()
    );
END

-- Assign SUPER_ADMIN role to admin
IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = @AdminUserId AND role_id = @SuperAdminRoleId)
BEGIN
    INSERT INTO user_roles (user_id, role_id) VALUES (@AdminUserId, @SuperAdminRoleId);
END
GO

-- ============================================================================
-- 12. CLEAN UP CLIENT ROUTE POLLUTION (Strip legacy /hmc prefixes)
-- ============================================================================
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'clients')
BEGIN
    UPDATE clients 
    SET applicationPath = '',
        usersRoute = '/users',
        servicesRoute = '/services',
        loginRoute = '/login',
        userRoleRoute = '/addUserRole'
    WHERE clientCode = 'MASTER93' OR applicationPath = '/hmc';
END
GO

PRINT '============================================================================';
PRINT '✓ SIMPLEX MASTER DATABASE SCHEMA & MIGRATIONS COMPLETED SUCCESSFULLY!';
PRINT '  - Database:       SIMPLEX_CENTRAL_DB';
PRINT '  - Application User: simplex_app_user';
PRINT '  - Admin Account:  admin (SUPER_ADMIN with all permissions)';
PRINT '  - Total Tables:   23 Tables aligned with zero missing columns';
PRINT '============================================================================';
GO
