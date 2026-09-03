export const PERMISSIONS = {
  // Dashboard
  DASHBOARD_VIEW: 'dashboard.view',

  // Client Management
  CLIENT_VIEW: 'client.view',
  CLIENT_CREATE: 'client.create',
  CLIENT_UPDATE: 'client.update',
  CLIENT_DISABLE: 'client.disable',
  CLIENT_OPEN: 'client.open',
  CLIENT_TEST_LOGIN: 'client.test_login',

  // Credential Security
  CREDENTIAL_MANAGE: 'credential.manage',

  // User Management (HMC Client Users)
  USER_MANAGEMENT_VIEW: 'user_management.view',
  USER_MANAGEMENT_CREATE: 'user_management.create',
  USER_MANAGEMENT_RESET_PASSWORD: 'user_management.reset_password',

  // Client Users (Target HMC Central Directory & Management)
  CLIENT_USERS_VIEW: 'client_users.view',
  CLIENT_USERS_SYNC: 'client_users.sync',
  CLIENT_USERS_CREATE: 'client_users.create',
  CLIENT_USERS_EDIT: 'client_users.edit',
  CLIENT_USERS_STATUS_CHANGE: 'client_users.status_change',
  CLIENT_USER_PASSWORD_RESET: 'client_user.password_reset',
  CLIENT_USERS_IMPORT: 'client_users.import',
  CLIENT_USERS_EXPORT: 'client_users.export',
  CLIENT_USERS_VIEW_SIGNATURE: 'client_users.view_signature',
  CLIENT_USERS_VIEW_PROFILE: 'client_users.view_profile',

  // Service Master
  SERVICE_MASTER_VIEW: 'service_master.view',
  SERVICE_MASTER_IMPORT: 'service_master.import',

  // Imports Operations
  IMPORT_PREVIEW: 'import.preview',
  IMPORT_EXECUTE: 'import.execute',
  IMPORT_PAUSE: 'import.pause',
  IMPORT_RESUME: 'import.resume',
  IMPORT_RETRY_FAILED: 'import.retry_failed',
  IMPORT_CANCEL: 'import.cancel',
  IMPORT_EXPORT_ERRORS: 'import.export_errors',

  // Audit and Logging
  AUDIT_VIEW: 'audit.view',
  AUDIT_EXPORT: 'audit.export',

  // RBAC & Application Users (Console)
  ROLE_VIEW: 'role.view',
  ROLE_MANAGE: 'role.manage',
  APPLICATION_USER_MANAGE: 'application_user.manage',

  // Workflow Definitions
  WORKFLOW_VIEW: 'workflow.view',
  WORKFLOW_MANAGE: 'workflow.manage',

  // Desktop Agents
  AGENT_VIEW: 'agent.view',
  AGENT_MANAGE: 'agent.manage',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface PermissionDefinition {
  code: PermissionCode;
  name: string;
  category: 'Dashboard' | 'Clients' | 'Credentials' | 'HMC Users' | 'Services' | 'Imports' | 'Audit' | 'System & RBAC' | 'Workflows' | 'Agents';
  description: string;
}

export const ALL_PERMISSIONS: PermissionDefinition[] = [
  { code: PERMISSIONS.DASHBOARD_VIEW, name: 'View Dashboard', category: 'Dashboard', description: 'View system metrics and executive summary' },
  { code: PERMISSIONS.CLIENT_VIEW, name: 'View Clients', category: 'Clients', description: 'View configured HMC client applications' },
  { code: PERMISSIONS.CLIENT_CREATE, name: 'Create Clients', category: 'Clients', description: 'Add new HMC client configurations' },
  { code: PERMISSIONS.CLIENT_UPDATE, name: 'Update Clients', category: 'Clients', description: 'Edit existing HMC client configurations' },
  { code: PERMISSIONS.CLIENT_DISABLE, name: 'Disable Clients', category: 'Clients', description: 'Deactivate or archive HMC client configurations' },
  { code: PERMISSIONS.CLIENT_OPEN, name: 'Open Client URL', category: 'Clients', description: 'Launch client URL and session in isolated browser' },
  { code: PERMISSIONS.CLIENT_TEST_LOGIN, name: 'Test Client Login', category: 'Clients', description: 'Execute automated login verification' },
  { code: PERMISSIONS.CREDENTIAL_MANAGE, name: 'Manage Credentials', category: 'Credentials', description: 'Create and update encrypted client credentials' },
  { code: PERMISSIONS.USER_MANAGEMENT_VIEW, name: 'View HMC Users', category: 'HMC Users', description: 'View user automation screens and tasks' },
  { code: PERMISSIONS.USER_MANAGEMENT_CREATE, name: 'Create HMC User', category: 'HMC Users', description: 'Trigger single or batch user creation in target HMC' },
  { code: PERMISSIONS.USER_MANAGEMENT_RESET_PASSWORD, name: 'Reset HMC User Password', category: 'HMC Users', description: 'Trigger user password reset in target HMC' },
  { code: PERMISSIONS.SERVICE_MASTER_VIEW, name: 'View Services', category: 'Services', description: 'View service master screens' },
  { code: PERMISSIONS.SERVICE_MASTER_IMPORT, name: 'Import Services', category: 'Services', description: 'Trigger service master import in target HMC' },
  { code: PERMISSIONS.IMPORT_PREVIEW, name: 'Preview Imports', category: 'Imports', description: 'Upload and validate spreadsheet data before import' },
  { code: PERMISSIONS.IMPORT_EXECUTE, name: 'Execute Imports', category: 'Imports', description: 'Start automated import execution on client' },
  { code: PERMISSIONS.IMPORT_PAUSE, name: 'Pause Imports', category: 'Imports', description: 'Pause in-flight import execution' },
  { code: PERMISSIONS.IMPORT_RESUME, name: 'Resume Imports', category: 'Imports', description: 'Resume paused import execution' },
  { code: PERMISSIONS.IMPORT_RETRY_FAILED, name: 'Retry Failed Rows', category: 'Imports', description: 'Re-run only failed rows from an import job' },
  { code: PERMISSIONS.IMPORT_CANCEL, name: 'Cancel Imports', category: 'Imports', description: 'Abort an active import job' },
  { code: PERMISSIONS.IMPORT_EXPORT_ERRORS, name: 'Export Import Errors', category: 'Imports', description: 'Download error CSV of failed import rows' },
  { code: PERMISSIONS.AUDIT_VIEW, name: 'View Audit Logs', category: 'Audit', description: 'Search and inspect system audit and security logs' },
  { code: PERMISSIONS.AUDIT_EXPORT, name: 'Export Audit Logs', category: 'Audit', description: 'Export audit logs for compliance review' },
  { code: PERMISSIONS.ROLE_VIEW, name: 'View Roles', category: 'System & RBAC', description: 'Inspect roles and permission sets' },
  { code: PERMISSIONS.ROLE_MANAGE, name: 'Manage Roles', category: 'System & RBAC', description: 'Create and modify custom roles and permissions' },
  { code: PERMISSIONS.APPLICATION_USER_MANAGE, name: 'Manage Console Users', category: 'System & RBAC', description: 'Create, edit, lock, unlock, and assign console users' },
  { code: PERMISSIONS.WORKFLOW_VIEW, name: 'View Workflows', category: 'Workflows', description: 'View automation workflow definitions and selectors' },
  { code: PERMISSIONS.WORKFLOW_MANAGE, name: 'Manage Workflows', category: 'Workflows', description: 'Create and modify workflow step and selector configs' },
  { code: PERMISSIONS.AGENT_VIEW, name: 'View Desktop Agents', category: 'Agents', description: 'Inspect online status and heartbeats of desktop agents' },
  { code: PERMISSIONS.AGENT_MANAGE, name: 'Manage Desktop Agents', category: 'Agents', description: 'Pair, authorize, and assign tasks to desktop agents' },
];
