export type DesktopAgentStatus = 'ONLINE' | 'OFFLINE' | 'BUSY';
export type ExecutionMode = 'HEADED_MUTATION' | 'HEADLESS_SYNC';

export interface DesktopAgentSummary {
  id: string;
  agentName: string;
  machineHostname: string;
  osInfo: string;
  assignedUserId: string;
  assignedUsername?: string;
  status: DesktopAgentStatus;
  currentTaskDescription?: string;
  lastHeartbeatAt?: string | null;
  supportsVisibleChromeMutations?: boolean;
  buildCommit?: string;
  buildTimestamp?: string;
  headedMutationVersion?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentHeartbeatPayload {
  agentId: string;
  machineHostname: string;
  osInfo: string;
  status: DesktopAgentStatus;
  activeRunId?: string | null;
  supportsVisibleChromeMutations?: boolean;
  buildCommit?: string;
  buildTimestamp?: string;
  headedMutationVersion?: string;
  supportedTaskTypes?: string[];
  systemMetrics?: {
    cpuPercent?: number;
    memoryFreeMb?: number;
  };
}

export type AgentTaskType =
  // READ-ONLY / HEADLESS (12)
  | 'SYNC_CLIENT_USERS_HEADLESS'
  | 'SYNC_CLIENT_USERS'
  | 'SYNC_CLIENT_RESOURCES_HEADLESS'
  | 'SYNC_CLIENT_RESOURCES'
  | 'SYNC_RESOURCES'
  | 'INSPECT_CREATE_FORM_METADATA'
  | 'INSPECT_FORM_OPTIONS'
  | 'REFRESH_CLIENT_USER_ROLES'
  | 'REFRESH_USER_ASSIGNED_ROLES'
  | 'VERIFY_USER_EXISTS'
  | 'VERIFY_USER_ROLES'
  | 'VERIFY_USER_STATUS'
  // MUTATION / HEADED (28)
  | 'CREATE_CLIENT_USER'
  | 'CREATE_USER'
  | 'PROCESS_USER_FULL_WORKFLOW'
  | 'UPDATE_USER_ROLES'
  | 'MAP_USER_ROLES'
  | 'MAP_CLIENT_USER_ROLES'
  | 'CHANGE_CLIENT_USER_STATUS'
  | 'SET_CLIENT_USER_STATUS'
  | 'RESET_CLIENT_USER_PASSWORD'
  | 'RESET_PASSWORD'
  | 'EDIT_CLIENT_USER'
  | 'EDIT_AND_UPDATE_CLIENT'
  | 'IMPORT_CLIENT_USERS'
  | 'BULK_IMPORT_CLIENT_USERS'
  | 'BULK_IMPORT'
  | 'CREATE_CLIENT_RESOURCE'
  | 'CREATE_RESOURCE'
  | 'EDIT_CLIENT_RESOURCE'
  | 'SET_CLIENT_RESOURCE_STATUS'
  | 'ACTIVATE_RESOURCE'
  | 'DEACTIVATE_RESOURCE'
  | 'MAP_RESOURCE_USER'
  | 'IMPORT_CLIENT_RESOURCES'
  | 'IMPORT_RESOURCES'
  | 'IMPORT_RESOURCES_BATCH'
  | 'PROCESS_RESOURCE_WORKFLOW'
  | 'PROCESS_RESOURCE_ROW_WORKFLOW'
  | 'CREATE_SERVICE'
  // INTERACTIVE (3)
  | 'OPEN_INTERACTIVE_CLIENT_SESSION'
  | 'INTERACTIVE_LOGIN'
  | 'TEST_LOGIN';

export interface AgentTaskAssignment {
  runId: string;
  taskType: AgentTaskType;
  clientId: string;
  clientBaseUrl: string;
  clientAppPath: string;
  loginRoute: string;
  targetRoute?: string;
  addUsersRoute?: string;
  remoteUserId?: string;
  workflowVersion: any;
  payload: Record<string, any>;
  executionMode?: ExecutionMode;
  credentials?: {
    username: string;
    password?: string;
  };
  options?: {
    isHeaded?: boolean;
    leaveBrowserOpen?: boolean;
    slowMoMs?: number;
  };
}

export interface TaskModePolicy {
  namespace: 'mutation' | 'read_only' | 'interactive';
  executionMode: ExecutionMode;
  isHeaded: boolean;
}

export const TASK_MODE_POLICY = {
  // Read-Only / Headless (12)
  SYNC_CLIENT_USERS_HEADLESS: { namespace: 'read_only', executionMode: 'HEADLESS_SYNC', isHeaded: false },
  SYNC_CLIENT_USERS: { namespace: 'read_only', executionMode: 'HEADLESS_SYNC', isHeaded: false },
  SYNC_CLIENT_RESOURCES_HEADLESS: { namespace: 'read_only', executionMode: 'HEADLESS_SYNC', isHeaded: false },
  SYNC_CLIENT_RESOURCES: { namespace: 'read_only', executionMode: 'HEADLESS_SYNC', isHeaded: false },
  SYNC_RESOURCES: { namespace: 'read_only', executionMode: 'HEADLESS_SYNC', isHeaded: false },
  INSPECT_CREATE_FORM_METADATA: { namespace: 'read_only', executionMode: 'HEADLESS_SYNC', isHeaded: false },
  INSPECT_FORM_OPTIONS: { namespace: 'read_only', executionMode: 'HEADLESS_SYNC', isHeaded: false },
  REFRESH_CLIENT_USER_ROLES: { namespace: 'read_only', executionMode: 'HEADLESS_SYNC', isHeaded: false },
  REFRESH_USER_ASSIGNED_ROLES: { namespace: 'read_only', executionMode: 'HEADLESS_SYNC', isHeaded: false },
  VERIFY_USER_EXISTS: { namespace: 'read_only', executionMode: 'HEADLESS_SYNC', isHeaded: false },
  VERIFY_USER_ROLES: { namespace: 'read_only', executionMode: 'HEADLESS_SYNC', isHeaded: false },
  VERIFY_USER_STATUS: { namespace: 'read_only', executionMode: 'HEADLESS_SYNC', isHeaded: false },

  // Mutation / Headed (28)
  CREATE_CLIENT_USER: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  CREATE_USER: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  PROCESS_USER_FULL_WORKFLOW: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  UPDATE_USER_ROLES: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  MAP_USER_ROLES: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  MAP_CLIENT_USER_ROLES: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  CHANGE_CLIENT_USER_STATUS: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  SET_CLIENT_USER_STATUS: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  RESET_CLIENT_USER_PASSWORD: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  RESET_PASSWORD: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  EDIT_CLIENT_USER: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  EDIT_AND_UPDATE_CLIENT: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  IMPORT_CLIENT_USERS: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  BULK_IMPORT_CLIENT_USERS: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  BULK_IMPORT: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  CREATE_CLIENT_RESOURCE: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  CREATE_RESOURCE: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  EDIT_CLIENT_RESOURCE: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  SET_CLIENT_RESOURCE_STATUS: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  ACTIVATE_RESOURCE: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  DEACTIVATE_RESOURCE: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  MAP_RESOURCE_USER: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  IMPORT_CLIENT_RESOURCES: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  IMPORT_RESOURCES: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  IMPORT_RESOURCES_BATCH: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  PROCESS_RESOURCE_WORKFLOW: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  PROCESS_RESOURCE_ROW_WORKFLOW: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },
  CREATE_SERVICE: { namespace: 'mutation', executionMode: 'HEADED_MUTATION', isHeaded: true },

