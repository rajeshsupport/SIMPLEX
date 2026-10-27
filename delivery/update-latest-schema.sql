-- ============================================================================
-- SIMPLEX CENTRAL OPERATIONS CONSOLE - IDEMPOTENT DATABASE MIGRATION SCRIPT
-- ============================================================================
-- Target Database: SIMPLEX_CENTRAL_DB
-- Safe execution: 100% idempotent. Can be executed multiple times safely.
-- Existing customer data, client registrations, and credentials remain untouched.
-- ============================================================================

USE [SIMPLEX_CENTRAL_DB];
GO

PRINT 'Starting SIMPLEX Central Operations Console database migration...';
GO

-- ============================================================================
-- 1. UPDATE [client_user_snapshots] COLUMNS
-- ============================================================================
PRINT 'Checking client_user_snapshots columns...';

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_user_snapshots') AND name = 'isBillCounterMapped')
    ALTER TABLE client_user_snapshots ADD isBillCounterMapped BIT NOT NULL DEFAULT 0;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_user_snapshots') AND name = 'billCounterName')
    ALTER TABLE client_user_snapshots ADD billCounterName NVARCHAR(150) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_user_snapshots') AND name = 'isStockLocationMapped')
    ALTER TABLE client_user_snapshots ADD isStockLocationMapped BIT NOT NULL DEFAULT 0;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_user_snapshots') AND name = 'stockLocationNames')
    ALTER TABLE client_user_snapshots ADD stockLocationNames NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_user_snapshots') AND name = 'stockLocationCount')
    ALTER TABLE client_user_snapshots ADD stockLocationCount INT NOT NULL DEFAULT 0;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_user_snapshots') AND name = 'isDocumentTypeMapped')
    ALTER TABLE client_user_snapshots ADD isDocumentTypeMapped BIT NOT NULL DEFAULT 0;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_user_snapshots') AND name = 'documentTypeNames')
    ALTER TABLE client_user_snapshots ADD documentTypeNames NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_user_snapshots') AND name = 'documentTypeCount')
    ALTER TABLE client_user_snapshots ADD documentTypeCount INT NOT NULL DEFAULT 0;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_user_snapshots') AND name = 'isFormAssemblyMapped')
    ALTER TABLE client_user_snapshots ADD isFormAssemblyMapped BIT NOT NULL DEFAULT 0;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_user_snapshots') AND name = 'formAssemblyNames')
    ALTER TABLE client_user_snapshots ADD formAssemblyNames NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_user_snapshots') AND name = 'formAssemblyCount')
    ALTER TABLE client_user_snapshots ADD formAssemblyCount INT NOT NULL DEFAULT 0;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_user_snapshots') AND name = 'syncRunId')
    ALTER TABLE client_user_snapshots ADD syncRunId NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_user_snapshots') AND name = 'isPresentRemotely')
    ALTER TABLE client_user_snapshots ADD isPresentRemotely BIT NOT NULL DEFAULT 1;
GO

-- ============================================================================
-- 2. UPDATE [client_resource_snapshots] COLUMNS
-- ============================================================================
PRINT 'Checking client_resource_snapshots columns...';

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'branchId')
    ALTER TABLE client_resource_snapshots ADD branchId NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'branchName')
    ALTER TABLE client_resource_snapshots ADD branchName NVARCHAR(150) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'retryResumeState')
    ALTER TABLE client_resource_snapshots ADD retryResumeState NVARCHAR(50) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'workflowStage')
    ALTER TABLE client_resource_snapshots ADD workflowStage NVARCHAR(50) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'eclaimStatus')
    ALTER TABLE client_resource_snapshots ADD eclaimStatus NVARCHAR(50) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'eclaimConfigJson')
    ALTER TABLE client_resource_snapshots ADD eclaimConfigJson NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'emrFormsJson')
    ALTER TABLE client_resource_snapshots ADD emrFormsJson NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'transferConfigJson')
    ALTER TABLE client_resource_snapshots ADD transferConfigJson NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'resourceCode')
    ALTER TABLE client_resource_snapshots ADD resourceCode NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'specialization')
    ALTER TABLE client_resource_snapshots ADD specialization NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'department')
    ALTER TABLE client_resource_snapshots ADD department NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('client_resource_snapshots') AND name = 'resourceType')
    ALTER TABLE client_resource_snapshots ADD resourceType NVARCHAR(50) NULL;
GO

-- ============================================================================
-- 2.1 UPDATE [clients] & [automation_runs] COLUMNS (If missing)
-- ============================================================================
PRINT 'Checking clients and automation_runs columns...';

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('clients') AND name = 'userRoleRoute')
    ALTER TABLE clients ADD userRoleRoute NVARCHAR(255) NULL DEFAULT '/addUserRole';

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('clients') AND name = 'quickResourceRoute')
    ALTER TABLE clients ADD quickResourceRoute NVARCHAR(255) NULL DEFAULT '/addResourceParentDetails';

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('clients') AND name = 'resourceUserRoute')
    ALTER TABLE clients ADD resourceUserRoute NVARCHAR(255) NULL DEFAULT '/addParentResourceUser';

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('clients') AND name = 'resourceDirectoryRoute')
    ALTER TABLE clients ADD resourceDirectoryRoute NVARCHAR(255) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('clients') AND name = 'branchName')
    ALTER TABLE clients ADD branchName NVARCHAR(255) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('clients') AND name = 'branchesJson')
    ALTER TABLE clients ADD branchesJson NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('automation_runs') AND name = 'importJobId')
    ALTER TABLE automation_runs ADD importJobId NVARCHAR(100) NULL;
GO

