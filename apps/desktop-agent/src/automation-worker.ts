import { BrowserContext, Page } from 'playwright';
import { BrowserProfileManager, WorkflowExecutor, UserManagementExecutor, SyncProgressUpdate } from '@hmc/automation';
import { AgentTaskAssignment, AutomationRunStepTelemetry } from '@hmc/shared';
import { AgentClient } from './agent-client.js';

export class AutomationWorker {
  private activeProfileContexts: Map<string, BrowserContext> = new Map();
  private singleFlightTasks: Map<string, Promise<void>> = new Map();

  constructor(private agentClient: AgentClient) {}

  public async executeTask(task: AgentTaskAssignment, onProgress?: (msg: string) => void): Promise<void> {
    const effectiveUserId = (task.payload?.userId || 'operator').replace(/[^a-zA-Z0-9_-]/g, '_');
    const isHeadlessSync = task.taskType === 'SYNC_CLIENT_USERS_HEADLESS' || task.taskType === 'SYNC_CLIENT_USERS';
    const profileKey = `${task.clientId}_${effectiveUserId}_${isHeadlessSync ? 'sync' : 'interactive'}`;

    // Single-flight lock: Prevent duplicate concurrent launches for the same client profile namespace
    const inFlight = this.singleFlightTasks.get(profileKey);
    if (inFlight) {
      onProgress?.(`A task is already in-flight for client [${task.clientId}] (${isHeadlessSync ? 'sync' : 'interactive'}). Awaiting execution...`);
      return inFlight;
    }

    const taskExecutionPromise = this.performTaskExecution(task, profileKey, effectiveUserId, isHeadlessSync, onProgress);
    this.singleFlightTasks.set(profileKey, taskExecutionPromise);

    try {
      await taskExecutionPromise;
    } finally {
      this.singleFlightTasks.delete(profileKey);
    }
  }

  private async performTaskExecution(
    task: AgentTaskAssignment,
    profileKey: string,
    effectiveUserId: string,
    isHeadlessSync: boolean,
    onProgress?: (msg: string) => void
  ): Promise<void> {
    const startTime = Date.now();
    onProgress?.(`Starting task [${task.taskType}] for client [${task.clientId}]...`);

    // =========================================================================
    // 1. DEDICATED HEADLESS BACKGROUND SYNC HANDLER (ZERO VISIBLE BROWSER)
    // =========================================================================
    if (isHeadlessSync) {
      let syncContext: BrowserContext | null = null;
      try {
        onProgress?.(`[BACKGROUND SYNC] Launching isolated headless sync context for client [${task.clientId}]...`);
        
        syncContext = await BrowserProfileManager.launchPersistentContext({
          clientId: task.clientId,
          userId: effectiveUserId,
          isHeaded: false,
          namespace: 'sync',
          slowMo: 0,
        });

        const syncPage = syncContext.pages()[0] || (await syncContext.newPage());

        const usersListUrl = task.targetRoute
          ? (task.targetRoute.startsWith('http') ? task.targetRoute : `${task.clientBaseUrl}${task.targetRoute}`)
          : `${task.clientBaseUrl}/MasterV9.4/users`;

        const loginUrl = task.loginRoute
          ? (task.loginRoute.startsWith('http') ? task.loginRoute : `${task.clientBaseUrl}${task.loginRoute}`)
          : `${task.clientBaseUrl}/login`;

        onProgress?.(`[BACKGROUND SYNC] Executing user scrape on ${usersListUrl}...`);

        const syncRes = await UserManagementExecutor.syncUsersHeadless(syncPage, {
          usersUrl: usersListUrl,
          loginUrl,
          credentials: task.credentials?.password
            ? { username: task.credentials.username, password: task.credentials.password }
            : undefined,
          onProgress: (update: SyncProgressUpdate) => {
            onProgress?.(`[SYNC PROGRESS] ${update.message}`);
            this.agentClient
              .sendTelemetry(task.runId, {
                status: 'RUNNING',
                resultData: {
                  message: update.message,
                  stage: update.stage,
                  currentPage: update.currentPage,
                  count: update.count,
                  streamedUsers: update.streamedUsers,
                },
              })
              .catch(() => {});
          },
        });

        const totalDurationMs = Date.now() - startTime;

        if (syncRes.success) {
          onProgress?.(`✓ [BACKGROUND SYNC COMPLETED] Scraped ${syncRes.totalScraped} users in ${totalDurationMs}ms.`);
          await this.agentClient.sendTelemetry(task.runId, {
            status: 'COMPLETED',
            totalDurationMs,
            resultData: syncRes,
          });
        } else {
          onProgress?.(`✗ [BACKGROUND SYNC FAILED] ${syncRes.errorCode}: ${syncRes.errorMessage}`);
          await this.agentClient.sendTelemetry(task.runId, {
            status: 'FAILED',
            errorMessage: syncRes.errorMessage || 'Background user synchronization failed',
            totalDurationMs,
            resultData: syncRes,
          });
        }
      } catch (err: any) {
        const totalDurationMs = Date.now() - startTime;
        onProgress?.(`[FATAL SYNC ERROR] ${err.message}`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'FAILED',
          errorMessage: err.message || 'Background sync runtime failure',
          totalDurationMs,
          resultData: {
            success: false,
            errorCode: 'CLIENT_USER_SYNC_TIMEOUT',
            errorMessage: err.message,
          },
        });
      } finally {
        if (syncContext) {
          try {
            await syncContext.close();
            onProgress?.('[BACKGROUND SYNC] Headless sync context cleanly released.');
          } catch {}
        }
      }
      return;
    }

