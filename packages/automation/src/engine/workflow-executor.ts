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
  classifiedCode?:
    | 'LOGIN_SUCCESS'
    | 'INVALID_CREDENTIALS'
    | 'SELECTOR_NOT_FOUND'
    | 'CREDENTIAL_NOT_SAVED'
    | 'CREDENTIAL_DECRYPTION_FAILED'
    | 'CLIENT_UNREACHABLE'
    | 'MFA_OR_CAPTCHA_REQUIRED'
    | 'LOGIN_TIMEOUT'
    | 'STEP_EXECUTION_FAILED';
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
    const isLoginWorkflow =
      (workflow.pageRoute && workflow.pageRoute.toLowerCase().includes('login')) ||
      workflow.steps.some(
        (s) =>
          s.stepName.toLowerCase().includes('password') ||
          (s.valueTemplate && s.valueTemplate.includes('password'))
      );

    if (isLoginWorkflow) {
      return this.executeLoginWorkflow(page, workflow, variables, onStepUpdate);
    }

    return this.executeGenericWorkflow(page, workflow, variables, onStepUpdate);
  }

  /**
   * Dedicated structured Auto-Login Workflow with strict 7-step progression,
   * safe selector fallbacks, React event dispatching, and session verification.
   */
  private static async executeLoginWorkflow(
    page: Page,
    workflow: WorkflowVersionConfig,
    variables: Record<string, any>,
    onStepUpdate?: (step: AutomationRunStepTelemetry) => void
  ): Promise<WorkflowExecutionResult> {
    const stepsTelemetry: AutomationRunStepTelemetry[] = [];
    const localVars = { ...variables };

    const passwordStep = workflow.steps.find((s) => {
      const name = (s.stepName || '').toLowerCase();
      const target = (s.targetSelector?.value || '').toLowerCase();
      return (
        s.action === 'FILL' &&
        (name.includes('pass') || target.includes('pass') || (s.valueTemplate && s.valueTemplate.toLowerCase().includes('pass')))
      );
    });

    const usernameStep =
      workflow.steps.find((s) => {
        const name = (s.stepName || '').toLowerCase();
        const target = (s.targetSelector?.value || '').toLowerCase();
        return (
          s.action === 'FILL' &&
          s !== passwordStep &&
          (name.includes('user') || target.includes('user') || (s.valueTemplate && s.valueTemplate.toLowerCase().includes('user')))
        );
      }) || workflow.steps.find((s) => s.action === 'FILL' && s !== passwordStep);

    const username =
      localVars.username ||
      (usernameStep?.valueTemplate && !usernameStep.valueTemplate.includes('{{')
        ? usernameStep.valueTemplate
        : '');
    const password =
      localVars.password ||
      (passwordStep?.valueTemplate && !passwordStep.valueTemplate.includes('{{')
        ? passwordStep.valueTemplate
        : '');

    // Step 1: Opening client application…
    const step1Start = new Date();
    const telStep1: AutomationRunStepTelemetry = {
      stepIndex: 1,
      stepName: 'Opening client application…',
      status: 'RUNNING',
      startedAt: step1Start.toISOString(),
    };
    onStepUpdate?.(telStep1);

    const initialNavStep = workflow.steps.find((s) => s.action === 'NAVIGATE');
    const targetUrl = initialNavStep
      ? this.interpolateTemplate(initialNavStep.valueTemplate, localVars)
      : localVars.loginUrl;

    try {
      await page.goto(targetUrl, {
        timeout: initialNavStep?.timeoutMs || 20000,
        waitUntil: 'domcontentloaded',
      });
      telStep1.status = 'SUCCESS';
      telStep1.completedAt = new Date().toISOString();
      telStep1.durationMs = Date.now() - step1Start.getTime();
      stepsTelemetry.push(telStep1);
      onStepUpdate?.(telStep1);
    } catch (err: any) {
      telStep1.status = 'FAILED';
      telStep1.completedAt = new Date().toISOString();
      telStep1.durationMs = Date.now() - step1Start.getTime();
      telStep1.errorMessage = 'Client application is currently unreachable.';
      stepsTelemetry.push(telStep1);
      onStepUpdate?.(telStep1);

      return {
        success: false,
        status: 'FAILED',
        classifiedCode: 'CLIENT_UNREACHABLE',
        errorMessage: 'Client application is currently unreachable.',
        failedStepIndex: 1,
        stepsTelemetry,
      };
    }

    // Check for Existing Authenticated Session Reuse
    const isAlreadyAuthenticated = await this.checkSessionActive(page, workflow);
    if (isAlreadyAuthenticated) {
      const reuseTel: AutomationRunStepTelemetry = {
        stepIndex: 2,
        stepName: 'Login successful — browser ready.',
        status: 'SUCCESS',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 50,
      };
      stepsTelemetry.push(reuseTel);
      onStepUpdate?.(reuseTel);

      return {
        success: true,
        status: 'COMPLETED',
        classifiedCode: 'LOGIN_SUCCESS',
        stepsTelemetry,
      };
    }

    // Step 2: Loading saved credentials securely…
    const step2Start = new Date();
    const telStep2: AutomationRunStepTelemetry = {
      stepIndex: 2,
      stepName: 'Loading saved credentials securely…',
      status: 'RUNNING',
      startedAt: step2Start.toISOString(),
    };
    onStepUpdate?.(telStep2);

    if (!username || !password) {
      telStep2.status = 'FAILED';
      telStep2.completedAt = new Date().toISOString();
      telStep2.errorMessage = 'Saved login credentials are unavailable for this client. Edit the client and save valid credentials.';
      stepsTelemetry.push(telStep2);
      onStepUpdate?.(telStep2);

      return {
        success: false,
        status: 'FAILED',
        classifiedCode: 'CREDENTIAL_NOT_SAVED',
        errorMessage: 'Saved login credentials are unavailable for this client. Edit the client and save valid credentials.',
        failedStepIndex: 2,
        stepsTelemetry,
      };
    }

    telStep2.status = 'SUCCESS';
    telStep2.completedAt = new Date().toISOString();
    telStep2.durationMs = Date.now() - step2Start.getTime();
    stepsTelemetry.push(telStep2);
    onStepUpdate?.(telStep2);

    // Pre-check for Security Controls (MFA / CAPTCHA)
    const mfaBlock = await this.checkMfaOrCaptcha(page, workflow);
    if (mfaBlock) {
      const mfaTel: AutomationRunStepTelemetry = {
        stepIndex: 3,
        stepName: 'Security verification required (MFA/CAPTCHA)',
        status: 'REQUIRES_MANUAL_INTERVENTION',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        errorMessage: 'Manual security verification is required in the opened browser window.',
      };
      stepsTelemetry.push(mfaTel);
      onStepUpdate?.(mfaTel);

      return {
        success: false,
        status: 'REQUIRES_MANUAL_INTERVENTION',
        classifiedCode: 'MFA_OR_CAPTCHA_REQUIRED',
        errorMessage: 'Manual security verification is required in the opened browser window.',
        stepsTelemetry,
      };
    }

    // Step 3: Entering username…
    const step3Start = new Date();
    const telStep3: AutomationRunStepTelemetry = {
      stepIndex: 3,
      stepName: 'Entering username…',
      status: 'RUNNING',
      startedAt: step3Start.toISOString(),
    };
    onStepUpdate?.(telStep3);

    const userResult = await SelectorResolver.findVisibleLocator(
      page,
      usernameStep?.targetSelector,
      SelectorResolver.USERNAME_FALLBACKS,
      8000
    );

    if (!userResult) {
      telStep3.status = 'FAILED';
      telStep3.completedAt = new Date().toISOString();
      telStep3.errorMessage = 'Automatic login fields could not be identified. Update the client selector configuration.';
      stepsTelemetry.push(telStep3);
      onStepUpdate?.(telStep3);

      return {
        success: false,
        status: 'FAILED',
        classifiedCode: 'SELECTOR_NOT_FOUND',
        errorMessage: 'Automatic login fields could not be identified. Update the client selector configuration.',
        failedStepIndex: 3,
        stepsTelemetry,
      };
    }

    const usernameFilled = await SelectorResolver.fillInputReliably(userResult.locator, username, false);
    if (!usernameFilled) {
      telStep3.status = 'FAILED';
      telStep3.errorMessage = 'Automatic login fields could not be identified. Update the client selector configuration.';
      stepsTelemetry.push(telStep3);
      onStepUpdate?.(telStep3);

      return {
        success: false,
        status: 'FAILED',
        classifiedCode: 'SELECTOR_NOT_FOUND',
        errorMessage: 'Automatic login fields could not be identified. Update the client selector configuration.',
        failedStepIndex: 3,
        stepsTelemetry,
      };
    }

    telStep3.status = 'SUCCESS';
    telStep3.completedAt = new Date().toISOString();
    telStep3.durationMs = Date.now() - step3Start.getTime();
    stepsTelemetry.push(telStep3);
    onStepUpdate?.(telStep3);

    // Step 4: Entering password securely…
    const step4Start = new Date();
    const telStep4: AutomationRunStepTelemetry = {
      stepIndex: 4,
      stepName: 'Entering password securely…',
      status: 'RUNNING',
      startedAt: step4Start.toISOString(),
    };
    onStepUpdate?.(telStep4);

    const passResult = await SelectorResolver.findVisibleLocator(
      page,
      passwordStep?.targetSelector,
      SelectorResolver.PASSWORD_FALLBACKS,
      8000
    );

    if (!passResult) {
      telStep4.status = 'FAILED';
      telStep4.completedAt = new Date().toISOString();
      telStep4.errorMessage = 'Automatic login fields could not be identified. Update the client selector configuration.';
      stepsTelemetry.push(telStep4);
      onStepUpdate?.(telStep4);

      return {
        success: false,
        status: 'FAILED',
        classifiedCode: 'SELECTOR_NOT_FOUND',
        errorMessage: 'Automatic login fields could not be identified. Update the client selector configuration.',
        failedStepIndex: 4,
        stepsTelemetry,
      };
    }

    const passFilled = await SelectorResolver.fillInputReliably(passResult.locator, password, true);

    // Secure hygiene: discard plaintext password immediately from local variables
    delete localVars.password;

    if (!passFilled) {
      telStep4.status = 'FAILED';
      telStep4.errorMessage = 'Automatic login fields could not be identified. Update the client selector configuration.';
      stepsTelemetry.push(telStep4);
      onStepUpdate?.(telStep4);

      return {
        success: false,
        status: 'FAILED',
        classifiedCode: 'SELECTOR_NOT_FOUND',
        errorMessage: 'Automatic login fields could not be identified. Update the client selector configuration.',
        failedStepIndex: 4,
        stepsTelemetry,
      };
    }

    telStep4.status = 'SUCCESS';
    telStep4.completedAt = new Date().toISOString();
    telStep4.durationMs = Date.now() - step4Start.getTime();
    stepsTelemetry.push(telStep4);
    onStepUpdate?.(telStep4);

    // Step 5: Submitting login…
    const step5Start = new Date();
    const telStep5: AutomationRunStepTelemetry = {
      stepIndex: 5,
      stepName: 'Submitting login…',
      status: 'RUNNING',
      startedAt: step5Start.toISOString(),
    };
    onStepUpdate?.(telStep5);

    const clickStep = workflow.steps.find((s) => s.action === 'CLICK');
    const submitResult = await SelectorResolver.findVisibleLocator(
      page,
      clickStep?.targetSelector,
      SelectorResolver.SUBMIT_FALLBACKS,
      5000
    );

    await SelectorResolver.triggerSubmit(submitResult?.locator, passResult.locator);

    telStep5.status = 'SUCCESS';
    telStep5.completedAt = new Date().toISOString();
    telStep5.durationMs = Date.now() - step5Start.getTime();
    stepsTelemetry.push(telStep5);
    onStepUpdate?.(telStep5);

    // Step 6: Verifying authenticated session…
    const step6Start = new Date();
    const telStep6: AutomationRunStepTelemetry = {
      stepIndex: 6,
      stepName: 'Verifying authenticated session…',
      status: 'RUNNING',
      startedAt: step6Start.toISOString(),
    };
    onStepUpdate?.(telStep6);

    const verifyStartTime = Date.now();
    const maxVerifyTimeoutMs = 15000;
    let authVerified = false;

    // Event-driven verification: Race between navigation, dashboard appearance, error banner, or MFA
    const verifyPromises: Promise<any>[] = [
      page.waitForURL((url) => {
        const u = url.toString().toLowerCase();
        return !u.includes('/login') || u.includes('/dashboard') || u.includes('/home');
      }, { timeout: 15000 }).catch(() => null),
      page.locator(SelectorResolver.DASHBOARD_FALLBACKS.join(', ')).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
      page.locator('.alert-wrapper .login-alert, .alert_error_message:visible, [data-testid="error-message"]:visible').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
      page.locator(SelectorResolver.MFA_CONTAINER_FALLBACKS.join(', ')).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
    ];

    await Promise.race(verifyPromises);

    // 1. Check for MFA / OTP / CAPTCHA prompt
    const postMfa = await this.checkMfaOrCaptcha(page, workflow);
    if (postMfa) {
      telStep6.status = 'REQUIRES_MANUAL_INTERVENTION';
      telStep6.errorMessage = 'Manual security verification is required in the opened browser window.';
      stepsTelemetry.push(telStep6);
      onStepUpdate?.(telStep6);

      return {
        success: false,
        status: 'REQUIRES_MANUAL_INTERVENTION',
        classifiedCode: 'MFA_OR_CAPTCHA_REQUIRED',
        errorMessage: 'Manual security verification is required in the opened browser window.',
        stepsTelemetry,
      };
    }

    // 2. Check for explicit error banners or credential failure
    const isBadCreds = await this.checkBadCredentials(page, workflow);
    if (isBadCreds) {
      telStep6.status = 'FAILED';
      telStep6.errorMessage = 'Client login was unsuccessful. Verify the stored credentials.';
      stepsTelemetry.push(telStep6);
      onStepUpdate?.(telStep6);

      return {
        success: false,
        status: 'FAILED',
        classifiedCode: 'INVALID_CREDENTIALS',
        errorMessage: 'Client login was unsuccessful. Verify the stored credentials.',
        failedStepIndex: 6,
        stepsTelemetry,
      };
    }

    // 3. Check for Dashboard Arrival / Authenticated Elements
    const isSuccess = await this.checkSessionActive(page, workflow);
    if (isSuccess) {
      authVerified = true;
    }

    if (!authVerified) {
      telStep6.status = 'FAILED';
      telStep6.errorMessage = 'Login verification timed out. Dashboard was not reached.';
      stepsTelemetry.push(telStep6);
      onStepUpdate?.(telStep6);

      return {
        success: false,
        status: 'FAILED',
        classifiedCode: 'LOGIN_TIMEOUT',
        errorMessage: 'Login verification timed out. Dashboard was not reached.',
        failedStepIndex: 6,
        stepsTelemetry,
      };
    }

    telStep6.status = 'SUCCESS';
    telStep6.completedAt = new Date().toISOString();
    telStep6.durationMs = Date.now() - step6Start.getTime();
    stepsTelemetry.push(telStep6);
    onStepUpdate?.(telStep6);

    // Final Success Step
    const finalTel: AutomationRunStepTelemetry = {
      stepIndex: 7,
      stepName: 'Login successful — browser ready.',
      status: 'SUCCESS',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: 50,
    };
    stepsTelemetry.push(finalTel);
    onStepUpdate?.(finalTel);

    return {
      success: true,
      status: 'COMPLETED',
      classifiedCode: 'LOGIN_SUCCESS',
      stepsTelemetry,
    };
  }

  /**
   * Executes arbitrary non-login workflow steps (e.g. HMC_SERVICE_CREATE).
   */
  private static async executeGenericWorkflow(
    page: Page,
    workflow: WorkflowVersionConfig,
    variables: Record<string, any>,
    onStepUpdate?: (step: AutomationRunStepTelemetry) => void
  ): Promise<WorkflowExecutionResult> {
    const stepsTelemetry: AutomationRunStepTelemetry[] = [];
    const localVars = { ...variables };

    // Pre-execution security check
    const secBlock = await this.checkMfaOrCaptcha(page, workflow);
    if (secBlock) {
      return {
        success: false,
        status: 'REQUIRES_MANUAL_INTERVENTION',
        classifiedCode: 'MFA_OR_CAPTCHA_REQUIRED',
        errorMessage: 'Security control (MFA/CAPTCHA) detected on target application',
        stepsTelemetry,
      };
    }

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
        await this.executeStep(page, step, localVars, workflow.defaultTimeoutMs);
        telemetry.status = 'SUCCESS';
        telemetry.completedAt = new Date().toISOString();
        telemetry.durationMs = Date.now() - stepStartTime.getTime();
        stepsTelemetry.push(telemetry);
        onStepUpdate?.(telemetry);
      } catch (err: any) {
        telemetry.status = 'FAILED';
        telemetry.completedAt = new Date().toISOString();
        telemetry.durationMs = Date.now() - stepStartTime.getTime();
        telemetry.errorMessage = err.message || 'Unknown step execution error';
        stepsTelemetry.push(telemetry);
        onStepUpdate?.(telemetry);

        if (!step.isOptional) {
          return {
            success: false,
            status: 'FAILED',
            classifiedCode: 'STEP_EXECUTION_FAILED',
            errorMessage: `Step ${step.stepIndex} (${step.stepName}) failed: ${err.message}`,
            failedStepIndex: step.stepIndex,
            stepsTelemetry,
          };
        }
      }
    }

    // Evaluate success conditions
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
        const found = await SelectorResolver.findVisibleLocator(page, step.targetSelector, [], timeout);
        if (!found) throw new Error(`Could not find input element for step: ${step.stepName}`);
        const value = this.interpolateTemplate(step.valueTemplate, variables);
        await SelectorResolver.fillInputReliably(found.locator, value, false);
        break;
      }
      case 'CLICK': {
        if (!step.targetSelector) throw new Error(`Step ${step.stepName} requires targetSelector`);
        const found = await SelectorResolver.findVisibleLocator(page, step.targetSelector, [], timeout);
        if (!found) throw new Error(`Could not find clickable element for step: ${step.stepName}`);
        await found.locator.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
        await found.locator.click();
        break;
      }
      case 'WAIT_FOR_ELEMENT': {
        if (!step.targetSelector) throw new Error(`Step ${step.stepName} requires targetSelector`);
        const found = await SelectorResolver.findVisibleLocator(page, step.targetSelector, [], timeout);
        if (!found) throw new Error(`Element did not become visible for step: ${step.stepName}`);
        break;
      }
      case 'WAIT_FOR_NAVIGATION': {
        await page.waitForLoadState('domcontentloaded', { timeout });
        break;
      }
      case 'ASSERT_TEXT': {
        if (!step.targetSelector) throw new Error(`Step ${step.stepName} requires targetSelector`);
        const found = await SelectorResolver.findVisibleLocator(page, step.targetSelector, [], timeout);
        if (!found) throw new Error(`Element not found for assertion in step: ${step.stepName}`);
        const expectedText = this.interpolateTemplate(step.valueTemplate, variables);
        const actualText = await found.locator.innerText();
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

  public static async checkSessionActive(page: Page, workflow?: WorkflowVersionConfig): Promise<boolean> {
    const currentUrl = page.url().toLowerCase();
    if (currentUrl === 'about:blank' || currentUrl === '') {
      return false;
    }

    // 0. If login form, password input, or sign-in button is visible, session is definitely NOT active
    const isLoginFormVisible = await page
      .locator(
        '#loginForm:visible, #username:visible, #userName:visible, #pasWord:visible, #password:visible, #passWord:visible, #loginPassword:visible, input[name="username" i]:visible, input[name="password" i]:visible, input[type="password"]:visible, button#SignIn:visible, #btnLogin:visible, [data-testid="btn-login"]:visible, [data-testid="input-password"]:visible'
      )
      .count()
      .catch(() => 0);

    if (isLoginFormVisible > 0) {
      return false;
    }

    // 1. URL pattern check (must NOT be at a /login route)
    if (currentUrl.includes('/login')) {
      return false;
    }

    // 2. Success conditions from workflow if specified
    if (workflow?.successConditions && workflow.successConditions.length > 0) {
      for (const cond of workflow.successConditions) {
        if (cond.type === 'URL_CONTAINS' && cond.expectedValue && currentUrl.includes(cond.expectedValue.toLowerCase())) {
          return true;
        }
        if (cond.type === 'ELEMENT_VISIBLE' && cond.selector) {
          const found = await SelectorResolver.findVisibleLocator(page, cond.selector, [], 500);
          if (found) return true;
        }
      }
    }

    // 3. Fallback dashboard/header selectors
    const dashResult = await SelectorResolver.findVisibleLocator(page, undefined, SelectorResolver.DASHBOARD_FALLBACKS, 500);
    if (dashResult) return true;

    // 4. URL path check if distinctly on post-login screen
    if (
      currentUrl.includes('/dashboard') ||
      currentUrl.includes('/home') ||
      currentUrl.includes('/users') ||
      currentUrl.includes('/services')
    ) {
      return true;
    }

    return false;
  }

  private static async checkMfaOrCaptcha(page: Page, workflow: WorkflowVersionConfig): Promise<boolean> {
    for (const cond of workflow.securityBlockConditions || []) {
      if (cond.selector) {
        const found = await SelectorResolver.findVisibleLocator(page, cond.selector, [], 300);
        if (found) return true;
      }
    }

    const foundMfa = await SelectorResolver.findVisibleLocator(page, undefined, SelectorResolver.MFA_CONTAINER_FALLBACKS, 300);
    return Boolean(foundMfa);
  }

  private static async checkBadCredentials(page: Page, workflow: WorkflowVersionConfig): Promise<boolean> {
    try {
      const alertSelector = '.alert-wrapper .login-alert, .alert_error_message:visible, [data-testid="error-message"]:visible, .alert-danger:visible';
      const isAlert = await page.locator(alertSelector).isVisible({ timeout: 200 }).catch(() => false);
      if (isAlert) return true;

      for (const cond of workflow.errorConditions || []) {
        if (cond.type === 'TEXT_PRESENT' && cond.expectedValue) {
          const hasText = await page.getByText(cond.expectedValue).first().isVisible({ timeout: 200 }).catch(() => false);
          if (hasText) return true;
        }
      }

      const bodyText = await page.locator('body').innerText({ timeout: 300 }).catch(() => '');
      if (
        bodyText.includes('Invalid credentials') ||
        bodyText.includes('Invalid username or password') ||
        bodyText.includes('Incorrect password') ||
        bodyText.includes('Please enter valid')
      ) {
        return true;
      }
    } catch {}
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
          const found = await SelectorResolver.findVisibleLocator(page, condition.selector, [], 2000);
          return Boolean(found);
        }
        case 'SECURITY_CONTROL_DETECTED': {
          if (!condition.selector) return false;
          const found = await SelectorResolver.findVisibleLocator(page, condition.selector, [], 1500);
          return Boolean(found);
        }
      }
    } catch {
      return false;
    }
    return false;
  }
}
