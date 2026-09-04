import { BrowserContext, Page } from 'playwright';
import { BrowserProfileManager, WorkflowExecutor, UserManagementExecutor, SyncProgressUpdate } from '@hmc/automation';
import { AgentTaskAssignment, AutomationRunStepTelemetry, resolveClientRoute } from '@hmc/shared';
import { AgentClient } from './agent-client.js';

function buildAbsoluteUrl(baseUrl: string, route?: string, fallbackRoute: string = '/'): string {
  return resolveClientRoute({ baseUrl, route, fallbackRoute });
}

function sanitizeErrorMessage(msg: string): string {
  if (!msg) return 'Operation failed';
  let clean = msg;

  // Remove full local file paths / profile paths
  clean = clean.replace(/(?:\/[a-zA-Z0-9._-]+)+\/\.hmc-console\/profiles\/[^\s'"]+/g, '[PROFILE_DIR]');
  clean = clean.replace(/(?:[a-zA-Z]:\\[^\s'"]+)\.hmc-console\\profiles\\[^\s'"]+/g, '[PROFILE_DIR]');
  clean = clean.replace(/(?:\/[a-zA-Z0-9._-]+){3,}/g, (p) => (p.includes('.hmc-console') ? '[INTERNAL_PATH]' : p));

  // Remove chrome launch args or binary paths
  clean = clean.replace(/\/Applications\/Google Chrome\.app[^\s'"]*/g, '[CHROME_BIN]');
  clean = clean.replace(/--user-data-dir=[^\s'"]+/g, '[USER_DATA_DIR]');

  // Remove potential password or token patterns
  clean = clean.replace(/(?:password|token|secret|bearer)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED_CREDENTIAL]');

  // Classify Playwright internal target closure messages
  if (clean.includes('Target page, context or browser has been closed') || clean.includes('Target closed')) {
    clean = clean.replace(/.*(?:Target page, context or browser has been closed|Target closed).*/gi, 'DOM_READ_ABORTED: Target page, context or browser has been closed');
  }

  return clean.trim();
}

export class AutomationWorker {
  // Operator-owned persistent contexts (namespace: 'interactive')
  private activeOperatorContexts: Map<string, BrowserContext> = new Map();
  // Single-flight task locks per client profile key
  private singleFlightTasks: Map<string, Promise<void>> = new Map();

  constructor(private agentClient: AgentClient) {}

  public async executeTask(task: AgentTaskAssignment, onProgress?: (msg: string) => void): Promise<void> {
    const effectiveUserId = (task.payload?.userId || 'operator').replace(/[^a-zA-Z0-9_-]/g, '_');
    
    // Determine strict profile namespace
    const isHeadlessSync = task.taskType === 'SYNC_CLIENT_USERS_HEADLESS' || task.taskType === 'SYNC_CLIENT_USERS';
    const isInspectTask = task.taskType === 'INSPECT_CREATE_FORM_METADATA' || task.taskType === 'INSPECT_FORM_OPTIONS';
    const isMutationTask = [
      'CREATE_CLIENT_USER',
      'CREATE_USER',
      'EDIT_CLIENT_USER',
      'EDIT_AND_UPDATE_CLIENT',
      'SET_CLIENT_USER_STATUS',
      'CHANGE_CLIENT_USER_STATUS',
      'RESET_CLIENT_USER_PASSWORD',
    ].includes(task.taskType);

    const namespace: 'interactive' | 'sync' | 'mutation' = isHeadlessSync || isInspectTask
      ? 'sync'
      : isMutationTask
      ? 'mutation'
      : 'interactive';

    const profileKey = `${task.clientId}_${effectiveUserId}_${namespace}`;

    // Single-flight lock: Prevent duplicate concurrent launches for the same client profile namespace
    const inFlight = this.singleFlightTasks.get(profileKey);
    if (inFlight) {
      onProgress?.(`A task is already in-flight for client [${task.clientId}] (${namespace}). Awaiting execution...`);
      return inFlight;
    }

    const taskExecutionPromise = this.performTaskExecution(task, profileKey, effectiveUserId, namespace, onProgress);
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
    namespace: 'interactive' | 'sync' | 'mutation',
    onProgress?: (msg: string) => void
  ): Promise<void> {
    const startTime = Date.now();
    onProgress?.(`Starting task [${task.taskType}] for client [${task.clientId}] (namespace: ${namespace})...`);

    // =========================================================================
    // 1. DEDICATED HEADLESS BACKGROUND SYNC HANDLER (namespace: 'sync')
    // =========================================================================
    if (task.taskType === 'SYNC_CLIENT_USERS_HEADLESS' || task.taskType === 'SYNC_CLIENT_USERS') {
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
          const safeError = sanitizeErrorMessage(syncRes.errorMessage || 'Background user synchronization failed');
          onProgress?.(`✗ [BACKGROUND SYNC FAILED] ${syncRes.errorCode}: ${safeError}`);
          await this.agentClient.sendTelemetry(task.runId, {
            status: 'FAILED',
            errorMessage: safeError,
            totalDurationMs,
            resultData: { ...syncRes, errorMessage: safeError },
          });
        }
      } catch (err: any) {
        const totalDurationMs = Date.now() - startTime;
        const safeMsg = sanitizeErrorMessage(err.message || 'Background sync runtime failure');
        onProgress?.(`[FATAL SYNC ERROR] ${safeMsg}`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'FAILED',
          errorMessage: safeMsg,
          totalDurationMs,
          resultData: {
            success: false,
            errorCode: 'CLIENT_USER_SYNC_TIMEOUT',
            errorMessage: safeMsg,
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
    // 1.5 DEDICATED HEADLESS LIVE FORM OPTIONS INSPECTOR (namespace: 'sync')
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
        const safeMsg = sanitizeErrorMessage(err.message || 'FORM_OPTIONS_UNAVAILABLE');
        onProgress?.(`[INSPECT OPTIONS ERROR] ${safeMsg}`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'FAILED',
          errorMessage: safeMsg,
          totalDurationMs,
          resultData: {
            success: false,
            errorCode: 'FORM_OPTIONS_UNAVAILABLE',
            errorMessage: safeMsg,
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
    // 2. REMOTE CLIENT MUTATION WORKFLOWS (VISIBLE CHROME - namespace: 'mutation')
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

      await this.executeMutationWithLifecycle(task, effectiveUserId, startTime, onProgress);
      return;
    }

    // =========================================================================
    // 3. INTERACTIVE & DIRECT CLIENT APPLICATION WORKFLOWS (namespace: 'interactive')
    // =========================================================================
    await this.executeInteractiveWorkflow(task, effectiveUserId, startTime, onProgress);
  }

  /**
   * Executes a mutation task using an isolated worker-owned 'mutation' profile context.
   * Handles pre-click retry and post-click read-only reconciliation.
   */
  private async executeMutationWithLifecycle(
    task: AgentTaskAssignment,
    effectiveUserId: string,
    startTime: number,
    onProgress?: (msg: string) => void
  ): Promise<void> {
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

    let mutationPhase: string = 'PRE_ACTION';
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let mutationContext: BrowserContext | null = null;
      let contextClosed = false;

      try {
        onProgress?.(`Launching isolated visible Chrome mutation context (attempt ${attempt}/${maxAttempts})...`);
        
        mutationContext = await BrowserProfileManager.launchPersistentContext({
          clientId: task.clientId,
          userId: effectiveUserId,
          isHeaded: true,
          namespace: 'mutation', // Isolated worker-owned mutation profile
          slowMo: 50,
        });

        mutationContext.on('close', () => {
          contextClosed = true;
        });

        const mutationPage = mutationContext.pages()[0] || (await mutationContext.newPage());
        await mutationPage.bringToFront().catch(() => {});

        mutationPhase = 'PRE_ACTION';

        // 1. Create User
        if (task.taskType === 'CREATE_CLIENT_USER' || task.taskType === 'CREATE_USER') {
          const payloadData = task.payload?.payload || task.payload;
          const addUsersUrl = resolveClientRoute({
            baseUrl: task.clientBaseUrl,
            applicationPath: appPath,
            route: task.payload?.addUsersRoute || task.addUsersRoute,
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
            onMutationDispatched: () => {
              mutationPhase = 'MUTATION_DISPATCHED';
            },
          } as any);

          const serializableResult = JSON.parse(JSON.stringify(createRes));
          const totalDurationMs = Date.now() - startTime;

          if (createRes.success) {
            onProgress?.(`✓ Created client user ${createRes.username}`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'COMPLETED',
              totalDurationMs,
              resultData: serializableResult,
            });
          } else {
            const safeError = sanitizeErrorMessage(createRes.message || createRes.errorMessage || 'User creation failed on client portal.');
            onProgress?.(`✗ Failed to create user: ${safeError}`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'FAILED',
              errorMessage: safeError,
              totalDurationMs,
              resultData: { ...serializableResult, errorMessage: safeError },
            });
          }
          return;
        }

        // 2. Edit User
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
            onMutationDispatched: () => {
              mutationPhase = 'MUTATION_DISPATCHED';
            },
          } as any);

          const serializableResult = JSON.parse(JSON.stringify(editRes));
          const totalDurationMs = Date.now() - startTime;

          if (editRes.success) {
            onProgress?.(`✓ Updated and verified user '${editRes.username}' on client.`);
            await this.agentClient.sendTelemetry(task.runId, { status: 'COMPLETED', totalDurationMs, resultData: serializableResult });
          } else {
            const safeError = sanitizeErrorMessage(editRes.message || editRes.errorMessage || 'Update failed');
            onProgress?.(`✗ Failed to update user: ${safeError}`);
            await this.agentClient.sendTelemetry(task.runId, { status: 'FAILED', errorMessage: safeError, totalDurationMs, resultData: { ...serializableResult, errorMessage: safeError } });
          }
          return;
        }

        // 3. Set User Status (Activate / Deactivate)
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
            remoteUserId: task.payload?.remoteUserId || task.remoteUserId,
            loginUrl,
            credentials: task.credentials,
            onProgress: reportProgress,
            onMutationDispatched: () => {
              mutationPhase = 'MUTATION_DISPATCHED';
            },
          } as any);

          const serializableResult = JSON.parse(JSON.stringify(statusRes));
          const totalDurationMs = Date.now() - startTime;

          if (statusRes.success) {
            reportProgress(`✓ Remote status verified: '${statusRes.username}' is ${statusRes.status}.`);
            await this.agentClient.sendTelemetry(task.runId, { status: 'COMPLETED', totalDurationMs, resultData: serializableResult });
          } else {
            const safeError = sanitizeErrorMessage(statusRes.errorMessage || statusRes.message || 'Remote status verification failed');
            onProgress?.(`✗ Remote status verification failed: ${safeError}`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'FAILED',
              errorMessage: safeError,
              totalDurationMs,
              resultData: { ...serializableResult, errorMessage: safeError },
            });
          }
          return;
        }

        // 4. Reset User Password
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
            onMutationDispatched: () => {
              mutationPhase = 'MUTATION_DISPATCHED';
            },
          } as any);

          const serializableResult = JSON.parse(JSON.stringify(resetRes));
          const totalDurationMs = Date.now() - startTime;

          if (resetRes.success) {
            reportProgress(`✓ Password reset confirmed for '${resetRes.username}'.`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'COMPLETED',
              totalDurationMs,
              resultData: serializableResult,
            });
          } else {
            const safeError = sanitizeErrorMessage(resetRes.errorMessage || resetRes.message || 'Password reset failed on remote client.');
            onProgress?.(`✗ Password reset failed: ${safeError}`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'FAILED',
              errorMessage: safeError,
              totalDurationMs,
              resultData: { ...serializableResult, errorMessage: safeError },
            });
          }
          return;
        }
      } catch (err: any) {
        const errMessage = err.message || '';
        const isTargetClosed =
          errMessage.includes('Target page, context or browser has been closed') ||
          errMessage.includes('Target closed') ||
          errMessage.includes('browser has been disconnected') ||
          contextClosed;

        if (isTargetClosed) {
          if (mutationPhase === 'PRE_ACTION' && attempt < maxAttempts) {
            onProgress?.(`! Browser context closed before mutation dispatch. Retrying mutation (attempt ${attempt + 1}/${maxAttempts})...`);
            if (mutationContext) {
              try { await mutationContext.close(); } catch {}
            }
            await new Promise((r) => setTimeout(r, 600));
            continue; // Retry once
          }

          if (mutationPhase === 'MUTATION_DISPATCHED' || mutationPhase === 'POST_ACTION_VERIFY') {
            onProgress?.(`! Browser context closed after mutation dispatch. Performing read-only reconciliation...`);
            
            // Perform read-only outcome reconciliation using isolated headless sync context
            const reconciliation = await this.reconcileMutationOutcome(task, effectiveUserId, usersListUrl, loginUrl);
            const totalDurationMs = Date.now() - startTime;

            if (reconciliation.reconciled) {
              onProgress?.(`✓ Remote mutation confirmed via reconciliation snapshot.`);
              await this.agentClient.sendTelemetry(task.runId, {
                status: 'COMPLETED',
                totalDurationMs,
                resultData: reconciliation.result,
              });
              return;
            } else {
              onProgress?.(`✗ Remote mutation outcome unknown after browser closure.`);
              await this.agentClient.sendTelemetry(task.runId, {
                status: 'FAILED',
                errorMessage: 'REMOTE_OUTCOME_UNKNOWN: Browser closed after action was sent. Mutation could not be verified in remote snapshot.',
                totalDurationMs,
                resultData: {
                  success: false,
                  errorCode: 'REMOTE_OUTCOME_UNKNOWN',
                  errorMessage: 'Browser closed after action was sent. Mutation could not be verified in remote snapshot.',
                },
              });
              return;
            }
          }

          // Pre-action closure on last attempt
          const totalDurationMs = Date.now() - startTime;
          const mappedCode = 'BROWSER_CONTEXT_CLOSED_BEFORE_ACTION';
          const safeMsg = 'Browser context was closed before the remote action could be performed.';
          onProgress?.(`✗ ${mappedCode}: ${safeMsg}`);
          await this.agentClient.sendTelemetry(task.runId, {
            status: 'FAILED',
            errorMessage: safeMsg,
            totalDurationMs,
            resultData: { success: false, errorCode: mappedCode, errorMessage: safeMsg },
          });
          return;
        }

        // Generic error
        const totalDurationMs = Date.now() - startTime;
        const safeMsg = sanitizeErrorMessage(errMessage || 'Remote mutation failed');
        onProgress?.(`[MUTATION ERROR] ${safeMsg}`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'FAILED',
          errorMessage: safeMsg,
          totalDurationMs,
          resultData: {
            success: false,
            errorCode: 'MUTATION_RUNTIME_ERROR',
            errorMessage: safeMsg,
          },
        });
        return;
      } finally {
        if (mutationContext) {
          try {
            await new Promise((r) => setTimeout(r, 400));
            await mutationContext.close();
            onProgress?.(`Visible Chrome mutation window closed safely.`);
          } catch {}
        }
      }
    }
  }

  /**
   * Performs read-only remote reconciliation using an isolated headless sync context.
   */
  private async reconcileMutationOutcome(
    task: AgentTaskAssignment,
    effectiveUserId: string,
    usersListUrl: string,
    loginUrl: string
  ): Promise<{ reconciled: boolean; result?: any }> {
    let syncContext: BrowserContext | null = null;
    try {
      syncContext = await BrowserProfileManager.launchPersistentContext({
        clientId: task.clientId,
        userId: effectiveUserId,
        isHeaded: false,
        namespace: 'sync',
      });
      const page = syncContext.pages()[0] || (await syncContext.newPage());
      const syncRes = await UserManagementExecutor.syncUsersHeadless(page, {
        usersUrl: usersListUrl,
        loginUrl,
        credentials: task.credentials?.password
          ? { username: task.credentials.username, password: task.credentials.password }
          : undefined,
      });

      if (syncRes.success && syncRes.users) {
        const username = (task.payload?.username || '').trim().toLowerCase();
        const matched = syncRes.users.find((u) => u.username.toLowerCase() === username);

        if (task.taskType === 'CREATE_CLIENT_USER' || task.taskType === 'CREATE_USER') {
          if (matched) {
            return {
              reconciled: true,
              result: {
                success: true,
                username: matched.username,
                status: matched.status,
                message: `User '${matched.username}' confirmed present on client via post-closure reconciliation.`,
              },
            };
          }
        }

        if (task.taskType === 'SET_CLIENT_USER_STATUS' || task.taskType === 'CHANGE_CLIENT_USER_STATUS') {
          const targetStatus = task.payload.status || task.payload.targetStatus;
          if (matched && matched.status === targetStatus) {
            return {
              reconciled: true,
              result: {
                success: true,
                username: matched.username,
                status: matched.status,
                message: `User '${matched.username}' status confirmed as ${matched.status} via reconciliation.`,
              },
            };
          }
        }
      }
    } catch {
      // Reconciliation scrape failed
    } finally {
      if (syncContext) {
        try { await syncContext.close(); } catch {}
      }
    }
    return { reconciled: false };
  }

  /**
   * Executes interactive sessions or workflows using an operator-owned 'interactive' profile context.
   */
  private async executeInteractiveWorkflow(
    task: AgentTaskAssignment,
    effectiveUserId: string,
    startTime: number,
    onProgress?: (msg: string) => void
  ): Promise<void> {
    const profileKey = `${task.clientId}_${effectiveUserId}`;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      // Check if an active operator context already exists for this client
      const existingContext = this.activeOperatorContexts.get(profileKey);
      if (existingContext) {
        try {
          const pages = existingContext.pages();
          if (pages.length > 0) {
            context = existingContext;
            page = pages[0];
            await page.bringToFront().catch(() => {});
            onProgress?.(`Existing client window focused.`);
          } else {
            context = existingContext;
            page = await existingContext.newPage();
            await page.bringToFront().catch(() => {});
            onProgress?.(`Client window reopened and authenticated.`);
          }
        } catch {
          try { await existingContext.close(); } catch {}
          this.activeOperatorContexts.delete(profileKey);
          context = null;
          page = null;
        }
      }

      // If no valid context is open, launch persistent interactive context
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
          const errCode = isLockErr ? 'PROFILE_ALREADY_IN_USE' : 'CLIENT_WINDOW_LAUNCH_FAILED';
          const safeMsg = sanitizeErrorMessage(err.message || errCode);
          onProgress?.(`✗ Window launch failed: ${errCode}`);
          await this.agentClient.sendTelemetry(task.runId, {
            status: 'FAILED',
            errorMessage: safeMsg,
            totalDurationMs: Date.now() - startTime,
            resultData: { success: false, errorCode: errCode, errorMessage: safeMsg },
          });
          return;
        }

        this.activeOperatorContexts.set(profileKey, context);
        context.on('close', () => {
          this.activeOperatorContexts.delete(profileKey);
        });
      }

      if (!context) {
        throw new Error('CLIENT_WINDOW_LAUNCH_FAILED');
      }

      if (!page) {
        page = context.pages()[0] || (await context.newPage());
        await page.bringToFront().catch(() => {});
      }

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

        if (task.options?.leaveBrowserOpen === false) {
          await context.close();
          this.activeOperatorContexts.delete(profileKey);
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

        const safeError = sanitizeErrorMessage(result.errorMessage || mappedCode);
        onProgress?.(`✗ Login failed: ${mappedCode}`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'FAILED',
          errorMessage: safeError,
          totalDurationMs,
          resultData: { success: false, errorCode: mappedCode, errorMessage: safeError },
        });
      }
    } catch (err: any) {
      const totalDurationMs = Date.now() - startTime;
      const safeMsg = sanitizeErrorMessage(err.message || 'Worker runtime error');
      onProgress?.(`[FATAL] Error in task execution: ${safeMsg}`);
      await this.agentClient.sendTelemetry(task.runId, {
        status: 'FAILED',
        errorMessage: safeMsg,
        totalDurationMs,
      });
    }
  }

  public getActiveContextCount(): number {
    return this.activeOperatorContexts.size;
  }
}
