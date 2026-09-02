export type SelectorStrategy =
  | 'TEST_ID'
  | 'ID'
  | 'ROLE'
  | 'LABEL'
  | 'NAME'
  | 'PLACEHOLDER'
  | 'CSS'
  | 'XPATH_LEGACY';

export interface ElementSelectorConfig {
  strategy: SelectorStrategy;
  value: string;
  roleName?: string;
  fallbackSelectors?: Array<{ strategy: SelectorStrategy; value: string; roleName?: string }>;
  description?: string;
}

export interface WorkflowStepDefinition {
  stepIndex: number;
  stepName: string;
  action: 'NAVIGATE' | 'FILL' | 'CLICK' | 'SELECT' | 'WAIT_FOR_ELEMENT' | 'WAIT_FOR_NAVIGATION' | 'ASSERT_TEXT' | 'CAPTURE_SCREENSHOT';
  targetSelector?: ElementSelectorConfig;
  valueTemplate?: string; // e.g. "{{username}}", "{{password}}", "{{serviceCode}}"
  timeoutMs?: number;
  isOptional?: boolean;
  captureScreenshotOnError?: boolean;
}

export interface WorkflowCondition {
  type: 'URL_CONTAINS' | 'ELEMENT_VISIBLE' | 'TEXT_PRESENT' | 'SECURITY_CONTROL_DETECTED';
  selector?: ElementSelectorConfig;
  expectedValue?: string;
  isTerminalSuccess?: boolean;
  isTerminalError?: boolean;
  isSecurityControlBlock?: boolean; // flags OTP/MFA/CAPTCHA
  errorMessage?: string;
}

export interface WorkflowVersionConfig {
  versionNumber: number;
  applicableAppVersion: string;
  pageRoute: string;
  steps: WorkflowStepDefinition[];
  successConditions: WorkflowCondition[];
  errorConditions: WorkflowCondition[];
  securityBlockConditions: WorkflowCondition[];
  defaultTimeoutMs: number;
  maxRetries: number;
}

export type AutomationRunType =
  | 'INTERACTIVE_LOGIN'
  | 'TEST_LOGIN'
  | 'CREATE_USER'
  | 'RESET_PASSWORD'
  | 'CREATE_SERVICE'
  | 'BULK_IMPORT';

export type AutomationRunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REQUIRES_MANUAL_INTERVENTION';

export interface AutomationRunStepTelemetry {
  stepIndex: number;
  stepName: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  errorMessage?: string;
}
