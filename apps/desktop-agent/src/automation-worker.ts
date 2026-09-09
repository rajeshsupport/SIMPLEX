import * as crypto from 'crypto';
import { BrowserContext, Page } from 'playwright';
import { BrowserProfileManager, BrowserLifecycleManager, WorkflowExecutor, UserManagementExecutor, ResourceManagementExecutor, SyncProgressUpdate, SelectorResolver } from '@hmc/automation';
import { AgentTaskAssignment, AutomationRunStepTelemetry, resolveClientRoute, resolveClientRoleUrl, resolveClientResourceUrl, resolveClientResourceUserMappingUrl, normalizeClientBaseUrl, resolveTaskModePolicy, isMutationTaskType } from '@hmc/shared';
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
  private browserLifecycleManager = BrowserLifecycleManager.getInstance();

  constructor(private agentClient: AgentClient) {}


  public async executeTask(task: AgentTaskAssignment, onProgress?: (msg: string) => void): Promise<void> {
    const effectiveUserId = (task.payload?.userId || 'operator').replace(/[^a-zA-Z0-9_-]/g, '_');
    
    // Resolve immutable task mode policy — fail closed before browser launch on unknown types
    let policy: any;
    try {
      policy = resolveTaskModePolicy(task.taskType, task.options);
    } catch (policyErr: any) {
      const errMsg = policyErr.message || `Unknown task type [${task.taskType}] rejected.`;
      onProgress?.(`✗ Rejected task [${task.taskType}]: ${errMsg}`);
      await this.agentClient.sendTelemetry(task.runId, {
        status: 'FAILED',
        errorMessage: errMsg,
        totalDurationMs: 0,
        resultData: {
          success: false,
          errorCode: 'UNCLASSIFIED_TASK_TYPE_BLOCKED',
          errorMessage: errMsg,
        },
      });
      return;
    }

    // Immutably derive effective execution mode, headedness, and leaveBrowserOpen exclusively from canonical policy
    const effectiveIsHeaded = policy.isHeaded;
    const effectiveExecutionMode = policy.executionMode;

    const effectiveLeaveBrowserOpen =
      policy.namespace === 'interactive'
        ? task.options?.leaveBrowserOpen === true
        : false;

    if (policy.namespace === 'mutation') {
      if (task.executionMode === 'HEADLESS_SYNC' || task.options?.isHeaded === false || process.env.HEADLESS === 'true') {
        onProgress?.(`[POLICY ENFORCED] Task [${task.taskType}] is a mutation. Overriding requested headless mode to headed visible Chrome.`);
      }
    } else if (policy.namespace === 'read_only') {
      if (task.executionMode === 'HEADED_MUTATION' || task.options?.isHeaded === true || process.env.HEADLESS === 'false') {
        onProgress?.(`[POLICY ENFORCED] Task [${task.taskType}] is read-only. Enforcing headless mode.`);
      }
    }

    const resolvedTask: AgentTaskAssignment = {
      ...task,
      executionMode: effectiveExecutionMode,
      options: {
        ...(task.options || {}),
        isHeaded: effectiveIsHeaded,
        leaveBrowserOpen: effectiveLeaveBrowserOpen,
      },
    };

    const namespace: 'interactive' | 'sync' | 'mutation' =
      policy.namespace === 'mutation'
        ? 'mutation'
        : policy.namespace === 'read_only'
        ? 'sync'
        : 'interactive';

    const profileKey = `${task.clientId}_${effectiveUserId}_${namespace}`;

    // Single-flight lock: Prevent duplicate concurrent launches for the same client profile namespace
    const inFlight = this.singleFlightTasks.get(profileKey);
    if (inFlight) {
      onProgress?.(`A task is already in-flight for client [${task.clientId}] (${namespace}). Awaiting execution...`);
      return inFlight;
    }

    const taskExecutionPromise = this.performTaskExecution(resolvedTask, profileKey, effectiveUserId, namespace, onProgress);
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
    const clientName = task.payload?.clientName || task.payload?.clientCode || 'Simplex Client';
    const version = SelectorResolver.normalizeVersionString(
      task.payload?.applicationVersion || (typeof task.workflowVersion === 'object' ? (task.workflowVersion as any)?.applicableAppVersion : task.workflowVersion),
      'v9.4'
    );
    const selectorProfile = SelectorResolver.normalizeSelectorProfile(
      task.payload?.selectorProfileVersion || (typeof task.workflowVersion === 'object' ? (task.workflowVersion as any)?.applicableAppVersion : undefined),
      'v9.3'
    );
    let resolvedRoleUrl = 'UNKNOWN';
    try {
      resolvedRoleUrl = resolveClientRoleUrl({
        baseUrl: task.clientBaseUrl,
        applicationPath: task.clientAppPath || task.payload?.applicationPath,
        userRoleRoute: task.payload?.userRoleRoute,
      });
    } catch (urlErr: any) {
      resolvedRoleUrl = `NOT_RESOLVED (${urlErr.message})`;
    }

    onProgress?.(`Starting task [${task.taskType}] for client [${task.clientId}] (namespace: ${namespace})...`);
    onProgress?.(`[AUTOMATION TELEMETRY] Client ID: ${task.clientId} | Client Name: ${clientName} | Configured Base URL: ${task.clientBaseUrl} | Resolved addUserRole URL: ${resolvedRoleUrl} | Version: ${version} | Selector Profile: ${selectorProfile} | Status: INITIALIZING`);

    // =========================================================================
    // 1. DEDICATED HEADLESS BACKGROUND SYNC HANDLER (namespace: 'sync')
    // =========================================================================
    if (task.taskType === 'SYNC_CLIENT_USERS_HEADLESS' || task.taskType === 'SYNC_CLIENT_USERS') {
      let lease: any = null;
      try {
        onProgress?.(`[BACKGROUND SYNC] Launching isolated headless sync context for client [${task.clientId}]...`);
        
        lease = await this.browserLifecycleManager.acquireLease({
          taskId: task.taskType,
          runId: task.runId,
          clientId: task.clientId,
          userId: effectiveUserId,
          ownerType: 'AUTOMATION_OWNED',
          namespace: 'sync',
          isHeaded: false,
          slowMo: 0,
        });

        const syncPage = lease.primaryPage;

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

          // Byte-aware chunking: maximum 100 records per batch and strictly <= 400 KB (409,600 bytes) UTF-8 payload target
          const scrapedUsers = syncRes.users || [];
          const batchId = crypto.randomUUID();
          const maxRecordsPerBatch = 100;
          const maxPayloadBytes = 400 * 1024; // 400 KB safe target (well within 500 KB parser limit)

          const batches: (typeof scrapedUsers)[] = [];
          let currentBatch: typeof scrapedUsers = [];

          for (const user of scrapedUsers) {
            // Check trial batch byte size if adding this user
            const trialBatch = [...currentBatch, user];
            const trialDto = {
              batchId,
              runId: task.runId,
              clientId: task.clientId,
              sequenceNumber: batches.length + 1,
              totalBatches: batches.length + 1,
              isFinalBatch: false,
              idempotencyKey: `${batchId}-${batches.length + 1}`,
              users: trialBatch,
            };
            const trialBytes = Buffer.byteLength(JSON.stringify(trialDto), 'utf8');

            if (currentBatch.length >= maxRecordsPerBatch || (currentBatch.length > 0 && trialBytes > maxPayloadBytes)) {
              // Flush current batch and start new batch
              batches.push(currentBatch);
              currentBatch = [user];
            } else {
              currentBatch.push(user);
            }
          }
          if (currentBatch.length > 0) {
            batches.push(currentBatch);
          }
          if (batches.length === 0) {
            batches.push([]);
          }

          // Verification & re-split pass: ensure every assembled batch fits <= 400 KB with full wrapper metadata
          let verifiedBatches: (typeof scrapedUsers)[] = [];
          const queue = [...batches];
          while (queue.length > 0) {
            const candidate = queue.shift()!;
            if (candidate.length <= 1) {
              verifiedBatches.push(candidate);
              continue;
            }
            const candidateDto = {
              batchId,
              runId: task.runId,
              clientId: task.clientId,
              sequenceNumber: verifiedBatches.length + 1,
              totalBatches: verifiedBatches.length + queue.length + 1,
              isFinalBatch: queue.length === 0,
              idempotencyKey: `${batchId}-${verifiedBatches.length + 1}`,
              users: candidate,
            };
            const candidateBytes = Buffer.byteLength(JSON.stringify(candidateDto), 'utf8');
            if (candidateBytes <= maxPayloadBytes) {
              verifiedBatches.push(candidate);
            } else {
              // Exceeds 400 KB target: split candidate batch into halves and re-check
              const mid = Math.floor(candidate.length / 2);
              queue.unshift(candidate.slice(mid));
              queue.unshift(candidate.slice(0, mid));
            }
          }

          const totalBatches = verifiedBatches.length;
          for (let i = 0; i < totalBatches; i++) {
            const chunk = verifiedBatches[i];
            const sequenceNumber = i + 1;
            const isFinalBatch = sequenceNumber === totalBatches;
            const finalDto = {
              batchId,
              runId: task.runId,
              clientId: task.clientId,
              sequenceNumber,
              totalBatches,
              isFinalBatch,
              idempotencyKey: `${batchId}-${sequenceNumber}`,
              users: chunk,
            };

            // Recalculate Buffer.byteLength(JSON.stringify(finalDto), 'utf8') immediately before transmission
            const finalBytes = Buffer.byteLength(JSON.stringify(finalDto), 'utf8');
            onProgress?.(
              `[SYNC CHUNK] Dispatching byte-aware batch ${sequenceNumber}/${totalBatches} (${chunk.length} users, ${finalBytes} bytes)...`
            );
            await this.agentClient.sendSyncBatch(task.runId, finalDto);
          }

          // Send lightweight completion telemetry (without oversized raw users array)
          await this.agentClient.sendTelemetry(task.runId, {
            status: 'COMPLETED',
            totalDurationMs,
            resultData: {
              success: true,
              totalScraped: syncRes.totalScraped,
              stage: 'COMPLETED',
              message: `Sync completed: ${syncRes.totalScraped} users reconciled across ${totalBatches} bounded batch(es).`,
            },
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
        if (lease) {
          try {
            await lease.close({ reason: 'SYNC_COMPLETED' });
            onProgress?.('[BACKGROUND SYNC] Headless sync context cleanly released.');
          } catch {}
        }
      }
      return;
    }

    // =========================================================================
    // 1.1 DEDICATED HEADLESS REFRESH CLIENT USER ROLES HANDLER (namespace: 'sync')
    // =========================================================================
    if (task.taskType === 'REFRESH_CLIENT_USER_ROLES') {
      let lease: any = null;
      try {
        onProgress?.(`[ROLE REFRESH] Launching isolated headless role refresh context for client [${task.clientId}]...`);

        lease = await this.browserLifecycleManager.acquireLease({
          taskId: task.taskType,
          runId: task.runId,
          clientId: task.clientId,
          userId: effectiveUserId,
          ownerType: 'AUTOMATION_OWNED',
          namespace: 'sync',
          isHeaded: false,
          slowMo: 0,
        });

        const refreshPage = lease.primaryPage;
        const roleUrl = resolveClientRoleUrl({
          baseUrl: task.clientBaseUrl,
          applicationPath: task.clientAppPath || task.payload?.applicationPath,
          userRoleRoute: task.payload?.userRoleRoute,
        });
        const loginUrl = resolveClientRoute({
          baseUrl: task.clientBaseUrl,
          applicationPath: task.clientAppPath || task.payload?.applicationPath,
          route: task.loginRoute,
          fallbackRoute: '/login',
        });

        const username = task.payload?.username || (task.payload?.payload && task.payload.payload.username);
        const remoteUserId = task.payload?.remoteUserId || (task.payload?.payload && task.payload.payload.remoteUserId);

        onProgress?.(`[ROLE REFRESH] Reading assigned roles for user '${username}' on ${roleUrl}...`);

        const refreshRes = await UserManagementExecutor.readUserAssignedRoles(refreshPage, {
          roleUrl,
          username,
          remoteUserId,
          loginUrl,
          credentials: task.credentials?.password
            ? { username: task.credentials.username, password: task.credentials.password }
            : undefined,
          onProgress: (msg: string) => {
            onProgress?.(`[ROLE REFRESH PROGRESS] ${msg}`);
          },
        });

        const totalDurationMs = Date.now() - startTime;
        if (refreshRes.success) {
          onProgress?.(`[ROLE REFRESH SUCCESS] Discovered ${refreshRes.roles.length} roles for '${username}': ${refreshRes.roles.join(', ')}`);
          await this.agentClient.sendTelemetry(task.runId, {
            status: 'COMPLETED',
            totalDurationMs,
            resultData: refreshRes,
          });
        } else {
          const safeError = sanitizeErrorMessage(refreshRes.errorMessage || 'Role refresh failed on remote portal');
          onProgress?.(`[ROLE REFRESH FAILED] ${safeError}`);
          await this.agentClient.sendTelemetry(task.runId, {
            status: 'FAILED',
            errorMessage: safeError,
            totalDurationMs,
            resultData: refreshRes,
          });
        }
      } catch (err: any) {
        const totalDurationMs = Date.now() - startTime;
        const safeMsg = sanitizeErrorMessage(err.message || 'Background role refresh runtime failure');
        onProgress?.(`[FATAL ROLE REFRESH ERROR] ${safeMsg}`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'FAILED',
          errorMessage: safeMsg,
          totalDurationMs,
          resultData: {
            success: false,
            roles: [],
            errorCode: 'ROLE_REFRESH_RUNTIME_ERROR',
            errorMessage: safeMsg,
          },
        });
      } finally {
        if (lease) {
          try {
            await lease.close({ reason: 'SYNC_COMPLETED' });
            onProgress?.('[ROLE REFRESH] Headless role refresh context cleanly released.');
          } catch {}
        }
      }
      return;
    }

    // =========================================================================
    // 1.2 DEDICATED HEADLESS BACKGROUND RESOURCE SYNC HANDLER (namespace: 'sync')
    // =========================================================================
    if (
      task.taskType === 'SYNC_CLIENT_RESOURCES_HEADLESS' ||
      task.taskType === 'SYNC_CLIENT_RESOURCES' ||
      task.taskType === 'SYNC_RESOURCES'
    ) {
      if (!task.payload?.resourceDirectoryRoute) {
        onProgress?.(`✗ Rejected task [${task.taskType}]: RESOURCE_DIRECTORY_ROUTE_NOT_CONFIGURED`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'FAILED',
          errorMessage: 'RESOURCE_DIRECTORY_ROUTE_NOT_CONFIGURED: Resource Directory route is not configured for this client.',
          totalDurationMs: Date.now() - startTime,
          resultData: {
            success: false,
            errorCode: 'RESOURCE_DIRECTORY_ROUTE_NOT_CONFIGURED',
            errorMessage: 'Resource Directory route is not configured for this client.',
          },
        });
        return;
      }

      let lease: any = null;
      try {
        onProgress?.(`[BACKGROUND SYNC] Launching isolated headless resource sync context for client [${task.clientId}]...`);
        lease = await this.browserLifecycleManager.acquireLease({
          taskId: task.taskType,
          runId: task.runId,
          clientId: task.clientId,
          userId: effectiveUserId,
          ownerType: 'AUTOMATION_OWNED',
          namespace: 'sync',
          isHeaded: false,
          slowMo: 0,
        });

        const syncPage = lease.primaryPage;

        const resourcesUrl = resolveClientResourceUrl({
          baseUrl: task.clientBaseUrl,
          applicationPath: task.payload?.applicationPath,
          quickResourceRoute: task.payload?.quickResourceRoute || '/resources',
        });
        const loginUrl = resolveClientRoute({
          baseUrl: task.clientBaseUrl,
          applicationPath: task.payload?.applicationPath,
          route: task.loginRoute,
          fallbackRoute: '/login',
        });

        onProgress?.(`[BACKGROUND SYNC] Executing resource scrape on ${resourcesUrl}...`);

        const syncRes = await ResourceManagementExecutor.syncResourcesHeadless(syncPage, {
          resourcesUrl,
          loginUrl,
          credentials: task.credentials?.password
            ? { username: task.credentials.username, password: task.credentials.password }
            : undefined,
          onProgress: (update) => {
            onProgress?.(`[RESOURCE SYNC PROGRESS] ${update.message}`);
          },
        });

        const totalDurationMs = Date.now() - startTime;
        if (syncRes.success) {
          onProgress?.(`✓ [RESOURCE SYNC COMPLETED] Discovered ${syncRes.totalScraped} resources.`);
          await this.agentClient.sendTelemetry(task.runId, {
            status: 'COMPLETED',
            totalDurationMs,
            resultData: syncRes,
          });
        } else {
          const safeError = sanitizeErrorMessage(syncRes.errorMessage || syncRes.errorCode || 'Resource sync failed');
          onProgress?.(`✗ [RESOURCE SYNC FAILED] ${safeError}`);
          await this.agentClient.sendTelemetry(task.runId, {
            status: 'FAILED',
            errorMessage: safeError,
            totalDurationMs,
            resultData: { ...syncRes, errorMessage: safeError },
          });
        }
      } catch (err: any) {
        const totalDurationMs = Date.now() - startTime;
        const safeMsg = sanitizeErrorMessage(err.message || 'Resource sync runtime failure');
        onProgress?.(`[FATAL RESOURCE SYNC ERROR] ${safeMsg}`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: 'FAILED',
          errorMessage: safeMsg,
          totalDurationMs,
          resultData: { success: false, errorCode: 'CLIENT_RESOURCE_SYNC_FAILED', errorMessage: safeMsg },
        });
      } finally {
        if (lease) {
          try {
            await lease.close({ reason: 'SYNC_COMPLETED' });
          } catch {}
        }
      }
      return;
    }

    // =========================================================================
    // 1.5 DEDICATED HEADLESS LIVE FORM OPTIONS INSPECTOR (namespace: 'sync')
    // =========================================================================
    if (task.taskType === 'INSPECT_CREATE_FORM_METADATA' || task.taskType === 'INSPECT_FORM_OPTIONS') {
      let lease: any = null;
      try {
        onProgress?.(`[INSPECT OPTIONS] Launching isolated headless browser context for client [${task.clientId}]...`);
        lease = await this.browserLifecycleManager.acquireLease({
          taskId: task.taskType,
          runId: task.runId,
          clientId: task.clientId,
          userId: effectiveUserId,
          ownerType: 'AUTOMATION_OWNED',
          namespace: 'sync',
          isHeaded: false,
          slowMo: 0,
        });

        const inspectPage = lease.primaryPage;
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
        if (lease) {
          try {
            await lease.close({ reason: 'INSPECT_COMPLETED' });
            onProgress?.('[INSPECT OPTIONS] Headless inspect context cleanly released.');
          } catch {}
        }
      }
      return;
    }


    // =========================================================================
    // 2. REMOTE CLIENT MUTATION WORKFLOWS (VISIBLE CHROME - namespace: 'mutation')
    // =========================================================================
    if (isMutationTaskType(task.taskType)) {
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
      let lease: any = null;
      let contextClosed = false;

      try {
        onProgress?.(`Launching isolated visible Chrome mutation context (attempt ${attempt}/${maxAttempts})...`);
        
        lease = await this.browserLifecycleManager.acquireLease({
          taskId: task.taskType,
          runId: task.runId,
          clientId: task.clientId,
          userId: effectiveUserId,
          ownerType: 'AUTOMATION_OWNED',
          namespace: 'mutation', // Isolated worker-owned mutation profile
          isHeaded: true,
          slowMo: 50,
        });

        lease.context.on('close', () => {
          contextClosed = true;
        });

        const mutationPage = lease.primaryPage;
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
              resultData: {
                ...serializableResult,
                overallStatus: statusRes.overallStatus || 'PARTIAL_FAILED',
                statusChangeState: statusRes.statusChangeState || 'MUTATION_SUBMITTED_VERIFICATION_PENDING',
                retryStartingPoint: statusRes.retryStartingPoint || 'STATUS_VERIFICATION',
                errorCode: statusRes.errorCode || 'REMOTE_STATUS_VERIFICATION_UNKNOWN',
                errorMessage: safeError,
              },
            });
          }
          return;
        }

        // 4. Reset User Password
        if (task.taskType === 'RESET_CLIENT_USER_PASSWORD') {
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
          reportProgress(`Resetting password for '${task.payload.username}' in Simplex client…`);

          const resetRes = await UserManagementExecutor.resetUserPassword(mutationPage, {
            usersListUrl,
            username: task.payload.username,
            remoteUserId: task.payload?.remoteUserId || task.remoteUserId,
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

        // 5. Process Single User Full Workflow
        if (task.taskType === 'PROCESS_USER_FULL_WORKFLOW') {
          const payloadData = task.payload?.payload || task.payload;
          const addUsersUrl = resolveClientRoute({
            baseUrl: task.clientBaseUrl,
            applicationPath: appPath,
            route: task.payload?.addUsersRoute || task.addUsersRoute,
            fallbackRoute: '/addUsers',
          });
          const roleUrl = resolveClientRoleUrl({
            baseUrl: task.clientBaseUrl,
            applicationPath: appPath,
            userRoleRoute: task.payload?.userRoleRoute,
          });
          const username = payloadData?.username || task.payload?.username || 'user';

          onProgress?.(`Starting single-user full workflow for '${username}'…`);

          const workflowRes = await UserManagementExecutor.processUserFullWorkflow(mutationPage, {
            clientId: task.clientId,
            addUsersUrl,
            usersUrl: usersListUrl,
            roleUrl,
            loginUrl,
            credentials: task.credentials,
            userDto: payloadData as any,
            onProgress: (comment: string, partial?: any) => {
              onProgress?.(comment);
              this.agentClient.sendTelemetry(task.runId, {
                status: 'RUNNING',
                resultData: {
                  message: comment,
                  ...partial,
                },
              }).catch(() => {});
            },
          });

          const serializableResult = JSON.parse(JSON.stringify(workflowRes));
          const totalDurationMs = Date.now() - startTime;

          if (workflowRes.success) {
            onProgress?.(`✓ Workflow completed for '${workflowRes.username}'`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'COMPLETED',
              totalDurationMs,
              resultData: serializableResult,
            });
          } else {
            const safeError = sanitizeErrorMessage(workflowRes.failureReason || workflowRes.errorMessage || 'Workflow failed');
            onProgress?.(`✗ Workflow failed for '${workflowRes.username}': ${safeError}`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'FAILED',
              errorMessage: safeError,
              totalDurationMs,
              resultData: { ...serializableResult, errorMessage: safeError },
            });
          }
          return;
        }

        // 6. Map User Roles Directly
        if (task.taskType === 'MAP_USER_ROLES' || task.taskType === 'MAP_CLIENT_USER_ROLES') {
          const payloadData = task.payload?.payload || task.payload;
          const roleUrl = resolveClientRoleUrl({
            baseUrl: task.clientBaseUrl,
            applicationPath: appPath,
            userRoleRoute: task.payload?.userRoleRoute,
          });
          const username = payloadData?.username || task.payload?.username;
          const requestedRoles = payloadData?.resultingRoles || payloadData?.roles || (payloadData?.role ? (Array.isArray(payloadData.role) ? payloadData.role : payloadData.role.split(',').map((s: string) => s.trim()).filter(Boolean)) : []);
          const existingRoles = payloadData?.existingRoles || [];
          const rolesToAdd = payloadData?.rolesToAdd || [];
          const rolesToRemove = payloadData?.rolesToRemove || [];

          onProgress?.(`Starting role mapping for '${username}'…`);

          const mapRes = await UserManagementExecutor.mapUserRoles(mutationPage, {
            roleUrl,
            username,
            fullName: payloadData?.fullName,
            firstName: payloadData?.firstName,
            remoteUserId: payloadData?.remoteUserId || task.remoteUserId,
            requestedRoles,
            existingRoles,
            rolesToAdd,
            rolesToRemove,
            loginUrl,
            credentials: task.credentials,
            onProgress: (comment: string) => {
              onProgress?.(comment);
              this.agentClient.sendTelemetry(task.runId, {
                status: 'RUNNING',
                resultData: { message: comment },
              }).catch(() => {});
            },
          });

          const serializableResult = JSON.parse(JSON.stringify(mapRes));
          const totalDurationMs = Date.now() - startTime;

          if (mapRes.success) {
            onProgress?.(`✓ Role mapping verified for '${username}'`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'COMPLETED',
              totalDurationMs,
              resultData: serializableResult,
            });
          } else {
            const safeError = sanitizeErrorMessage(mapRes.failureReason || mapRes.errorMessage || 'Role mapping failed');
            onProgress?.(`✗ Role mapping failed for '${username}': ${safeError}`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'FAILED',
              errorMessage: safeError,
              totalDurationMs,
              resultData: { ...serializableResult, errorMessage: safeError },
            });
          }
          return;
        }

        // 7. Create Client Resource
        if (task.taskType === 'CREATE_CLIENT_RESOURCE' || task.taskType === 'CREATE_RESOURCE') {
          const resourceDto = task.payload?.resource || task.payload;
          const addResourceUrl = resolveClientResourceUrl({
            baseUrl: task.clientBaseUrl,
            applicationPath: appPath,
            quickResourceRoute: task.payload?.quickResourceRoute || '/addResourceParentDetails',
          });

          onProgress?.(`Creating resource [${resourceDto.resourceCode}] - ${resourceDto.resourceName}...`);

          const createRes = await ResourceManagementExecutor.createResource(mutationPage, {
            addResourceUrl,
            resource: resourceDto,
            loginUrl,
            credentials: task.credentials,
            onProgress: (msg: string) => onProgress?.(msg),
          });

          const serializableResult = JSON.parse(JSON.stringify(createRes));
          const totalDurationMs = Date.now() - startTime;

          if (createRes.success) {
            onProgress?.(`✓ Created and verified resource '${createRes.resourceCode}' on client.`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'COMPLETED',
              totalDurationMs,
              resultData: serializableResult,
            });
          } else {
            const safeError = sanitizeErrorMessage(createRes.errorMessage || createRes.message || 'Resource creation failed');
            onProgress?.(`✗ Failed to create resource: ${safeError}`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'FAILED',
              errorMessage: safeError,
              totalDurationMs,
              resultData: { ...serializableResult, errorMessage: safeError },
            });
          }
          return;
        }

        // 8. Set Client Resource Status
        if (
          task.taskType === 'SET_CLIENT_RESOURCE_STATUS' ||
          task.taskType === 'ACTIVATE_RESOURCE' ||
          task.taskType === 'DEACTIVATE_RESOURCE'
        ) {
          const resourceCode = task.payload?.resourceCode;
          const targetStatus = task.taskType === 'ACTIVATE_RESOURCE'
            ? 'ACTIVE'
            : task.taskType === 'DEACTIVATE_RESOURCE'
            ? 'INACTIVE'
            : task.payload?.status || 'ACTIVE';

          const resourcesUrl = resolveClientResourceUrl({
            baseUrl: task.clientBaseUrl,
            applicationPath: appPath,
            quickResourceRoute: task.payload?.quickResourceRoute || '/resources',
          });

          onProgress?.(`Setting status of resource [${resourceCode}] to ${targetStatus}...`);

          const statusRes = await ResourceManagementExecutor.setResourceStatus(mutationPage, {
            resourcesUrl,
            resourceCode,
            status: targetStatus,
            loginUrl,
            credentials: task.credentials,
            onProgress: (msg: string) => onProgress?.(msg),
          });

          const serializableResult = JSON.parse(JSON.stringify(statusRes));
          const totalDurationMs = Date.now() - startTime;

          if (statusRes.success) {
            onProgress?.(`✓ Resource '${resourceCode}' status updated to ${targetStatus}.`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'COMPLETED',
              totalDurationMs,
              resultData: serializableResult,
            });
          } else {
            const safeError = sanitizeErrorMessage(statusRes.errorMessage || statusRes.message || 'Resource status update failed');
            onProgress?.(`✗ Failed to update resource status: ${safeError}`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'FAILED',
              errorMessage: safeError,
              totalDurationMs,
              resultData: { ...serializableResult, errorMessage: safeError },
            });
          }
          return;
        }

        // 9. Map Resource User
        if (task.taskType === 'MAP_RESOURCE_USER') {
          const { resourceCode, username } = task.payload;
          const mappingUrl = resolveClientResourceUserMappingUrl({
            baseUrl: task.clientBaseUrl,
            applicationPath: appPath,
            resourceUserRoute: task.payload?.resourceUserRoute || '/addParentResourceUser',
          });

          onProgress?.(`Mapping resource [${resourceCode}] to user [${username}]...`);

          const mapRes = await ResourceManagementExecutor.mapResourceUser(mutationPage, {
            mappingUrl,
            resourceCode,
            username,
            loginUrl,
            credentials: task.credentials,
            onProgress: (msg: string) => onProgress?.(msg),
          });

          const serializableResult = JSON.parse(JSON.stringify(mapRes));
          const totalDurationMs = Date.now() - startTime;

          if (mapRes.success) {
            onProgress?.(`✓ Resource '${resourceCode}' mapped to '${username}'.`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'COMPLETED',
              totalDurationMs,
              resultData: serializableResult,
            });
          } else {
            const safeError = sanitizeErrorMessage(mapRes.errorMessage || mapRes.message || 'Resource user mapping failed');
            onProgress?.(`✗ Failed to map resource user: ${safeError}`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'FAILED',
              errorMessage: safeError,
              totalDurationMs,
              resultData: { ...serializableResult, errorMessage: safeError },
            });
          }
          return;
        }

        // 10. Process Resource Workflow (Human multi-stage or Non-Human)
        if (task.taskType === 'PROCESS_RESOURCE_WORKFLOW' || task.taskType === 'PROCESS_RESOURCE_ROW_WORKFLOW') {
          const payloadData = task.payload?.row || task.payload?.payload || task.payload;
          const quickResourceRoute = resolveClientResourceUrl({
            baseUrl: task.clientBaseUrl,
            applicationPath: appPath,
            quickResourceRoute: task.payload?.quickResourceRoute || '/addResourceParentDetails',
          });
          const addUsersRoute = resolveClientRoute({
            baseUrl: task.clientBaseUrl,
            applicationPath: appPath,
            route: task.payload?.addUsersRoute || '/addUsers',
            fallbackRoute: '/addUsers',
          });
          const addUserRoleRoute = resolveClientRoleUrl({
            baseUrl: task.clientBaseUrl,
            applicationPath: appPath,
            userRoleRoute: task.payload?.addUserRoleRoute || '/addUserRole',
          });
          const resourceUserRoute = resolveClientResourceUserMappingUrl({
            baseUrl: task.clientBaseUrl,
            applicationPath: appPath,
            resourceUserRoute: task.payload?.resourceUserRoute || '/addParentResourceUser',
          });

          onProgress?.(`Starting resource full workflow for '${payloadData.resourceName}'…`);

          const workflowRes = await ResourceManagementExecutor.processResourceFullWorkflow(mutationPage, {
            row: payloadData,
            routes: {
              quickResourceRoute,
              addUsersRoute,
              addUserRoleRoute,
              resourceUserRoute,
              loginUrl,
            },
            credentials: task.credentials,
            startStage: task.payload?.startStage,
            existingState: task.payload?.existingState,
            onEphemeralPassword: async (evt) => {
              if (task.payload?.ephemeralDeliveryCallbackUrl) {
                // optional webhook callback
              }
            },
            onProgress: (stage: string, message: string) => {
              onProgress?.(`[${stage}] ${message}`);
              this.agentClient.sendTelemetry(task.runId, {
                status: 'RUNNING',
                resultData: { stage, message },
              }).catch(() => {});
            },
          });

          const serializableResult = JSON.parse(JSON.stringify(workflowRes));
          const totalDurationMs = Date.now() - startTime;

          if (workflowRes.success) {
            onProgress?.(`✓ Resource workflow completed successfully for '${payloadData.resourceName}'.`);
            await this.agentClient.sendTelemetry(task.runId, {
              status: 'COMPLETED',
              totalDurationMs,
              resultData: serializableResult,
            });
          } else {
            const safeError = sanitizeErrorMessage(workflowRes.errorMessage || 'Resource workflow failed');
            onProgress?.(`✗ Resource workflow failed for '${payloadData.resourceName}': ${safeError}`);
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
            if (lease) {
              try { await lease.close({ reason: 'RETRY_PRE_ACTION' }); } catch {}
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
                errorMessage: 'REMOTE_STATUS_VERIFICATION_UNKNOWN: Browser closed after action was sent. Mutation could not be verified in remote snapshot.',
                totalDurationMs,
                resultData: {
                  success: false,
                  overallStatus: 'PARTIAL_FAILED',
                  statusChangeState: 'MUTATION_SUBMITTED_VERIFICATION_PENDING',
                  errorCode: 'REMOTE_STATUS_VERIFICATION_UNKNOWN',
                  retryStartingPoint: 'STATUS_VERIFICATION',
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
        if (lease) {
          try {
            await new Promise((r) => setTimeout(r, 400));
            await lease.close({ reason: 'MUTATION_FINISHED' });
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
    let lease: any = null;
    try {
      lease = await this.browserLifecycleManager.acquireLease({
        taskId: 'RECONCILIATION',
        runId: `${task.runId}_reconcile`,
        clientId: task.clientId,
        userId: effectiveUserId,
        ownerType: 'AUTOMATION_OWNED',
        namespace: 'sync',
        isHeaded: false,
      });
      const page = lease.primaryPage;
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
      if (lease) {
        try { await lease.close({ reason: 'RECONCILIATION_COMPLETED' }); } catch {}
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
    let isOperatorOwned = false;
    let lease: any = null;

    try {
      // Check if an active pre-existing operator context already exists for this client
      let existingContext = this.activeOperatorContexts.get(profileKey);
      if (existingContext) {
        try {
          existingContext.pages();
        } catch {
          try { await existingContext.close(); } catch {}
          this.activeOperatorContexts.delete(profileKey);
          existingContext = undefined;
        }
      }

      // Pre-existing operator browser only = OPERATOR_OWNED, or explicit operator session with leaveBrowserOpen === true.
      // Every browser launched by User/Resource automation, headed or headless = AUTOMATION_OWNED.
      const isExplicitOperatorSession = (task.taskType === 'OPEN_INTERACTIVE_CLIENT_SESSION' || task.taskType === 'INTERACTIVE_LOGIN') && task.options?.leaveBrowserOpen === true;
      isOperatorOwned = Boolean(existingContext) || isExplicitOperatorSession;

      try {
        lease = await this.browserLifecycleManager.acquireLease({
          taskId: task.taskType,
          runId: task.runId,
          clientId: task.clientId,
          userId: effectiveUserId,
          ownerType: isOperatorOwned ? 'OPERATOR_OWNED' : 'AUTOMATION_OWNED',
          namespace: 'interactive',
          isHeaded: task.options?.isHeaded ?? true,
          slowMo: 0,
          existingContext,
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

      context = lease.context;
      page = lease.primaryPage;
      if (!context || !page) return;
      await page.bringToFront().catch(() => {});

      if (isOperatorOwned) {
        this.activeOperatorContexts.set(profileKey, context);
        context.on('close', () => {
          this.activeOperatorContexts.delete(profileKey);
        });
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

        if (!isOperatorOwned) {
          await lease.close({ reason: 'COMPLETED' });
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
        if (!isOperatorOwned) {
          await lease.close({ reason: 'FAILED' });
          this.activeOperatorContexts.delete(profileKey);
        }
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
    } finally {
      if (!isOperatorOwned && lease && !lease.isClosed) {
        await lease.close({ reason: 'AUTOMATION_OWNED_AUTO_CLOSE' }).catch(() => {});
        this.activeOperatorContexts.delete(profileKey);
      }
    }
  }

  public getActiveContextCount(): number {
    return this.activeOperatorContexts.size;
  }

  public async shutdown(): Promise<void> {
    await this.browserLifecycleManager.closeAllAutomationOwned('AGENT_SHUTDOWN');
  }
}