  // Interactive (3)
  OPEN_INTERACTIVE_CLIENT_SESSION: { namespace: 'interactive', executionMode: 'HEADED_MUTATION', isHeaded: true },
  INTERACTIVE_LOGIN: { namespace: 'interactive', executionMode: 'HEADED_MUTATION', isHeaded: true },
  TEST_LOGIN: { namespace: 'interactive', executionMode: 'HEADED_MUTATION', isHeaded: true },
} satisfies Record<AgentTaskType, TaskModePolicy>;

export const READ_ONLY_HEADLESS_TASK_TYPES = [
  'SYNC_CLIENT_USERS_HEADLESS',
  'SYNC_CLIENT_USERS',
  'SYNC_CLIENT_RESOURCES_HEADLESS',
  'SYNC_CLIENT_RESOURCES',
  'SYNC_RESOURCES',
  'INSPECT_CREATE_FORM_METADATA',
  'INSPECT_FORM_OPTIONS',
  'REFRESH_CLIENT_USER_ROLES',
  'REFRESH_USER_ASSIGNED_ROLES',
  'VERIFY_USER_EXISTS',
  'VERIFY_USER_ROLES',
  'VERIFY_USER_STATUS',
] as const;

export const MUTATION_HEADED_TASK_TYPES = [
  'CREATE_CLIENT_USER',
  'CREATE_USER',
  'PROCESS_USER_FULL_WORKFLOW',
  'UPDATE_USER_ROLES',
  'MAP_USER_ROLES',
  'MAP_CLIENT_USER_ROLES',
  'CHANGE_CLIENT_USER_STATUS',
  'SET_CLIENT_USER_STATUS',
  'RESET_CLIENT_USER_PASSWORD',
  'RESET_PASSWORD',
  'EDIT_CLIENT_USER',
  'EDIT_AND_UPDATE_CLIENT',
  'IMPORT_CLIENT_USERS',
  'BULK_IMPORT_CLIENT_USERS',
  'BULK_IMPORT',
  'CREATE_CLIENT_RESOURCE',
  'CREATE_RESOURCE',
  'EDIT_CLIENT_RESOURCE',
  'SET_CLIENT_RESOURCE_STATUS',
  'ACTIVATE_RESOURCE',
  'DEACTIVATE_RESOURCE',
  'MAP_RESOURCE_USER',
  'IMPORT_CLIENT_RESOURCES',
  'IMPORT_RESOURCES',
  'IMPORT_RESOURCES_BATCH',
  'PROCESS_RESOURCE_WORKFLOW',
  'PROCESS_RESOURCE_ROW_WORKFLOW',
  'CREATE_SERVICE',
] as const;

