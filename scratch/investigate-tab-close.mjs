import { chromium } from '../packages/automation/node_modules/playwright/index.mjs';
import { AppDataSource, Client, EnvelopeEncryption } from '../packages/database/dist/index.js';
import { ChromeGuestLauncher, WorkflowExecutor } from '../packages/automation/dist/index.js';

async function investigate() {
  console.log('================================================================');
  console.log('   DEEP INVESTIGATION: MULTIPLE TAB CLOSURE & SIMPLEX BEHAVIOUR ');
  console.log('================================================================\n');

  await AppDataSource.initialize();
  const client = await AppDataSource.getRepository(Client).findOne({
    where: { clientCode: 'TRE2' },
    relations: ['credential'],
  });
  if (!client || !client.credential) {
    throw new Error('Client TRE2 not found');
  }

  const rawDecrypted = EnvelopeEncryption.decrypt(JSON.parse(client.credential.encryptedPayload));
  const creds = JSON.parse(rawDecrypted);
  console.log('Client:', client.clientCode, 'Base URL:', client.baseUrl, 'User:', creds.username);

  // Launch Chrome Guest session
  console.log('\n[1] Launching Chrome Guest Session...');
  const session = await ChromeGuestLauncher.launchGuestSession({ headless: true });
  const context = session.context;
  const page1 = session.page;

  // Listen to context page events
  context.on('page', async (p) => {
    console.log(`[CONTEXT EVENT] 'page' event fired! New Page URL at event: "${p.url()}"`);
    p.on('close', () => {
      console.log(`[PAGE EVENT] Page closed! Final URL: "${p.url()}"`);
    });
  });

  // Attach diagnostic listener before loading any page
  const attachDiagnostics = async (page, pageName) => {
    // 1. Intercept window.close()
    await page.addInitScript(`
      const originalClose = window.close;
      window.__closeCalls = [];
      window.close = function(...args) {
        const stack = new Error().stack;
        console.log('[DIAGNOSTIC] window.close() was called from:', stack);
        window.__closeCalls.push({ time: Date.now(), stack });
        return originalClose.apply(this, args);
      };

      // 2. Monitor BroadcastChannel
      if (window.BroadcastChannel) {
        const OrigBC = window.BroadcastChannel;
        window.BroadcastChannel = function(name) {
          console.log('[DIAGNOSTIC] BroadcastChannel opened:', name);
          const bc = new OrigBC(name);
          bc.addEventListener('message', (ev) => {
            console.log('[DIAGNOSTIC] BroadcastChannel message on', name, ':', ev.data);
          });
          return bc;
        };
      }

      // 3. Monitor Storage Events
      window.addEventListener('storage', (e) => {
        console.log('[DIAGNOSTIC] Storage event:', e.key, e.oldValue, '->', e.newValue);
      });

      // 4. Monitor beforeunload & unload
      window.addEventListener('beforeunload', (e) => {
        console.log('[DIAGNOSTIC] beforeunload fired on URL:', window.location.href);
      });
      window.addEventListener('unload', (e) => {
        console.log('[DIAGNOSTIC] unload fired on URL:', window.location.href);
      });
    `);

    page.on('console', (msg) => {
      console.log(`[CONSOLE ${pageName}] [${msg.type()}] ${msg.text()}`);
    });

    page.on('requestfailed', (req) => {
      console.log(`[REQ FAILED ${pageName}] ${req.method()} ${req.url()}: ${req.failure()?.errorText}`);
    });

    page.on('response', (res) => {
      if (res.status() >= 400) {
        console.log(`[HTTP ${res.status()} ${pageName}] ${res.url()}`);
      }
    });
  };

  await attachDiagnostics(page1, 'Tab 1');

  // Step 2: Login
  console.log('\n[2] Logging in to Simplex Staging on Tab 1...');
  const defaultWorkflow = {
    versionNumber: 1,
    applicableAppVersion: 'v1.0',
    pageRoute: '/login',
    steps: [
      {
        stepIndex: 1,
        stepName: 'Opening client application…',
        action: 'NAVIGATE',
        valueTemplate: '{{loginUrl}}',
        timeoutMs: 15000,
      },
      {
        stepIndex: 2,
        stepName: 'Entering username…',
        action: 'FILL',
        targetSelector: { strategy: 'ID', value: 'username' },
        valueTemplate: '{{username}}',
        timeoutMs: 10000,
      },
      {
        stepIndex: 3,
        stepName: 'Entering password…',
        action: 'FILL',
        targetSelector: { strategy: 'ID', value: 'pasWord', fallbackSelectors: [{ strategy: 'NAME', value: 'password' }] },
        valueTemplate: '{{password}}',
        timeoutMs: 10000,
      },
      {
        stepIndex: 4,
        stepName: 'Click Sign In',
        action: 'CLICK',
        targetSelector: { strategy: 'ID', value: 'SignIn', fallbackSelectors: [{ strategy: 'CSS', value: 'button[type="submit"]' }] },
        timeoutMs: 10000,
      },
      {
        stepIndex: 5,
        stepName: 'Verify authenticated',
        action: 'WAIT_FOR_ELEMENT',
        targetSelector: { strategy: 'CSS', value: 'body' },
        timeoutMs: 20000,
      },
    ],
    successConditions: [],
    errorConditions: [],
    securityBlockConditions: [],
    defaultTimeoutMs: 30000,
    maxRetries: 1,
  };

  const loginRes = await WorkflowExecutor.executeWorkflow(
    page1,
    defaultWorkflow,
    {
      loginUrl: `${client.baseUrl}/login`,
      username: creds.username,
      password: creds.password,
      targetBranch: client.branchName,
    },
    (t) => console.log(`  [Login Step] ${t.stepName} -> ${t.status}`)
  );

  console.log('Login Result:', loginRes.success ? 'SUCCESS' : 'FAILED', 'Current URL:', page1.url());

  // Step 3: Now open a second tab in this authenticated context!
  console.log('\n[3] Opening Tab 2 in the same authenticated context (simulating Duplicate Tab / context.newPage())...');
  const page2 = await context.newPage();
  await attachDiagnostics(page2, 'Tab 2');

  const currentTab1Url = page1.url();
  console.log('Tab 1 URL is:', currentTab1Url);

  console.log('Navigating Tab 2 to Tab 1 URL...');
  try {
    const navPromise = page2.goto(currentTab1Url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await navPromise;
    console.log('Tab 2 arrived at:', page2.url());
  } catch (err) {
    console.log('Tab 2 navigation error / closed:', err.message);
  }

  // Wait 3 seconds to see if Tab 2 closes or if Simplex executes window.close()
  console.log('\n[4] Observing Tab 2 over 3 seconds for unexpected closures or script-triggered window.close()...');
  for (let i = 1; i <= 6; i++) {
    await new Promise((r) => setTimeout(r, 500));
    console.log(`  [+${i * 500}ms] Tab 1 closed? ${page1.isClosed()} | Tab 2 closed? ${page2.isClosed()} | Tab 2 URL: ${page2.isClosed() ? 'N/A' : page2.url()}`);
    if (page2.isClosed()) break;
  }

  // Check window.__closeCalls
  if (!page2.isClosed()) {
    const closeCalls = await page2.evaluate(() => window.__closeCalls || []).catch(() => []);
    console.log('Tab 2 close calls recorded:', closeCalls);
    const storageKeys = await page2.evaluate(() => ({
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    })).catch(() => ({ local: [], session: [] }));
    console.log('Tab 2 Storage Keys:', storageKeys);
  }

  console.log('\n[5] Now testing with BrowserLifecycleManager WITHOUT allowMultipleTabs...');
  const lifecycleManager = BrowserLifecycleManager.getInstance();
  const lease = await lifecycleManager.acquireLease({
    taskId: 'OPEN_INTERACTIVE_CLIENT_SESSION',
    runId: `test_inv_${Date.now()}`,
    clientId: client.id,
    userId: 'op',
    ownerType: 'OPERATOR_OWNED',
    namespace: 'interactive',
    isHeaded: false,
    // Note: allowMultipleTabs is NOT passed!
  });

  const blmPage1 = lease.primaryPage;
  await blmPage1.goto(`${client.baseUrl}/login`);
  console.log('BLM Page 1 opened:', blmPage1.url());

  console.log('Creating BLM Page 2 in lease context...');
  const blmPage2 = await lease.context.newPage();
  console.log('BLM Page 2 created. Checking after 150ms if closed by BLM interceptor...');
  await new Promise((r) => setTimeout(r, 200));
  console.log('BLM Page 2 isClosed()?', blmPage2.isClosed());

  await lease.close({ force: true }).catch(() => {});
  await session.page.close().catch(() => {});
  await session.context.close().catch(() => {});
  await session.browser.close().catch(() => {});
  await AppDataSource.destroy();

  console.log('\n=== INVESTIGATION COMPLETED ===');
}

investigate().catch(console.error);
