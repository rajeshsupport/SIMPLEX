import { z } from 'zod';

export const ElementSelectorSchema = z.object({
  strategy: z.enum(['TEST_ID', 'ID', 'ROLE', 'LABEL', 'NAME', 'PLACEHOLDER', 'CSS', 'XPATH_LEGACY']),
  value: z.string().min(1),
  roleName: z.string().optional(),
  fallbackSelectors: z.array(z.object({
    strategy: z.enum(['TEST_ID', 'ID', 'ROLE', 'LABEL', 'NAME', 'PLACEHOLDER', 'CSS', 'XPATH_LEGACY']),
    value: z.string().min(1),
    roleName: z.string().optional(),
  })).optional(),
  description: z.string().optional(),
});

export const WorkflowStepSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  stepName: z.string().min(1),
  action: z.enum(['NAVIGATE', 'FILL', 'CLICK', 'SELECT', 'WAIT_FOR_ELEMENT', 'WAIT_FOR_NAVIGATION', 'ASSERT_TEXT', 'CAPTURE_SCREENSHOT']),
  targetSelector: ElementSelectorSchema.optional(),
  valueTemplate: z.string().optional(),
  timeoutMs: z.number().positive().optional(),
  isOptional: z.boolean().optional().default(false),
  captureScreenshotOnError: z.boolean().optional().default(true),
});

export const WorkflowConditionSchema = z.object({
  type: z.enum(['URL_CONTAINS', 'ELEMENT_VISIBLE', 'TEXT_PRESENT', 'SECURITY_CONTROL_DETECTED']),
  selector: ElementSelectorSchema.optional(),
  expectedValue: z.string().optional(),
  isTerminalSuccess: z.boolean().optional(),
  isTerminalError: z.boolean().optional(),
  isSecurityControlBlock: z.boolean().optional(),
  errorMessage: z.string().optional(),
});

export const CreateWorkflowSchema = z.object({
  workflowCode: z.string().min(2).max(50),
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
  appVersion: z.string().default('v1.0'),
  pageRoute: z.string(),
  steps: z.array(WorkflowStepSchema).min(1),
  successConditions: z.array(WorkflowConditionSchema).default([]),
  errorConditions: z.array(WorkflowConditionSchema).default([]),
  securityBlockConditions: z.array(WorkflowConditionSchema).default([]),
  defaultTimeoutMs: z.number().default(30000),
  maxRetries: z.number().default(2),
});

export type CreateWorkflowDto = z.infer<typeof CreateWorkflowSchema>;
