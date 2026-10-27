import * as os from 'os';
import {
  AgentHeartbeatPayload,
  AgentTaskAssignment,
  AutomationRunStepTelemetry,
  SyncUserBatchDto,
  SyncUserBatchResponse,
} from '@hmc/shared';

export class AgentClient {
  private apiBaseUrl: string;
  private agentId?: string;
  private agentName: string;
  private token?: string;
  private isPaired: boolean = false;
  private lastUserId?: string;
  private lastSharedSecret?: string;

  constructor(apiBaseUrl?: string, agentName?: string) {
    this.apiBaseUrl = (apiBaseUrl || process.env.API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    this.agentName = agentName || `Agent-${os.hostname()}`;
  }

  public async pair(userId: string, sharedSecret: string): Promise<boolean> {
    this.lastUserId = userId;
    this.lastSharedSecret = sharedSecret;
    try {
      const res = await fetch(`${this.apiBaseUrl}/api/v1/agents/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: this.agentName,
          machineHostname: os.hostname(),
          osInfo: `${os.type()} ${os.release()} (${os.arch()})`,
          userId,
          sharedSecret,
          supportsVisibleChromeMutations: true,
          headedMutationVersion: 'v1.0.0',
          buildCommit: '6d63f04',
          buildTimestamp: new Date().toISOString(),
          supportedTaskTypes: [
            'OPEN_MULTIPLE_TABS_SESSION',
            'OPEN_INTERACTIVE_CLIENT_SESSION',
            'SYNC_CLIENT_USERS_HEADLESS',
            'CREATE_CLIENT_USER',
            'EDIT_CLIENT_USER',
            'CHANGE_CLIENT_USER_STATUS',
            'SET_CLIENT_USER_STATUS',
            'RESET_CLIENT_USER_PASSWORD',
            'CREATE_USER',
            'EDIT_AND_UPDATE_CLIENT',
            'PROCESS_RESOURCE_WORKFLOW',
            'PROCESS_RESOURCE_ROW_WORKFLOW',
            'CREATE_CLIENT_RESOURCE',
            'CREATE_RESOURCE',
            'MAP_RESOURCE_USER',
            'INSPECT_CREATE_FORM_METADATA',
            'INSPECT_FORM_OPTIONS',
          ],
        }),
      });

      if (!res.ok) {
        const err: any = await res.json();
        throw new Error(err.message || 'Pairing failed');
      }

      const data: any = await res.json();
      this.agentId = data.agentId;
      this.token = data.token;
      this.isPaired = true;
      return true;
    } catch (err) {
      console.error('[AGENT_CLIENT] Pairing error:', err);
      return false;
    }
  }

  public async sendHeartbeat(status: 'ONLINE' | 'OFFLINE' | 'BUSY' = 'ONLINE'): Promise<AgentTaskAssignment | null> {
    if (!this.agentId) {
      if (this.lastUserId && this.lastSharedSecret) {
        await this.pair(this.lastUserId, this.lastSharedSecret);
      }
      if (!this.agentId) return null;
    }

    try {
      const payload: AgentHeartbeatPayload = {
        agentId: this.agentId,
        machineHostname: os.hostname(),
        osInfo: `${os.type()} ${os.release()}`,
        status,
        supportsVisibleChromeMutations: true,
        headedMutationVersion: 'v1.0.0',
        buildCommit: '6d63f04',
        buildTimestamp: new Date().toISOString(),
        supportedTaskTypes: [
          'OPEN_MULTIPLE_TABS_SESSION',
          'OPEN_INTERACTIVE_CLIENT_SESSION',
          'SYNC_CLIENT_USERS_HEADLESS',
          'CREATE_CLIENT_USER',
          'EDIT_CLIENT_USER',
          'CHANGE_CLIENT_USER_STATUS',
          'SET_CLIENT_USER_STATUS',
          'RESET_CLIENT_USER_PASSWORD',
          'CREATE_USER',
          'EDIT_AND_UPDATE_CLIENT',
          'PROCESS_RESOURCE_WORKFLOW',
          'PROCESS_RESOURCE_ROW_WORKFLOW',
          'CREATE_CLIENT_RESOURCE',
          'CREATE_RESOURCE',
          'MAP_RESOURCE_USER',
          'INSPECT_CREATE_FORM_METADATA',
          'INSPECT_FORM_OPTIONS',
        ],
        systemMetrics: {
          memoryFreeMb: Math.round(os.freemem() / 1024 / 1024),
        },
      };

      const res = await fetch(`${this.apiBaseUrl}/api/v1/agents/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data: any = await res.json();
        return data.pendingRun || null;
      } else if (res.status === 401 && this.lastUserId && this.lastSharedSecret) {
        await this.pair(this.lastUserId, this.lastSharedSecret);
      }
    } catch (err) {
      // quiet retry
    }
    return null;
  }

  public async sendTelemetry(
    runId: string,
    update: {
      status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'REQUIRES_MANUAL_INTERVENTION';
      errorMessage?: string;
      step?: AutomationRunStepTelemetry;
      totalDurationMs?: number;
      resultData?: any;
    }
  ): Promise<void> {
    try {
      await fetch(`${this.apiBaseUrl}/api/v1/agents/runs/${runId}/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
    } catch (err) {
      console.error('[AGENT_CLIENT] Telemetry dispatch failed:', err);
    }
  }

  public async sendSyncBatch(runId: string, dto: SyncUserBatchDto): Promise<SyncUserBatchResponse> {
    const doSend = async () => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.agentId) headers['x-agent-id'] = this.agentId;
      if (this.token) headers['x-agent-token'] = this.token;
      if (this.lastSharedSecret) headers['x-agent-secret'] = this.lastSharedSecret;

      return fetch(`${this.apiBaseUrl}/api/v1/agents/runs/${runId}/client-users/sync-batches`, {
        method: 'POST',
        headers,
        body: JSON.stringify(dto),
      });
    };

    let res = await doSend();
    if (res.status === 401 && this.lastUserId && this.lastSharedSecret) {
      console.log('[AGENT_CLIENT] 401 on sync batch. Transparently re-pairing with API...');
      const rePaired = await this.pair(this.lastUserId, this.lastSharedSecret);
      if (rePaired) {
        res = await doSend();
      }
    }

    if (!res.ok) {
      const err: any = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(err.message || `Failed to send sync batch: ${res.status}`);
    }
    return (await res.json()) as SyncUserBatchResponse;
  }

  public getStatus() {
    return {
      isPaired: this.isPaired,
      agentId: this.agentId,
      agentName: this.agentName,
      apiBaseUrl: this.apiBaseUrl,
    };
  }
}
