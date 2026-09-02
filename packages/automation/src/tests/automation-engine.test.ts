import { chromium } from 'playwright';
import { startFixtureServer } from '../fixture/server.js';
import { WorkflowExecutor } from '../engine/workflow-executor.js';
import { WorkflowVersionConfig } from '@hmc/shared';
import * as http from 'http';

async function runTests() {
  console.log('--- Starting Automation Engine Integration Tests ---');
  let server: http.Server | null = null;
  const testPort = 4001;
  const baseUrl = `http://localhost:${testPort}`;

  try {
    server = await startFixtureServer(testPort);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    // 1. Test Login Workflow
    console.log('\n[TEST 1] Testing Automated Login Workflow...');
    const loginWorkflow: WorkflowVersionConfig = {
      versionNumber: 1,
      applicableAppVersion: 'v1.0',
      pageRoute: '/hmc/login',
      steps: [
        {
          stepIndex: 1,
          stepName: 'Navigate to Login Page',
          action: 'NAVIGATE',
          valueTemplate: `${baseUrl}/hmc/login`,
        },
        {
          stepIndex: 2,
          stepName: 'Enter Username',
          action: 'FILL',
          targetSelector: { strategy: 'TEST_ID', value: 'input-username' },
          valueTemplate: '{{username}}',
        },
        {
          stepIndex: 3,
          stepName: 'Enter Password',
          action: 'FILL',
          targetSelector: { strategy: 'TEST_ID', value: 'input-password' },
          valueTemplate: '{{password}}',
        },
        {
          stepIndex: 4,
          stepName: 'Click Sign In',
          action: 'CLICK',
          targetSelector: { strategy: 'TEST_ID', value: 'btn-login' },
        },
        {
          stepIndex: 5,
          stepName: 'Wait for Dashboard',
          action: 'WAIT_FOR_ELEMENT',
          targetSelector: { strategy: 'TEST_ID', value: 'hmc-dashboard' },
        },
      ],
      successConditions: [
        { type: 'URL_CONTAINS', expectedValue: '/hmc/dashboard', isTerminalSuccess: true },
        { type: 'ELEMENT_VISIBLE', selector: { strategy: 'TEST_ID', value: 'hmc-dashboard' }, isTerminalSuccess: true },
      ],
      errorConditions: [
        { type: 'TEXT_PRESENT', expectedValue: 'Invalid credentials', errorMessage: 'Invalid login' },
      ],
      securityBlockConditions: [
        { type: 'ELEMENT_VISIBLE', selector: { strategy: 'TEST_ID', value: 'mfa-challenge' }, isSecurityControlBlock: true, errorMessage: 'MFA Detected' },
      ],
      defaultTimeoutMs: 10000,
      maxRetries: 1,
    };

    const loginResult = await WorkflowExecutor.executeWorkflow(
      page,
      loginWorkflow,
      { username: 'test_operator', password: 'SecretPassword123' },
      (telemetry) => {
        console.log(`  > Step ${telemetry.stepIndex} [${telemetry.stepName}]: ${telemetry.status}`);
      }
    );

    if (!loginResult.success || loginResult.status !== 'COMPLETED') {
      throw new Error(`Login workflow failed: ${loginResult.errorMessage}`);
    }
    console.log('✓ TEST 1 PASSED: Successfully logged in and arrived on dashboard.');

    // 2. Test Service Creation Workflow
    console.log('\n[TEST 2] Testing Service Creation Workflow...');
    const serviceWorkflow: WorkflowVersionConfig = {
      versionNumber: 1,
      applicableAppVersion: 'v1.0',
      pageRoute: '/hmc/services',
      steps: [
        {
          stepIndex: 1,
          stepName: 'Navigate to Services',
          action: 'NAVIGATE',
          valueTemplate: `${baseUrl}/hmc/services`,
        },
        {
          stepIndex: 2,
          stepName: 'Click Add Service Button',
          action: 'CLICK',
          targetSelector: { strategy: 'TEST_ID', value: 'btn-add-service' },
        },
        {
          stepIndex: 3,
          stepName: 'Fill Service Code',
          action: 'FILL',
          targetSelector: { strategy: 'TEST_ID', value: 'input-service-code' },
          valueTemplate: '{{serviceCode}}',
        },
        {
          stepIndex: 4,
          stepName: 'Fill Service Name',
          action: 'FILL',
          targetSelector: { strategy: 'TEST_ID', value: 'input-service-name' },
          valueTemplate: '{{serviceName}}',
        },
        {
          stepIndex: 5,
          stepName: 'Fill Unit Price',
          action: 'FILL',
          targetSelector: { strategy: 'TEST_ID', value: 'input-unit-price' },
          valueTemplate: '{{unitPrice}}',
        },
        {
          stepIndex: 6,
          stepName: 'Submit Service',
          action: 'CLICK',
          targetSelector: { strategy: 'TEST_ID', value: 'btn-save-service' },
        },
      ],
      successConditions: [
        { type: 'TEXT_PRESENT', expectedValue: 'Service saved successfully', isTerminalSuccess: true },
      ],
      errorConditions: [],
      securityBlockConditions: [],
      defaultTimeoutMs: 10000,
      maxRetries: 1,
    };

    const serviceResult = await WorkflowExecutor.executeWorkflow(
      page,
      serviceWorkflow,
      { serviceCode: 'TEST-SRV-99', serviceName: 'Automated Test Diagnostic', unitPrice: 275 },
      (telemetry) => {
        console.log(`  > Step ${telemetry.stepIndex} [${telemetry.stepName}]: ${telemetry.status}`);
      }
    );

    if (!serviceResult.success || serviceResult.status !== 'COMPLETED') {
      throw new Error(`Service creation workflow failed: ${serviceResult.errorMessage}`);
    }
    console.log('✓ TEST 2 PASSED: Successfully created service record on target HMC.');

    // 3. Test Security Control (MFA) Safe Halt
    console.log('\n[TEST 3] Testing MFA / Security Control Detection Safe Stop...');
    const mfaWorkflow: WorkflowVersionConfig = {
      ...loginWorkflow,
      steps: [
        {
          stepIndex: 1,
          stepName: 'Navigate to MFA Page',
          action: 'NAVIGATE',
          valueTemplate: `${baseUrl}/hmc/login?mfa=true`,
        },
      ],
    };

    const mfaResult = await WorkflowExecutor.executeWorkflow(
      page,
      mfaWorkflow,
      { username: 'test_user', password: 'password' }
    );

    if (mfaResult.status !== 'REQUIRES_MANUAL_INTERVENTION') {
      throw new Error(`Expected REQUIRES_MANUAL_INTERVENTION on MFA detection, got: ${mfaResult.status}`);
    }
    console.log('✓ TEST 3 PASSED: Workflow safely halted on security control detection (no bypass attempted).');

    await browser.close();
    console.log('\nAll Automation Engine tests completed successfully!');
  } finally {
    if (server) {
      server.close();
    }
  }
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
