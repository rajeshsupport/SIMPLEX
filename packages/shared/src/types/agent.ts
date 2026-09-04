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

export interface AgentTaskAssignment {
  runId: string;
  taskType:
    | 'OPEN_INTERACTIVE_CLIENT_SESSION'
    | 'SYNC_CLIENT_USERS_HEADLESS'
    | 'INTERACTIVE_LOGIN'
    | 'TEST_LOGIN'
    | 'SYNC_CLIENT_USERS'
    | 'CREATE_CLIENT_USER'
    | 'EDIT_CLIENT_USER'
    | 'EDIT_AND_UPDATE_CLIENT'
    | 'SET_CLIENT_USER_STATUS'
    | 'CHANGE_CLIENT_USER_STATUS'
    | 'RESET_CLIENT_USER_PASSWORD'
    | 'BULK_IMPORT_CLIENT_USERS'
    | 'INSPECT_CREATE_FORM_METADATA'
    | 'INSPECT_FORM_OPTIONS'
    | 'CREATE_USER'
    | 'RESET_PASSWORD'
    | 'CREATE_SERVICE'
    | 'BULK_IMPORT';
  clientId: string;
  clientBaseUrl: string;
  clientAppPath: string;
  loginRoute: string;
  targetRoute?: string;
  addUsersRoute?: string;
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
