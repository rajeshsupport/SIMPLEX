import { BrowserContext, Page } from 'playwright';
import { BrowserProfileManager, WorkflowExecutor } from '@hmc/automation';
import { AgentTaskAssignment, AutomationRunStepTelemetry } from '@hmc/shared';
import { AgentClient } from './agent-client.js';

export class AutomationWorker {
  private activeProfileContexts: Map<string, BrowserContext> = new Map();

  constructor(private agentClient: AgentClient) {}

  public async executeTask(task: AgentTaskAssignment, onProgress?: (msg: string) => void): Promise<void> {
    const startTime = Date.now();
    onProgress?.(`Starting task [${task.taskType}] for client [${task.clientId}]...`);

    let context: BrowserContext | null = null;
    let page: Page | null = null;
    const effectiveUserId = (task.payload?.userId || 'operator').replace(/[^a-zA-Z0-9_-]/g, '_');
    const profileKey = `${task.clientId}_${effectiveUserId}`;

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
          }
        } catch {
          // Existing context is closed/invalid
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
          slowMo: task.options?.slowMoMs ?? 50,
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

        // Keep browser open for interactive user session if requested
        if (!task.options?.leaveBrowserOpen) {
          await context.close();
          this.activeProfileContexts.delete(profileKey);
        }
      } else {
        onProgress?.(`✗ Task ${task.runId} ${result.status}: ${result.errorMessage}`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: result.status,
          errorMessage: result.errorMessage,
          totalDurationMs,
        });

        // If manual intervention required or leave open, preserve window
        if (!task.options?.leaveBrowserOpen && result.status !== 'REQUIRES_MANUAL_INTERVENTION') {
          await context.close();
          this.activeProfileContexts.delete(profileKey);
        }
      }
    } catch (err: any) {
      const totalDurationMs = Date.now() - startTime;
      const friendlyError = err.message && err.message.includes('ERR_CONNECTION_REFUSED')
        ? 'Client application is currently unreachable.'
        : (err.message || 'Unknown execution failure');

      onProgress?.(`Fatal error during task execution: ${friendlyError}`);
      await this.agentClient.sendTelemetry(task.runId, {
        status: 'FAILED',
        errorMessage: friendlyError,
        totalDurationMs,
      });
    }
  }

  public async closeAllSessions(): Promise<void> {
    for (const [key, ctx] of this.activeProfileContexts.entries()) {
      try {
        await ctx.close();
      } catch {}
    }
    this.activeProfileContexts.clear();
  }
}