    // =========================================================================
    // 2. INTERACTIVE & DIRECT CLIENT APPLICATION WORKFLOWS (HEADED)
    // =========================================================================
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      // Check if an active browser context already exists for this client profile
      const existingContext = this.activeProfileContexts.get(profileKey);
      if (existingContext) {
        try {
          const pages = existingContext.pages();
          if (pages.length > 0) {
            context = existingContext;
            page = pages[0];
            await page.bringToFront();
            onProgress?.(`Reusing existing active browser window for client [${task.clientId}]`);
          } else {
            // Context is warm, open fresh page in same context immediately (<50ms)
            context = existingContext;
            page = await existingContext.newPage();
            onProgress?.(`Reopened page in warm browser context for client [${task.clientId}]`);
          }
        } catch {
          try {
            await existingContext.close();
          } catch {}
          this.activeProfileContexts.delete(profileKey);
          context = null;
          page = null;
        }
      }

      // If no valid context is open, launch persistent context
      if (!context) {
        context = await BrowserProfileManager.launchPersistentContext({
          clientId: task.clientId,
          userId: effectiveUserId,
          isHeaded: task.options?.isHeaded ?? true,
          namespace: 'interactive',
          slowMo: 0,
        });

        this.activeProfileContexts.set(profileKey, context);
        context.on('close', () => {
          this.activeProfileContexts.delete(profileKey);
        });
      }

      if (!context) {
        throw new Error('Failed to initialize or launch browser context');
      }

      if (!page) {
        page = context.pages()[0] || (await context.newPage());
      }

      const usersListUrl = task.targetRoute
        ? (task.targetRoute.startsWith('http') ? task.targetRoute : `${task.clientBaseUrl}${task.targetRoute}`)
        : `${task.clientBaseUrl}/MasterV9.4/users`;

      if (task.taskType === 'CREATE_CLIENT_USER') {
        const addUsersUrl = `${task.clientBaseUrl}/MasterV9.4/addUsers`;
        onProgress?.(`Creating client user '${task.payload.username}' on ${addUsersUrl}...`);
        const createRes = await UserManagementExecutor.createUser(page, addUsersUrl, usersListUrl, task.payload as any);
        const totalDurationMs = Date.now() - startTime;
        if (createRes.success) {
          onProgress?.(`✓ Created client user ${createRes.username}`);
          await this.agentClient.sendTelemetry(task.runId, {
            status: 'COMPLETED',
            totalDurationMs,
            resultData: createRes,
          });
        } else {
          onProgress?.(`✗ Failed to create user: ${createRes.message}`);
          await this.agentClient.sendTelemetry(task.runId, {
            status: 'FAILED',
            errorMessage: createRes.message,
            totalDurationMs,
            resultData: createRes,
          });
        }
        return;
      }

