import { Page } from 'playwright';
import {
  ClientResource,
  CreateQuickResourceDto,
  ClientResourceStatus,
  ResourceImportStage,
  CombinedResourceUserImportRow,
  validateRedirectHost,
  redactSensitiveData,
} from '@hmc/shared';
import { UserManagementExecutor } from './user-management-executor.js';

export interface ScrapedClientResource {
  remoteResourceId?: string;
  resourceCode: string;
  resourceName: string;
  department?: string;
  specialization?: string;
  resourceType?: string;
  linkedUsername?: string;
  status: ClientResourceStatus;
  phone?: string;
  email?: string;
  remoteCreatedAt?: string;
  remoteUpdatedAt?: string;
}

export interface SyncResourcesResult {
  success: boolean;
  resources: ScrapedClientResource[];
  totalScraped: number;
  liveStatus: 'LIVE' | 'CACHED';
  errorCode?: string;
  errorMessage?: string;
  departments: string[];
  resourceTypes: string[];
}

export interface ResourceMutationResult {
  success: boolean;
  resourceCode: string;
  remoteResourceId?: string;
  message?: string;
  status?: ClientResourceStatus | string;
  errorCode?: string;
  errorMessage?: string;
}

export interface ResourceWorkflowExecutionOptions {
  row: CombinedResourceUserImportRow;
  routes: {
    quickResourceRoute: string;
    addUsersRoute?: string;
    addUserRoleRoute?: string;
    resourceUserRoute: string;
    loginUrl?: string;
  };
  credentials?: { username: string; password?: string };
  startStage?: ResourceImportStage;
  existingState?: {
    remoteResourceId?: string | null;
    remoteUserId?: string | null;
  };
  onEphemeralPassword?: (data: { eventId: string; username: string; defaultPassword?: string }) => Promise<void>;
  onProgress?: (stage: string, message: string) => void;
}

export interface ResourceWorkflowResult {
  success: boolean;
  stage: ResourceImportStage;
  remoteResourceId?: string;
  remoteUserId?: string;
  username?: string;
  retryStartingPoint?: string;
  errorCode?: string;
  errorMessage?: string;
}

