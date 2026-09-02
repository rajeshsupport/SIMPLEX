import { Page } from 'playwright';
import {
  WorkflowVersionConfig,
  WorkflowStepDefinition,
  AutomationRunStepTelemetry,
  WorkflowCondition,
} from '@hmc/shared';
import { SelectorResolver } from './selector-resolver.js';

export interface WorkflowExecutionResult {
  success: boolean;
  status: 'COMPLETED' | 'FAILED' | 'REQUIRES_MANUAL_INTERVENTION';
  errorMessage?: string;
  failedStepIndex?: number;
  stepsTelemetry: AutomationRunStepTelemetry[];
  screenshotPath?: string;
}

export class WorkflowExecutor {
  public static interpolateTemplate(template: string | undefined, vars: Record<string, any>): string {
    if (!template) return '';
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
      return vars[key] !== undefined ? String(vars[key]) : '';
    });
  }

  public static async executeWorkflow(
    page: Page,
    workflow: WorkflowVersionConfig,
    variables: Record<string, any>,
    onStepUpdate?: (step: AutomationRunStepTelemetry) => void
  ): Promise<WorkflowExecutionResult> {
    const stepsTelemetry: AutomationRunStepTelemetry[] = [];

    // Step 1: Pre-execution security check
    const secBlock = await this.checkSecurityBlocks(page, workflow.securityBlockConditions);
    if (secBlock) {
      return {
        success: false,
        status: 'REQUIRES_MANUAL_INTERVENTION',
        errorMessage: secBlock.errorMessage || 'Security control (MFA/CAPTCHA) detected on target application',
        stepsTelemetry,
      };
    }

    // Step 2: Execute defined workflow steps sequentially
    for (const step of workflow.steps) {
      const stepStartTime = new Date();
      const telemetry: AutomationRunStepTelemetry = {
        stepIndex: step.stepIndex,
        stepName: step.stepName,
        status: 'RUNNING',
        startedAt: stepStartTime.toISOString(),
      };
      onStepUpdate?.(telemetry);

      try {
        await this.executeStep(page, step, variables, workflow.defaultTimeoutMs);
        telemetry.status = 'SUCCESS';
        telemetry.completedAt = new Date().toISOString();
        telemetry.durationMs = new Date().getTime() - stepStartTime.getTime();
        stepsTelemetry.push(telemetry);
        onStepUpdate?.(telemetry);
      } catch (err: any) {
        telemetry.status = 'FAILED';
        telemetry.completedAt = new Date().toISOString();
        telemetry.durationMs = new Date().getTime() - stepStartTime.getTime();
        telemetry.errorMessage = err.message || 'Unknown step execution error';
        stepsTelemetry.push(telemetry);
        onStepUpdate?.(telemetry);

        if (!step.isOptional) {
          // Check if failure is due to security control block
          const postErrorSecBlock = await this.checkSecurityBlocks(page, workflow.securityBlockConditions);
          if (postErrorSecBlock) {
            return {
              success: false,
              status: 'REQUIRES_MANUAL_INTERVENTION',
              errorMessage: postErrorSecBlock.errorMessage || 'Security control detected',
              failedStepIndex: step.stepIndex,
              stepsTelemetry,
            };
          }

          return {
            success: false,
            status: 'FAILED',
            errorMessage: `Step ${step.stepIndex} (${step.stepName}) failed: ${err.message}`,
            failedStepIndex: step.stepIndex,
            stepsTelemetry,
          };
        }
      }
    }

    // Step 3: Evaluate Success & Error conditions
    const finalSecBlock = await this.checkSecurityBlocks(page, workflow.securityBlockConditions);
    if (finalSecBlock) {
      return {
        success: false,
        status: 'REQUIRES_MANUAL_INTERVENTION',
        errorMessage: finalSecBlock.errorMessage || 'Security control required',
        stepsTelemetry,
      };
    }

    // Check error conditions
    for (const errCond of workflow.errorConditions || []) {
      const isMet = await this.evaluateCondition(page, errCond);
      if (isMet) {
        return {
          success: false,
          status: 'FAILED',
          errorMessage: errCond.errorMessage || 'Target application signaled an error condition',
          stepsTelemetry,
        };
      }
    }

    // If success conditions defined, check them
    if (workflow.successConditions && workflow.successConditions.length > 0) {
      let anySuccessMatched = false;
      for (const succCond of workflow.successConditions) {
        const isMet = await this.evaluateCondition(page, succCond);
        if (isMet) {
          anySuccessMatched = true;
          break;
        }
      }

      if (!anySuccessMatched) {
        return {
          success: false,
          status: 'FAILED',
          errorMessage: 'Workflow steps finished but expected success conditions were not satisfied',
          stepsTelemetry,
        };
      }
    }

    return {
      success: true,
      status: 'COMPLETED',
      stepsTelemetry,
    };
  }

  private static async executeStep(
    page: Page,
    step: WorkflowStepDefinition,
    variables: Record<string, any>,
    defaultTimeout: number
  ): Promise<void> {
    const timeout = step.timeoutMs || defaultTimeout;

    switch (step.action) {
      case 'NAVIGATE': {
        const url = this.interpolateTemplate(step.valueTemplate, variables);
        await page.goto(url, { timeout, waitUntil: 'domcontentloaded' });
        break;
      }
      case 'FILL': {
        if (!step.targetSelector) throw new Error(`Step ${step.stepName} requires targetSelector`);
        const locator = await SelectorResolver.resolveLocator(page, step.targetSelector, timeout);
        const value = this.interpolateTemplate(step.valueTemplate, variables);
        await locator.waitFor({ state: 'visible', timeout });
        await locator.fill(value);
        break;
      }
      case 'CLICK': {
        if (!step.targetSelector) throw new Error(`Step ${step.stepName} requires targetSelector`);
        const locator = await SelectorResolver.resolveLocator(page, step.targetSelector, timeout);
        await locator.waitFor({ state: 'visible', timeout });
        await locator.click();
        break;
      }
      case 'WAIT_FOR_ELEMENT': {
        if (!step.targetSelector) throw new Error(`Step ${step.stepName} requires targetSelector`);
        const locator = await SelectorResolver.resolveLocator(page, step.targetSelector, timeout);
        await locator.waitFor({ state: 'visible', timeout });
        break;
      }
      case 'WAIT_FOR_NAVIGATION': {
        await page.waitForLoadState('networkidle', { timeout });
        break;
      }
      case 'ASSERT_TEXT': {
        if (!step.targetSelector) throw new Error(`Step ${step.stepName} requires targetSelector`);
        const locator = await SelectorResolver.resolveLocator(page, step.targetSelector, timeout);
        const expectedText = this.interpolateTemplate(step.valueTemplate, variables);
        await locator.waitFor({ state: 'visible', timeout });
        const actualText = await locator.innerText();
        if (!actualText.includes(expectedText)) {
          throw new Error(`Text assertion failed. Expected: "${expectedText}", Actual: "${actualText}"`);
        }
        break;
      }
      case 'CAPTURE_SCREENSHOT': {
        await page.screenshot({ fullPage: true });
        break;
      }
    }
  }

  private static async checkSecurityBlocks(page: Page, conditions: WorkflowCondition[]): Promise<WorkflowCondition | null> {
    if (!conditions || conditions.length === 0) return null;
    for (const cond of conditions) {
      const isDetected = await this.evaluateCondition(page, cond);
      if (isDetected) {
        return cond;
      }
    }
    return null;
  }

  private static async evaluateCondition(page: Page, condition: WorkflowCondition): Promise<boolean> {
    try {
      switch (condition.type) {
        case 'URL_CONTAINS':
          return condition.expectedValue ? page.url().includes(condition.expectedValue) : false;
        case 'TEXT_PRESENT': {
          if (!condition.expectedValue) return false;
          try {
            await page.getByText(condition.expectedValue).first().waitFor({ state: 'visible', timeout: 5000 });
            return true;
          } catch {
            const bodyText = await page.locator('body').innerText({ timeout: 2000 });
            return bodyText.includes(condition.expectedValue);
          }
        }
        case 'ELEMENT_VISIBLE': {
          if (!condition.selector) return false;
          try {
            const locator = await SelectorResolver.resolveLocator(page, condition.selector, 5000);
            await locator.waitFor({ state: 'visible', timeout: 5000 });
            return await locator.isVisible({ timeout: 1000 });
          } catch {
            return false;
          }
        }
        case 'SECURITY_CONTROL_DETECTED': {
          if (condition.selector) {
            const locator = await SelectorResolver.resolveLocator(page, condition.selector, 1500);
            return await locator.isVisible({ timeout: 1500 });
          }
          return false;
        }
      }
    } catch {
      return false;
    }
    return false;
  }
}