-- ============================================================================
-- 3. CREATE TABLE: [client_bill_counter_mappings]
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'client_bill_counter_mappings')
BEGIN
    PRINT 'Creating table [client_bill_counter_mappings]...';
    CREATE TABLE client_bill_counter_mappings (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        clientId UNIQUEIDENTIFIER NOT NULL,
        billCounterName NVARCHAR(150) NOT NULL,
        userName NVARCHAR(250) NOT NULL,
        normalizedUserName NVARCHAR(250) NULL,
        role NVARCHAR(150) NULL,
        status NVARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        lastSyncedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_client_bill_counter_mappings_client_user ON client_bill_counter_mappings (clientId, userName);
END
GO

-- ============================================================================
-- 4. CREATE TABLE: [client_stock_location_mappings]
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'client_stock_location_mappings')
BEGIN
    PRINT 'Creating table [client_stock_location_mappings]...';
    CREATE TABLE client_stock_location_mappings (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        clientId UNIQUEIDENTIFIER NOT NULL,
        stockLocationName NVARCHAR(250) NOT NULL,
        stockLocationId NVARCHAR(50) NULL,
        userName NVARCHAR(250) NOT NULL,
        loginUsername NVARCHAR(100) NULL,
        normalizedUserName NVARCHAR(250) NULL,
        status NVARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        lastSyncedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_client_stock_location_mappings_client_loc ON client_stock_location_mappings (clientId, stockLocationName);
    CREATE INDEX IX_client_stock_location_mappings_client_user ON client_stock_location_mappings (clientId, userName);
    CREATE INDEX IX_client_stock_location_mappings_client_username ON client_stock_location_mappings (clientId, loginUsername);
END
GO

-- ============================================================================
-- 5. CREATE TABLE: [client_document_type_mappings]
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'client_document_type_mappings')
BEGIN
    PRINT 'Creating table [client_document_type_mappings]...';
    CREATE TABLE client_document_type_mappings (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        clientId UNIQUEIDENTIFIER NOT NULL,
        documentTypeId NVARCHAR(50) NOT NULL,
        documentTypeName NVARCHAR(250) NOT NULL,
        userDocGroup NVARCHAR(50) NULL,
        userName NVARCHAR(250) NOT NULL,
        loginUsername NVARCHAR(100) NULL,
        normalizedUserName NVARCHAR(250) NULL,
        status NVARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        lastSyncedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_client_doc_type_mappings_client_doc ON client_document_type_mappings (clientId, documentTypeId);
    CREATE INDEX IX_client_doc_type_mappings_client_user ON client_document_type_mappings (clientId, userName);
    CREATE INDEX IX_client_doc_type_mappings_client_username ON client_document_type_mappings (clientId, loginUsername);
END
GO

-- ============================================================================
-- 6. CREATE TABLE: [client_form_assembly_mappings]
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'client_form_assembly_mappings')
BEGIN
    PRINT 'Creating table [client_form_assembly_mappings]...';
    CREATE TABLE client_form_assembly_mappings (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        clientId UNIQUEIDENTIFIER NOT NULL,
        formId NVARCHAR(50) NOT NULL,
        formName NVARCHAR(250) NOT NULL,
        groupName NVARCHAR(100) NULL,
        userName NVARCHAR(250) NOT NULL,
        loginUsername NVARCHAR(100) NULL,
        normalizedUserName NVARCHAR(250) NULL,
        isDefault BIT NOT NULL DEFAULT 0,
        status NVARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        lastSyncedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        createdAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_client_form_assembly_mappings_client_form ON client_form_assembly_mappings (clientId, formId);
    CREATE INDEX IX_client_form_assembly_mappings_client_user ON client_form_assembly_mappings (clientId, userName);
    CREATE INDEX IX_client_form_assembly_mappings_client_username ON client_form_assembly_mappings (clientId, loginUsername);
END
GO

-- ============================================================================
-- 7. CREATE RESOURCE RELATION TABLES (If missing)
-- ============================================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'client_resource_departments')
BEGIN
    PRINT 'Creating table [client_resource_departments]...';
    CREATE TABLE client_resource_departments (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        resourceId UNIQUEIDENTIFIER NOT NULL,
        departmentCode NVARCHAR(100) NOT NULL,
        departmentName NVARCHAR(250) NOT NULL
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'client_resource_services')
BEGIN
    PRINT 'Creating table [client_resource_services]...';
    CREATE TABLE client_resource_services (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        resourceId UNIQUEIDENTIFIER NOT NULL,
        serviceCode NVARCHAR(100) NOT NULL,
        serviceName NVARCHAR(250) NOT NULL
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'resource_import_jobs')
BEGIN
    PRINT 'Creating table [resource_import_jobs]...';
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
        updatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
END
GO

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'resource_import_rows')
BEGIN
    PRINT 'Creating table [resource_import_rows]...';
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
        rawRowJson NVARCHAR(MAX) NULL
    );
END
GO

-- ============================================================================
-- 8. GRANT APPLICATION USER PERMISSIONS
-- ============================================================================
IF EXISTS (SELECT * FROM sys.database_principals WHERE name = 'simplex_app_user')
BEGIN
    GRANT SELECT, INSERT, UPDATE, DELETE ON client_bill_counter_mappings TO simplex_app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON client_stock_location_mappings TO simplex_app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON client_document_type_mappings TO simplex_app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON client_form_assembly_mappings TO simplex_app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON client_resource_departments TO simplex_app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON client_resource_services TO simplex_app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON resource_import_jobs TO simplex_app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON resource_import_rows TO simplex_app_user;
END
GO

PRINT '============================================================================';
PRINT '✓ SIMPLEX DATABASE MIGRATION APPLIED SUCCESSFULLY!';
PRINT '  All 4 new mapping tables and resource tables are now fully provisioned.';
PRINT '  All client user snapshot columns are up to date.';
PRINT '============================================================================';
GO
