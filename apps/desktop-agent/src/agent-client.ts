import * as os from 'os';
import {
  AgentHeartbeatPayload,
  AgentTaskAssignment,
  AutomationRunStepTelemetry,
} from '@hmc/shared';

export class AgentClient {
  private apiBaseUrl: string;
  private agentId?: string;
  private agentName: string;
  private token?: string;
  private isPaired: boolean = false;

  constructor(apiBaseUrl?: string, agentName?: string) {
    this.apiBaseUrl = (apiBaseUrl || process.env.API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
    this.agentName = agentName || `Agent-${os.hostname()}`;
  }

  public async pair(userId: string, sharedSecret: string): Promise<boolean> {
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
    if (!this.agentId) return null;

    try {
      const payload: AgentHeartbeatPayload = {
        agentId: this.agentId,
        machineHostname: os.hostname(),
        osInfo: `${os.type()} ${os.release()}`,
        status,
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
      }
    } catch (err) {
      console.warn('[AGENT_CLIENT] Heartbeat ping failed:', err);
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

  public getStatus() {
    return {
      isPaired: this.isPaired,
      agentId: this.agentId,
      agentName: this.agentName,
      apiBaseUrl: this.apiBaseUrl,
    };
  }
}
