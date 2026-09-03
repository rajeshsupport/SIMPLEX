export type DesktopAgentStatus = 'ONLINE' | 'OFFLINE' | 'BUSY';

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
  createdAt: string;
  updatedAt: string;
}

export interface AgentHeartbeatPayload {
  agentId: string;
  machineHostname: string;
  osInfo: string;
  status: DesktopAgentStatus;
  activeRunId?: string | null;
  systemMetrics?: {
    cpuPercent?: number;
    memoryFreeMb?: number;
  };
}

export interface AgentTaskAssignment {
  runId: string;
  taskType:
    | 'INTERACTIVE_LOGIN'
    | 'TEST_LOGIN'
    | 'SYNC_CLIENT_USERS'
    | 'CREATE_CLIENT_USER'
    | 'EDIT_CLIENT_USER'
    | 'SET_CLIENT_USER_STATUS'
    | 'RESET_CLIENT_USER_PASSWORD'
    | 'BULK_IMPORT_CLIENT_USERS'
    | 'CREATE_USER'
    | 'RESET_PASSWORD'
    | 'CREATE_SERVICE'
    | 'BULK_IMPORT';
  clientId: string;
  clientBaseUrl: string;
  clientAppPath: string;
  loginRoute: string;
  targetRoute?: string;
  workflowVersion: any;
  payload: Record<string, any>;
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
