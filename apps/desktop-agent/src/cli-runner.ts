import * as dotenv from 'dotenv';
import * as path from 'path';
import { AgentClient } from './agent-client.js';
import { AutomationWorker } from './automation-worker.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

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
    // Check next queued task immediately
    setImmediate(pollCycle);
  };

  // Dedicated Heartbeat Timer running independently
  const heartbeatTimer = setInterval(async () => {
    try {
      const status = isExecuting ? 'BUSY' : 'ONLINE';
      const pendingTask = await agentClient.sendHeartbeat(status);
      if (pendingTask && !isExecuting) {
        await handlePendingTask(pendingTask);
      }
    } catch (err) {
      // quiet retry
    }
  }, 1500);

  const pollCycle = async () => {
    if (isExecuting) return;

    try {
      const pendingTask = await agentClient.sendHeartbeat('ONLINE');
      if (pendingTask) {
        await handlePendingTask(pendingTask);
      }
    } catch (err) {
      console.error('[AGENT] Error in heartbeat/task loop:', err);
      isExecuting = false;
    }
  };

  const heartbeatInterval = setInterval(pollCycle, 500);

  const shutdown = async () => {
    console.log('\n[AGENT] Shutting down agent runner...');
    clearInterval(heartbeatInterval);
    clearInterval(heartbeatTimer);
    await agentClient.sendHeartbeat('OFFLINE');
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
