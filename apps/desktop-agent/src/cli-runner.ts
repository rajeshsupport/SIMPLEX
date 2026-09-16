import * as dotenv from 'dotenv';
import * as path from 'path';
import { AgentClient } from './agent-client.js';
import { AutomationWorker } from './automation-worker.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export interface DesktopAgentPollerOptions {
  isExecutingGetter: () => boolean;
  sendHeartbeat: (status: 'ONLINE' | 'BUSY') => Promise<any>;
  handlePendingTask: (task: any) => Promise<void>;
  onError?: (err: any) => void;
}

export class DesktopAgentPoller {
  private pollInProgress = false;

  constructor(private readonly options: DesktopAgentPollerOptions) {}

  public isPollInProgress(): boolean {
    return this.pollInProgress;
  }

  public async pollCycle(): Promise<void> {
    if (this.pollInProgress) return;
    this.pollInProgress = true;
    try {
      const status = this.options.isExecutingGetter() ? 'BUSY' : 'ONLINE';
      const pendingTask = await this.options.sendHeartbeat(status);
      if (pendingTask && !this.options.isExecutingGetter()) {
        this.options.handlePendingTask(pendingTask).catch((err) => {
          if (this.options.onError) {
            this.options.onError(err);
          } else {
            console.error('[AGENT] Task execution error:', err);
          }
        });
      }
    } catch (err) {
      if (this.options.onError) {
        this.options.onError(err);
      } else {
        console.error('[AGENT] Error in heartbeat/task loop:', err);
      }
    } finally {
      this.pollInProgress = false;
    }
  }
}

async function startAgentRunner() {
  console.log('================================================================');
  console.log('       HMC DESKTOP BROWSER AUTOMATION AGENT RUNNER              ');
  console.log('================================================================');

  const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
  const sharedSecret = process.env.AGENT_SHARED_SECRET || 'hmc_agent_shared_secret_pair_key_2026';

  const agentClient = new AgentClient(apiBaseUrl, 'Local-Daemon-Agent');
  const worker = new AutomationWorker(agentClient);

  console.log(`[AGENT] Connecting to API at ${apiBaseUrl}...`);
  let paired = false;
  while (!paired) {
    paired = await agentClient.pair('default_operator', sharedSecret);
    if (!paired) {
      console.log('[AGENT] API not ready yet. Retrying connection in 1.5s...');
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  console.log(`[AGENT] Successfully paired! Agent ID: ${agentClient.getStatus().agentId}`);
  console.log('Desktop Agent ready — visible Chrome mutations enabled — build 6d63f04');
  console.log('[AGENT] Starting fast event-polling loop (250ms)...');

  let isExecuting = false;

  const handlePendingTask = async (pendingTask: any) => {
    if (!pendingTask || isExecuting) return;
    isExecuting = true;
    console.log(`\n[AGENT] >>> Received task: ${pendingTask.taskType} (Run ID: ${pendingTask.runId}) for client [${pendingTask.clientId}]`);
    try {
      await worker.executeTask(pendingTask, (msg) => {
        console.log(`[TASK PROGRESS] ${msg}`);
      });
    } catch (err) {
      console.error('[AGENT] Task execution error:', err);
    } finally {
      isExecuting = false;
    }
  };

  // Coordinated single-loop heartbeat and task poller
  const poller = new DesktopAgentPoller({
    isExecutingGetter: () => isExecuting,
    sendHeartbeat: (status) => agentClient.sendHeartbeat(status),
    handlePendingTask,
  });

  const heartbeatInterval = setInterval(() => poller.pollCycle(), 500);

  const shutdown = async () => {
    console.log('\n[AGENT] Shutting down agent runner...');
    clearInterval(heartbeatInterval);
    try {
      await worker.shutdown();
    } catch {}
    try {
      await agentClient.sendHeartbeat('OFFLINE');
    } catch {}
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}


if (require.main === module) {
  startAgentRunner().catch((err) => {
    console.error('[AGENT FATAL]', err);
    process.exit(1);
  });
}
