import 'reflect-metadata';
import * as argon2 from 'argon2';
import { AppDataSource } from '../data-source.js';
import {
  Permission,
  Role,
  ApplicationUser,
  RetentionPolicy,
  AutomationWorkflow,
  AutomationWorkflowVersion,
} from '../entities/index.js';
import { ALL_PERMISSIONS, DEFAULT_ROLES, SYSTEM_ROLES } from '@hmc/shared';

export async function runSeeds(): Promise<void> {
  console.log('[SEED] Initializing database connection...');
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  const permissionRepo = AppDataSource.getRepository(Permission);
  const roleRepo = AppDataSource.getRepository(Role);
  const userRepo = AppDataSource.getRepository(ApplicationUser);
  const retentionRepo = AppDataSource.getRepository(RetentionPolicy);
  const workflowRepo = AppDataSource.getRepository(AutomationWorkflow);
  const workflowVersionRepo = AppDataSource.getRepository(AutomationWorkflowVersion);

  console.log('[SEED] 1. Seeding permissions...');
  const permissionMap = new Map<string, Permission>();

  for (const permDef of ALL_PERMISSIONS) {
    let perm = await permissionRepo.findOne({ where: { code: permDef.code } });
    if (!perm) {
      perm = permissionRepo.create({
        code: permDef.code,
        name: permDef.name,
        category: permDef.category,
        description: permDef.description,
      });
      perm = await permissionRepo.save(perm);
    }
    permissionMap.set(perm.code, perm);
  }
  console.log(`[SEED] Permissions synchronized (${permissionMap.size} permissions).`);

  console.log('[SEED] 2. Seeding default roles & role-permissions...');
  const roleMap = new Map<string, Role>();

  for (const roleDef of DEFAULT_ROLES) {
    let role = await roleRepo.findOne({
      where: { name: roleDef.name },
      relations: ['permissions'],
    });

    const targetPermissions = roleDef.permissions
      .map((code) => permissionMap.get(code))
      .filter((p): p is Permission => p !== undefined);

    if (!role) {
      role = roleRepo.create({
        name: roleDef.name,
        description: roleDef.description,
        isSystem: roleDef.isSystem,
        permissions: targetPermissions,
        createdBy: 'SYSTEM_BOOTSTRAP',
      });
      role = await roleRepo.save(role);
    } else {
      role.permissions = targetPermissions;
      role = await roleRepo.save(role);
    }
    roleMap.set(role.name, role);
  }
  console.log(`[SEED] Roles synchronized (${roleMap.size} roles).`);

  console.log('[SEED] 3. Seeding retention policies...');
  const defaultPolicies = [
    { logType: 'SCREENSHOTS' as const, retentionDays: 30, isArchiveEnabled: false },
    { logType: 'ERROR_LOGS' as const, retentionDays: 90, isArchiveEnabled: false },
    { logType: 'AUDIT_LOGS' as const, retentionDays: 365, isArchiveEnabled: true, archiveDestination: 'central-storage/audit-archives' },
    { logType: 'IMPORT_SUMMARIES' as const, retentionDays: 365, isArchiveEnabled: true, archiveDestination: 'central-storage/import-archives' },
  ];

  for (const pol of defaultPolicies) {
    const existing = await retentionRepo.findOne({ where: { logType: pol.logType } });
    if (!existing) {
      const entity = retentionRepo.create(pol);
      await retentionRepo.save(entity);
    }
  }

  console.log('[SEED] 4. Seeding default automation workflows...');
  const defaultWorkflows = [
    {
      code: 'HMC_LOGIN',
      name: 'HMC Automated Login Workflow',
      description: 'Navigates to /hmc/login, enters credentials, submits, and verifies dashboard arrival',
      pageRoute: '/hmc/login',
      steps: [
        {
          stepIndex: 1,
          stepName: 'Navigate to Login Page',
          action: 'NAVIGATE',
          valueTemplate: '{{loginUrl}}',
          timeoutMs: 15000,
        },
        {
          stepIndex: 2,
          stepName: 'Enter Username',
          action: 'FILL',
          targetSelector: {
            strategy: 'TEST_ID',
            value: 'input-username',
            fallbackSelectors: [
              { strategy: 'ID', value: 'username' },
              { strategy: 'NAME', value: 'username' },
              { strategy: 'LABEL', value: 'Username' },
              { strategy: 'PLACEHOLDER', value: 'Enter your username' },
              { strategy: 'CSS', value: 'input[type="text"]' },
            ],
          },
          valueTemplate: '{{username}}',
          timeoutMs: 10000,
        },
        {
          stepIndex: 3,
          stepName: 'Enter Password',
          action: 'FILL',
          targetSelector: {
            strategy: 'TEST_ID',
            value: 'input-password',
            fallbackSelectors: [
              { strategy: 'ID', value: 'password' },
              { strategy: 'NAME', value: 'password' },
              { strategy: 'LABEL', value: 'Password' },
              { strategy: 'PLACEHOLDER', value: 'Enter your password' },
              { strategy: 'CSS', value: 'input[type="password"]' },
            ],
          },
          valueTemplate: '{{password}}',
          timeoutMs: 10000,
        },
        {
          stepIndex: 4,
          stepName: 'Click Sign In Button',
          action: 'CLICK',
          targetSelector: {
            strategy: 'TEST_ID',
            value: 'btn-login',
            fallbackSelectors: [
              { strategy: 'ID', value: 'btnLogin' },
              { strategy: 'ROLE', value: 'button', roleName: 'Sign In' },
              { strategy: 'CSS', value: 'button[type="submit"]' },
            ],
          },
          timeoutMs: 10000,
        },
        {
          stepIndex: 5,
          stepName: 'Wait for Dashboard or Session State',
          action: 'WAIT_FOR_ELEMENT',
          targetSelector: {
            strategy: 'TEST_ID',
            value: 'hmc-dashboard',
            fallbackSelectors: [
              { strategy: 'ID', value: 'hmc-app-header' },
              { strategy: 'CSS', value: '.hmc-authenticated-layout' },
            ],
          },
          timeoutMs: 20000,
        },
      ],
      successConditions: [
        { type: 'URL_CONTAINS', expectedValue: '/hmc/dashboard', isTerminalSuccess: true },
        { type: 'ELEMENT_VISIBLE', selector: { strategy: 'TEST_ID', value: 'hmc-dashboard' }, isTerminalSuccess: true },
      ],
      errorConditions: [
        { type: 'TEXT_PRESENT', expectedValue: 'Invalid credentials', isTerminalError: true, errorMessage: 'Invalid username or password' },
        { type: 'TEXT_PRESENT', expectedValue: 'Account locked', isTerminalError: true, errorMessage: 'Account locked out on target HMC' },
      ],
      securityBlockConditions: [
        { type: 'ELEMENT_VISIBLE', selector: { strategy: 'TEST_ID', value: 'mfa-challenge' }, isSecurityControlBlock: true, errorMessage: 'MFA / 2FA required on target HMC' },
        { type: 'ELEMENT_VISIBLE', selector: { strategy: 'TEST_ID', value: 'captcha-container' }, isSecurityControlBlock: true, errorMessage: 'CAPTCHA detected on target HMC' },
      ],
    },
    {
      code: 'HMC_SERVICE_CREATE',
      name: 'HMC Service Master Creation Workflow',
      description: 'Opens /hmc/services, clicks Add Service, populates fields, and submits',
      pageRoute: '/hmc/services',
      steps: [
        {
          stepIndex: 1,
          stepName: 'Navigate to Services Screen',
          action: 'NAVIGATE',
          valueTemplate: '{{servicesUrl}}',
          timeoutMs: 15000,
        },
        {
          stepIndex: 2,
          stepName: 'Click Add Service Button',
          action: 'CLICK',
          targetSelector: {
            strategy: 'TEST_ID',
            value: 'btn-add-service',
            fallbackSelectors: [
              { strategy: 'ID', value: 'btnAddService' },
              { strategy: 'ROLE', value: 'button', roleName: 'Add New Service' },
              { strategy: 'CSS', value: '.btn-add-service' },
            ],
          },
          timeoutMs: 10000,
        },
        {
          stepIndex: 3,
          stepName: 'Fill Service Code',
          action: 'FILL',
          targetSelector: {
            strategy: 'TEST_ID',
            value: 'input-service-code',
            fallbackSelectors: [{ strategy: 'NAME', value: 'serviceCode' }, { strategy: 'ID', value: 'serviceCode' }],
          },
          valueTemplate: '{{serviceCode}}',
        },
        {
          stepIndex: 4,
          stepName: 'Fill Service Name',
          action: 'FILL',
          targetSelector: {
            strategy: 'TEST_ID',
            value: 'input-service-name',
            fallbackSelectors: [{ strategy: 'NAME', value: 'serviceName' }, { strategy: 'ID', value: 'serviceName' }],
          },
          valueTemplate: '{{serviceName}}',
        },
        {
          stepIndex: 5,
          stepName: 'Fill Unit Price',
          action: 'FILL',
          targetSelector: {
            strategy: 'TEST_ID',
            value: 'input-unit-price',
            fallbackSelectors: [{ strategy: 'NAME', value: 'unitPrice' }, { strategy: 'ID', value: 'unitPrice' }],
          },
          valueTemplate: '{{unitPrice}}',
        },
        {
          stepIndex: 6,
          stepName: 'Submit Service Form',
          action: 'CLICK',
          targetSelector: {
            strategy: 'TEST_ID',
            value: 'btn-save-service',
            fallbackSelectors: [{ strategy: 'ROLE', value: 'button', roleName: 'Save Service' }, { strategy: 'CSS', value: 'button[type="submit"]' }],
          },
        },
      ],
      successConditions: [
        { type: 'TEXT_PRESENT', expectedValue: 'Service saved successfully', isTerminalSuccess: true },
      ],
      errorConditions: [
        { type: 'TEXT_PRESENT', expectedValue: 'Duplicate service code', isTerminalError: true, errorMessage: 'Duplicate service code in target HMC' },
      ],
      securityBlockConditions: [],
    },
  ];

  for (const wf of defaultWorkflows) {
    let workflow = await workflowRepo.findOne({ where: { workflowCode: wf.code } });
    if (!workflow) {
      workflow = workflowRepo.create({
        workflowCode: wf.code,
        name: wf.name,
        description: wf.description,
        appVersion: 'v1.0',
        createdBy: 'SYSTEM_BOOTSTRAP',
      });
      workflow = await workflowRepo.save(workflow);

      const version = workflowVersionRepo.create({
        workflowId: workflow.id,
        versionNumber: 1,
        applicableAppVersion: 'v1.0',
        pageRoute: wf.pageRoute,
        stepsJson: JSON.stringify(wf.steps),
        successConditionsJson: JSON.stringify(wf.successConditions),
        errorConditionsJson: JSON.stringify(wf.errorConditions),
        securityBlockConditionsJson: JSON.stringify(wf.securityBlockConditions),
        defaultTimeoutMs: 30000,
        maxRetries: 2,
        isActive: true,
        createdBy: 'SYSTEM_BOOTSTRAP',
      });
      await workflowVersionRepo.save(version);
    }
  }

  console.log('[SEED] 5. Bootstrapping Super Admin user...');
  const superAdminUsername = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@hmc-central.local';
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || '[CONFIGURED_VIA_ADMIN_BOOTSTRAP]';

  let superAdmin = await userRepo.findOne({
    where: [{ username: superAdminUsername }, { email: superAdminEmail }],
    relations: ['roles'],
  });

  const superAdminRole = roleMap.get(SYSTEM_ROLES.SUPER_ADMIN);

  if (!superAdmin) {
    const passwordHash = await argon2.hash(superAdminPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    superAdmin = userRepo.create({
      username: superAdminUsername,
      email: superAdminEmail,
      fullName: 'System Super Administrator',
      passwordHash,
      status: 'ACTIVE',
      roles: superAdminRole ? [superAdminRole] : [],
      requirePasswordChange: false,
      createdBy: 'SYSTEM_BOOTSTRAP',
    });
    await userRepo.save(superAdmin);
    console.log(`[SEED] Created default Super Admin user: ${superAdminUsername}`);
  } else {
    console.log(`[SEED] Super Admin user already exists: ${superAdmin.username}`);
  }

  console.log('[SEED] Database seeding completed successfully.');
}

if (require.main === module) {
  runSeeds()
    .then(() => {
      console.log('[SEED] Process finished.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[SEED] Error during seeding:', err);
      process.exit(1);
    });
}
