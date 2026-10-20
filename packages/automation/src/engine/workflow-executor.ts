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
    | 'STEP_EXECUTION_FAILED'
    | 'BRANCH_NOT_FOUND'
    | 'BRANCH_AMBIGUOUS'
    | 'BRANCH_CONFIRMATION_FAILED';
  errorMessage?: string;
  failedStepIndex?: number;
  stepsTelemetry: AutomationRunStepTelemetry[];
  screenshotPath?: string;
  resultData?: Record<string, any>;
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

    // Bounded polling loop: Poll every 300ms up to 15s to eliminate premature races during navigation
    let discoveredBranches: string[] = [];

    while (Date.now() - verifyStartTime < maxVerifyTimeoutMs) {
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

      // 2.5 Option 2: Check for Post-Login Branch Selection (/userBaseBranch, /loginCheck or CHOOSE BRANCH)
      const isBranchSelection = await this.checkBranchSelectionScreen(page);
      if (isBranchSelection) {
        const targetBranch = (variables.targetBranch || variables.branchName || '') as string;
        const branchRes = await this.handleBranchSelection(page, targetBranch, onStepUpdate);
        if (branchRes.discoveredBranches && branchRes.discoveredBranches.length > 0) {
          discoveredBranches = branchRes.discoveredBranches;
        }
        if (!branchRes.selected && branchRes.errorCode) {
          telStep6.status = 'FAILED';
          telStep6.errorMessage = branchRes.errorMessage;
          stepsTelemetry.push(telStep6);
          onStepUpdate?.(telStep6);

          return {
            success: false,
            status: 'FAILED',
            classifiedCode: branchRes.errorCode,
            errorMessage: branchRes.errorMessage,
            failedStepIndex: 6,
            stepsTelemetry,
            resultData: discoveredBranches.length > 0 ? { discoveredBranches } : undefined,
          };
        }
      }

      // 3. Check for Dashboard Arrival / Authenticated Elements
      const isSuccess = await this.checkSessionActive(page, workflow);
      if (isSuccess) {
        authVerified = true;
        break;
      }

      await page.waitForTimeout(300);
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
        resultData: discoveredBranches.length > 0 ? { discoveredBranches } : undefined,
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
      resultData: discoveredBranches.length > 0 ? { discoveredBranches } : undefined,
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

    // 1. URL pattern check (must NOT be at a /login route, except /logincheck when dashboard rendered)
    if (currentUrl.includes('/login') && !currentUrl.includes('/logincheck')) {
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

  /**
   * Checks if the page is on a post-login branch selection screen (/userBaseBranch, /loginCheck, or "CHOOSE BRANCH")
   */
  public static async checkBranchSelectionScreen(page: Page): Promise<boolean> {
    try {
      const currentUrl = page.url().toLowerCase();
      if (
        currentUrl.includes('/userbasebranch') ||
        currentUrl.includes('/changeuserbranch') ||
        currentUrl.includes('/logincheck')
      ) {
        return true;
      }
      const branchHeader = await page
        .locator(
          'text="CHOOSE BRANCH", text="Choose Branch", #chooseBranch, .choose-branch, h1:has-text("CHOOSE BRANCH" i), h2:has-text("CHOOSE BRANCH" i), h3:has-text("CHOOSE BRANCH" i), div:has-text("CHOOSE BRANCH" i), .jOrgChart, #chart, a[href*="loginCheck"], a[href*="userBaseBranch"], a[href*="changeUserBranch"], select[name="branch"], select#ddlBranch, #userBaseBranch, #changeUserBranch, [data-testid="branch-selection"]'
        )
        .first()
        .isVisible()
        .catch(() => false);

      return Boolean(branchHeader);
    } catch {
      return false;
    }
  }

  /**
   * Automatically resolves and selects the designated target branch on /userBaseBranch, /changeUserBranch, /loginCheck, or interactive branch tree.
   * Uses normalized equality matching and verifies active branch context before proceeding.
   */
  public static async handleBranchSelection(
    page: Page,
    targetBranchName?: string,
    onStepUpdate?: (step: AutomationRunStepTelemetry) => void,
    destinationUrl?: string
  ): Promise<{
    selected: boolean;
    activeBranch?: string;
    discoveredBranches: string[];
    errorCode?: 'BRANCH_NOT_FOUND' | 'BRANCH_AMBIGUOUS' | 'BRANCH_CONFIRMATION_FAILED';
    errorMessage?: string;
  }> {
    try {
      // 1. Wait until live branch list/options are fully loaded
      await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);

      const branchSelectorCandidate =
        'select[name*="branch" i], select#ddlBranch, select#branch, #userBaseBranch select, #changeUserBranch select, select, input[type="radio"][name*="branch" i], input[type="radio"], .node, .jOrgChart .node, #chart, .branch-item, .branch-card, a[href*="loginCheck"], a[href*="userBaseBranch"], a[href*="changeUserBranch"], a, button';
      await page.waitForSelector(branchSelectorCandidate, { timeout: 8000 }).catch(() => {});

      // If dynamic DOM / AJAX branch options are loading, wait for items to settle
      await page
        .waitForFunction(() => {
          const selects = Array.from(document.querySelectorAll('select'));
          for (const s of selects) {
            const valid = Array.from(s.options).filter((o) => {
              const val = (o.value || '').trim();
              const txt = (o.text || '').trim().toLowerCase();
              return val !== '' && !txt.includes('select') && !txt.includes('choose') && !txt.includes('please');
            });
            if (valid.length > 0) return true;
          }
          const radios = document.querySelectorAll('input[type="radio"]');
          if (radios.length > 0) return true;
          const nodes = document.querySelectorAll('.node, .jOrgChart .node, .branch-card, .branch-item, .onbranchSelect, [data-branch], .brn, .lv1, .lv2, .lv3, #chart a, table tbody tr');
          return nodes.length > 0;
        }, { timeout: 3000 })
        .catch(() => {});

      const normalize = (str: string): string => {
        return (str || '')
          .trim()
          .replace(/_/g, ' ')
          .replace(/\s+/g, ' ')
          .toLowerCase();
      };

      const target = (targetBranchName || '').trim();
      const targetNorm = normalize(target);

      // ----------------------------------------------------------------------
      // MODE A: <select> Dropdown (Standard on /userBaseBranch or /changeUserBranch in Master V9.4)
      // ----------------------------------------------------------------------
      const selectLocator = page.locator('select[name*="branch" i], select#ddlBranch, select#branch, #userBaseBranch select, #changeUserBranch select, select').first();
      const selectCount = await selectLocator.count().catch(() => 0);
      let hasSelect = false;
      let validOptions: Array<{ index: number; value: string; text: string; selected: boolean }> = [];

      if (selectCount > 0) {
        const rawOptions = await selectLocator
          .evaluate((sel: HTMLSelectElement) => {
            return Array.from(sel.options).map((o, idx) => ({
              index: idx,
              value: (o.value || '').trim(),
              text: (o.text || '').trim(),
              selected: o.selected,
            }));
          })
          .catch(() => []);

        // Filter out placeholder options
        validOptions = rawOptions.filter((o) => {
          const val = o.value.toLowerCase();
          const txt = o.text.toLowerCase();
          if (!val && !txt) return false;
          if (val === '' || val === '0' || val === '-1') {
            if (txt.includes('select') || txt.includes('choose') || txt.includes('please') || txt === '') return false;
          }
          return !txt.startsWith('--') && !txt.includes('select branch') && !txt.includes('choose branch');
        });

        if (validOptions.length > 0) {
          hasSelect = true;
        }
      }

      if (hasSelect) {
        const discoveredBranches = validOptions.map((o) => o.text);

        let chosenOption: (typeof validOptions)[0] | undefined;

        if (targetNorm) {
          // Normalized exact equality match
          let matches = validOptions.filter((o) => {
            const oTextNorm = normalize(o.text);
            const oValNorm = normalize(o.value);
            return oTextNorm === targetNorm || oValNorm === targetNorm;
          });

          // Fallback: stripped prefix (e.g. "GAG - GAELAN..." or "[GAG] GAELAN...")
          if (matches.length === 0) {
            matches = validOptions.filter((o) => {
              const stripped = normalize(o.text.replace(/^[\[\(]?[a-z0-9_-]+[\]\)]?\s*[-–:]\s*/i, ''));
              return stripped === targetNorm;
            });
          }

          if (matches.length === 0) {
            // Check if the page also has interactive tree / org chart / card elements before declaring BRANCH_NOT_FOUND
            const hasTree = (await page.locator('.node, .jOrgChart .node, #chart, .branch-card').count().catch(() => 0)) > 0;
            if (!hasTree) {
              return {
                selected: false,
                discoveredBranches,
                errorCode: 'BRANCH_NOT_FOUND',
                errorMessage: `BRANCH_NOT_FOUND: Target branch '${target}' was not found in available branches [${discoveredBranches.join(', ')}] on ${page.url()}. Stopped before Submit with 0 clicks.`,
              };
            }
            // If tree exists on page, proceed to MODE B below!
          } else if (matches.length > 1) {
            return {
              selected: false,
              discoveredBranches,
              errorCode: 'BRANCH_AMBIGUOUS',
              errorMessage: `BRANCH_AMBIGUOUS: Multiple matches found for branch '${target}' on ${page.url()}. Stopped before Submit with 0 clicks.`,
            };
          } else {
            chosenOption = matches[0];
          }
        } else {
          // Central did not provide a branch: select verified single or default branch
          if (validOptions.length === 1) {
            chosenOption = validOptions[0];
          } else {
            const defaultOpt = validOptions.find((o) => o.selected);
            if (defaultOpt) {
              chosenOption = defaultOpt;
            } else {
              const hasTree = (await page.locator('.node, .jOrgChart .node, #chart, .branch-card').count().catch(() => 0)) > 0;
              if (!hasTree) {
                return {
                  selected: false,
                  discoveredBranches,
                  errorCode: 'BRANCH_AMBIGUOUS',
                  errorMessage: `BRANCH_AMBIGUOUS: Multiple branches available [${discoveredBranches.join(', ')}] but no target branch was specified and no single default branch is configured. Stopped before Submit with 0 clicks.`,
                };
              }
            }
          }
        }

        if (chosenOption) {
          onStepUpdate?.({
            stepIndex: 6,
            stepName: `Selecting verified branch: ${chosenOption.text}…`,
            status: 'RUNNING',
            startedAt: new Date().toISOString(),
          });

          // Select the option via Playwright (force: true in case styled with Select2)
          await selectLocator.selectOption({ index: chosenOption.index }, { force: true }).catch(async () => {
            await selectLocator.selectOption(chosenOption!.value, { force: true }).catch(() => {});
          });

          // Also set value directly via DOM evaluation and trigger jQuery/Select2
          await selectLocator
            .evaluate((sel: HTMLSelectElement, opt: { index: number; value: string }) => {
              sel.selectedIndex = opt.index;
              sel.value = opt.value;
              sel.dispatchEvent(new Event('input', { bubbles: true }));
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              const w = window as any;
              if (w.jQuery || w.$) {
                const $ = w.jQuery || w.$;
                $(sel).val(opt.value).trigger('change');
              }
            }, chosenOption)
            .catch(() => {});

          await page.waitForTimeout(300);

          // Complete portal branch confirmation action
          const confirmButton = page
            .locator(
              '#btnSubmit, #btnConfirm, #btnSave, #sub_but, form#userBaseBranch button, form#userBaseBranch input[type="submit"], form#changeUserBranch button, form#changeUserBranch input[type="submit"], button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Confirm"), button:has-text("Select"), button:has-text("Proceed"), input[value*="Submit" i], input[value*="Confirm" i], input[value*="Select" i]'
            )
            .first();

          if ((await confirmButton.count().catch(() => 0)) > 0) {
            await confirmButton.scrollIntoViewIfNeeded().catch(() => {});
            await confirmButton.click({ force: true }).catch(() => {});
          }

          // Also trigger form submission directly as a reliable fallback
          await page
            .evaluate(() => {
              const f = document.querySelector('form#userBaseBranch, form#changeUserBranch, form#frmBranch, form') as HTMLFormElement | null;
              if (f) {
                try {
                  const btn = f.querySelector('button[type="submit"], input[type="submit"], #btnSubmit, #sub_but') as HTMLElement | null;
                  if (btn) btn.click();
                  else f.submit();
                } catch {}
              }
            })
            .catch(() => {});

          // Wait for portal to establish branch session/context
          try {
            await page.waitForURL(
              (u) => {
                const uLower = u.toString().toLowerCase();
                return !uLower.includes('/userbasebranch') && !uLower.includes('/changeuserbranch') && !uLower.includes('/logincheck');
              },
              { timeout: 8000 }
            );
          } catch {}

          await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(500);

          const postUrl = page.url().toLowerCase();

          // Verify active branch post-confirmation state
          if (postUrl.includes('/userbasebranch') || postUrl.includes('/changeuserbranch') || postUrl.includes('/logincheck')) {
            const errText = (await page.locator('.error, .alert-danger, [data-testid="error-message"], .text-danger').first().textContent().catch(() => '')) || '';
            if (errText.trim()) {
              return {
                selected: false,
                discoveredBranches,
                errorCode: 'BRANCH_CONFIRMATION_FAILED',
                errorMessage: `BRANCH_CONFIRMATION_FAILED: Portal did not establish branch context and remained on ${page.url()}. Portal error: ${errText.trim()}`,
              };
            }

            // Direct destination recovery: test if the session now allows navigating to destination
            const curUrl = page.url();
            let testTargetUrl = destinationUrl;
            if (!testTargetUrl) {
              try {
                const origin = new URL(curUrl).origin;
                testTargetUrl = curUrl.includes('/MasterV9.4') ? `${origin}/MasterV9.4/ResourceParent` : `${origin}/hmc/dashboard`;
              } catch {}
            }

            if (testTargetUrl) {
              try {
                await page.goto(testTargetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await page.waitForTimeout(500);
                const postNavUrl = page.url().toLowerCase();
                const pageContent = (await page.content().catch(() => '')).toLowerCase();
                const accessRestricted =
                  pageContent.includes('access restricted') ||
                  pageContent.includes('select an active base branch') ||
                  pageContent.includes('select branch');
                const sessionBounced =
                  postNavUrl.includes('/logincheck') ||
                  postNavUrl.includes('/userbasebranch') ||
                  postNavUrl.includes('/changeuserbranch') ||
                  postNavUrl.includes('/login') ||
                  accessRestricted;
                if (!sessionBounced) {
                  return {
                    selected: true,
                    activeBranch: chosenOption.text,
                    discoveredBranches,
                  };
                }
              } catch {}
            }

            return {
              selected: false,
              discoveredBranches,
              errorCode: 'BRANCH_CONFIRMATION_FAILED',
              errorMessage: `BRANCH_CONFIRMATION_FAILED: Portal did not establish branch context and remained on ${page.url()}.`,
            };
          }

          if (postUrl.includes('/login') && !postUrl.includes('/logincheck')) {
            return {
              selected: false,
              discoveredBranches,
              errorCode: 'BRANCH_CONFIRMATION_FAILED',
              errorMessage: `BRANCH_CONFIRMATION_FAILED: Portal session redirected back to login after branch confirmation.`,
            };
          }

          // Active branch context established and verified
          const branchIndicator = page
            .locator('.header-branch, .branch-name, #lblBranch, #branchName, [data-testid="active-branch"], [data-testid="branch-indicator"], .active-branch, .user-branch')
            .first();
          let activeBranch = chosenOption.text;
          if ((await branchIndicator.count().catch(() => 0)) > 0 && (await branchIndicator.isVisible().catch(() => false))) {
            const indText = (await branchIndicator.textContent().catch(() => '')) || '';
            if (indText.trim()) activeBranch = indText.trim();
          }

          return {
            selected: true,
            activeBranch,
            discoveredBranches,
          };
        }
      }

      // ----------------------------------------------------------------------
      // MODE B: Radio Buttons / Table / Interactive Tree / OrgChart
      // ----------------------------------------------------------------------
      // Discover candidate branch elements
      const discoveredBranches: string[] = await page
        .evaluate(() => {
          const chartContainer = document.querySelector(
            '#chart, .jOrgChart, .orgChart, #userBaseBranch, #changeUserBranch, .branch-container, #loginCheck, #main'
          );
          const root = chartContainer || document.body;
          const candidates = Array.from(root.querySelectorAll('.node, .jOrgChart .node, .branch-card, .branch-item, a, button, div, span, td, li'));
          const branches: string[] = [];
          const seen = new Set<string>();

          const ignoredWords = [
            'simplex himes', 'choose branch', 'welcome', 'logout', 'sign out', 'menu',
            'no results found', 'admin simplex', 'support', 'my profile', 'switch branch',
            'about us', 'discharge slip', 'copyright', 'all rights reserved', 'dashboard'
          ];

          for (const el of candidates) {
            const text = (el.textContent || '').trim();
            if (text.length > 2 && text.length < 150) {
              const lower = text.toLowerCase();
              const isIgnored = ignoredWords.some((w) => lower === w || (lower.length < 30 && lower.includes(w)));
              if (!isIgnored && el.children.length <= 2 && !seen.has(text)) {
                seen.add(text);
                branches.push(text);
              }
            }
          }
          return branches;
        })
        .catch(() => []);

      if (targetNorm) {
        onStepUpdate?.({
          stepIndex: 6,
          stepName: `Selecting branch: ${target}…`,
          status: 'RUNNING',
          startedAt: new Date().toISOString(),
        });

        // 1. IN-DOM DIRECT SELECTION & CLICK VIA EVALUATE
        // Highly resilient against horizontal scroll, SVG/jOrgChart wrappers, and nested spans
        const domResult = await page
          .evaluate((targetArg) => {
            const norm = (s: string) => (s || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
            const targetNormVal = norm(targetArg);
            const targetRawVal = (targetArg || '').trim().toLowerCase();

            const candidates = Array.from(
              document.querySelectorAll(
                '.node, .jOrgChart .node, .branch-card, .branch-item, #chart a, #chart td, #chart div, table a, a, button, [onclick], li, div, span, td, b, strong, p'
              )
            ) as HTMLElement[];

            const scored: Array<{ el: HTMLElement; score: number; text: string }> = [];

            for (const el of candidates) {
              const rawText = (el.textContent || '').trim();
              const textNormVal = norm(rawText);
              if (!textNormVal) continue;

              let match = false;
              let score = 0;

              // Exact string match (case-insensitive)
              if (rawText.toLowerCase() === targetRawVal) {
                match = true;
                score = 100;
              }
              // Normalized equality (handles underscore vs space, multiple spaces)
              else if (textNormVal === targetNormVal) {
                match = true;
                score = 90;
              }
              // Prefix-stripped match (e.g. "01 - Branch" or "[GAG] Branch")
              else if (norm(rawText.replace(/^[\[\(]?[a-z0-9_-]+[\]\)]?\s*[-–:]\s*/i, '')) === targetNormVal) {
                match = true;
                score = 80;
              }
              // Substring inclusion
              else if (targetNormVal.length >= 5 && (textNormVal.includes(targetNormVal) || targetNormVal.includes(textNormVal))) {
                const longer = Math.max(textNormVal.length, targetNormVal.length);
                const shorter = Math.min(textNormVal.length, targetNormVal.length);
                if (shorter / longer > 0.6) {
                  match = true;
                  score = 60;
                }
              }

              if (match) {
                const isClickable = el.closest('a, button, [onclick], .node, .onbranchSelect, [data-branch], li, input[type="radio"]') !== null;
                if (isClickable) score += 20;
                if (el.matches('.onbranchSelect, [data-branch]')) score += 30;
                if (rawText.length > targetRawVal.length + 50) score -= 30;
                if (el.children.length > 3) score -= 15;

                scored.push({ el, score, text: rawText });
              }
            }

            scored.sort((a, b) => b.score - a.score);

            if (scored.length > 0) {
              const best = scored[0];
              const targetNode = best.el;

              // Check if there is a radio button or checkbox inside or nearby
              const radio = (targetNode.querySelector('input[type="radio"], input[type="checkbox"]') ||
                targetNode.closest('.node, tr, td, li')?.querySelector('input[type="radio"], input[type="checkbox"]')) as HTMLInputElement | null;
              if (radio) {
                radio.checked = true;
                radio.dispatchEvent(new Event('change', { bubbles: true }));
                radio.dispatchEvent(new Event('click', { bubbles: true }));
              }

              // Check if there is an anchor with a real HTTP/relative href
              const anchor = (targetNode.closest('a') || targetNode.querySelector('a')) as HTMLAnchorElement | null;
              const hrefAttr = anchor ? anchor.getAttribute('href') : null;
              if (anchor && hrefAttr && !hrefAttr.startsWith('#') && !hrefAttr.toLowerCase().startsWith('javascript:')) {
                window.location.href = anchor.href;
                return { clicked: true, matchedText: best.text, tagName: 'A' };
              }

              // If href starts with javascript:, execute it safely
              if (anchor && hrefAttr && hrefAttr.toLowerCase().startsWith('javascript:')) {
                try {
                  anchor.click();
                } catch {}
              }

              // Prioritize clicking the specific interactive branch element (.onbranchSelect, [data-branch], button, a, [onclick], .node)
              let clickable: HTMLElement = targetNode;
              if (targetNode.matches('.onbranchSelect, [data-branch], button, a, [onclick], .node, input[type="radio"]')) {
                clickable = targetNode;
              } else {
                const innerInteractive = targetNode.querySelector('.onbranchSelect, [data-branch], button, a, [onclick], .node, input[type="radio"]') as HTMLElement | null;
                if (innerInteractive) {
                  clickable = innerInteractive;
                } else {
                  const outerInteractive = targetNode.closest('.onbranchSelect, [data-branch], button, a, [onclick], .node, input[type="radio"]') as HTMLElement | null;
                  if (outerInteractive) {
                    clickable = outerInteractive;
                  } else {
                    clickable = (targetNode.closest('li') || targetNode) as HTMLElement;
                  }
                }
              }

              // Extract branch code from data-branch if present
              const branchCode = clickable.getAttribute('data-branch') ||
                targetNode.getAttribute('data-branch') ||
                clickable.closest('[data-branch]')?.getAttribute('data-branch') ||
                targetNode.closest('[data-branch]')?.getAttribute('data-branch') ||
                (clickable.querySelector('[data-branch]') as HTMLElement)?.getAttribute('data-branch') ||
                (targetNode.querySelector('[data-branch]') as HTMLElement)?.getAttribute('data-branch');

              if (branchCode) {
                const roleInput = document.querySelector('input[name="txtrolecode"], #txtrolecode') as HTMLInputElement | null;
                if (roleInput) {
                  roleInput.value = branchCode;
                }
              }

              clickable.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });

              try {
                clickable.focus();
              } catch {}

              clickable.click();
              clickable.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
              clickable.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
              clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

              // If branchCode exists and page has loginFormChangeRole, submit it as direct confirmation
              if (branchCode) {
                const roleForm = (document.getElementById('loginFormChangeRole') || document.querySelector('form#loginFormChangeRole')) as HTMLFormElement | null;
                if (roleForm) {
                  const roleInput = document.querySelector('input[name="txtrolecode"], #txtrolecode') as HTMLInputElement | null;
                  if (roleInput) roleInput.value = branchCode;
                  try {
                    roleForm.submit();
                  } catch {}
                }
              }

              return { clicked: true, matchedText: best.text, tagName: clickable.tagName };
            }

            return { clicked: false };
          }, target)
          .catch((err: any) => {
            if (err?.message && (err.message.includes('Execution context was destroyed') || err.message.includes('navigating'))) {
              return { clicked: true, matchedText: target, tagName: 'A' };
            }
            return { clicked: false, error: err?.message };
          });

        if (domResult.clicked) {
          // Wait to see if URL leaves branch selection
          await page
            .waitForURL(
              (u) => {
                const uLower = u.toString().toLowerCase();
                return (
                  !uLower.includes('/logincheck') &&
                  !uLower.includes('/userbasebranch') &&
                  !uLower.includes('/changeuserbranch')
                );
              },
              { timeout: 5000 }
            )
            .catch(() => {});

          const currentUrlAfterClick = page.url().toLowerCase();
          if (
            !currentUrlAfterClick.includes('/logincheck') &&
            !currentUrlAfterClick.includes('/userbasebranch') &&
            !currentUrlAfterClick.includes('/changeuserbranch')
          ) {
            return {
              selected: true,
              activeBranch: domResult.matchedText || target,
              discoveredBranches,
            };
          }

          // If still on branch screen, check for confirmation/submit buttons across page
          if (
            page.url().toLowerCase().includes('/logincheck') ||
            page.url().toLowerCase().includes('/userbasebranch') ||
            page.url().toLowerCase().includes('/changeuserbranch')
          ) {
            const specificSelectors = [
              '#btnSubmit',
              '#btnConfirm',
              '#btnSave',
              '#sub_but',
              '#btnSelect',
              '#btnOK',
              '#btnOk',
              'form#userBaseBranch button[type="submit"]',
              'form#userBaseBranch input[type="submit"]',
              'form#userBaseBranch button',
              'form#changeUserBranch button[type="submit"]',
              'form#changeUserBranch input[type="submit"]',
              'form#changeUserBranch button',
              'form#frmBranch button[type="submit"]',
              'form#frmBranch input[type="submit"]',
              'form#frmBranch button',
              'form[action*="userBaseBranch" i] button[type="submit"]',
              'form[action*="userBaseBranch" i] input[type="submit"]',
              'form[action*="userBaseBranch" i] button',
              'form[action*="changeUserBranch" i] button[type="submit"]',
              'form[action*="changeUserBranch" i] input[type="submit"]',
              'form[action*="changeUserBranch" i] button',
              'form[action*="loginCheck" i] button[type="submit"]',
              'form[action*="loginCheck" i] input[type="submit"]',
              'button[type="submit"]:has-text("Submit")',
              'button[type="submit"]:has-text("Confirm")',
              'button[type="submit"]:has-text("Select")',
              'button[type="submit"]:has-text("Proceed")',
              'button[type="submit"]:has-text("Continue")',
              'input[type="submit"][value*="Submit" i]',
              'input[type="submit"][value*="Confirm" i]',
              'input[type="submit"][value*="Select" i]',
              'input[type="submit"][value*="Proceed" i]',
              'input[type="submit"][value*="Continue" i]',
              'form button[type="submit"]',
              'form input[type="submit"]',
              'button[type="submit"]',
              'input[type="submit"]',
              'button:has-text("Submit")',
              'button:has-text("Confirm")',
              'button:has-text("Select Branch")',
              'button:has-text("Choose Branch")',
              'button:has-text("Proceed")',
              'button:has-text("Continue")',
            ];

            const navBlacklist = [
              'menu',
              'navbar',
              'toggle',
              'hamburger',
              'search',
              'cancel',
              'close',
              'logout',
              'sign out',
              'back',
              'profile',
              'support',
              'switch branch',
              'about us',
            ];

            for (const sel of specificSelectors) {
              const loc = page.locator(sel);
              const count = await loc.count().catch(() => 0);
              let clicked = false;
              for (let i = 0; i < count; i++) {
                const btn = loc.nth(i);
                const isVis = await btn.isVisible().catch(() => false);
                if (!isVis) continue;

                const txt = ((await btn.textContent().catch(() => '')) || '').toLowerCase().trim();
                const cls = ((await btn.getAttribute('class').catch(() => '')) || '').toLowerCase();
                const id = ((await btn.getAttribute('id').catch(() => '')) || '').toLowerCase();

                // Skip navbar, toggle, or non-confirmation buttons
                if (navBlacklist.some((w) => txt.includes(w) || cls.includes(w) || id.includes(w))) {
                  continue;
                }

                await btn.click({ force: true }).catch(() => {});
                clicked = true;
                await page
                  .waitForURL(
                    (u) => {
                      const uLower = u.toString().toLowerCase();
                      return (
                        !uLower.includes('/logincheck') &&
                        !uLower.includes('/userbasebranch') &&
                        !uLower.includes('/changeuserbranch')
                      );
                    },
                    { timeout: 5000 }
                  )
                  .catch(() => {});
                break;
              }
              if (clicked) {
                const cur = page.url().toLowerCase();
                if (
                  !cur.includes('/logincheck') &&
                  !cur.includes('/userbasebranch') &&
                  !cur.includes('/changeuserbranch')
                ) {
                  break;
                }
              }
            }

            // Also trigger in-DOM form submit fallback
            if (
              page.url().toLowerCase().includes('/logincheck') ||
              page.url().toLowerCase().includes('/userbasebranch') ||
              page.url().toLowerCase().includes('/changeuserbranch')
            ) {
              await page
                .evaluate(() => {
                  const roleInput = document.querySelector('input[name="txtrolecode"], #txtrolecode') as HTMLInputElement | null;
                  const roleForm = (document.getElementById('loginFormChangeRole') || document.querySelector('form#loginFormChangeRole')) as HTMLFormElement | null;
                  if (roleForm && roleInput && roleInput.value) {
                    try {
                      roleForm.submit();
                      return;
                    } catch {}
                  }

                  const f = (document.querySelector(
                    'form#userBaseBranch, form#changeUserBranch, form#frmBranch, form[action*="userBaseBranch" i], form[action*="changeUserBranch" i], form[action*="loginCheck" i]'
                  ) || document.querySelector('form')) as HTMLFormElement | null;
                  if (f) {
                    try {
                      const btn = f.querySelector(
                        '#btnSubmit, #btnConfirm, #sub_but, button[type="submit"], input[type="submit"]'
                      ) as HTMLElement | null;
                      if (btn) btn.click();
                      else if (f.id !== 'loginFormChangeRole' || (roleInput && roleInput.value)) f.submit();
                    } catch {}
                  }
                })
                .catch(() => {});

              await page
                .waitForURL(
                  (u) => {
                    const uLower = u.toString().toLowerCase();
                    return (
                      !uLower.includes('/logincheck') &&
                      !uLower.includes('/userbasebranch') &&
                      !uLower.includes('/changeuserbranch')
                    );
                  },
                  { timeout: 5000 }
                )
                .catch(() => {});
            }
          }

          await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(500);

          const postDomUrl = page.url().toLowerCase();
          if (
            !postDomUrl.includes('/logincheck') &&
            !postDomUrl.includes('/userbasebranch') &&
            !postDomUrl.includes('/changeuserbranch')
          ) {
            return {
              selected: true,
              activeBranch: domResult.matchedText || target,
              discoveredBranches,
            };
          }
        }

        // 2. PLAYWRIGHT NATIVE LOCATOR FALLBACK
        const pattern = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '[_\\s]+').replace(/\s+/g, '[_\\s]+');
        const partialRegExp = new RegExp(pattern, 'i');

        const candidateLocators = [
          page.locator('.node, .jOrgChart .node, .branch-card, .branch-item, #chart a, #chart td, table a, a, button').filter({ hasText: partialRegExp }),
          page.getByText(partialRegExp),
          page.locator(`text=${target}`),
          page.locator(`text=${target.replace(/_/g, ' ')}`),
        ];

        for (const group of candidateLocators) {
          const count = await group.count().catch(() => 0);
          for (let i = 0; i < count; i++) {
            const item = group.nth(i);
            await item.scrollIntoViewIfNeeded().catch(() => {});
            const anchor = item.locator('xpath=self::a | ancestor::a | descendant::a').first();
            const button = item.locator('xpath=self::button | ancestor::button | descendant::button').first();
            const genericNode = item.locator('xpath=ancestor-or-self::div[contains(@class, "node")] | ancestor-or-self::li').first();
            let targetEl = item;
            if ((await anchor.count().catch(() => 0)) > 0) {
              targetEl = anchor;
            } else if ((await button.count().catch(() => 0)) > 0) {
              targetEl = button;
            } else if ((await genericNode.count().catch(() => 0)) > 0) {
              targetEl = genericNode;
            }

            try {
              await targetEl.click({ force: true });
              await page
                .waitForURL(
                  (u) => {
                    const uLower = u.toString().toLowerCase();
                    return (
                      !uLower.includes('/logincheck') &&
                      !uLower.includes('/userbasebranch') &&
                      !uLower.includes('/changeuserbranch')
                    );
                  },
                  { timeout: 4000 }
                )
                .catch(() => {});

              if (
                page.url().toLowerCase().includes('/logincheck') ||
                page.url().toLowerCase().includes('/userbasebranch') ||
                page.url().toLowerCase().includes('/changeuserbranch')
              ) {
                const specificFallbackSelectors = [
                  '#btnSubmit',
                  '#btnConfirm',
                  '#btnSave',
                  '#sub_but',
                  '#btnSelect',
                  'form#userBaseBranch button[type="submit"]',
                  'form#userBaseBranch input[type="submit"]',
                  'form#changeUserBranch button[type="submit"]',
                  'form#changeUserBranch input[type="submit"]',
                  'form#frmBranch button[type="submit"]',
                  'form#frmBranch input[type="submit"]',
                  'form button[type="submit"]',
                  'form input[type="submit"]',
                  'button[type="submit"]:has-text("Submit")',
                  'button[type="submit"]:has-text("Confirm")',
                  'input[type="submit"][value*="Submit" i]',
                  'input[type="submit"][value*="Confirm" i]',
                  'button:has-text("Submit")',
                  'button:has-text("Confirm")',
                  'button:has-text("Select Branch")',
                ];

                for (const fbSel of specificFallbackSelectors) {
                  const confirmBtn = page.locator(fbSel).first();
                  if ((await confirmBtn.count().catch(() => 0)) > 0 && (await confirmBtn.isVisible().catch(() => false))) {
                    await confirmBtn.click({ force: true }).catch(() => {});
                    await page
                      .waitForURL(
                        (u) => {
                          const uLower = u.toString().toLowerCase();
                          return (
                            !uLower.includes('/logincheck') &&
                            !uLower.includes('/userbasebranch') &&
                            !uLower.includes('/changeuserbranch')
                          );
                        },
                        { timeout: 5000 }
                      )
                      .catch(() => {});
                    break;
                  }
                }

                if (
                  page.url().toLowerCase().includes('/logincheck') ||
                  page.url().toLowerCase().includes('/userbasebranch') ||
                  page.url().toLowerCase().includes('/changeuserbranch')
                ) {
                  await page
                    .evaluate(() => {
                      const f = (document.querySelector(
                        'form#userBaseBranch, form#changeUserBranch, form#frmBranch, form[action*="userBaseBranch" i], form[action*="changeUserBranch" i], form[action*="loginCheck" i]'
                      ) || document.querySelector('form')) as HTMLFormElement | null;
                      if (f) {
                        try {
                          const btn = f.querySelector(
                            '#btnSubmit, #btnConfirm, #sub_but, button[type="submit"], input[type="submit"]'
                          ) as HTMLElement | null;
                          if (btn) btn.click();
                          else f.submit();
                        } catch {}
                      }
                    })
                    .catch(() => {});

                  await page
                    .waitForURL(
                      (u) => {
                        const uLower = u.toString().toLowerCase();
                        return (
                          !uLower.includes('/logincheck') &&
                          !uLower.includes('/userbasebranch') &&
                          !uLower.includes('/changeuserbranch')
                        );
                      },
                      { timeout: 5000 }
                    )
                    .catch(() => {});
                }
              }

              await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
              const afterClickUrl = page.url().toLowerCase();
              if (
                !afterClickUrl.includes('/logincheck') &&
                !afterClickUrl.includes('/userbasebranch') &&
                !afterClickUrl.includes('/changeuserbranch')
              ) {
                return { selected: true, activeBranch: target, discoveredBranches };
              }
            } catch {}
          }
        }

        // Check if branch was clicked but portal session did not confirm
        const finalUrlAfterAttempts = page.url().toLowerCase();
        if (
          finalUrlAfterAttempts.includes('/logincheck') ||
          finalUrlAfterAttempts.includes('/userbasebranch') ||
          finalUrlAfterAttempts.includes('/changeuserbranch')
        ) {
          const errText =
            (await page.locator('.error, .alert-danger, [data-testid="error-message"], .text-danger').first().textContent().catch(() => '')) || '';
          if (errText.trim()) {
            return {
              selected: false,
              discoveredBranches,
              errorCode: 'BRANCH_CONFIRMATION_FAILED',
              errorMessage: `BRANCH_CONFIRMATION_FAILED: Portal did not establish branch context and remained on ${page.url()}. Portal error: ${errText.trim()}`,
            };
          }

          if (domResult.clicked) {
            // TEST DIRECT NAVIGATION RECOVERY!
            // When a branch is selected in Master V9.4, the portal may persist the branch in the session
            // while remaining on /loginCheck until the user or agent navigates to their destination route.
            const curUrl = page.url();
            let testTargetUrl = destinationUrl;
            if (!testTargetUrl) {
              try {
                const origin = new URL(curUrl).origin;
                testTargetUrl = curUrl.includes('/MasterV9.4') ? `${origin}/MasterV9.4/ResourceParent` : `${origin}/hmc/dashboard`;
              } catch {}
            }

            if (testTargetUrl) {
              onStepUpdate?.({
                stepIndex: 6,
                stepName: `Testing active branch session on destination: ${testTargetUrl}…`,
                status: 'RUNNING',
                startedAt: new Date().toISOString(),
              });

              try {
                await page.goto(testTargetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await page.waitForTimeout(500);
                const postNavUrl = page.url().toLowerCase();
                const pageContent = (await page.content().catch(() => '')).toLowerCase();
                const accessRestricted =
                  pageContent.includes('access restricted') ||
                  pageContent.includes('select an active base branch') ||
                  pageContent.includes('select branch');
                const sessionBounced =
                  postNavUrl.includes('/logincheck') ||
                  postNavUrl.includes('/userbasebranch') ||
                  postNavUrl.includes('/changeuserbranch') ||
                  postNavUrl.includes('/login') ||
                  accessRestricted;
                if (!sessionBounced) {
                  return {
                    selected: true,
                    activeBranch: domResult.matchedText || target,
                    discoveredBranches,
                  };
                }
              } catch {}
            }

            return {
              selected: false,
              discoveredBranches,
              errorCode: 'BRANCH_CONFIRMATION_FAILED',
              errorMessage: `BRANCH_CONFIRMATION_FAILED: Portal did not establish branch context after selecting branch '${target}' on ${page.url()}.`,
            };
          }

          return {
            selected: false,
            discoveredBranches,
            errorCode: 'BRANCH_NOT_FOUND',
            errorMessage: `BRANCH_NOT_FOUND: Target branch '${target}' was not found in available branches [${discoveredBranches.join(', ')}] on ${page.url()}. Stopped before Submit with 0 clicks.`,
          };
        }

        return { selected: true, activeBranch: target, discoveredBranches };
      }

      // If Central provided no branch:
      if (discoveredBranches.length === 1) {
        const onlyBranch = discoveredBranches[0];
        const domRes = await page
          .evaluate((b) => {
            const candidates = Array.from(
              document.querySelectorAll('.onbranchSelect, [data-branch], .node, .jOrgChart .node, .branch-card, .branch-item, a, button, [onclick], li, div, span, td')
            ) as HTMLElement[];
            const el = candidates.find((c) => (c.textContent || '').trim().toLowerCase() === b.toLowerCase());
            if (el) {
              let clickable: HTMLElement = el;
              if (el.matches('.onbranchSelect, [data-branch], button, a, [onclick], .node, input[type="radio"]')) {
                clickable = el;
              } else {
                const innerInteractive = el.querySelector('.onbranchSelect, [data-branch], button, a, [onclick], .node, input[type="radio"]') as HTMLElement | null;
                if (innerInteractive) {
                  clickable = innerInteractive;
                } else {
                  const outerInteractive = el.closest('.onbranchSelect, [data-branch], button, a, [onclick], .node, input[type="radio"]') as HTMLElement | null;
                  if (outerInteractive) {
                    clickable = outerInteractive;
                  } else {
                    clickable = (el.closest('li') || el) as HTMLElement;
                  }
                }
              }

              const branchCode = clickable.getAttribute('data-branch') ||
                el.getAttribute('data-branch') ||
                clickable.closest('[data-branch]')?.getAttribute('data-branch') ||
                el.closest('[data-branch]')?.getAttribute('data-branch');

              if (branchCode) {
                const roleInput = document.querySelector('input[name="txtrolecode"], #txtrolecode') as HTMLInputElement | null;
                if (roleInput) roleInput.value = branchCode;
              }

              clickable.scrollIntoView({ behavior: 'instant', block: 'center' });
              clickable.click();

              if (branchCode) {
                const roleForm = (document.getElementById('loginFormChangeRole') || document.querySelector('form#loginFormChangeRole')) as HTMLFormElement | null;
                if (roleForm) {
                  try {
                    roleForm.submit();
                  } catch {}
                }
              }

              return true;
            }
            return false;
          }, onlyBranch)
          .catch(() => false);

        if (domRes) {
          await page
            .waitForURL(
              (u) => {
                const uLower = u.toString().toLowerCase();
                return (
                  !uLower.includes('/logincheck') &&
                  !uLower.includes('/userbasebranch') &&
                  !uLower.includes('/changeuserbranch')
                );
              },
              { timeout: 8000 }
            )
            .catch(() => {});
          await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
          return { selected: true, activeBranch: onlyBranch, discoveredBranches };
        }
      } else if (discoveredBranches.length > 1) {
        return {
          selected: false,
          discoveredBranches,
          errorCode: 'BRANCH_AMBIGUOUS',
          errorMessage: `BRANCH_AMBIGUOUS: Multiple branches available [${discoveredBranches.join(', ')}] but no target branch was specified. Stopped before Submit with 0 clicks.`,
        };
      }

      // Self-healing fallback
      const fallbackCandidates = [
        page.locator('.jOrgChart .node, .orgChart .node, .node, [class*="node"]'),
        page.locator('a[href*="loginCheck"], a[href*="userBaseBranch"], a[href*="changeUserBranch"], a[href*="branch" i], a[onclick*="branch" i]'),
        page.locator('div, span, a, td, button').filter({
          hasText: /HOSPITAL|CLINIC|SURGERY|BRANCH|CARE|LLC|CENTER|HEALTH|MEDICAL|TESTING/i,
        }),
        page.locator('#chart a, .tree a, #page a:not([href*="logout"])'),
      ];

      for (const group of fallbackCandidates) {
        const count = await group.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const item = group.nth(i);
          const text = (await item.textContent().catch(() => '')) || '';
          const lower = text.toLowerCase();
          if (lower.includes('simplex') || lower.includes('choose branch') || lower.includes('logout') || lower.includes('welcome')) {
            continue;
          }
          await item.scrollIntoViewIfNeeded().catch(() => {});
          if (await item.isVisible().catch(() => false)) {
            const clickable = item
              .locator('xpath=ancestor-or-self::a | ancestor-or-self::button | ancestor-or-self::div[contains(@class, "node")] | ancestor-or-self::li')
              .first();
            const targetEl = (await clickable.count().catch(() => 0)) > 0 ? clickable : item;
            await targetEl.click({ force: true }).catch(() => {});
            await page
              .waitForURL(
                (u) => {
                  const uLower = u.toString().toLowerCase();
                  return (
                    !uLower.includes('/logincheck') &&
                    !uLower.includes('/userbasebranch') &&
                    !uLower.includes('/changeuserbranch')
                  );
                },
                { timeout: 5000 }
              )
              .catch(() => {});
            const postFbUrl = page.url().toLowerCase();
            if (
              !postFbUrl.includes('/logincheck') &&
              !postFbUrl.includes('/userbasebranch') &&
              !postFbUrl.includes('/changeuserbranch')
            ) {
              return { selected: true, activeBranch: text.trim(), discoveredBranches };
            }
          }
        }
      }

      const finalUrl = page.url().toLowerCase();
      const leavesBranch =
        !finalUrl.includes('/logincheck') &&
        !finalUrl.includes('/userbasebranch') &&
        !finalUrl.includes('/changeuserbranch');
      return {
        selected: leavesBranch,
        discoveredBranches,
        errorCode: leavesBranch ? undefined : 'BRANCH_CONFIRMATION_FAILED',
        errorMessage: leavesBranch ? undefined : 'BRANCH_CONFIRMATION_FAILED: Failed to confirm branch selection.',
      };
    } catch (err: any) {
      return {
        selected: false,
        discoveredBranches: [],
        errorCode: 'BRANCH_CONFIRMATION_FAILED',
        errorMessage: `BRANCH_CONFIRMATION_FAILED: ${err.message}`,
      };
    }
  }
}
