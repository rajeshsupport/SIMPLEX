import { BrowserContext, Page } from 'playwright';
import { BrowserProfileManager, WorkflowExecutor } from '@hmc/automation';
import { AgentTaskAssignment, AutomationRunStepTelemetry } from '@hmc/shared';
import { AgentClient } from './agent-client.js';

export class AutomationWorker {
  private activeContexts: Map<string, BrowserContext> = new Map();

  constructor(private agentClient: AgentClient) {}

  public async executeTask(task: AgentTaskAssignment, onProgress?: (msg: string) => void): Promise<void> {
    const startTime = Date.now();
    onProgress?.(`Starting task [${task.taskType}] for client [${task.clientId}]...`);

    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      // 1. Launch isolated persistent browser context
      context = await BrowserProfileManager.launchPersistentContext({
        clientId: task.clientId,
        userId: 'operator',
        isHeaded: task.options?.isHeaded ?? true,
        slowMo: task.options?.slowMoMs ?? 100,
      });

      this.activeContexts.set(task.runId, context);
      page = context.pages()[0] || (await context.newPage());

      // 2. Prepare workflow variables
      const variables: Record<string, any> = {
        loginUrl: `${task.clientBaseUrl}${task.loginRoute}`,
        servicesUrl: `${task.clientBaseUrl}/hmc/services`,
        usersUrl: `${task.clientBaseUrl}/hmc/users`,
        username: task.credentials?.username || '',
        password: task.credentials?.password || '',
        ...task.payload,
      };

      // 3. Execute workflow steps
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
          this.activeContexts.delete(task.runId);
        }
      } else {
        onProgress?.(`✗ Task ${task.runId} failed: ${result.errorMessage}`);
        await this.agentClient.sendTelemetry(task.runId, {
          status: result.status,
          errorMessage: result.errorMessage,
          totalDurationMs,
        });

        if (!task.options?.leaveBrowserOpen) {
          await context.close();
          this.activeContexts.delete(task.runId);
        }
      }
    } catch (err: any) {
      const totalDurationMs = Date.now() - startTime;
      onProgress?.(`Fatal error during task execution: ${err.message}`);
      await this.agentClient.sendTelemetry(task.runId, {
        status: 'FAILED',
        errorMessage: err.message || 'Unknown execution failure',
        totalDurationMs,
      });
    }
  }

  public async closeAllSessions(): Promise<void> {
    for (const [runId, ctx] of this.activeContexts.entries()) {
      try {
        await ctx.close();
      } catch {}
    }
    this.activeContexts.clear();
  }
}
