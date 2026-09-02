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
    const localVars = { ...variables };

    // Step 0: Initial Navigation & Session Re-use Check
    const initialNavStep = workflow.steps.find((s) => s.action === 'NAVIGATE');
    if (initialNavStep) {
      const stepStartTime = new Date();
      const telemetry: AutomationRunStepTelemetry = {
        stepIndex: 1,
        stepName: 'Opening client URL…',
        status: 'RUNNING',
        startedAt: stepStartTime.toISOString(),
      };
      onStepUpdate?.(telemetry);

      try {
        const targetUrl = this.interpolateTemplate(initialNavStep.valueTemplate, localVars);
        await page.goto(targetUrl, { timeout: initialNavStep.timeoutMs || 15000, waitUntil: 'domcontentloaded' });
        telemetry.status = 'SUCCESS';
        telemetry.completedAt = new Date().toISOString();
        telemetry.durationMs = new Date().getTime() - stepStartTime.getTime();
        stepsTelemetry.push(telemetry);
        onStepUpdate?.(telemetry);
      } catch (err: any) {
        telemetry.status = 'FAILED';
        telemetry.completedAt = new Date().toISOString();
        telemetry.durationMs = new Date().getTime() - stepStartTime.getTime();
        telemetry.errorMessage = 'Client application is currently unreachable.';
        stepsTelemetry.push(telemetry);
        onStepUpdate?.(telemetry);
        return {
          success: false,
          status: 'FAILED',
          errorMessage: 'Client application is currently unreachable.',
          failedStepIndex: 1,
          stepsTelemetry,
        };
      }

      // Check if existing session is already authenticated (session reuse)
      const isAlreadyLoggedIn = await this.checkSuccessConditions(page, workflow.successConditions);
      if (isAlreadyLoggedIn) {
        const sessionReuseTelemetry: AutomationRunStepTelemetry = {
          stepIndex: 2,
          stepName: 'Existing session active — opening dashboard',
          status: 'SUCCESS',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: 50,
        };
        stepsTelemetry.push(sessionReuseTelemetry);
        onStepUpdate?.(sessionReuseTelemetry);

        return {
          success: true,
          status: 'COMPLETED',
          stepsTelemetry,
        };
      }
    }

    // Step 1: Pre-execution security check (MFA / CAPTCHA / OTP)
    const secBlock = await this.checkSecurityBlocks(page, workflow.securityBlockConditions);
    if (secBlock) {
      const secTelemetry: AutomationRunStepTelemetry = {
        stepIndex: stepsTelemetry.length + 1,
        stepName: 'Security verification detected (MFA/CAPTCHA)',
        status: 'REQUIRES_MANUAL_INTERVENTION',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        errorMessage: 'Manual security verification is required in the opened browser window.',
      };
      stepsTelemetry.push(secTelemetry);
      onStepUpdate?.(secTelemetry);

      return {
        success: false,
        status: 'REQUIRES_MANUAL_INTERVENTION',
        errorMessage: 'Manual security verification is required in the opened browser window.',
        stepsTelemetry,
      };
    }

    // Step 2: Execute defined workflow steps sequentially (skip step 1 if already navigated)
    const remainingSteps = initialNavStep
      ? workflow.steps.filter((s) => s.stepIndex !== initialNavStep.stepIndex)
      : workflow.steps;

    for (const step of remainingSteps) {
      const stepStartTime = new Date();
      let displayName = step.stepName;
      if (step.action === 'FILL' && step.stepName.toLowerCase().includes('password')) {
        displayName = 'Entering credentials securely…';
      } else if (step.action === 'WAIT_FOR_ELEMENT' || step.action === 'WAIT_FOR_NAVIGATION') {
        displayName = 'Verifying login…';
      }

      const telemetry: AutomationRunStepTelemetry = {
        stepIndex: step.stepIndex,
        stepName: displayName,
        status: 'RUNNING',
        startedAt: stepStartTime.toISOString(),
      };
      onStepUpdate?.(telemetry);

      try {
        await this.executeStep(page, step, localVars, workflow.defaultTimeoutMs);
        telemetry.status = 'SUCCESS';
        telemetry.completedAt = new Date().toISOString();
        telemetry.durationMs = new Date().getTime() - stepStartTime.getTime();
        stepsTelemetry.push(telemetry);
        onStepUpdate?.(telemetry);

        // Plaintext hygiene: discard password from local variables as soon as password field is filled
        if (step.action === 'FILL' && step.stepName.toLowerCase().includes('password')) {
          delete localVars.password;
        }
      } catch (err: any) {
        telemetry.status = 'FAILED';
        telemetry.completedAt = new Date().toISOString();
        telemetry.durationMs = new Date().getTime() - stepStartTime.getTime();

        // Check if failure is due to security control block (MFA/CAPTCHA)
        const postErrorSecBlock = await this.checkSecurityBlocks(page, workflow.securityBlockConditions);
        if (postErrorSecBlock) {
          telemetry.status = 'REQUIRES_MANUAL_INTERVENTION';
          telemetry.errorMessage = 'Manual security verification is required in the opened browser window.';
          stepsTelemetry.push(telemetry);
          onStepUpdate?.(telemetry);

          return {
            success: false,
            status: 'REQUIRES_MANUAL_INTERVENTION',
            errorMessage: 'Manual security verification is required in the opened browser window.',
            failedStepIndex: step.stepIndex,
            stepsTelemetry,
          };
        }

        // Check if error condition matched (e.g., Invalid credentials / Account locked)
        const matchedErr = await this.checkErrorConditions(page, workflow.errorConditions);
        if (matchedErr) {
          telemetry.errorMessage = 'Client login was unsuccessful. Verify the stored credentials.';
          stepsTelemetry.push(telemetry);
          onStepUpdate?.(telemetry);

          return {
            success: false,
            status: 'FAILED',
            errorMessage: 'Client login was unsuccessful. Verify the stored credentials.',
            failedStepIndex: step.stepIndex,
            stepsTelemetry,
          };
        }

        // Translate selector errors into standard friendly error
        const isSelectorError = err.message && (err.message.includes('Waiting for selector') || err.message.includes('requires targetSelector') || err.message.includes('Timeout'));
        const friendlyError = isSelectorError
          ? 'Automatic login fields could not be identified. Update the client selector configuration.'
          : (err.message || 'Workflow step execution failed');

        telemetry.errorMessage = friendlyError;
        stepsTelemetry.push(telemetry);
        onStepUpdate?.(telemetry);

        if (!step.isOptional) {
          return {
            success: false,
            status: 'FAILED',
            errorMessage: friendlyError,
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
        errorMessage: 'Manual security verification is required in the opened browser window.',
        stepsTelemetry,
      };
    }

    // Check error conditions (e.g. invalid credentials)
    const errCond = await this.checkErrorConditions(page, workflow.errorConditions);
    if (errCond) {
      return {
        success: false,
        status: 'FAILED',
        errorMessage: 'Client login was unsuccessful. Verify the stored credentials.',
        stepsTelemetry,
      };
    }

    // Evaluate success conditions
    const isSuccess = await this.checkSuccessConditions(page, workflow.successConditions);
    if (!isSuccess && workflow.successConditions && workflow.successConditions.length > 0) {
      return {
        success: false,
        status: 'FAILED',
        errorMessage: 'Client login verification failed. Dashboard was not reached.',
        stepsTelemetry,
      };
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

  private static async checkSecurityBlocks(page: Page, conditions?: WorkflowCondition[]): Promise<WorkflowCondition | null> {
    if (!conditions || conditions.length === 0) return null;
    for (const cond of conditions) {
      const isDetected = await this.evaluateCondition(page, cond);
      if (isDetected) return cond;
    }
    return null;
  }

  private static async checkErrorConditions(page: Page, conditions?: WorkflowCondition[]): Promise<WorkflowCondition | null> {
    if (!conditions || conditions.length === 0) return null;
    for (const cond of conditions) {
      const isDetected = await this.evaluateCondition(page, cond);
      if (isDetected) return cond;
    }
    return null;
  }

  private static async checkSuccessConditions(page: Page, conditions?: WorkflowCondition[]): Promise<boolean> {
    if (!conditions || conditions.length === 0) return true;
    for (const cond of conditions) {
      const isDetected = await this.evaluateCondition(page, cond);
      if (isDetected) return true;
    }
    return false;
  }

  private static async evaluateCondition(page: Page, condition: WorkflowCondition): Promise<boolean> {
    try {
      switch (condition.type) {
        case 'URL_CONTAINS':
          return condition.expectedValue ? page.url().includes(condition.expectedValue) : false;
        case 'TEXT_PRESENT': {
          if (!condition.expectedValue) return false;
          try {
            await page.getByText(condition.expectedValue).first().waitFor({ state: 'visible', timeout: 2000 });
            return true;
          } catch {
            const bodyText = await page.locator('body').innerText({ timeout: 1000 });
            return bodyText.includes(condition.expectedValue);
          }
        }
        case 'ELEMENT_VISIBLE': {
          if (!condition.selector) return false;
          try {
            const locator = await SelectorResolver.resolveLocator(page, condition.selector, 2000);
            await locator.waitFor({ state: 'visible', timeout: 2000 });
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