export const INTERACTIVE_TASK_TYPES = [
  'OPEN_INTERACTIVE_CLIENT_SESSION',
  'INTERACTIVE_LOGIN',
  'TEST_LOGIN',
] as const;

export function isMutationTaskType(taskType: string): boolean {
  const policy = (TASK_MODE_POLICY as Record<string, TaskModePolicy>)[taskType];
  return policy?.namespace === 'mutation';
}

export function isReadOnlyTaskType(taskType: string): boolean {
  const policy = (TASK_MODE_POLICY as Record<string, TaskModePolicy>)[taskType];
  return policy?.namespace === 'read_only';
}

export function isInteractiveTaskType(taskType: string): boolean {
  const policy = (TASK_MODE_POLICY as Record<string, TaskModePolicy>)[taskType];
  return policy?.namespace === 'interactive';
}

export function resolveTaskModePolicy(taskType: string, options?: { isHeaded?: boolean }): TaskModePolicy {
  const policy = (TASK_MODE_POLICY as Record<string, TaskModePolicy>)[taskType];
  if (!policy) {
    throw new Error(`UNKNOWN_TASK_MODE_POLICY: Task type '${taskType}' has no defined execution mode policy.`);
  }

  // Mutation and interactive tasks strictly enforce headed visible Chrome; payload or options cannot override
  return {
    namespace: policy.namespace,
    executionMode: policy.executionMode,
    isHeaded: policy.isHeaded,
  };
}