      if (task.taskType === 'EDIT_CLIENT_USER') {
        onProgress?.(`Updating client user '${task.payload.username}'...`);
        const editRes = await UserManagementExecutor.editUser(page, usersListUrl, task.payload.username, task.payload as any);
        const totalDurationMs = Date.now() - startTime;
        if (editRes.success) {
          await this.agentClient.sendTelemetry(task.runId, { status: 'COMPLETED', totalDurationMs, resultData: editRes });
        } else {
          await this.agentClient.sendTelemetry(task.runId, { status: 'FAILED', errorMessage: editRes.message, totalDurationMs, resultData: editRes });
        }
        return;
      }

      if (task.taskType === 'SET_CLIENT_USER_STATUS') {
        onProgress?.(`Setting status for '${task.payload.username}' to ${task.payload.status}...`);
        const statusRes = await UserManagementExecutor.setUserStatus(page, usersListUrl, task.payload.username, task.payload.status);
        const totalDurationMs = Date.now() - startTime;
        if (statusRes.success) {
          await this.agentClient.sendTelemetry(task.runId, { status: 'COMPLETED', totalDurationMs, resultData: statusRes });
        } else {
          await this.agentClient.sendTelemetry(task.runId, { status: 'FAILED', errorMessage: statusRes.message, totalDurationMs, resultData: statusRes });
        }
        return;
      }

      if (task.taskType === 'RESET_CLIENT_USER_PASSWORD') {
        onProgress?.(`Resetting password for '${task.payload.username}'...`);
        const resetRes = await UserManagementExecutor.resetUserPassword(page, usersListUrl, task.payload.username);
        const totalDurationMs = Date.now() - startTime;
        if (resetRes.success) {
          await this.agentClient.sendTelemetry(task.runId, { status: 'COMPLETED', totalDurationMs, resultData: resetRes });
        } else {
          await this.agentClient.sendTelemetry(task.runId, { status: 'FAILED', errorMessage: resetRes.message, totalDurationMs, resultData: resetRes });
        }
        return;
      }

      // Default Interactive / Workflow Execution (Login, Service Creation, etc.)
      const variables: Record<string, any> = {
        loginUrl: `${task.clientBaseUrl}${task.loginRoute}`,
        servicesUrl: `${task.clientBaseUrl}/hmc/services`,
        usersUrl: `${task.clientBaseUrl}/hmc/users`,
        username: task.credentials?.username || '',
        password: task.credentials?.password || '',
        ...task.payload,
      };

      const result = await WorkflowExecutor.executeWorkflow(
        page,
        task.workflowVersion,
        variables,
        (stepTelemetry: AutomationRunStepTelemetry) => {
          onProgress?.(`Step ${stepTelemetry.stepIndex}: ${stepTelemetry.stepName} -> ${stepTelemetry.status}`);
          this.agentClient.sendTelemetry(task.runId, {
            status: 'RUNNING',
            step: stepTelemetry,
          });
        }
      );

      const totalDurationMs = Date.now() - startTime;

      if (result.success) {
        onProgress?.(`✓ Task ${task.runId} completed successfully in ${totalDurationMs}ms.`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'COMPLETED',
          totalDurationMs,
        });

        if (!task.options?.leaveBrowserOpen) {
          await context.close();
          this.activeProfileContexts.delete(profileKey);
        }
      } else if (result.status === 'REQUIRES_MANUAL_INTERVENTION') {
        onProgress?.(`! Task ${task.runId} requires manual security intervention: ${result.errorMessage}`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'REQUIRES_MANUAL_INTERVENTION',
          errorMessage: result.errorMessage || 'Manual security intervention required.',
          totalDurationMs,
        });
      } else {
        onProgress?.(`✗ Task ${task.runId} failed: ${result.errorMessage}`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'FAILED',
          errorMessage: result.errorMessage || 'Automation execution failed',
          totalDurationMs,
        });
      }
    } catch (err: any) {
      const totalDurationMs = Date.now() - startTime;
      onProgress?.(`[FATAL] Error in task execution: ${err.message}`);
      await this.agentClient.sendTelemetry(task.runId, {
        status: 'FAILED',
        errorMessage: err.message || 'Worker runtime error',
        totalDurationMs,
      });
    }
  }

  public getActiveContextCount(): number {
    return this.activeProfileContexts.size;
  }
}