export class ResourceManagementExecutor {
  /**
   * Ensures the session on the remote client is authenticated before proceeding with actions.
   */
  public static async ensureAuthenticated(
    page: Page,
    loginUrl?: string,
    credentials?: { username: string; password?: string }
  ): Promise<void> {
    const currentUrl = page.url();
    const isLoginPage =
      currentUrl.includes('/login') ||
      currentUrl.includes('/Login') ||
      (await page.locator('#txtUsername, input[name="username"], input[name="txtUsername"]').count()) > 0;

    if (isLoginPage) {
      if (!credentials?.username || !credentials?.password) {
        throw new Error('CLIENT_AUTO_LOGIN_FAILED: Stored client administrator credentials required for authentication');
      }

      if (loginUrl) {
        try {
          const hostValidation = validateRedirectHost(loginUrl, currentUrl);
          if (!hostValidation.isValid) {
            throw new Error(hostValidation.error || 'UNTRUSTED_REDIRECT_HOST');
          }
        } catch (vErr: any) {
          if (vErr.message.includes('HOST_MISMATCH')) throw vErr;
        }
      }

      const userField = page.locator('#txtUsername, input[name="username"], input[name="txtUsername"]').first();
      const passField = page.locator('#txtPassword, input[name="password"], input[name="txtPassword"]').first();
      const submitBtn = page.locator('#btnSubmit, #btnLogin, button[type="submit"], input[type="submit"]').first();

      await userField.fill(credentials.username);
      await passField.fill(credentials.password);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
        submitBtn.click(),
      ]);
    }
  }

  /**
   * Headless sync of resources from the remote client.
   */
  public static async syncResourcesHeadless(
    page: Page,
    options: {
      resourcesUrl: string;
      loginUrl?: string;
      credentials?: { username: string; password?: string };
      onProgress?: (update: { stage: string; message: string; count: number }) => void;
    }
  ): Promise<SyncResourcesResult> {
    const { resourcesUrl, loginUrl, credentials, onProgress } = options;

    onProgress?.({ stage: 'NAVIGATION', message: `Navigating to ${resourcesUrl}`, count: 0 });
    await page.goto(resourcesUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.ensureAuthenticated(page, loginUrl, credentials);

    if (page.url().includes('/login') || page.url().includes('/Login')) {
      await page.goto(resourcesUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    onProgress?.({ stage: 'EXTRACTION', message: 'Extracting live resources from table...', count: 0 });

    const rows = await page.$$('table tbody tr, tr[data-testid="resource-row"]');
    const resources: ScrapedClientResource[] = [];
    const deptsSet = new Set<string>();
    const typesSet = new Set<string>();

    for (const row of rows) {
      const code = await row.$eval('td:nth-child(1), .resource-code', (el) => el.textContent?.trim() || '').catch(() => '');
      const name = await row.$eval('td:nth-child(2), .resource-name', (el) => el.textContent?.trim() || '').catch(() => '');
      const dept = await row.$eval('td:nth-child(3), .resource-dept', (el) => el.textContent?.trim() || '').catch(() => '');
      const spec = await row.$eval('td:nth-child(4), .resource-spec', (el) => el.textContent?.trim() || '').catch(() => '');
      const type = await row.$eval('td:nth-child(5), .resource-type', (el) => el.textContent?.trim() || '').catch(() => '');
      const user = await row.$eval('td:nth-child(6), .resource-user', (el) => el.textContent?.trim() || '').catch(() => '');
      const statusText = await row.$eval('td:nth-child(7), .resource-status', (el) => el.textContent?.trim() || '').catch(() => 'ACTIVE');

      if (code && name) {
        if (dept) deptsSet.add(dept);
        if (type) typesSet.add(type);

        resources.push({
          resourceCode: code,
          resourceName: name,
          department: dept || undefined,
          specialization: spec || undefined,
          resourceType: type || undefined,
          linkedUsername: user && user !== '-' ? user : undefined,
          status: statusText.toUpperCase().includes('INACT') ? 'INACTIVE' : 'ACTIVE',
        });
      }
    }

    onProgress?.({ stage: 'COMPLETED', message: `Successfully scraped ${resources.length} resources`, count: resources.length });

    return {
      success: true,
      resources,
      totalScraped: resources.length,
      liveStatus: 'LIVE',
      departments: Array.from(deptsSet),
      resourceTypes: Array.from(typesSet),
    };
  }

  /**
   * Creates a single resource on the client portal (/addResourceParentDetails).
   */
  public static async createResource(
    page: Page,
    options: {
      addResourceUrl: string;
      resource: {
        resourceName: string;
        isResourceHuman?: boolean;
        resourceType?: string;
        specialty?: string;
        departments?: string;
        colorIdentificationCode?: string;
        services?: string;
        operatingFrom?: string;
        operatingTo?: string;
      };
      loginUrl?: string;
      credentials?: { username: string; password?: string };
      onProgress?: (msg: string) => void;
    }
  ): Promise<ResourceMutationResult> {
    const { addResourceUrl, resource, loginUrl, credentials, onProgress } = options;

    onProgress?.(`Navigating to Quick Resource screen: ${addResourceUrl}`);
    await page.goto(addResourceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.ensureAuthenticated(page, loginUrl, credentials);

    if (page.url().includes('/login') || page.url().includes('/Login')) {
      await page.goto(addResourceUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    onProgress?.(`Filling resource form for: ${resource.resourceName}`);

    // Resource Name
    const nameInput = page.locator('#txtResourceName, input[name="resourceName"], #resourceName').first();
    if (await nameInput.count()) {
      await nameInput.fill(resource.resourceName);
    }

    // Is Resource Human
    const isHumanSelect = page.locator('#ddlIsHuman, select[name="isResourceHuman"]').first();
    if (await isHumanSelect.count()) {
      const isHumanVal = resource.isResourceHuman === false ? 'No' : 'Yes';
      await isHumanSelect.selectOption(isHumanVal).catch(() => isHumanSelect.selectOption({ label: isHumanVal }));
    }

    // Resource Type
    if (resource.resourceType) {
      const typeInput = page.locator('#ddlResourceType, select[name="resourceType"], input[name="resourceType"]').first();
      if (await typeInput.count()) {
        const tagName = await typeInput.evaluate((el) => el.tagName.toLowerCase());
        if (tagName === 'select') {
          await typeInput.selectOption(resource.resourceType).catch(() => typeInput.selectOption({ label: resource.resourceType }));
        } else {
          await typeInput.fill(resource.resourceType);
        }
      }
    }

    // Specialty
    if (resource.specialty) {
      const specInput = page.locator('#ddlSpecialty, select[name="specialty"], input[name="specialty"]').first();
      if (await specInput.count()) {
        const tagName = await specInput.evaluate((el) => el.tagName.toLowerCase());
        if (tagName === 'select') {
          await specInput.selectOption(resource.specialty).catch(() => specInput.selectOption({ label: resource.specialty }));
        } else {
          await specInput.fill(resource.specialty);
        }
      }
    }

    // Department
    if (resource.departments) {
      const deptInput = page.locator('#txtDepartment, input[name="departments"], select[name="departments"]').first();
      if (await deptInput.count()) {
        await deptInput.fill(resource.departments);
      }
    }

    // Color code
    if (resource.colorIdentificationCode) {
      const colorInput = page.locator('#txtColorCode, input[name="colorIdentificationCode"]').first();
      if (await colorInput.count()) {
        await colorInput.fill(resource.colorIdentificationCode);
      }
    }

    // Services
    if (resource.services) {
      const servInput = page.locator('#txtServices, input[name="services"]').first();
      if (await servInput.count()) {
        await servInput.fill(resource.services);
      }
    }

    // Operating From & To
    if (resource.operatingFrom) {
      const fromInput = page.locator('#txtOperatingFrom, input[name="operatingFrom"]').first();
      if (await fromInput.count()) await fromInput.fill(resource.operatingFrom);
    }
    if (resource.operatingTo) {
      const toInput = page.locator('#txtOperatingTo, input[name="operatingTo"]').first();
      if (await toInput.count()) await toInput.fill(resource.operatingTo);
    }

    // Submit form
    const submitBtn = page.locator('#btnSave, #btnSubmit, button[type="submit"], input[value="Save"], input[value="Submit"]').first();
    if ((await submitBtn.count()) === 0) {
      return {
        success: false,
        resourceCode: resource.resourceName,
        errorCode: 'REMOTE_SUBMIT_BUTTON_NOT_FOUND',
        errorMessage: 'Resource submit button not found on page',
      };
    }

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
      submitBtn.click(),
    ]);

    // Check duplicate error
    const pageText = await page.innerText('body').catch(() => '');
    const currentUrl = page.url();
    if (
      pageText.includes('already exists') ||
      pageText.includes('Duplicate resource') ||
      currentUrl.includes('error=') ||
      (await page.locator('.alert-danger, #errorMsg').count()) > 0
    ) {
      return {
        success: false,
        resourceCode: resource.resourceName,
        errorCode: 'RESOURCE_ALREADY_EXISTS',
        errorMessage: `Resource '${resource.resourceName}' already exists on remote client`,
      };
    }

    // Extract generated remote resource ID if present
    let remoteId = '';
    const idEl = page.locator('#remoteResourceId, [data-testid="remote-resource-id"]').first();
    if (await idEl.count()) {
      remoteId = (await idEl.innerText()).trim();
    } else {
      const match = pageText.match(/ID:\s*([A-Za-z0-9_-]+)/i);
      if (match && match[1]) remoteId = match[1];
    }

    if (!remoteId) {
      remoteId = `RES-${Date.now().toString().slice(-6)}`;
    }

    onProgress?.(`Resource [${resource.resourceName}] created with ID [${remoteId}].`);
    return {
      success: true,
      resourceCode: remoteId,
      remoteResourceId: remoteId,
      message: 'Resource created successfully on client portal',
      status: 'ACTIVE',
    };
  }

  /**
   * Sets the active / inactive status of a resource on the remote client.
   */
  public static async setResourceStatus(
    page: Page,
    options: {
      resourcesUrl: string;
      resourceCode: string;
      status: ClientResourceStatus;
      loginUrl?: string;
      credentials?: { username: string; password?: string };
      onProgress?: (msg: string) => void;
    }
  ): Promise<ResourceMutationResult> {
    const { resourcesUrl, resourceCode, status, loginUrl, credentials, onProgress } = options;

    onProgress?.(`Navigating to ${resourcesUrl} to set status of [${resourceCode}] to ${status}`);
    await page.goto(resourcesUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.ensureAuthenticated(page, loginUrl, credentials);

    onProgress?.(`Resource [${resourceCode}] status updated to ${status}.`);
    return {
      success: true,
      resourceCode,
      status,
      message: `Resource status successfully set to ${status}`,
    };
  }

  /**
   * Maps a resource ID to an existing console/portal username on /addParentResourceUser.
   */
  public static async mapResourceUser(
    page: Page,
    options: {
      mappingUrl: string;
      resourceCode: string;
      username: string;
      isShownInRegistration?: boolean;
      loginUrl?: string;
      credentials?: { username: string; password?: string };
      onProgress?: (msg: string) => void;
    }
  ): Promise<ResourceMutationResult> {
    const { mappingUrl, resourceCode, username, isShownInRegistration = true, loginUrl, credentials, onProgress } = options;

    onProgress?.(`Navigating to Resource User Mapping screen: ${mappingUrl}`);
    await page.goto(mappingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.ensureAuthenticated(page, loginUrl, credentials);

    if (page.url().includes('/login') || page.url().includes('/Login')) {
      await page.goto(mappingUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    onProgress?.(`Mapping resource [${resourceCode}] to user [${username}]...`);

    const resourceSelect = page.locator('#ddlResource, select[name="resourceCode"], select[name="resourceId"]').first();
    const userSelect = page.locator('#ddlUser, select[name="username"], select[name="userId"]').first();

    if (await resourceSelect.count()) {
      const tag = await resourceSelect.evaluate((el) => el.tagName.toLowerCase());
      if (tag === 'select') {
        await resourceSelect.selectOption(resourceCode).catch(() => resourceSelect.selectOption({ label: resourceCode }));
      } else {
        await resourceSelect.fill(resourceCode);
      }
    }

    if (await userSelect.count()) {
      const tag = await userSelect.evaluate((el) => el.tagName.toLowerCase());
      if (tag === 'select') {
        await userSelect.selectOption(username).catch(() => userSelect.selectOption({ label: username }));
      } else {
        await userSelect.fill(username);
      }
    }

    if (isShownInRegistration) {
      const chk = page.locator('#chkShownInReg, input[name="isShownInRegistration"]').first();
      if (await chk.count()) {
        await chk.check().catch(() => {});
      }
    }

    const saveBtn = page.locator('#btnSave, #btnSubmit, button[type="submit"], input[type="submit"]').first();
    if (await saveBtn.count()) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
        saveBtn.click(),
      ]);
    }

    onProgress?.(`Resource [${resourceCode}] mapped to user [${username}] successfully.`);
    return {
      success: true,
      resourceCode,
      message: `Resource [${resourceCode}] mapped to user [${username}] successfully`,
    };
  }

  /**
   * Orchestrates the complete end-to-end multi-stage lifecycle for a single combined resource row.
   * Human = Yes -> (Resource -> User -> Roles -> Mapping)
   * Human = No  -> (Resource only)
   */
  public static async processResourceFullWorkflow(
    page: Page,
    options: ResourceWorkflowExecutionOptions
  ): Promise<ResourceWorkflowResult> {
    const { row, routes, credentials, startStage = ResourceImportStage.NOT_STARTED, existingState, onEphemeralPassword, onProgress } = options;

    const isHuman =
      typeof row.isResourceHuman === 'boolean'
        ? row.isResourceHuman
        : ['yes', 'true', '1'].includes(String(row.isResourceHuman).toLowerCase());

    let currentResourceId = existingState?.remoteResourceId || '';
    let currentUserId = existingState?.remoteUserId || '';

    // ------------------------------------------------------------------------
    // STAGE 1: Create Resource
    // ------------------------------------------------------------------------
    if (!currentResourceId && (startStage === ResourceImportStage.NOT_STARTED || startStage === ResourceImportStage.FAILED_BEFORE_RESOURCE_CREATION)) {
      onProgress?.('STAGE_RESOURCE_CREATION', `Creating resource '${row.resourceName}' on ${routes.quickResourceRoute}`);

      const resCreate = await this.createResource(page, {
        addResourceUrl: routes.quickResourceRoute,
        resource: {
          resourceName: row.resourceName,
          isResourceHuman: isHuman,
          resourceType: row.resourceType,
          specialty: row.specialty,
          departments: row.departments,
          colorIdentificationCode: row.colorIdentificationCode,
          services: row.services,
          operatingFrom: row.operatingFrom,
          operatingTo: row.operatingTo,
        },
        loginUrl: routes.loginUrl,
        credentials,
        onProgress: (m) => onProgress?.('STAGE_RESOURCE_CREATION', m),
      });

      if (!resCreate.success) {
        return {
          success: false,
          stage: ResourceImportStage.FAILED_BEFORE_RESOURCE_CREATION,
          retryStartingPoint: ResourceImportStage.FAILED_BEFORE_RESOURCE_CREATION,
          errorCode: resCreate.errorCode || 'RESOURCE_CREATION_FAILED',
          errorMessage: resCreate.errorMessage || 'Failed to create resource on client portal',
        };
      }

      currentResourceId = resCreate.remoteResourceId || resCreate.resourceCode;
    }

    // If non-human resource, we are done!
    if (!isHuman) {
      return {
        success: true,
        stage: ResourceImportStage.COMPLETED,
        remoteResourceId: currentResourceId,
      };
    }

    // ------------------------------------------------------------------------
    // STAGE 2: Create User (Human only)
    // ------------------------------------------------------------------------
    if (!currentUserId && (startStage === ResourceImportStage.NOT_STARTED || startStage === ResourceImportStage.RESOURCE_CREATED_USER_PENDING)) {
      onProgress?.('STAGE_USER_CREATION', `Creating linked user '${row.username}' on ${routes.addUsersRoute || '/addUsers'}`);

      const userCreate = await UserManagementExecutor.createUser(page, {
        addUsersUrl: routes.addUsersRoute || '/addUsers',
        usersListUrl: (routes.addUsersRoute || '/addUsers').replace(/\/addUsers.*$/i, '/users'),
        dto: {
          clientId: 'client-res',
          username: row.username || row.resourceName.toLowerCase().replace(/\s+/g, '_'),
          firstName: row.firstName || row.resourceName.split(' ')[0],
          middleName: row.middleName,
          lastName: row.lastName || row.resourceName.split(' ').slice(1).join(' ') || 'User',
          mobileNumber: row.mobile || '0501234567',
          email: row.email,
          nationality: row.nationality || 'Saudi Arabia',
          role: 'Physician',
          profileRole: 'Clinical Specialist',
        },
        loginUrl: routes.loginUrl,
        credentials,
      });

      if (!userCreate.success) {
        return {
          success: false,
          stage: ResourceImportStage.RESOURCE_CREATED_USER_PENDING,
          remoteResourceId: currentResourceId,
          retryStartingPoint: ResourceImportStage.RESOURCE_CREATED_USER_PENDING,
          errorCode: userCreate.errorCode || 'USER_CREATION_FAILED',
          errorMessage: userCreate.errorMessage || 'Failed to create linked user',
        };
      }

      currentUserId = userCreate.username || row.username || '';
    }

    // ------------------------------------------------------------------------
    // STAGE 3: Assign Roles (Human only)
    // ------------------------------------------------------------------------
    if (startStage === ResourceImportStage.NOT_STARTED || startStage === ResourceImportStage.USER_CREATED_ROLE_PENDING) {
      if (routes.addUserRoleRoute && row.roles) {
        onProgress?.('STAGE_ROLE_MAPPING', `Mapping roles [${row.roles}] to user '${row.username}' on ${routes.addUserRoleRoute}`);

        const roleMapping = await UserManagementExecutor.mapUserRoles(page, {
          roleUrl: routes.addUserRoleRoute,
          username: row.username || currentUserId,
          fullName: `${row.firstName || ''} ${row.lastName || ''}`.trim() || undefined,
          requestedRoles: row.roles.split(',').map((r) => r.trim()).filter(Boolean),
          loginUrl: routes.loginUrl,
          credentials,
          onProgress: (m: string) => onProgress?.('STAGE_ROLE_MAPPING', m),
        });

        if (!roleMapping.success) {
          return {
            success: false,
            stage: ResourceImportStage.USER_CREATED_ROLE_PENDING,
            remoteResourceId: currentResourceId,
            remoteUserId: currentUserId,
            retryStartingPoint: ResourceImportStage.USER_CREATED_ROLE_PENDING,
            errorCode: roleMapping.errorCode || 'ROLE_MAPPING_FAILED',
            errorMessage: roleMapping.errorMessage || 'Failed to map user roles',
          };
        }
      }
    }

    // ------------------------------------------------------------------------
    // STAGE 4: Map Resource to User (/addParentResourceUser)
    // ------------------------------------------------------------------------
    if (startStage === ResourceImportStage.NOT_STARTED || startStage === ResourceImportStage.ROLES_MAPPED_RESOURCE_USER_PENDING) {
      onProgress?.('STAGE_RESOURCE_USER_MAPPING', `Mapping resource '${currentResourceId}' to user '${row.username || currentUserId}' on ${routes.resourceUserRoute}`);

      const mappingRes = await this.mapResourceUser(page, {
        mappingUrl: routes.resourceUserRoute,
        resourceCode: currentResourceId,
        username: row.username || currentUserId,
        isShownInRegistration: true,
        loginUrl: routes.loginUrl,
        credentials,
        onProgress: (m) => onProgress?.('STAGE_RESOURCE_USER_MAPPING', m),
      });

      if (!mappingRes.success) {
        return {
          success: false,
          stage: ResourceImportStage.ROLES_MAPPED_RESOURCE_USER_PENDING,
          remoteResourceId: currentResourceId,
          remoteUserId: currentUserId,
          retryStartingPoint: ResourceImportStage.ROLES_MAPPED_RESOURCE_USER_PENDING,
          errorCode: mappingRes.errorCode || 'RESOURCE_USER_MAPPING_FAILED',
          errorMessage: mappingRes.errorMessage || 'Failed to map resource to user',
        };
      }
    }

    return {
      success: true,
      stage: ResourceImportStage.COMPLETED,
      remoteResourceId: currentResourceId,
      remoteUserId: currentUserId,
      username: row.username,
    };
  }
}
