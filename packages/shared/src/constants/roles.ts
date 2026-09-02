import { PERMISSIONS, PermissionCode } from './permissions.js';

export const SYSTEM_ROLES = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  USER_ADMINISTRATOR: 'User Administrator',
  IMPORT_OPERATOR: 'Import Operator',
  URL_OPERATOR: 'URL Operator',
  AUDITOR: 'Auditor',
  VIEWER: 'Viewer',
} as const;

export type SystemRoleName = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

export interface DefaultRoleDefinition {
  name: SystemRoleName;
  description: string;
  isSystem: boolean;
  permissions: PermissionCode[];
}

export const DEFAULT_ROLES: DefaultRoleDefinition[] = [
  {
    name: SYSTEM_ROLES.SUPER_ADMIN,
    description: 'Super Administrator with unrestricted access to all operations, security configurations, and clients',
    isSystem: true,
    permissions: Object.values(PERMISSIONS),
  },
  {
    name: SYSTEM_ROLES.ADMIN,
    description: 'Full administrative access excluding master credential deletion and root security policy modifications',
    isSystem: true,
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.CLIENT_VIEW,
      PERMISSIONS.CLIENT_CREATE,
      PERMISSIONS.CLIENT_UPDATE,
      PERMISSIONS.CLIENT_DISABLE,
      PERMISSIONS.CLIENT_OPEN,
      PERMISSIONS.CLIENT_TEST_LOGIN,
      PERMISSIONS.CREDENTIAL_MANAGE,
      PERMISSIONS.USER_MANAGEMENT_VIEW,
      PERMISSIONS.USER_MANAGEMENT_CREATE,
      PERMISSIONS.USER_MANAGEMENT_RESET_PASSWORD,
      PERMISSIONS.SERVICE_MASTER_VIEW,
      PERMISSIONS.SERVICE_MASTER_IMPORT,
      PERMISSIONS.IMPORT_PREVIEW,
      PERMISSIONS.IMPORT_EXECUTE,
      PERMISSIONS.IMPORT_PAUSE,
      PERMISSIONS.IMPORT_RESUME,
      PERMISSIONS.IMPORT_RETRY_FAILED,
      PERMISSIONS.IMPORT_CANCEL,
      PERMISSIONS.IMPORT_EXPORT_ERRORS,
      PERMISSIONS.AUDIT_VIEW,
      PERMISSIONS.AUDIT_EXPORT,
      PERMISSIONS.ROLE_VIEW,
      PERMISSIONS.APPLICATION_USER_MANAGE,
      PERMISSIONS.WORKFLOW_VIEW,
      PERMISSIONS.WORKFLOW_MANAGE,
      PERMISSIONS.AGENT_VIEW,
      PERMISSIONS.AGENT_MANAGE,
    ],
  },
  {
    name: SYSTEM_ROLES.USER_ADMINISTRATOR,
    description: 'Specialized in user account lifecycle automation (User creation, password resets)',
    isSystem: true,
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.CLIENT_VIEW,
      PERMISSIONS.CLIENT_OPEN,
      PERMISSIONS.USER_MANAGEMENT_VIEW,
      PERMISSIONS.USER_MANAGEMENT_CREATE,
      PERMISSIONS.USER_MANAGEMENT_RESET_PASSWORD,
      PERMISSIONS.IMPORT_PREVIEW,
      PERMISSIONS.IMPORT_EXECUTE,
      PERMISSIONS.IMPORT_RETRY_FAILED,
      PERMISSIONS.AUDIT_VIEW,
    ],
  },
  {
    name: SYSTEM_ROLES.IMPORT_OPERATOR,
    description: 'Operator specialized in uploading, validating, executing, and reviewing batch spreadsheet imports',
    isSystem: true,
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.CLIENT_VIEW,
      PERMISSIONS.SERVICE_MASTER_VIEW,
      PERMISSIONS.SERVICE_MASTER_IMPORT,
      PERMISSIONS.IMPORT_PREVIEW,
      PERMISSIONS.IMPORT_EXECUTE,
      PERMISSIONS.IMPORT_PAUSE,
      PERMISSIONS.IMPORT_RESUME,
      PERMISSIONS.IMPORT_RETRY_FAILED,
      PERMISSIONS.IMPORT_CANCEL,
      PERMISSIONS.IMPORT_EXPORT_ERRORS,
      PERMISSIONS.AUDIT_VIEW,
    ],
  },
  {
    name: SYSTEM_ROLES.URL_OPERATOR,
    description: 'Operator authorized to open client URLs in isolated browser sessions and verify connectivity',
    isSystem: true,
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.CLIENT_VIEW,
      PERMISSIONS.CLIENT_OPEN,
      PERMISSIONS.CLIENT_TEST_LOGIN,
    ],
  },
  {
    name: SYSTEM_ROLES.AUDITOR,
    description: 'Compliance auditor with read-only access to audit logs, history, and exports',
    isSystem: true,
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.CLIENT_VIEW,
      PERMISSIONS.AUDIT_VIEW,
      PERMISSIONS.AUDIT_EXPORT,
      PERMISSIONS.ROLE_VIEW,
      PERMISSIONS.WORKFLOW_VIEW,
      PERMISSIONS.AGENT_VIEW,
    ],
  },
  {
    name: SYSTEM_ROLES.VIEWER,
    description: 'General read-only observer across clients and dashboard',
    isSystem: true,
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.CLIENT_VIEW,
      PERMISSIONS.USER_MANAGEMENT_VIEW,
      PERMISSIONS.SERVICE_MASTER_VIEW,
    ],
  },
];
