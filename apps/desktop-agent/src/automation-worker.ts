import { BrowserContext, Page } from 'playwright';
import { BrowserProfileManager, WorkflowExecutor, UserManagementExecutor, SyncProgressUpdate } from '@hmc/automation';
import { AgentTaskAssignment, AutomationRunStepTelemetry, resolveClientRoute } from '@hmc/shared';
import { AgentClient } from './agent-client.js';

function buildAbsoluteUrl(baseUrl: string, route?: string, fallbackRoute: string = '/'): string {
  return resolveClientRoute({ baseUrl, route, fallbackRoute });
}

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

        const usersListUrl = resolveClientRoute({
          baseUrl: task.clientBaseUrl,
          applicationPath: task.payload?.applicationPath,
          route: task.targetRoute,
          fallbackRoute: '/users',
        });
        const loginUrl = resolveClientRoute({
          baseUrl: task.clientBaseUrl,
          applicationPath: task.payload?.applicationPath,
          route: task.loginRoute,
          fallbackRoute: '/login',
        });

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
    // 1.5 DEDICATED HEADLESS LIVE FORM OPTIONS INSPECTOR
    // =========================================================================
    if (task.taskType === 'INSPECT_CREATE_FORM_METADATA' || task.taskType === 'INSPECT_FORM_OPTIONS') {
      let inspectContext: BrowserContext | null = null;
      try {
        onProgress?.(`[INSPECT OPTIONS] Launching isolated headless browser context for client [${task.clientId}]...`);
        inspectContext = await BrowserProfileManager.launchPersistentContext({
          clientId: task.clientId,
          userId: effectiveUserId,
          isHeaded: false,
          namespace: 'sync',
          slowMo: 0,
        });

        const inspectPage = inspectContext.pages()[0] || (await inspectContext.newPage());
        const appPath = task.clientAppPath || task.payload?.applicationPath;
        const addUsersUrl = resolveClientRoute({
          baseUrl: task.clientBaseUrl,
          applicationPath: appPath,
          route: task.payload?.addUsersRoute || '/addUsers',
          fallbackRoute: '/addUsers',
        });
        const loginUrl = resolveClientRoute({
          baseUrl: task.clientBaseUrl,
          applicationPath: appPath,
          route: task.loginRoute,
          fallbackRoute: '/login',
        });

        onProgress?.(`[INSPECT OPTIONS] Inspecting live Add User options at ${addUsersUrl}...`);
        const metadata = await UserManagementExecutor.inspectCreateFormMetadata(inspectPage, {
          addUsersUrl,
          clientId: task.clientId,
          applicationVersion: task.payload?.applicationVersion || 'v9.4',
          loginUrl,
          credentials: task.credentials,
        });

        const totalDurationMs = Date.now() - startTime;
        if (metadata && (metadata.nationalities?.length > 0 || metadata.roles?.length > 0)) {
          onProgress?.(`✓ [INSPECT OPTIONS COMPLETED] Discovered ${metadata.nationalities.length} nationalities, ${metadata.roles.length} roles, ${metadata.profileRoles.length} profile roles.`);
          await this.agentClient.sendTelemetry(task.runId, {
            status: 'COMPLETED',
            totalDurationMs,
            resultData: metadata,
          });
        } else {
          onProgress?.(`✗ [INSPECT OPTIONS FAILED] No dropdown options discovered on remote form.`);
          await this.agentClient.sendTelemetry(task.runId, {
            status: 'FAILED',
            errorMessage: 'FORM_OPTIONS_UNAVAILABLE: No dropdown options discovered on remote Add User form.',
            totalDurationMs,
            resultData: {
              success: false,
              errorCode: 'FORM_OPTIONS_UNAVAILABLE',
              errorMessage: 'No dropdown options discovered on remote Add User form.',
            },
          });
        }
      } catch (err: any) {
        const totalDurationMs = Date.now() - startTime;
        onProgress?.(`[INSPECT OPTIONS ERROR] ${err.message}`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'FAILED',
          errorMessage: err.message || 'FORM_OPTIONS_UNAVAILABLE',
          totalDurationMs,
          resultData: {
            success: false,
            errorCode: 'FORM_OPTIONS_UNAVAILABLE',
            errorMessage: err.message,
          },
        });
      } finally {
        if (inspectContext) {
          try {
            await inspectContext.close();
            onProgress?.('[INSPECT OPTIONS] Headless inspect context cleanly released.');
          } catch {}
        }
      }
      return;
    }

    // =========================================================================
    // 2. REMOTE CLIENT MUTATION WORKFLOWS (VISIBLE AUTOMATED CHROME WINDOW)
    // =========================================================================
    const isMutationTask = [
      'CREATE_CLIENT_USER',
      'CREATE_USER',
      'EDIT_CLIENT_USER',
      'EDIT_AND_UPDATE_CLIENT',
      'SET_CLIENT_USER_STATUS',
      'CHANGE_CLIENT_USER_STATUS',
      'RESET_CLIENT_USER_PASSWORD',
    ].includes(task.taskType);

    if (isMutationTask) {
      if (task.executionMode === 'HEADLESS_SYNC' || task.options?.isHeaded === false) {
        onProgress?.(`✗ Rejected task [${task.taskType}]: MUTATION_BROWSER_MODE_MISMATCH`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'FAILED',
          errorMessage: 'Mutation tasks cannot run in headless mode. Headed Chrome is required.',
          totalDurationMs: Date.now() - startTime,
          resultData: {
            success: false,
            errorCode: 'MUTATION_BROWSER_MODE_MISMATCH',
            errorMessage: 'Mutation tasks cannot run in headless mode. Headed Chrome is required.',
          },
        });
        return;
      }

      let mutationContext: BrowserContext | null = null;
      try {
        onProgress?.(`Launching visible automated Chrome for mutation [${task.taskType}]`);
        mutationContext = await BrowserProfileManager.launchPersistentContext({
          clientId: task.clientId,
          userId: effectiveUserId,
          isHeaded: true, // Visible automated Chrome window for remote mutations
          namespace: 'interactive',
          slowMo: 50,
        });

        const mutationPage = mutationContext.pages()[0] || (await mutationContext.newPage());
        await mutationPage.bringToFront().catch(() => {});

        const appPath = task.clientAppPath || task.payload?.applicationPath;
        const usersListUrl = resolveClientRoute({
          baseUrl: task.clientBaseUrl,
          applicationPath: appPath,
          route: task.targetRoute,
          fallbackRoute: '/users',
        });
        const loginUrl = resolveClientRoute({
          baseUrl: task.clientBaseUrl,
          applicationPath: appPath,
          route: task.loginRoute,
          fallbackRoute: '/login',
        });

        if (task.taskType === 'CREATE_CLIENT_USER' || task.taskType === 'CREATE_USER') {
          const payloadData = task.payload?.payload || task.payload;
          const addUsersUrl = resolveClientRoute({
            baseUrl: task.clientBaseUrl,
            applicationPath: appPath,
            route: task.payload?.addUsersRoute,
            fallbackRoute: '/addUsers',
          });
          const username = payloadData?.username || task.payload?.username || 'user';
          onProgress?.(`Logging in to selected Simplex client…`);
          onProgress?.(`Opening Add User screen for '${username}'…`);
          const createRes = await UserManagementExecutor.createUser(mutationPage, {
            addUsersUrl,
            usersListUrl,
            dto: payloadData as any,
            loginUrl,
            credentials: task.credentials,
          });
          const totalDurationMs = Date.now() - startTime;
          if (createRes.success) {
            onProgress?.(`✓ Created client user ${createRes.username}`);
            onProgress?.(`Verifying remote result…`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'COMPLETED',
              totalDurationMs,
              resultData: createRes,
            });
          } else {
            onProgress?.(`✗ Failed to create user: ${createRes.message || createRes.errorMessage}`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'FAILED',
              errorMessage: createRes.message || createRes.errorMessage || 'User creation failed on client portal.',
              totalDurationMs,
              resultData: createRes,
            });
          }
          return;
        }

        if (task.taskType === 'EDIT_CLIENT_USER' || task.taskType === 'EDIT_AND_UPDATE_CLIENT') {
          onProgress?.(`Logging in to selected Simplex client…`);
          onProgress?.(`Opening Users screen…`);
          onProgress?.(`Searching for '${task.payload.username}'…`);
          const editRes = await UserManagementExecutor.editUser(mutationPage, {
            usersListUrl,
            username: task.payload.username,
            dto: task.payload as any,
            loginUrl,
            credentials: task.credentials,
          });
          const totalDurationMs = Date.now() - startTime;
          if (editRes.success) {
            onProgress?.(`✓ Updated and verified user '${editRes.username}' on client.`);
            await this.agentClient.sendTelemetry(task.runId, { status: 'COMPLETED', totalDurationMs, resultData: editRes });
          } else {
            onProgress?.(`✗ Failed to update user: ${editRes.message || editRes.errorMessage}`);
            await this.agentClient.sendTelemetry(task.runId, { status: 'FAILED', errorMessage: editRes.message || editRes.errorMessage, totalDurationMs, resultData: editRes });
          }
          return;
        }

        if (task.taskType === 'SET_CLIENT_USER_STATUS' || task.taskType === 'CHANGE_CLIENT_USER_STATUS') {
          const targetStatus = task.payload.status || task.payload.targetStatus;
          const reportProgress = (msg: string) => {
            onProgress?.(msg);
            this.agentClient
              .sendTelemetry(task.runId, {
                status: 'RUNNING',
                resultData: { message: msg, stage: 'MUTATING' },
              })
              .catch(() => {});
          };

          reportProgress(`Logging in to selected Simplex client…`);
          reportProgress(`Opening Users screen…`);
          reportProgress(`Searching for '${task.payload.username}'…`);
          reportProgress(`Updating remote status to ${targetStatus} in Simplex client…`);
          const statusRes = await UserManagementExecutor.setUserStatus(mutationPage, {
            usersListUrl,
            username: task.payload.username,
            targetStatus,
            loginUrl,
            credentials: task.credentials,
            onProgress: reportProgress,
          });
          const totalDurationMs = Date.now() - startTime;
          if (statusRes.success) {
            reportProgress(`✓ Remote status verified: '${statusRes.username}' is ${statusRes.status}.`);
            reportProgress(`Synchronizing Central data…`);
            await this.agentClient.sendTelemetry(task.runId, { status: 'COMPLETED', totalDurationMs, resultData: statusRes });
          } else {
            onProgress?.(`✗ Remote status verification failed: ${statusRes.errorMessage || statusRes.message}`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'FAILED',
              errorMessage: statusRes.errorMessage || statusRes.message || 'Remote status verification failed',
              totalDurationMs,
              resultData: statusRes,
            });
          }
          return;
        }

        if (task.taskType === 'RESET_CLIENT_USER_PASSWORD') {
          const addUsersUrl = resolveClientRoute({
            baseUrl: task.clientBaseUrl,
            applicationPath: appPath,
            route: task.payload?.addUsersRoute || task.addUsersRoute,
            fallbackRoute: '/addUsers',
          });

          const reportProgress = (msg: string) => {
            onProgress?.(msg);
            this.agentClient
              .sendTelemetry(task.runId, {
                status: 'RUNNING',
                resultData: { message: msg, stage: 'MUTATING' },
              })
              .catch(() => {});
          };

          reportProgress(`Logging in to selected Simplex client…`);
          reportProgress(`Capturing client default password from Add User screen…`);
          reportProgress(`Opening Users screen…`);
          reportProgress(`Searching for '${task.payload.username}'…`);
          reportProgress(`Resetting password for '${task.payload.username}' in Simplex client…`);

          const resetRes = await UserManagementExecutor.resetUserPassword(mutationPage, {
            usersListUrl,
            addUsersUrl,
            username: task.payload.username,
            loginUrl,
            credentials: task.credentials,
            onProgress: reportProgress,
          });

          const totalDurationMs = Date.now() - startTime;
          if (resetRes.success) {
            reportProgress(`✓ Password reset confirmed for '${resetRes.username}'.`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'COMPLETED',
              totalDurationMs,
              resultData: resetRes,
            });
          } else {
            onProgress?.(`✗ Password reset failed: ${resetRes.errorMessage || resetRes.message}`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'FAILED',
              errorMessage: resetRes.errorMessage || resetRes.message || 'Password reset failed on remote client.',
              totalDurationMs,
              resultData: resetRes,
            });
          }
          return;
        }
      } catch (err: any) {
        const totalDurationMs = Date.now() - startTime;
        onProgress?.(`[MUTATION ERROR] ${err.message}`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'FAILED',
          errorMessage: err.message || 'Remote mutation failed',
          totalDurationMs,
          resultData: {
            success: false,
            errorCode: 'MUTATION_RUNTIME_ERROR',
            errorMessage: err.message,
          },
        });
      } finally {
        if (mutationContext) {
          try {
            await new Promise((r) => setTimeout(r, 600)); // Brief display of verified result
            await mutationContext.close();
            onProgress?.(`Visible Chrome mutation window closed safely.`);
          } catch {}
        }
      }
      return;
    }

    // =========================================================================
    // 3. INTERACTIVE & DIRECT CLIENT APPLICATION WORKFLOWS (HEADED)
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
            await page.bringToFront().catch(() => {});
            onProgress?.(`Existing client window focused.`);
          } else {
            // Context is warm, open fresh page in same context immediately (<50ms)
            context = existingContext;
            page = await existingContext.newPage();
            await page.bringToFront().catch(() => {});
            onProgress?.(`Client window reopened and authenticated.`);
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
        onProgress?.(`Opening selected client…`);
        try {
          context = await BrowserProfileManager.launchPersistentContext({
            clientId: task.clientId,
            userId: effectiveUserId,
            isHeaded: task.options?.isHeaded ?? true,
            namespace: 'interactive',
            slowMo: 0,
          });
        } catch (err: any) {
          const isLockErr = err.message && (err.message.includes('lock') || err.message.includes('EBUSY') || err.message.includes('Process singleton'));
          const errCode = isLockErr ? 'CLIENT_PROFILE_LOCKED' : 'CLIENT_WINDOW_LAUNCH_FAILED';
          onProgress?.(`✗ Window launch failed: ${errCode}`);
          await this.agentClient.sendTelemetry(task.runId, {
            status: 'FAILED',
            errorMessage: err.message || errCode,
            totalDurationMs: Date.now() - startTime,
            resultData: { success: false, errorCode: errCode, errorMessage: err.message },
          });
          return;
        }

        this.activeProfileContexts.set(profileKey, context);
        context.on('close', () => {
          this.activeProfileContexts.delete(profileKey);
        });
      }

      if (!context) {
        throw new Error('CLIENT_WINDOW_LAUNCH_FAILED');
      }

      if (!page) {
        page = context.pages()[0] || (await context.newPage());
        await page.bringToFront().catch(() => {});
      }

      // Default Interactive / Workflow Execution (Login, Service Creation, etc.)
      const resolvedLoginUrl = buildAbsoluteUrl(task.clientBaseUrl, task.loginRoute, '/login');

      onProgress?.(`Checking client session…`);
      const isSessionActive = await WorkflowExecutor.checkSessionActive(page, task.workflowVersion);

      if (isSessionActive && (task.taskType === 'INTERACTIVE_LOGIN' || task.taskType === 'OPEN_INTERACTIVE_CLIENT_SESSION')) {
        const totalDurationMs = Date.now() - startTime;
        onProgress?.(`Login successful — client ready.`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'COMPLETED',
          totalDurationMs,
          resultData: { success: true, status: 'ALREADY_AUTHENTICATED' },
        });
        return;
      }

      if (!isSessionActive && (task.taskType === 'INTERACTIVE_LOGIN' || task.taskType === 'OPEN_INTERACTIVE_CLIENT_SESSION')) {
        onProgress?.(`Session expired — signing in again…`);
      }

      const variables: Record<string, any> = {
        loginUrl: resolvedLoginUrl,
        servicesUrl: buildAbsoluteUrl(task.clientBaseUrl, undefined, '/services'),
        usersUrl: buildAbsoluteUrl(task.clientBaseUrl, task.targetRoute, '/users'),
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
        onProgress?.(`Login successful — client ready.`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'COMPLETED',
          totalDurationMs,
          resultData: { success: true, status: 'REAUTHENTICATED' },
        });

        if (!task.options?.leaveBrowserOpen) {
          await context.close();
          this.activeProfileContexts.delete(profileKey);
        }
      } else if (result.status === 'REQUIRES_MANUAL_INTERVENTION') {
        onProgress?.(`! Task ${task.runId} requires manual security intervention: ${result.errorMessage}`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'REQUIRES_MANUAL_INTERVENTION',
          errorMessage: result.errorMessage || 'Manual security verification is required in the opened browser window.',
          totalDurationMs,
        });
      } else {
        const mappedCode =
          result.classifiedCode === 'SELECTOR_NOT_FOUND'
            ? 'CLIENT_LOGIN_FORM_NOT_FOUND'
            : result.classifiedCode === 'LOGIN_TIMEOUT'
            ? 'CLIENT_DASHBOARD_VERIFICATION_FAILED'
            : result.classifiedCode === 'INVALID_CREDENTIALS'
            ? 'CLIENT_AUTO_LOGIN_FAILED'
            : result.classifiedCode || 'CLIENT_SESSION_REAUTHENTICATION_FAILED';

        onProgress?.(`✗ Login failed: ${mappedCode}`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'FAILED',
          errorMessage: result.errorMessage || mappedCode,
          totalDurationMs,
          resultData: { success: false, errorCode: mappedCode, errorMessage: result.errorMessage },
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
