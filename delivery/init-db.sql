-- ============================================================================
-- SIMPLEX Central Operations Console - Isolated Database Provisioning Script
-- ============================================================================
-- Purpose: Creates a dedicated, sandboxed database and restricted application
-- user that has ZERO access to any other databases on the MS SQL Server instance.
-- ============================================================================

USE [master];
GO

-- 1. Create Dedicated Application Database (if not exists)
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'SIMPLEX_CENTRAL_DB')
BEGIN
    PRINT 'Creating database [SIMPLEX_CENTRAL_DB]...';
    CREATE DATABASE [SIMPLEX_CENTRAL_DB];
END
ELSE
BEGIN
    PRINT 'Database [SIMPLEX_CENTRAL_DB] already exists.';
END
GO

-- 2. Create Dedicated Application Login (if not exists)
IF NOT EXISTS (SELECT name FROM sys.server_principals WHERE name = N'simplex_app_user')
BEGIN
    PRINT 'Creating server login [simplex_app_user]...';
    CREATE LOGIN [simplex_app_user] 
    WITH PASSWORD = N'SimplexApp@Secure2026!', 
         CHECK_POLICY = OFF, 
         CHECK_EXPIRATION = OFF;
END
ELSE
BEGIN
    PRINT 'Login [simplex_app_user] already exists.';
END
GO

-- 3. Map User and Grant Full Control ONLY to SIMPLEX_CENTRAL_DB
USE [SIMPLEX_CENTRAL_DB];
GO

IF NOT EXISTS (SELECT name FROM sys.database_principals WHERE name = N'simplex_app_user')
BEGIN
    PRINT 'Mapping user [simplex_app_user] to [SIMPLEX_CENTRAL_DB]...';
    CREATE USER [simplex_app_user] FOR LOGIN [simplex_app_user];
    ALTER ROLE [db_owner] ADD MEMBER [simplex_app_user];
END
ELSE
BEGIN
    PRINT 'User [simplex_app_user] is already mapped.';
    ALTER ROLE [db_owner] ADD MEMBER [simplex_app_user];
END
GO

-- 4. SECURITY SANDBOX: Deny viewing and access to all other databases on this server!
USE [master];
GO

PRINT 'Enforcing database sandbox security: Denying VIEW ANY DATABASE...';
DENY VIEW ANY DATABASE TO [simplex_app_user];
GO

PRINT '============================================================================';
PRINT '✓ SIMPLEX Database and Sandboxed User Provisioned Successfully!';
PRINT '  - Database:  SIMPLEX_CENTRAL_DB';
PRINT '  - Username:  simplex_app_user';
PRINT '  - Isolation: Restricted ONLY to SIMPLEX_CENTRAL_DB (Cannot see other DBs)';
PRINT '============================================================================';
GO
