import { chromium } from 'playwright';
import { BrowserLifecycleManager } from '../packages/automation/dist/index.js';
import { startFixtureServer, fixtureBranchState } from '../packages/automation/dist/fixture/server.js';

async function testInvestigation() {
  console.log('=== INVESTIGATION 1: Testing BrowserLifecycleManager with OPEN_INTERACTIVE_CLIENT_SESSION ===');
  const server = await startFixtureServer(4090);
  const baseUrl = 'http://127.0.0.1:4090';

  const lifecycleManager = BrowserLifecycleManager.getInstance();
  const lease = await lifecycleManager.acquireLease({
    taskId: 'OPEN_INTERACTIVE_CLIENT_SESSION',
    runId: `run_investigate_${Date.now()}`,
    clientId: 'client_investigate',
    userId: 'test_operator',
    ownerType: 'OPERATOR_OWNED',
    namespace: 'interactive',
    isHeaded: false,
  });

  const page1 = lease.primaryPage;
  await page1.goto(`${baseUrl}/login`);
  console.log('Page 1 loaded:', page1.url());

  console.log('\n--- Simulating Chrome Duplicate Tab on the same BrowserContext ---');
  const startTime = Date.now();
  const page2 = await lease.context.newPage();
  console.log('Page 2 created. Is page2 closed immediately?', page2.isClosed());

  // Wait 300ms to observe if the interceptor closes it
  await new Promise((r) => setTimeout(r, 300));
  const elapsed = Date.now() - startTime;
  console.log(`After ${elapsed}ms: Is page2 closed?`, page2.isClosed());
  console.log('Is page1 closed?', page1.isClosed());

  if (page2.isClosed()) {
    console.log('🚨 REPRODUCED: Page 2 was automatically closed by BrowserLifecycleManager interceptor!');
  } else {
    console.log('Page 2 remained open.');
  }

  await lease.close({ force: true }).catch(() => {});
  await new Promise((resolve) => server.close(() => resolve()));
}

testInvestigation().catch(console.error);
