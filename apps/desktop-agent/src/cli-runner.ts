import * as dotenv from 'dotenv';
import * as path from 'path';
import { ChromeGuestLauncher } from '@hmc/automation';
import { AgentClient } from './agent-client.js';
import { AutomationWorker } from './automation-worker.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export interface DesktopAgentPollerOptions {
  isExecutingGetter?: () => boolean;
  isBusyGetter?: () => boolean;
  canAcceptTasksGetter?: () => boolean;
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
      const isBusy = this.options.isBusyGetter
        ? this.options.isBusyGetter()
        : (this.options.isExecutingGetter ? this.options.isExecutingGetter() : false);
      const status = isBusy ? 'BUSY' : 'ONLINE';
      
      const pendingTask = await this.options.sendHeartbeat(status);

      const canAccept = this.options.canAcceptTasksGetter
        ? this.options.canAcceptTasksGetter()
        : (this.options.isExecutingGetter ? !this.options.isExecutingGetter() : true);

      if (pendingTask && canAccept) {
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
  const maxConcurrentTasks = parseInt(process.env.MAX_CONCURRENT_TASKS || '5', 10);

  const launchConfig = ChromeGuestLauncher.getLaunchConfiguration();
  console.log('\n[CHROME LAUNCH CONFIGURATION]');
  console.log(`  Target Browser:            ${launchConfig.browser}`);
  console.log(`  Chrome Guest Mode:         ${launchConfig.chromeGuest ? 'ENABLED (--guest)' : 'DISABLED'}`);
  console.log(`  Headless Mode:             ${launchConfig.headless ? 'TRUE' : 'FALSE (Visible Windows)'}`);
  console.log(`  Allow Chromium Fallback:   ${launchConfig.allowChromiumFallback ? 'TRUE' : 'FALSE (Fail Closed)'}`);
  console.log(`  Detected Chrome Binary:    ${launchConfig.detectedExecutablePath || 'NOT_FOUND'}`);
  console.log(`  Max Global Concurrency:    ${maxConcurrentTasks}`);
  console.log('----------------------------------------------------------------');

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
  console.log('Desktop Agent ready — Google Chrome Guest Mode enabled');
  console.log('[AGENT] Starting fast event-polling loop (250ms)...');

  const activeRuns = new Set<string>();

  const handlePendingTask = async (pendingTask: any) => {
    if (!pendingTask || activeRuns.size >= maxConcurrentTasks) return;
    if (activeRuns.has(pendingTask.runId)) return;
    activeRuns.add(pendingTask.runId);

    // Launch task execution concurrently; per-client mutation locking is enforced inside worker
    (async () => {
      console.log(`\n[AGENT] >>> Received task: ${pendingTask.taskType} (Run ID: ${pendingTask.runId}) for client [${pendingTask.clientId}] (Active: ${activeRuns.size}/${maxConcurrentTasks})`);
      try {
        await worker.executeTask(pendingTask, (msg) => {
          console.log(`[TASK PROGRESS] [${pendingTask.clientId}] ${msg}`);
        });
      } catch (err) {
        console.error(`[AGENT] Task execution error for run [${pendingTask.runId}]:`, err);
      } finally {
        activeRuns.delete(pendingTask.runId);
      }
    })();
  };

  // Coordinated multi-task heartbeat and task poller
  const poller = new DesktopAgentPoller({
    isExecutingGetter: () => activeRuns.size > 0,
    isBusyGetter: () => activeRuns.size >= maxConcurrentTasks,
    canAcceptTasksGetter: () => activeRuns.size < maxConcurrentTasks,
    sendHeartbeat: (status) => agentClient.sendHeartbeat(status),
    handlePendingTask,
  });

  const heartbeatInterval = setInterval(() => poller.pollCycle(), 250);

  const shutdown = async () => {
    console.log('\n[AGENT] Shutting down agent runner...');
    clearInterval(heartbeatInterval);
    try {
      await worker.shutdown();
    } catch {}
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && process.argv[1].endsWith('cli-runner.js')) {
  startAgentRunner().catch((err) => {
    console.error('[FATAL] Desktop Agent failed to start:', err);
    process.exit(1);
  });
}
