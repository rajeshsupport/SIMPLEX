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
  const paired = await agentClient.pair('default_operator', sharedSecret);
  if (!paired) {
    console.error('[AGENT] Failed to pair with API. Check API status and AGENT_SHARED_SECRET.');
    process.exit(1);
  }

  console.log(`[AGENT] Successfully paired! Agent ID: ${agentClient.getStatus().agentId}`);
  console.log('[AGENT] Starting fast event-polling loop (250ms)...');

  // Dedicated independent Heartbeat Timer (runs every 1s so agent stays reliably ONLINE during tasks)
  const heartbeatTimer = setInterval(async () => {
    try {
      await agentClient.sendHeartbeat('ONLINE');
    } catch (err) {
      // quiet log
    }
  }, 1000);

  let isExecuting = false;

  const pollCycle = async () => {
    if (isExecuting) return;

    try {
      const pendingTask = await agentClient.sendHeartbeat('ONLINE');
      if (pendingTask) {
        isExecuting = true;
        console.log(`\n[AGENT] >>> Received task: ${pendingTask.taskType} (Run ID: ${pendingTask.runId}) for client [${pendingTask.clientId}]`);
        try {
          await worker.executeTask(pendingTask, (msg) => {
            console.log(`[TASK PROGRESS] ${msg}`);
          });
        } finally {
          isExecuting = false;
        }
        // Immediately poll next task without waiting for interval
        setImmediate(pollCycle);
      }
    } catch (err) {
      console.error('[AGENT] Error in heartbeat/task loop:', err);
      isExecuting = false;
    }
  };

  const heartbeatInterval = setInterval(pollCycle, 250);

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
