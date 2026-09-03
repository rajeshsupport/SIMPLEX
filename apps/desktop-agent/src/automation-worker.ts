import { BrowserContext, Page } from 'playwright';
import { BrowserProfileManager, WorkflowExecutor } from '@hmc/automation';
import { AgentTaskAssignment, AutomationRunStepTelemetry } from '@hmc/shared';
import { AgentClient } from './agent-client.js';

export class AutomationWorker {
  private activeProfileContexts: Map<string, BrowserContext> = new Map();
  private singleFlightTasks: Map<string, Promise<void>> = new Map();

  constructor(private agentClient: AgentClient) {}

  public async executeTask(task: AgentTaskAssignment, onProgress?: (msg: string) => void): Promise<void> {
    const effectiveUserId = (task.payload?.userId || 'operator').replace(/[^a-zA-Z0-9_-]/g, '_');
    const profileKey = `${task.clientId}_${effectiveUserId}`;

    // Single-flight lock: Prevent duplicate concurrent launches for the same client profile
    const inFlight = this.singleFlightTasks.get(profileKey);
    if (inFlight) {
      onProgress?.(`A launch task is already in-flight for client [${task.clientId}]. Awaiting existing execution...`);
      return inFlight;
    }

    const taskExecutionPromise = this.performTaskExecution(task, profileKey, effectiveUserId, onProgress);
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
    onProgress?: (msg: string) => void
  ): Promise<void> {
    const startTime = Date.now();
    onProgress?.(`Starting task [${task.taskType}] for client [${task.clientId}]...`);

    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      // 1. Check if an active browser context already exists for this client profile
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

      // 2. If no valid context is open, launch persistent context with robust recovery
      if (!context) {
        context = await BrowserProfileManager.launchPersistentContext({
          clientId: task.clientId,
          userId: effectiveUserId,
          isHeaded: task.options?.isHeaded ?? true,
          slowMo: 0, // Zero artificial delay for maximum performance
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

      // 3. Prepare workflow variables
      const variables: Record<string, any> = {
        loginUrl: `${task.clientBaseUrl}${task.loginRoute}`,
        servicesUrl: `${task.clientBaseUrl}/hmc/services`,
        usersUrl: `${task.clientBaseUrl}/hmc/users`,
        username: task.credentials?.username || '',
        password: task.credentials?.password || '',
        ...task.payload,
      };

      // 4. Execute workflow steps with session reuse and error mapping
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
