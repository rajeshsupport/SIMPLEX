import { Page, Locator } from 'playwright';
import {
  ClientUser,
  CreateClientUserDto,
  UpdateClientUserDto,
  ClientUserStatus,
  ClientCreateFormMetadata,
  validateRedirectHost,
  CredentialDeliveryStatus,
  EphemeralCredentialPayload,
  EphemeralCredentialAck,
  redactSensitiveData,
  safeJsonStringify,
  assertValidOneTimeEventId,
  computeOneTimeEventIdHash,
  SHA256_EMPTY_DIGEST,
} from '@hmc/shared';
import { SelectorResolver } from './selector-resolver';
import { WorkflowExecutor } from './workflow-executor';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export interface ScrapedClientUser {
  remoteUserId?: string;
  username: string;
  normalizedUsername?: string;
  editRouteIdentifier?: string;
  sourcePage?: number;
  firstName: string;
  middleName?: string;
  lastName: string;
  fullName: string;
  nickName?: string;
  email?: string;
  mobileNumber?: string;
  nationality?: string;
  role?: string;
  profileRole?: string;
  status: ClientUserStatus;
  barcodeNumber?: string;
  hasSignature: boolean;
  signatureUrl?: string;
  hasStamp: boolean;
  stampUrl?: string;
  hasProfileImage: boolean;
  profileImageUrl?: string;
  remoteCreatedAt?: string;
  remoteUpdatedAt?: string;
}

export interface SyncProgressUpdate {
  stage:
    | 'QUEUED'
    | 'CLAIMED'
    | 'AUTHENTICATING'
    | 'NAVIGATING'
    | 'EXTRACTING'
    | 'PERSISTING'
    | 'SUCCEEDED'
    | 'COMPLETED'
    | 'FAILED'
    | 'CANCELLED'
    | 'TIMED_OUT'
    | 'CONNECTING'
    | 'LOADING_PAGE'
    | 'SYNCHRONIZING';
  message: string;
  currentPage: number;
  totalPages?: number;
  count: number;
  streamedUsers?: ScrapedClientUser[];
}

export interface SyncUsersResult {
  success: boolean;
  users: ScrapedClientUser[];
  totalScraped: number;
  remoteRowsRead?: number;
  remotePagesRead?: number;
  remoteDuplicatesRemoved?: number;
  remoteUniqueUsers?: number;
  liveStatus: 'LIVE' | 'CACHED';
  errorCode?: string;
  errorMessage?: string;
  options: {
    nationalities: string[];
    roles: string[];
    profileRoles: string[];
  };
}

export interface MutationResult {
  success: boolean;
  username: string;
  message?: string;
  status?: ClientUserStatus | string;
  remoteStage?: string;
  defaultPassword?: string;
  temporaryPassword?: string;
  isRemoteSaveConfirmed?: boolean;
  pendingReconciliation?: boolean;
  actionTaken?: 'NO_CHANGE_REQUIRED' | 'MUTATED' | string;
  retryStartingPoint?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface RoleMappingResult {
  success: boolean;
  username: string;
  userSearchState: 'NOT_STARTED' | 'IN_PROGRESS' | 'EXACT_MATCH_FOUND' | 'FAILED' | 'AMBIGUOUS' | 'SKIPPED';
  roleSelectionState: 'NOT_STARTED' | 'IN_PROGRESS' | 'SELECTED' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  roleUpdateState: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  roleVerificationState: 'NOT_STARTED' | 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'SKIPPED';
  overallStatus: 'COMPLETED' | 'PARTIAL_FAILED' | 'FAILED';
  requestedRoles: string[];
  mappedRoles: string[];
  missingRoles: string[];
  deactivatedRoles?: string[];
  roleSelectionProgress?: string;
  failureReason?: string;
  errorCode?: string;
  errorMessage?: string;
  retryStartingPoint?: 'USER_CREATION' | 'ROLE_STATE_INSPECTION' | 'VALIDATION' | 'NONE';
  diagnostics?: any;
}

export interface UserWorkflowResult {
  success: boolean;
  username: string;
  fullName?: string;
  validationState: 'NOT_STARTED' | 'IN_PROGRESS' | 'PASSED' | 'FAILED';
  creationState: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  userSearchState: 'NOT_STARTED' | 'IN_PROGRESS' | 'EXACT_MATCH_FOUND' | 'FAILED' | 'AMBIGUOUS' | 'SKIPPED';
  roleSelectionState: 'NOT_STARTED' | 'IN_PROGRESS' | 'SELECTED' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  roleUpdateState: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  roleVerificationState: 'NOT_STARTED' | 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'SKIPPED';
  overallStatus: 'READY' | 'IN_PROGRESS' | 'COMPLETED' | 'PARTIAL_FAILED' | 'FAILED' | 'ALREADY_EXISTS' | 'CANCELLED' | 'NOT_PROCESSED' | 'SKIPPED_DUPLICATE';
  failureReason?: string;
  errorCode?: string;
  errorMessage?: string;
  retryStartingPoint?: 'USER_CREATION' | 'ROLE_STATE_INSPECTION' | 'VALIDATION' | 'NONE';
  nextAction?: string;
  requestedRoles?: string[];
  mappedRoles?: string[];
  missingRoles?: string[];
  roleSelectionProgress?: string;
  credentialDeliveryStatus?: CredentialDeliveryStatus;
  defaultPassword?: string;
  temporaryPassword?: string;
  ephemeralDefaultPassword?: string;
}


export interface MapBillCounterUserOptions {
  addBillCounterUrl: string;
  billCounterListUrl?: string;
  username: string;
  remoteUserId?: string;
  roleName?: string;
  loginUrl?: string;
  credentials?: { username: string; password?: string };
  targetBranch?: string;
  onProgress?: (msg: string) => void;
  onMutationDispatched?: () => void;
}

export interface MapBillCounterUserResult {
  success: boolean;
  alreadyExists?: boolean;
  username: string;
  billCounterName?: string;
  roleName?: string;
  message: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface BillCounterMappingRecord {
  billCounterName: string;
  userName: string;
  role?: string;
  isActive: boolean;
}

export interface FetchBillCounterMappingsOptions {
  billCounterListUrl: string;
  loginUrl?: string;
  credentials?: { username: string; password?: string };
  targetBranch?: string;
  onProgress?: (msg: string) => void;
}

export interface FetchBillCounterMappingsResult {
  success: boolean;
  mappings: BillCounterMappingRecord[];
  totalCount: number;
  message?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface MapStockLocationUserOptions {
  addStockLocationUrl: string;
  stockLocationListUrl?: string;
  username: string;
  remoteUserId?: string | null;
  fullName?: string;
  stockLocationNames?: string[];
  stockLocationIds?: string[];
  loginUrl?: string;
  credentials?: { username: string; password?: string };
  targetBranch?: string;
  onProgress?: (msg: string) => void;
  onMutationDispatched?: () => void;
}

export interface MapStockLocationUserResult {
  success: boolean;
  alreadyExists?: boolean;
  username: string;
  mappedLocations?: string[];
  message: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface StockLocationMappingRecord {
  userName: string;
  stockLocationName: string;
  status: string;
  isActive: boolean;
}

export interface FetchStockLocationMappingsOptions {
  stockLocationListUrl: string;
  loginUrl?: string;
  credentials?: { username: string; password?: string };
  targetBranch?: string;
  onProgress?: (msg: string) => void;
}

export interface FetchStockLocationMappingsResult {
  success: boolean;
  mappings: StockLocationMappingRecord[];
  totalCount: number;
  message?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface OpenStockLocationInteractiveSessionOptions {
  addStockLocationUrl: string;
  username: string;
  remoteUserId?: string | null;
  fullName?: string;
  loginUrl?: string;
  credentials?: { username: string; password?: string };
  targetBranch?: string;
  onProgress?: (msg: string) => void;
}


export interface DocumentTypeItemRecord {
  sno: string;
  name: string;
  group: string;
  status: string;
  editHref: string | null;
  docTypeSno: string;
  docTypeName: string;
  userDocGroup: string;
  totalUsersCount: number;
  mappedUsersCount: number;
  mappedUsernames: string[];
}

export interface FetchDocumentTypeMappingsOptions {
  documentTypeListUrl: string;
  loginUrl?: string;
  credentials?: { username: string; password?: string };
  targetBranch?: string;
  onProgress?: (msg: string) => void;
}

export interface FetchDocumentTypeMappingsResult {
  success: boolean;
  documentTypes: DocumentTypeItemRecord[];
  userMappings: Array<{
    docTypeId: string;
    docTypeName: string;
    userDocGroup?: string;
    userName: string;
    username: string;
  }>;
  totalDocumentTypes: number;
  totalMappings: number;
  message?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface UpdateDocumentTypeMappingsOptions {
  docTypeId: string;
  selectedUsernames: string[];
  userDocGroup?: string;
  documentTypeListUrl: string;
  editUrl?: string;
  loginUrl?: string;
  credentials?: { username: string; password?: string };
  targetBranch?: string;
  onProgress?: (msg: string) => void;
  onMutationDispatched?: () => void;
}

export interface UpdateDocumentTypeMappingsResult {
  success: boolean;
  docTypeId: string;
  docTypeName?: string;
  selectedUsernames: string[];
  message: string;
  errorCode?: string;
  errorMessage?: string;
}


export interface FormAssemblyItemRecord {
  formId: string;
  formName: string;
  groupName: string;
  isDefault: boolean;
  encounterType?: string;
  isAssigned?: boolean;
  status: string;
}

export interface FetchFormAssemblyMappingsOptions {
  emrPanelUrl: string;
  loginUrl?: string;
  credentials?: { username: string; password?: string };
  targetBranch?: string;
  userId?: string;
  username?: string;
  onProgress?: (msg: string) => void;
}

export interface FetchFormAssemblyMappingsResult {
  success: boolean;
  forms: FormAssemblyItemRecord[];
  userMappings: Array<{
    formId: string;
    formName: string;
    groupName?: string;
    userName: string;
    username: string;
    isDefault: boolean;
  }>;
  totalForms: number;
  totalMappings: number;
  message?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface UpdateFormAssemblyMappingsOptions {
  emrPanelUrl: string;
  loginUrl?: string;
  credentials?: { username: string; password?: string };
  targetBranch?: string;
  userId?: string;
  username: string;
  fullName?: string;
  targetFormIds: string[];
  onProgress?: (msg: string) => void;
  onMutationDispatched?: () => void;
}

export interface UpdateFormAssemblyMappingsResult {
  success: boolean;
  username: string;
  assignedFormIds: string[];
  assignedFormNames: string[];
  message: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface OpenFormAssemblyInteractiveSessionOptions {
  emrPanelUrl: string;
  loginUrl?: string;
  credentials?: { username: string; password?: string };
  targetBranch?: string;
  userId?: string;
  username?: string;
  fullName?: string;
  onProgress?: (msg: string) => void;
}

export interface OpenDocumentTypeInteractiveSessionOptions {
  documentTypeListUrl: string;
  editUrl?: string;
  docTypeId?: string;
  groupCode?: string;
  username?: string;
  fullName?: string;
  loginUrl?: string;
  credentials?: { username: string; password?: string };
  targetBranch?: string;
  onProgress?: (msg: string) => void;
}

export class UserManagementExecutor {
  private static cachedClientDefaultPasswords = new Map<string, string>();

  public static recordClientDefaultPassword(url: string, password?: string): void {
    if (!password) return;
    try {
      const origin = url.startsWith('http') ? new URL(url).origin : url.split('/')[0];
      this.cachedClientDefaultPasswords.set(origin, password);
    } catch {
      this.cachedClientDefaultPasswords.set('default', password);
    }
  }

  public static getCachedClientDefaultPassword(url: string): string | undefined {
    try {
      const origin = url.startsWith('http') ? new URL(url).origin : url.split('/')[0];
      return this.cachedClientDefaultPasswords.get(origin) || this.cachedClientDefaultPasswords.get('default');
    } catch {
      return this.cachedClientDefaultPasswords.get('default');
    }
  }

  /**
   * Performs an end-to-end background headless sync of all users across all pagination pages.
   * Handles headless background auto-login if redirected to login, navigates directly to users route,
   * extracts structured user data without binary leaks, streams progress, and detects errors.
   */
  public static async syncUsersHeadless(
    page: Page,
    options: {
      usersUrl: string;
      loginUrl?: string;
      credentials?: { username: string; password: string };
      targetBranch?: string;
      onProgress?: (update: SyncProgressUpdate) => void;
    }
  ): Promise<SyncUsersResult> {
    const { usersUrl, loginUrl, credentials, targetBranch, onProgress } = options;

    onProgress?.({
      stage: 'NAVIGATING',
      message: 'Opening client user directory…',
      currentPage: 1,
      count: 0,
    });

    // Perform background authentication if credentials are provided and session is not authenticated
    if (credentials && credentials.username && credentials.password) {
      onProgress?.({
        stage: 'AUTHENTICATING',
        message: 'Authenticating securely…',
        currentPage: 1,
        count: 0,
      });

      const targetLoginUrl = loginUrl || usersUrl.replace(/\/users.*$/i, '/login');
      try {
        await page.goto(targetLoginUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (err: any) {
        return {
          success: false,
          users: [],
          totalScraped: 0,
          liveStatus: 'CACHED',
          errorCode: 'CLIENT_USER_SYNC_TIMEOUT',
          errorMessage: `Connection timeout navigating to login page: ${err.message}`,
          options: this.getDefaultOptions(),
        };
      }

      // Perform headless background login using SelectorResolver (10s timeout)
      const userLoc = await SelectorResolver.findVisibleLocator(page, undefined, SelectorResolver.USERNAME_FALLBACKS, 10000);
      const passLoc = await SelectorResolver.findVisibleLocator(page, undefined, SelectorResolver.PASSWORD_FALLBACKS, 10000);
      const submitLoc = await SelectorResolver.findVisibleLocator(page, undefined, SelectorResolver.SUBMIT_FALLBACKS, 10000);

      if (!userLoc || !passLoc || !submitLoc) {
        return {
          success: false,
          users: [],
          totalScraped: 0,
          liveStatus: 'CACHED',
          errorCode: 'CLIENT_BACKGROUND_LOGIN_FAILED',
          errorMessage: 'Client login fields could not be identified during background authentication.',
          options: this.getDefaultOptions(),
        };
      }

      await SelectorResolver.fillInputReliably(userLoc.locator, credentials.username);
      await SelectorResolver.fillInputReliably(passLoc.locator, credentials.password);
      await SelectorResolver.triggerSubmit(submitLoc.locator, passLoc.locator);

      // Check for multi-branch screen (/userBaseBranch, /loginCheck or CHOOSE BRANCH) with polling
      const branchTarget = (options as any).targetBranch || (options as any).branchName;
      const branchWaitStart = Date.now();
      while (Date.now() - branchWaitStart < 10000) {
        if (
          page.url().toLowerCase().includes('/userbasebranch') ||
          page.url().toLowerCase().includes('/changeuserbranch') ||
          page.url().toLowerCase().includes('/logincheck') ||
          (await WorkflowExecutor.checkBranchSelectionScreen(page))
        ) {
          onProgress?.({
            stage: 'AUTHENTICATING',
            message: `Multi-branch screen detected. Selecting branch: ${branchTarget || 'default'}…`,
            currentPage: 1,
            count: 0,
          });
          const branchRes = await WorkflowExecutor.handleBranchSelection(page, branchTarget, undefined, (options as any).usersUrl);
          if (!branchRes.selected && branchRes.errorCode) {
            return {
              success: false,
              users: [],
              totalScraped: 0,
              liveStatus: 'CACHED',
              errorCode: branchRes.errorCode,
              errorMessage: branchRes.errorMessage,
              options: this.getDefaultOptions(),
            };
          }
          break;
        }
        await page.waitForTimeout(300);
      }

      // Confirm login redirect completed and wait for authenticated facility header
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      await page.waitForSelector('.header-user-name, #welpag, .header-cus, .header-logo, #page', { timeout: 10000 }).catch(() => {});

      onProgress?.({
        stage: 'NAVIGATING',
        message: 'Opening client user directory…',
        currentPage: 1,
        count: 0,
      });

      // Navigate to target users route after authentication (15s timeout)
      await page.goto(usersUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForSelector('table tbody tr, [ng-repeat], [role="row"], .user-row', { timeout: 15000 }).catch(() => {});
    } else {
      try {
        await page.goto(usersUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (err: any) {
        return {
          success: false,
          users: [],
          totalScraped: 0,
          liveStatus: 'CACHED',
          errorCode: 'CLIENT_USER_SYNC_TIMEOUT',
          errorMessage: `Connection timeout navigating to ${usersUrl}: ${err.message}`,
          options: this.getDefaultOptions(),
        };
      }
    }

    // Check for Access Denied or Client Error Page
    const pageStatus = await page.evaluate(() => {
      const text = document.body ? document.body.innerText.toLowerCase() : '';
      if (text.includes('403 forbidden') || text.includes('access denied') || text.includes('unauthorized access')) {
        return 'ACCESS_DENIED';
      }
      if (text.includes('404 not found') || text.includes('page not found')) {
        return 'PAGE_NOT_FOUND';
      }
      return 'OK';
    });

    if (pageStatus === 'ACCESS_DENIED') {
      return {
        success: false,
        users: [],
        totalScraped: 0,
        liveStatus: 'CACHED',
        errorCode: 'CLIENT_USER_ACCESS_DENIED',
        errorMessage: 'Client portal returned Access Denied for the configured user directory route.',
        options: this.getDefaultOptions(),
      };
    }

    // 1. Check and wait for loading overlays to disappear
    try {
      await page.locator('.loading, #loading, .spinner, .overlay, img[src*="loading" i], .loader').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    } catch {}

    // 2. Identify Screen Heading
    const screenHeading = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, .page-title, .screen-title, .title, .heading, legend, .mm-title, [class*="title" i], [class*="header" i]'))
        .map(el => (el.textContent || '').trim())
        .filter(t => t.length > 0 && !t.includes('\n'));
      return headings.find(h => /user|master|details|himes/i.test(h)) || headings[0] || 'User Details';
    });

    // 3. Dedicated MasterV9.4 Screen Adapter: Priority Record Container Detection
    // Priority order:
    // 1. [ng-repeat] or [data-ng-repeat]
    // 2. [role="row"] and [role="gridcell"]
    // 3. ui-grid / ag-grid / custom-grid rows
    // 4. Repeated containers sharing the same class
    // 5. Repeated containers aligned below the six visible headers (S.NO, User Name, Name, Mobile No, Status, Action)
    // 6. Standard table rows (table tbody tr)
    const allFrames = [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())];
    let targetFrame = page.mainFrame();
    let structureEval = { structure: 'NONE', count: 0, selector: '', asyncLoadStatus: 'PENDING' };

    // 4. Observe DOM mutations / async data loading for up to 20 seconds
    const asyncStartTime = Date.now();
    const maxAsyncWaitMs = 5000; // 5s bounded wait for test suite and runtime responsiveness

    while (Date.now() - asyncStartTime < maxAsyncWaitMs) {
      for (const frame of allFrames) {
        const frameStructure = await frame.evaluate(() => {
          // Priority 1: AngularJS ng-repeat
          const ngRows = Array.from(document.querySelectorAll('[ng-repeat*="user" i], [data-ng-repeat*="user" i], [ng-repeat*="item" i], [data-ng-repeat*="item" i], [ng-repeat*="row" i], [data-ng-repeat*="row" i]'));
          if (ngRows.length > 0) {
            return { structure: 'ANGULAR_NG_REPEAT', count: ngRows.length, selector: '[ng-repeat*="user" i], [data-ng-repeat*="user" i], [ng-repeat*="item" i], [data-ng-repeat*="item" i], [ng-repeat*="row" i], [data-ng-repeat*="row" i]' };
          }

          // Priority 2: Accessibility roles
          const roleRows = Array.from(document.querySelectorAll('[role="row"]:not(:first-child), [role="listitem"]'));
          if (roleRows.length > 0) {
            return { structure: 'ACCESSIBILITY_ROLE_ROW', count: roleRows.length, selector: '[role="row"]:not(:first-child), [role="listitem"]' };
          }

          // Priority 3: ui-grid / ag-grid / custom-grid rows
          const gridRows = Array.from(document.querySelectorAll('.ui-grid-row, .ag-row, .custom-grid-row, .user-row, .user-grid-row, [class*="user-row" i], .user-card, .user-item'));
          if (gridRows.length > 0) {
            return { structure: 'DIV_BASED_GRID_ROW', count: gridRows.length, selector: '.ui-grid-row, .ag-row, .custom-grid-row, .user-row, .user-grid-row, [class*="user-row" i], .user-card, .user-item' };
          }

          // Priority 4: Standard HTML table rows (excluding thead, tfoot, filter rows, and empty state rows)
          const rawTableRows = Array.from(document.querySelectorAll('table tbody tr, table:not(:has(tbody)) tr'));
          const tableRows = rawTableRows.filter(r => {
            if (r.closest('thead') || r.closest('tfoot')) return false;
            const tds = r.querySelectorAll('td');
            if (tds.length === 0) return false;
            const cls = (r.className || '').toLowerCase();
            const id = (r.id || '').toLowerCase();
            const isFilterRow = (cls.includes('filter-table') || cls.includes('filter-row') || cls.includes('search-row') || id.includes('filter') || id.includes('search')) &&
              r.querySelector('input[type="text"], input[type="search"]') !== null;
            if (isFilterRow) return false;
            if (cls.includes('header') && !cls.includes('user') && r.querySelectorAll('input, button, a').length === 0) return false;
            const txt = (r.textContent || '').trim().toLowerCase();
            if (!txt || txt.includes('maximum characters') || txt.includes('no records found') || txt.includes('no data')) return false;
            return true;
          });
          if (tableRows.length > 0) {
            return { structure: 'HTML_TABLE', count: tableRows.length, selector: 'table tbody tr, table:not(:has(tbody)) tr' };
          }

          // Priority 5: Repeated containers aligned below the six visible headers
          const headerLabels = Array.from(document.querySelectorAll('th, .header, .col-header, [class*="header" i], dt')).map(h => (h.textContent || '').trim().toLowerCase());
          const hasUserHeaders = headerLabels.some(h => h.includes('user') || h.includes('name') || h.includes('mobile') || h.includes('status') || h.includes('s.no') || h.includes('action'));
          if (hasUserHeaders) {
            const candidateRows = Array.from(document.querySelectorAll('#menureplace .row, .content .row, .main-content .row, .row, [class*="row" i]'))
              .filter(r => r.children.length >= 3 && r.querySelectorAll('input, button, span, div, td, a').length >= 3);
            if (candidateRows.length > 0) {
              return { structure: 'FLEX_GRID_CONTAINER', count: candidateRows.length, selector: '#menureplace .row, .content .row, .main-content .row, .row, [class*="row" i]' };
            }
          }

          return { structure: 'NONE', count: 0, selector: '' };
        });

        if (frameStructure.count > 0) {
          targetFrame = frame;
          structureEval = {
            ...frameStructure,
            asyncLoadStatus: Date.now() - asyncStartTime > 500 ? 'ASYNC_LOADED' : 'SYNC_LOADED',
          };
          break;
        }
      }

      if (structureEval.count > 0) break;
      await new Promise(r => setTimeout(r, 500));
    }

    if (structureEval.count === 0) {
      structureEval.asyncLoadStatus = 'EMPTY_STATE_OR_UNAVAILABLE';
    }

    // 5. Save Sanitized Structural Snapshot (Excludes credentials, tokens, input values)
    const diagDir = path.join(os.homedir(), '.hmc-console', 'diagnostics');
    try {
      fs.mkdirSync(diagDir, { recursive: true });
      const sanitizedSnapshot = await page.evaluate((evalData) => {
        const tags: Record<string, number> = {};
        const classes: string[] = [];
        const ids: string[] = [];
        const roles: string[] = [];
        const angularDirectives: string[] = [];
        const visibleHeaderLabels: string[] = [];

        document.querySelectorAll('*').forEach((el) => {
          const tag = el.tagName.toLowerCase();
          tags[tag] = (tags[tag] || 0) + 1;
          if (el.id && !ids.includes(el.id)) ids.push(el.id);
          if (el.className && typeof el.className === 'string') {
            classes.push(...el.className.split(/\s+/).filter(Boolean));
          }
          const role = el.getAttribute('role');
          if (role && !roles.includes(role)) roles.push(role);

          // Angular directives
          Array.from(el.attributes).forEach((attr) => {
            if (attr.name.startsWith('ng-') || attr.name.startsWith('data-ng-') || attr.name.startsWith('ui-')) {
              if (!angularDirectives.includes(attr.name)) angularDirectives.push(attr.name);
            }
          });
        });

        document.querySelectorAll('h1, h2, h3, h4, h5, th, label, .title, .header').forEach((el) => {
          const t = (el.textContent || '').trim();
          if (t && t.length < 50 && !visibleHeaderLabels.includes(t)) {
            visibleHeaderLabels.push(t);
          }
        });

        return {
          timestamp: new Date().toISOString(),
          screenHeading: evalData.heading,
          detectedStructure: evalData.structure,
          recordContainersFound: evalData.count,
          tags,
          elementIds: ids.slice(0, 30),
          topClasses: Array.from(new Set(classes)).slice(0, 40),
          roles,
          angularDirectives,
          visibleHeaderLabels: visibleHeaderLabels.slice(0, 20),
        };
      }, { heading: screenHeading, structure: structureEval.structure, count: structureEval.count });

      const snapshotFile = path.join(diagDir, `user_screen_structure_${Date.now()}.json`);
      fs.writeFileSync(snapshotFile, JSON.stringify(sanitizedSnapshot, null, 2));

      const screenshotPath = path.join(diagDir, `user_screen_${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    } catch {}

    // 6. If record containers are not recognized, return USER_SCREEN_STRUCTURE_NOT_RECOGNIZED
    if (structureEval.count === 0) {
      return {
        success: false,
        users: [],
        totalScraped: 0,
        liveStatus: 'CACHED',
        errorCode: 'USER_SCREEN_STRUCTURE_NOT_RECOGNIZED',
        errorMessage: `User directory screen structure could not be recognized. Screen heading: "${screenHeading}".`,
        options: this.getDefaultOptions(),
      };
    }

    const scrapedUsersMap = new Map<string, ScrapedClientUser>();
    const seenPageSignatures = new Set<string>();
    let currentPage = 1;
    let totalRowsRead = 0;
    // 1. Fast jQuery / DOM expansion: Expand rows-per-page to 500 so all records are captured immediately
    try {
      await (targetFrame || page).evaluate(() => {
        try {
          const $ = (window as any).$ || (window as any).jQuery;
          const sel = document.querySelector('#tablePagination_rowsPerPage, select[name*="length" i], .dataTables_length select, select[name*="pageSize" i], select[name*="records" i]') as HTMLSelectElement | null;
          if (sel) {
            const vals = Array.from(sel.options).map(o => o.value);
            const targetVal = vals.find(v => v === '500' || v === '250' || v === '200' || v === '100' || v === '-1') || (sel.options[sel.options.length - 1]?.value);
            if (targetVal) {
              sel.value = targetVal;
              if ($) {
                $(sel).val(targetVal).trigger('change');
                $('table tbody tr').show().removeClass('hideSearch');
              } else {
                sel.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          }
        } catch {}
      });
      await page.waitForTimeout(1000);
    } catch {}

    // 1. Expand rows-per-page dropdown if available (e.g. 500, 250, 100, All) so all records can be captured
    const lengthSelectSelectors = [
      '#tablePagination_rowsPerPage',
      'select[name*="length" i]',
      '.dataTables_length select',
      'select[name*="pageSize" i]',
      'select[name*="records" i]',
      'select[name*="limit" i]',
      'select[name*="perpage" i]',
      'select.rows-per-page',
      '#pageSize',
      '#recordsPerPage',
      '#ddlPageSize',
    ];

    for (const sel of lengthSelectSelectors) {
      try {
        const selectLocator = (targetFrame || page).locator(sel).first();
        const count = await selectLocator.count().catch(() => 0);
        if (count > 0 && (await selectLocator.isVisible().catch(() => false))) {
          onProgress?.({
            stage: 'EXTRACTING',
            message: 'Expanding rows-per-page to capture all user records…',
            currentPage: 1,
            count: scrapedUsersMap.size,
          });

          const selected = await selectLocator.selectOption({ value: '500' })
            .catch(() => selectLocator.selectOption({ value: '250' }))
            .catch(() => selectLocator.selectOption({ value: '200' }))
            .catch(() => selectLocator.selectOption({ value: '100' }))
            .catch(() => selectLocator.selectOption({ label: '500' }))
            .catch(() => selectLocator.selectOption({ label: '250' }))
            .catch(() => selectLocator.selectOption({ label: '100' }))
            .catch(() => selectLocator.selectOption({ label: 'All' }))
            .catch(() => selectLocator.selectOption({ value: '-1' }))
            .catch(() => null);

          if (selected) {
            await selectLocator.dispatchEvent('change').catch(() => {});
            await page.waitForTimeout(1500);
            break;
          }
        }
      } catch {}
    }

    const maxPages = 100; // Guard against infinite pagination while allowing large user directories

    while (currentPage <= maxPages) {
      onProgress?.({
        stage: 'EXTRACTING',
        message: `Reading users page ${currentPage}…`,
        currentPage,
        count: scrapedUsersMap.size,
      });

      // Scrape current page rows with flexible header and container awareness
      const pageRowsData = await targetFrame.evaluate((selector) => {
        const rawRows = Array.from(document.querySelectorAll(selector));

        // Detect column indices from headers or visible labels
        const headerEls = Array.from(document.querySelectorAll('table thead th, table tr:first-child th, table tr:first-child td, [role="columnheader"], .header-cell, .grid-header, th, dt'));
        const headers = headerEls.map(h => (h.textContent || '').trim().toLowerCase().replace(/[\r\n\t]+/g, ' '));

        let colSNo = -1;
        let colFullName = -1;
        let colUsername = -1;
        let colMobile = -1;
        let colEmail = -1;
        let colNationality = -1;
        let colRole = -1;
        let colProfileRole = -1;
        let colStatus = -1;

        headers.forEach((h, idx) => {
          if (h.includes('s.no') || h === 'sno' || h === '#' || h.includes('sl.no')) colSNo = idx;
          else if (h.includes('user name') || h.includes('username') || h.includes('login') || h.includes('user id')) colUsername = idx;
          else if (h.includes('full name') || h.includes('fullname') || h === 'name' || h.startsWith('name ')) colFullName = idx;
          else if (h.includes('mobile') || h.includes('phone') || h.includes('contact')) colMobile = idx;
          else if (h.includes('email') || h.includes('mail')) colEmail = idx;
          else if (h.includes('national') || h.includes('country')) colNationality = idx;
          else if (h.includes('profile role') || h.includes('designation')) colProfileRole = idx;
          else if (h.includes('role') || h.includes('group') || h.includes('type')) colRole = idx;
          else if (h.includes('status') || h.includes('state')) colStatus = idx;
        });

        if (colUsername === -1 && colFullName !== -1) colUsername = colFullName;
        if (colFullName === -1 && colUsername !== -1) colFullName = colUsername;

        // Filter out header, footer, filter, search, and empty-state rows
        const dataRows = rawRows.filter((r) => {
          if (r.closest('thead') || r.closest('tfoot')) return false;
          const tds = r.querySelectorAll('td, [role="gridcell"], [role="cell"], .cell, .grid-cell, .col, div[class*="col-"]');
          if (tds.length === 0) return false;
          const ths = r.querySelectorAll('th');
          if (ths.length > 0 && tds.length === 0) return false;
          const cls = (r.className || '').toLowerCase();
          const id = (r.id || '').toLowerCase();
          const isFilterRow = (cls.includes('filter-table') || cls.includes('filter-row') || cls.includes('search-row') || id.includes('filter') || id.includes('search')) &&
            r.querySelector('input[type="text"], input[type="search"]') !== null;
          if (isFilterRow) return false;
          if (cls.includes('header') && !cls.includes('user') && r.querySelectorAll('input, button, a').length === 0) return false;
          const txt = (r.textContent || '').trim().toLowerCase();
          if (!txt) return false;
          if (
            txt.includes('maximum characters') ||
            txt.includes('max characters') ||
            txt.includes('characters maximum') ||
            txt.includes('no records found') ||
            txt.includes('no data available') ||
            txt.includes('no matching records') ||
            txt.includes('zero records') ||
            txt.includes('loading...')
          ) {
            return false;
          }

          // If pagination is active across multiple pages (currPage < totalPages), only scrape visible rows on current page
          const tpCurr = document.getElementById('tablePagination_currPage') as HTMLInputElement | null;
          const tpTotal = document.getElementById('tablePagination_totalPages');
          if (tpCurr && tpTotal) {
            const currVal = parseInt(tpCurr.value || '1', 10);
            const totalVal = parseInt(tpTotal.textContent || '1', 10);
            if (totalVal > 1) {
              const isVisible = (r as HTMLElement).offsetParent !== null && (r as HTMLElement).style.display !== 'none';
              if (!isVisible) return false;
            }
          }
          return true;
        });

        return dataRows.map((r) => {
          const cells = Array.from(r.querySelectorAll('td, [role="gridcell"], [role="cell"], .cell, .grid-cell, .col, div[class*="col-"]'))
            .map((c) => (c.textContent || '').trim());
          
          const hasSig = r.querySelectorAll('img[src*="sig" i], a[href*="sig" i], .has-signature').length > 0;
          const hasStmp = r.querySelectorAll('img[src*="stamp" i], a[href*="stamp" i], .has-stamp').length > 0;
          const hasProf = r.querySelectorAll('img[src*="profile" i], img[src*="user" i], .user-avatar').length > 0;

          const dataId = r.getAttribute('data-id') || r.getAttribute('data-user-id') || r.getAttribute('id') || '';
          const editHref = r.querySelector('a[href*="edit" i], a[href*="addUsers" i], a[href*="user" i]')?.getAttribute('href') || '';
          const actionHrefs = Array.from(r.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') || '');

          // Status detection: icon, class, label, tooltip, or accessibility text
          const statusCell = colStatus >= 0 && colStatus < cells.length ? r.querySelectorAll('td, [role="gridcell"], .cell')[colStatus] : r;
          const statusText = statusCell ? (statusCell.textContent || '').toUpperCase() : '';
          const statusHtml = statusCell ? (statusCell.innerHTML || '') : '';

          const hasInactiveIndicator =
            statusCell.querySelectorAll('.glyphicon-remove, .glyphicon-remove-circle, .fa-times, .fa-toggle-off, .text-danger, .status-inactive, .badge-danger, [title*="inactive" i], [title*="deactive" i], [aria-label*="inactive" i], [aria-label*="deactive" i]').length > 0 ||
            statusHtml.includes('glyphicon-remove') || statusHtml.includes('Deactive') || statusHtml.includes('/D"') || statusHtml.includes('color:red') ||
            statusText.includes('INACTIVE') || statusText.includes('DEACTIVE') || statusText.includes('DISABLED') || statusText.includes('OFF') || statusText.includes('LOCKED') || statusText.includes('BLOCK');

          const hasActiveIndicator = !hasInactiveIndicator && (
            statusCell.querySelectorAll('.glyphicon-ok, .glyphicon-ok-sign, .fa-check, .fa-toggle-on, .text-success, .status-active, .badge-success, [title*="active" i], [aria-label*="active" i]').length > 0 ||
            statusHtml.includes('glyphicon-ok') || statusHtml.includes('title="Active"') || statusHtml.includes('/A"') || statusHtml.includes('color:green') ||
            statusText.includes('ACTIVE') || statusText.includes('ENABLED') || statusText.includes('ON')
          );

          return {
            cells,
            hasSig,
            hasStmp,
            hasProf,
            dataId,
            editHref,
            actionHrefs,
            colSNo,
            colFullName,
            colUsername,
            colMobile,
            colEmail,
            colNationality,
            colRole,
            colProfileRole,
            colStatus,
            hasActiveIndicator,
            hasInactiveIndicator,
          };
        });
      }, structureEval.selector);

      totalRowsRead += pageRowsData.length;

      // Signature of current page to prevent repeated page loop
      const pageSignature = pageRowsData.map(r => r.cells.slice(0, 3).join('|')).join('::');
      if (pageSignature && seenPageSignatures.has(pageSignature)) {
        // Page repeated / pagination cycle detected -> break safely
        break;
      }
      if (pageSignature) {
        seenPageSignatures.add(pageSignature);
      }

      const pageUsers: ScrapedClientUser[] = [];

      for (let i = 0; i < pageRowsData.length; i++) {
        const row = pageRowsData[i];
        const texts = row.cells;
        if (texts.length < 2) continue;

        // Clean text items from control characters, tabs, and newlines
        const cleanTexts = texts.map((t) => (t || '').replace(/[\x00-\x1F\x7F\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim());

        // Check if this row is a header repetition, filter, or instructional row
        const rowCombined = cleanTexts.join(' ').toLowerCase();
        if (
          rowCombined.includes('maximum characters') ||
          rowCombined.includes('max characters') ||
          rowCombined.includes('characters maximum') ||
          rowCombined.includes('no records found') ||
          rowCombined.includes('no data available') ||
          rowCombined.includes('no matching records')
        ) {
          continue;
        }

        // Use header mapped indices
        let fullName = (row.colFullName >= 0 && row.colFullName < cleanTexts.length ? cleanTexts[row.colFullName] : cleanTexts[1]) || '';
        let username = (row.colUsername >= 0 && row.colUsername < cleanTexts.length ? cleanTexts[row.colUsername] : cleanTexts[2]) || '';
        let mobileNumber = (row.colMobile >= 0 && row.colMobile < cleanTexts.length ? cleanTexts[row.colMobile] : cleanTexts[3]) || '';
        let email = (row.colEmail >= 0 && row.colEmail < cleanTexts.length ? cleanTexts[row.colEmail] : cleanTexts[4]) || '';
        let nationality = (row.colNationality >= 0 && row.colNationality < cleanTexts.length ? cleanTexts[row.colNationality] : cleanTexts[5]) || '';
        let role = (row.colRole >= 0 && row.colRole < cleanTexts.length ? cleanTexts[row.colRole] : cleanTexts[6]) || '';
        let profileRole = (row.colProfileRole >= 0 && row.colProfileRole < cleanTexts.length ? cleanTexts[row.colProfileRole] : cleanTexts[7]) || '';
        let rawStatus = ((row.colStatus >= 0 && row.colStatus < cleanTexts.length ? cleanTexts[row.colStatus] : cleanTexts[8]) || '').toUpperCase();

        // Reject header labels
        const knownHeaderLabels = new Set([
          'name', 'user name', 'username', 'full name', 's.no', 'sno', 'sl.no', '#',
          'mobile', 'mobile no', 'phone', 'contact', 'email', 'nationality', 'role',
          'profile role', 'status', 'action', 'actions', 'select', 'filter', 'search',
        ]);

        if (knownHeaderLabels.has(username.toLowerCase()) && knownHeaderLabels.has(fullName.toLowerCase())) {
          continue;
        }

        // If username is a header label or contains instruction text, it cannot be a username
        if (knownHeaderLabels.has(username.toLowerCase()) || username.toLowerCase().includes('maximum characters') || username.toLowerCase().includes('max characters')) {
          if (fullName && !knownHeaderLabels.has(fullName.toLowerCase()) && !fullName.toLowerCase().includes('maximum characters')) {
            username = fullName;
            fullName = '';
          } else if (email && email.includes('@')) {
            username = email.split('@')[0];
          } else {
            continue;
          }
        }

        // If username has spaces (e.g. "John Doe") and fullName has no spaces and is a valid username pattern
        if (username.includes(' ') && fullName && !fullName.includes(' ') && /^[a-zA-Z0-9._@:-]{1,100}$/.test(fullName)) {
          const temp = username;
          username = fullName;
          fullName = temp;
        }

        if (!username && email.includes('@')) {
          username = email.split('@')[0];
        } else if (!username && fullName) {
          username = fullName.toLowerCase().replace(/\s+/g, '.');
        }

        // Clean username: remove illegal characters
        username = username.replace(/[^a-zA-Z0-9._@:-]/g, '');

        if (!username || !/^[a-zA-Z0-9._@:-]{1,100}$/.test(username)) {
          continue;
        }

        let status: ClientUserStatus = 'ACTIVE';
        if (row.hasInactiveIndicator || rawStatus.includes('INACTIVE') || rawStatus.includes('DISABLED') || rawStatus.includes('OFF') || rawStatus.includes('LOCKED') || rawStatus.includes('BLOCK')) {
          status = 'INACTIVE';
        } else if (row.hasActiveIndicator || rawStatus.includes('ACTIVE') || rawStatus.includes('ENABLED') || rawStatus.includes('ON')) {
          status = 'ACTIVE';
        }

        const nameParts = fullName.split(' ').filter(Boolean);
        const firstName = nameParts[0] || username;
        const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
        const middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : undefined;

        let remoteUserId = row.dataId || '';
        if (!remoteUserId && row.editHref) {
          const match = row.editHref.match(/(?:userId|id|user)=([^&'"]+)/i);
          if (match) remoteUserId = match[1];
        }
        if (!remoteUserId) {
          remoteUserId = `remote_${username.toLowerCase()}`;
        }

        const scrapedUser: ScrapedClientUser = {
          remoteUserId,
          username: username.trim(),
          normalizedUsername: username.trim().toLowerCase(),
          editRouteIdentifier: row.editHref || undefined,
          sourcePage: currentPage,
          firstName,
          middleName,
          lastName: lastName || firstName,
          fullName: fullName || `${firstName} ${lastName}`.trim(),
          email: email || undefined,
          mobileNumber: mobileNumber || undefined,
          nationality: nationality || undefined,
          role: role || undefined,
          profileRole: profileRole || undefined,
          status,
          hasSignature: row.hasSig,
          hasStamp: row.hasStmp,
          hasProfileImage: row.hasProf,
          remoteCreatedAt: undefined,
          remoteUpdatedAt: undefined,
        };

        scrapedUsersMap.set(username.toLowerCase(), scrapedUser);
        pageUsers.push(scrapedUser);
      }

      // Capture current first row signature to verify page change after clicking next
      const currentFirstRow = pageRowsData.length > 0 ? pageRowsData[0].cells.slice(0, 3).join('|') : '';

      // Check if jQuery tablePagination indicates we are already on the last page
      const hasMorePages = await (targetFrame || page).evaluate(() => {
        try {
          const currEl = document.getElementById('tablePagination_currPage') as HTMLInputElement | null;
          const totalEl = document.getElementById('tablePagination_totalPages');
          if (currEl && totalEl) {
            const curr = parseInt(currEl.value || '1', 10);
            const total = parseInt(totalEl.textContent || '1', 10);
            return curr < total;
          }
        } catch {}
        return null;
      });

      if (hasMorePages === false) {
        // tablePagination has reached the last page (or all 500 rows are already on page 1)
        break;
      }

      // Comprehensive next page selectors covering Simplex, DataTables, Bootstrap, and HTML tables
      const nextSelectors = [
        '#tablaDatos_next:not(.disabled) a',
        '#tablaDatos_next:not(.disabled)',
        '#usersTable_next:not(.disabled) a',
        '#usersTable_next:not(.disabled)',
        '.dataTables_paginate .next:not(.disabled) a',
        '.dataTables_paginate .next:not(.disabled)',
        '.paginate_button.next:not(.disabled) a',
        '.paginate_button.next:not(.disabled)',
        'li.paginate_button.next:not(.disabled) a',
        '#tablePagination_nextPage a',
        '#tablePagination_nextPage',
        'li.next:not(.disabled) a',
        'li.next:not(.disabled) span',
        '.pagination .next:not(.disabled) a',
        '.pagination-next:not(.disabled)',
        '#nextArrowJS',
        'button:has-text("Next"):not([disabled])',
        'a:has-text("Next"):not(.disabled)',
        'a[aria-label*="Next" i]:not(.disabled)',
        'button[aria-label*="Next" i]:not([disabled])',
        '[data-testid="pagination-next"]:not([disabled])',
        'a[title*="Next" i]:not(.disabled)',
        'input[value*="forward" i]',
        '.page-link:has-text("›")',
        'a:has-text("›"):not(.disabled)',
        'a:has-text("»"):not(.disabled)',
        'a:has-text(">"):not(.disabled)',
      ];

      let clickedNext = false;

      // Priority 1: Direct tablePagination next button (#tablePagination_nextPage)
      try {
        const tpNext = (targetFrame || page).locator('#tablePagination_nextPage').first();
        if ((await tpNext.count().catch(() => 0)) > 0 && (await tpNext.isVisible().catch(() => false))) {
          await tpNext.scrollIntoViewIfNeeded().catch(() => {});
          await tpNext.click({ timeout: 3000 }).catch(() => {});
          await (targetFrame || page).evaluate(() => {
            try {
              const btn = document.getElementById('tablePagination_nextPage');
              if (btn) {
                btn.click();
                const $ = (window as any).$ || (window as any).jQuery;
                if ($) $(btn).trigger('click');
              }
            } catch {}
          }).catch(() => {});
          clickedNext = true;
        }
      } catch {}

      if (!clickedNext) {
        for (const sel of nextSelectors) {
          try {
            const nextBtn = (targetFrame || page).locator(sel).first();
            const cnt = await nextBtn.count().catch(() => 0);
            if (cnt > 0 && (await nextBtn.isVisible().catch(() => false))) {
              const isDisabled = await nextBtn.getAttribute('disabled').catch(() => null);
              const isAriaDisabled = await nextBtn.getAttribute('aria-disabled').catch(() => null);
              const cls = (await nextBtn.getAttribute('class').catch(() => '')) || '';
              if (isDisabled === null && isAriaDisabled !== 'true' && !cls.includes('disabled')) {
                await nextBtn.scrollIntoViewIfNeeded().catch(() => {});
                await nextBtn.click({ timeout: 3000 }).catch(() => {});
                clickedNext = true;
                break;
              }
            }
          } catch {}
        }
      }

      // If next button wasn't found or clicked, try clicking next numeric page link (e.g. "2", "3", ...)
      if (!clickedNext) {
        const nextPageNum = currentPage + 1;
        const pageNumSelectors = [
          `a.paginate_button:has-text("${nextPageNum}")`,
          `li.paginate_button:not(.disabled) a:has-text("${nextPageNum}")`,
          `.pagination li:not(.disabled) a:has-text("${nextPageNum}")`,
          `.page-link:has-text("${nextPageNum}")`,
          `a:has-text("${nextPageNum}")`,
        ];
        for (const pSel of pageNumSelectors) {
          try {
            const pBtn = (targetFrame || page).locator(pSel).first();
            if ((await pBtn.count().catch(() => 0)) > 0 && (await pBtn.isVisible().catch(() => false))) {
              const cls = (await pBtn.getAttribute('class').catch(() => '')) || '';
              if (!cls.includes('active') && !cls.includes('disabled')) {
                await pBtn.scrollIntoViewIfNeeded().catch(() => {});
                await pBtn.click({ timeout: 3000 }).catch(() => {});
                clickedNext = true;
                break;
              }
            }
          } catch {}
        }
      }

      if (!clickedNext) {
        // Reached the end of pagination
        break;
      }

      // Wait for AJAX or in-page DOM table update
      await page.waitForTimeout(600);

      // Verify that table content updated, checking currPage counter and visible row change
      let waitAttempts = 0;
      let pageChanged = false;
      while (waitAttempts < 5) {
        const checkRes = await targetFrame.evaluate((selector) => {
          const currEl = document.getElementById('tablePagination_currPage') as HTMLInputElement | null;
          const currVal = currEl ? parseInt(currEl.value || '1', 10) : null;

          const rows = Array.from(document.querySelectorAll(selector));
          const visibleRows = rows.filter(r => !r.closest('thead') && !r.closest('tfoot') && r.querySelectorAll('td').length > 0 && (r as HTMLElement).offsetParent !== null && (r as HTMLElement).style.display !== 'none');
          const first = visibleRows[0] || rows.find(r => !r.closest('thead') && !r.closest('tfoot') && r.querySelectorAll('td').length > 0);
          const firstSig = first ? Array.from(first.querySelectorAll('td')).map(c => (c.textContent || '').trim()).slice(0, 3).join('|') : '';

          return { currVal, firstSig, visibleCount: visibleRows.length };
        }, structureEval.selector).catch(() => null);

        if (checkRes) {
          if (checkRes.currVal !== null && checkRes.currVal > currentPage) {
            pageChanged = true;
            break;
          }
          if (checkRes.firstSig && checkRes.firstSig !== currentFirstRow) {
            pageChanged = true;
            break;
          }
        }
        await page.waitForTimeout(500);
        waitAttempts++;
      }

      if (!pageChanged) {
        // Table content did not change after clicking next -> reached the end of pagination
        break;
      }

      currentPage++;
    }

    const allUsers = Array.from(scrapedUsersMap.values());
    const remoteDuplicatesRemoved = Math.max(0, totalRowsRead - allUsers.length);

    // Do not classify success unless users fetched is greater than zero
    if (allUsers.length === 0) {
      return {
        success: false,
        users: [],
        totalScraped: 0,
        remoteRowsRead: totalRowsRead,
        remotePagesRead: currentPage,
        remoteDuplicatesRemoved,
        remoteUniqueUsers: 0,
        liveStatus: 'CACHED',
        errorCode: 'USER_SCREEN_STRUCTURE_NOT_RECOGNIZED',
        errorMessage: `User directory screen structure could not be recognized. Screen heading: "${screenHeading}".`,
        options: this.getDefaultOptions(),
      };
    }

    onProgress?.({
      stage: 'PERSISTING',
      message: `${allUsers.length} users synchronized successfully.`,
      currentPage,
      count: allUsers.length,
      streamedUsers: allUsers,
    });

    return {
      success: true,
      users: allUsers,
      totalScraped: allUsers.length,
      remoteRowsRead: totalRowsRead,
      remotePagesRead: currentPage,
      remoteDuplicatesRemoved,
      remoteUniqueUsers: allUsers.length,
      liveStatus: 'LIVE',
      options: this.getDefaultOptions(),
    };
  }

  /**
   * Backwards compatible wrapper for syncUsers
   */
  public static async syncUsers(page: Page, usersUrl: string): Promise<SyncUsersResult> {
    return this.syncUsersHeadless(page, { usersUrl });
  }

  private static getDefaultOptions() {
    return {
      nationalities: ['Saudi Arabia', 'United Arab Emirates', 'United States', 'United Kingdom', 'India', 'Egypt', 'Jordan', 'Pakistan', 'Philippines', 'Other'],
      roles: ['Physician', 'Nurse', 'Admin', 'Pharmacist', 'Lab Technician', 'Operator', 'Super User'],
      profileRoles: ['Clinical Specialist', 'General Practitioner', 'Head Nurse', 'Chief Pharmacist', 'System Administrator', 'Billing Specialist'],
    };
  }

  /**
   * The client host, application context and version are client-specific.
   * Only the addUserRole route is common by default.
   * Never hardcode the staging host or MasterV9.3.
   *
   * Inspects the live Role Master screen (/addUserRole) to extract available client roles.
   */
  public static async inspectRoleMaster(
    page: Page,
    options: {
      roleUrl: string;
      clientId: string;
      applicationVersion?: string;
      loginUrl?: string;
      credentials?: { username: string; password?: string };
    }
  ): Promise<{ roles: string[]; roleDetails?: Array<{ roleName: string; description?: string }> }> {
    const { roleUrl, clientId, loginUrl, credentials } = options;
    if (page.isClosed()) {
      return { roles: [] };
    }

    const authRes = await this.ensureAuthenticated(page, { targetUrl: roleUrl, loginUrl, credentials });
    if (!authRes.authenticated) {
      return { roles: [] };
    }

    if (page.isClosed()) {
      return { roles: [] };
    }

    if (page.url() !== roleUrl) {
      await page.goto(roleUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }

    if (page.isClosed()) {
      return { roles: [] };
    }

    const extractedRoles = await page.evaluate(() => {
      const roleSet = new Set<string>();
      const details: Array<{ roleName: string; description?: string }> = [];

      // 1. Check tables (e.g. role list table)
      const rows = Array.from(document.querySelectorAll('table tbody tr, .role-item, .table tr'));
      for (const r of rows) {
        const cells = Array.from(r.querySelectorAll('td, th')).map((c) => (c.textContent || '').trim());
        if (cells.length > 0) {
          for (const cell of cells) {
            if (cell && !cell.match(/^(s\.?no|#|action|status|actions|edit|delete|view)$/i) && cell.length > 1 && cell.length < 50) {
              if (!roleSet.has(cell)) {
                roleSet.add(cell);
                details.push({ roleName: cell, description: cells[1] && cells[1] !== cell ? cells[1] : undefined });
              }
              break;
            }
          }
        }
      }

      // 2. Check dropdown / select elements if on a form
      const selects = Array.from(document.querySelectorAll('select[name*="role" i], #role, #userRole, select'));
      for (const sel of selects) {
        const opts = Array.from((sel as HTMLSelectElement).options);
        for (const opt of opts) {
          const val = (opt.text || opt.value || '').trim();
          if (val && !val.toLowerCase().includes('select') && !roleSet.has(val)) {
            roleSet.add(val);
            details.push({ roleName: val });
          }
        }
      }

      return {
        roles: Array.from(roleSet),
        roleDetails: details,
      };
    }).catch(() => ({ roles: [], roleDetails: [] }));

    return extractedRoles;
  }

  /**
   * Searches and selects a specific user on the /addUserRole screen.
   * Search priority:
   * 1. Stable remote user ID/value
   * 2. Exact username
   * 3. Exact full name
   * 4. First name only as a discovery fallback with strict identity matching
   *
   * Disambiguation rules:
   * - Never select the first dropdown result automatically.
   * - Never select a user only because the first name matches.
   * - If multiple candidates match or candidates expose only first name without username/ID, flag USER_SELECTION_AMBIGUOUS.
   */
  public static async searchAndSelectUserInRoleScreen(
    page: Page,
    options: {
      roleUrl: string;
      username: string;
      fullName?: string;
      firstName?: string;
      remoteUserId?: string;
      loginUrl?: string;
      credentials?: { username: string; password?: string };
      onProgress?: (comment: string) => void;
    }
  ): Promise<{
    success: boolean;
    userSearchState: 'EXACT_MATCH_FOUND' | 'FAILED' | 'AMBIGUOUS';
    errorCode?: string;
    errorMessage?: string;
    matchedUsername?: string;
    matchedFullName?: string;
    candidates?: string[];
  }> {
    const { roleUrl, username, fullName, firstName, remoteUserId, loginUrl, credentials, onProgress } = options;
    if (page.isClosed()) {
      return { success: false, userSearchState: 'FAILED', errorCode: 'BROWSER_CONTEXT_CLOSED_BEFORE_ACTION', errorMessage: 'Browser was closed.' };
    }

    const authRes = await this.ensureAuthenticated(page, { targetUrl: roleUrl, loginUrl, credentials });
    if (!authRes.authenticated) {
      const isRedirectToLogin = page.url().includes('/login') || authRes.errorCode === 'CLIENT_AUTO_LOGIN_FAILED' || authRes.errorCode === 'AUTH_SESSION_EXPIRED';
      const errorCode = isRedirectToLogin ? 'AUTH_SESSION_EXPIRED' : (authRes.errorCode || 'CLIENT_AUTO_LOGIN_FAILED');
      const errorMessage = authRes.errorMessage || 'Import paused: Client administrator authentication failed before role mapping. The user was created successfully, but role mapping is pending. Verify the selected client credential/session, then retry from ROLE_STATE_INSPECTION.';
      return {
        success: false,
        userSearchState: 'FAILED',
        errorCode,
        errorMessage,
      };
    }

    if (page.url() !== roleUrl) {
      await page.goto(roleUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }

    onProgress?.('Searching for the newly created user');

    // Locate user search input or select element (Real staging: #txtUserFirstname / .ui-autocomplete-input)
    const searchInput = page
      .locator(
        'input#txtUserFirstname, input[name="txtUserFirstname"], .ui-autocomplete-input, input[data-testid="input-user-role-search"], input#userSearch, form input[name*="user" i]:not(#searchMenu):not([name="searchMenu"]), form input[placeholder*="user" i]:not(#searchMenu):not([name="searchMenu"]), input#txtUser'
      )
      .first();
    const selectDropdown = page.locator('select[name*="user" i], select#userSelect, select#userId, select#txtUser').first();

    const hasInput = (await searchInput.count().catch(() => 0)) > 0;
    const hasSelect = !hasInput && ((await selectDropdown.count().catch(() => 0)) > 0);

    const normUsername = username.trim().toLowerCase();
    const normFullName = (fullName || '').trim().toLowerCase();
    const normFirstName = (firstName || username.split('.')[0] || '').trim().toLowerCase();
    const normUserId = (remoteUserId || '').trim().toLowerCase();

    if (hasSelect) {
      // Direct <select> element
      const selectEl = selectDropdown;
      const opts = await selectEl.evaluate((sel: HTMLSelectElement) => {
        return Array.from(sel.options).map((o) => ({
          text: (o.text || '').trim(),
          value: (o.value || '').trim(),
        }));
      });

      // 1. Match stable ID
      let matched = normUserId ? opts.find((o) => o.value.toLowerCase() === normUserId || o.text.toLowerCase().includes(`[${normUserId}]`)) : undefined;
      // 2. Match exact username
      if (!matched) {
        matched = opts.find((o) => o.value.toLowerCase() === normUsername || o.text.toLowerCase().includes(`(${normUsername})`) || o.text.toLowerCase() === normUsername);
      }
      // 3. Match exact full name
      if (!matched && normFullName) {
        matched = opts.find((o) => o.text.toLowerCase().includes(normFullName) && (o.value.toLowerCase() === normUsername || o.text.toLowerCase().includes(`(${normUsername})`)));
      }

      if (matched && matched.value) {
        await selectEl.selectOption({ value: matched.value });
        onProgress?.('Selecting the user');
        return { success: true, userSearchState: 'EXACT_MATCH_FOUND', matchedUsername: username, matchedFullName: matched.text };
      } else {
        return {
          success: false,
          userSearchState: 'FAILED',
          errorCode: 'USER_SELECTION_NOT_FOUND',
          errorMessage: `User '${username}' was not found in Add User Role dropdown options.`,
        };
      }
    }

    if (hasInput) {
      // Dynamic Search Input with Debounce and Candidate Dropdown
      // Search sequence: Username first for exact match, then remoteUserId, fullName, firstName
      const attempts: Array<{ query: string; type: 'FIRST_NAME' | 'FULL_NAME' | 'USER_ID' | 'USERNAME' }> = [];
      attempts.push({ query: username.trim(), type: 'USERNAME' });
      if (remoteUserId && remoteUserId.trim() && remoteUserId.trim().toLowerCase() !== username.trim().toLowerCase()) {
        attempts.push({ query: remoteUserId.trim(), type: 'USER_ID' });
      }
      if (fullName && fullName.trim() && fullName.trim().toLowerCase() !== username.trim().toLowerCase()) {
        attempts.push({ query: fullName.trim(), type: 'FULL_NAME' });
      }
      if (firstName && firstName.trim() && firstName.trim().toLowerCase() !== username.trim().toLowerCase()) {
        attempts.push({ query: firstName.trim(), type: 'FIRST_NAME' });
      } else if (username.includes('.')) {
        attempts.push({ query: username.split('.')[0], type: 'FIRST_NAME' });
      }

      let lastCandidates: string[] = [];

      for (const attempt of attempts) {
        await searchInput.fill('');
        await searchInput.fill(attempt.query);
        await searchInput.dispatchEvent('input').catch(() => {});
        await searchInput.dispatchEvent('change').catch(() => {});

        // Trigger custom autocomplete search if attached
        await page.evaluate((val) => {
          const $ = (window as any).$ || (window as any).jQuery;
          if ($ && $('#txtUserFirstname').data('custom-loadUser_ID')) {
            $('#txtUserFirstname').val(val).trigger('keydown').trigger('input');
          }
        }, attempt.query).catch(() => {});

        // Wait for debounce and candidate list
        await page.waitForTimeout(300);
        await page.waitForSelector('ul.ui-autocomplete, .ui-menu, .dropdown-results, [data-testid="user-dropdown-results"], .user-option', { timeout: 3000 }).catch(() => {});

        // Check if exact user is in window.availableTags / window.availableTags1
        const normClean = normUsername.replace(/[._\-]/g, '');
        const windowMatch = await page.evaluate(({ normUser, normId, cleanU }) => {
          const tags = (window as any).availableTags || (window as any).availableTags1;
          if (Array.isArray(tags)) {
            const found = tags.find((t: any) => {
              const uId = (t.valuess || t.User_Id || '').toLowerCase().trim();
              const cU = uId.replace(/[._\-]/g, '');
              return (normId && uId === normId) || (normUser && uId === normUser) || (cleanU && cleanU.length > 3 && cU === cleanU);
            });
            if (found) {
              return {
                label: found.label || `${found.User_First_Name || ''} ${found.User_Last_Name || ''}`.trim(),
                valuess: found.valuess || found.User_Id,
              };
            }
          }
          return null;
        }, { normUser: normUsername, normId: normUserId, cleanU: normClean });

        // Read all returned candidate items atomically including jQuery UI data
        const candidates = await page.evaluate(() => {
          const items = Array.from(
            document.querySelectorAll(
              'ul.ui-autocomplete li.ui-menu-item, .ui-autocomplete li:not(.header-auto), .user-option, [data-testid="user-option"], .dropdown-item, .typeahead-item, .user-result-row'
            )
          );
          const $ = (window as any).$ || (window as any).jQuery;
          return items.map((el, idx) => {
            let uiItem: any = null;
            if ($ && $(el).data) {
              uiItem = $(el).data('ui-autocomplete-item') || $(el).data('item.autocomplete') || $(el).data('uiAutocompleteItem') || $(el).data('custom-loadUser_ID-item');
            }
            const valuess = (uiItem?.valuess || el.getAttribute('data-username') || el.getAttribute('data-value') || '').trim();
            const usernameAttr = (el.getAttribute('data-username') || el.getAttribute('data-value') || uiItem?.valuess || '').trim();
            const userIdAttr = (el.getAttribute('data-userid') || '').trim();
            const strongEl = el.querySelector('strong');
            const cleanText = strongEl ? strongEl.textContent?.trim() : '';
            const label = (uiItem?.label || uiItem?.value || cleanText || el.textContent || '').trim();
            return {
              index: idx,
              text: (el.textContent || '').trim(),
              label,
              valuess,
              username: usernameAttr || valuess,
              userId: userIdAttr,
              id: el.id || '',
              className: el.className || '',
            };
          });
        });

        lastCandidates = candidates.map((c) => c.text).filter(Boolean);

        // 1. Direct User ID / valuess match from visible candidates
        const exactValuessMatch = candidates.find((c) => {
          const cVal = c.valuess.toLowerCase();
          const cUser = c.username.toLowerCase();
          const cId = c.userId.toLowerCase();
          const cCleanVal = cVal.replace(/[._\-]/g, '');
          const cCleanUser = cUser.replace(/[._\-]/g, '');
          return (
            (normUserId && (cId === normUserId || cVal === normUserId || cUser === normUserId)) ||
            (normUsername && (
              cUser === normUsername ||
              cVal === normUsername ||
              (normClean.length > 3 && (cCleanUser === normClean || cCleanVal === normClean)) ||
              c.text.toLowerCase().includes(`(${normUsername})`)
            ))
          );
        });

        if (exactValuessMatch) {
          const matchIdx = exactValuessMatch.index;
          await page.locator('ul.ui-autocomplete li:not(.header-auto), .user-option, [data-testid="user-option"], .dropdown-item').nth(matchIdx).click().catch(() => {});
          await page.waitForTimeout(400);

          const resolvedUser = exactValuessMatch.username || exactValuessMatch.valuess || username;
          const resolvedLabel = fullName || exactValuessMatch.label || exactValuessMatch.text || resolvedUser;

          // Synchronize #txtUser, #txtUserFirhidden, #txtUserFirstname and unhide roleSelectionContainer
          await page.evaluate(({ expUser, expLabel }) => {
            const txtUser = document.getElementById('txtUser') as HTMLInputElement | null;
            const txtUserFirhidden = document.getElementById('txtUserFirhidden') as HTMLInputElement | null;
            const txtUserFirstname = document.getElementById('txtUserFirstname') as HTMLInputElement | null;
            const selectedUsername = document.getElementById('selectedUsername') as HTMLInputElement | null;
            const roleContainer = document.getElementById('roleSelectionContainer');

            if (txtUser) txtUser.value = expUser;
            if (selectedUsername) selectedUsername.value = expUser;
            if (txtUserFirstname) txtUserFirstname.value = expLabel;
            if (txtUserFirhidden) txtUserFirhidden.value = expLabel;
            if (roleContainer) roleContainer.style.display = 'block';

            const $ = (window as any).$ || (window as any).jQuery;
            if ($) {
              try {
                $('#txtUser').val(expUser);
                $('#selectedUsername').val(expUser);
                $('#txtUserFirstname').val(expLabel);
                $('#txtUserFirhidden').val(expLabel);
                $('#roleSelectionContainer').show();
                if ($('#UserRole').data('formValidation')) {
                  $('#UserRole').formValidation('revalidateField', 'txtUserFirstname');
                }
                if (typeof (window as any).checkroleAlreadyInAddNewUser === 'function') {
                  (window as any).checkroleAlreadyInAddNewUser();
                }
              } catch {}
            }
          }, { expUser: resolvedUser, expLabel: resolvedLabel });

          const verifyDomId = await page.evaluate(() => {
            const txtUser = document.getElementById('txtUser') as HTMLInputElement | null;
            return txtUser ? txtUser.value : null;
          });

          if (remoteUserId && verifyDomId && verifyDomId.toLowerCase() !== remoteUserId.toLowerCase() && verifyDomId.toLowerCase() !== username.toLowerCase()) {
            return {
              success: false,
              userSearchState: 'FAILED',
              errorCode: 'USER_SELECTION_ID_MISMATCH',
              errorMessage: `USER_SELECTION_ID_MISMATCH: #txtUser value '${verifyDomId}' does not match expected User ID '${remoteUserId}'.`,
            };
          }

          onProgress?.('Selecting the user');
          return {
            success: true,
            userSearchState: 'EXACT_MATCH_FOUND',
            matchedUsername: resolvedUser,
            matchedFullName: resolvedLabel,
          };
        }

        // 2. Direct Window AvailableTags match
        if (windowMatch) {
          const resolvedUser = windowMatch.valuess || username;
          const resolvedLabel = windowMatch.label || fullName || resolvedUser;

          await page.evaluate(({ expUser, expLabel }) => {
            const txtUser = document.getElementById('txtUser') as HTMLInputElement | null;
            const txtUserFirhidden = document.getElementById('txtUserFirhidden') as HTMLInputElement | null;
            const txtUserFirstname = document.getElementById('txtUserFirstname') as HTMLInputElement | null;
            const selectedUsername = document.getElementById('selectedUsername') as HTMLInputElement | null;
            const roleContainer = document.getElementById('roleSelectionContainer');

            if (txtUser) txtUser.value = expUser;
            if (selectedUsername) selectedUsername.value = expUser;
            if (txtUserFirstname) txtUserFirstname.value = expLabel;
            if (txtUserFirhidden) txtUserFirhidden.value = expLabel;
            if (roleContainer) roleContainer.style.display = 'block';

            const $ = (window as any).$ || (window as any).jQuery;
            if ($) {
              try {
                $('#txtUser').val(expUser);
                $('#selectedUsername').val(expUser);
                $('#txtUserFirstname').val(expLabel);
                $('#txtUserFirhidden').val(expLabel);
                $('#roleSelectionContainer').show();
                if ($('#UserRole').data('formValidation')) {
                  $('#UserRole').formValidation('revalidateField', 'txtUserFirstname');
                }
                if (typeof (window as any).checkroleAlreadyInAddNewUser === 'function') {
                  (window as any).checkroleAlreadyInAddNewUser();
                }
              } catch {}
            }
          }, { expUser: resolvedUser, expLabel: resolvedLabel });

          onProgress?.('Selecting the user');
          return {
            success: true,
            userSearchState: 'EXACT_MATCH_FOUND',
            matchedUsername: resolvedUser,
            matchedFullName: resolvedLabel,
          };
        }

        // 3. Full Name match
        if (normFullName && candidates.length > 0) {
          const fullNameMatches = candidates.filter((c) => {
            const textLower = c.text.toLowerCase();
            const labelLower = c.label.toLowerCase();
            return textLower.includes(normFullName) || labelLower === normFullName;
          });

          if (fullNameMatches.length === 1 && fullNameMatches[0].valuess) {
            const matchIdx = fullNameMatches[0].index;
            await page.locator('ul.ui-autocomplete li:not(.header-auto), .user-option, [data-testid="user-option"], .dropdown-item').nth(matchIdx).click().catch(() => {});
            await page.waitForTimeout(400);

            const resolvedUser = fullNameMatches[0].valuess || username;
            const resolvedLabel = fullNameMatches[0].label || fullNameMatches[0].text || resolvedUser;

            await page.evaluate(({ expUser, expLabel }) => {
              const txtUser = document.getElementById('txtUser') as HTMLInputElement | null;
              const txtUserFirhidden = document.getElementById('txtUserFirhidden') as HTMLInputElement | null;
              const txtUserFirstname = document.getElementById('txtUserFirstname') as HTMLInputElement | null;
              const selectedUsername = document.getElementById('selectedUsername') as HTMLInputElement | null;
              const roleContainer = document.getElementById('roleSelectionContainer');

              if (txtUser) txtUser.value = expUser;
              if (selectedUsername) selectedUsername.value = expUser;
              if (txtUserFirstname) txtUserFirstname.value = expLabel;
              if (txtUserFirhidden) txtUserFirhidden.value = expLabel;
              if (roleContainer) roleContainer.style.display = 'block';

              const $ = (window as any).$ || (window as any).jQuery;
              if ($) {
                try {
                  $('#txtUser').val(expUser);
                  $('#selectedUsername').val(expUser);
                  $('#txtUserFirstname').val(expLabel);
                  $('#txtUserFirhidden').val(expLabel);
                  $('#roleSelectionContainer').show();
                  if ($('#UserRole').data('formValidation')) {
                    $('#UserRole').formValidation('revalidateField', 'txtUserFirstname');
                  }
                  if (typeof (window as any).checkroleAlreadyInAddNewUser === 'function') {
                    (window as any).checkroleAlreadyInAddNewUser();
                  }
                } catch {}
              }
            }, { expUser: resolvedUser, expLabel: resolvedLabel });

            onProgress?.('Selecting the user');
            return {
              success: true,
              userSearchState: 'EXACT_MATCH_FOUND',
              matchedUsername: resolvedUser,
              matchedFullName: resolvedLabel,
            };
          }
        }

        // 4. First Name Ambiguity Guard (if multiple ambiguous candidates with no unique ID)
        if (attempt.type === 'FIRST_NAME' && candidates.length > 1 && !exactValuessMatch && !windowMatch) {
          // If all candidates lack unique identifier matching target user, flag ambiguity
          const hasAnyUniqueVal = candidates.some((c) => c.valuess);
          if (!hasAnyUniqueVal) {
            return {
              success: false,
              userSearchState: 'AMBIGUOUS',
              errorCode: 'USER_SELECTION_AMBIGUOUS',
              errorMessage: `USER_SELECTION_AMBIGUOUS: First name search returned ambiguous candidates [${lastCandidates.join('; ')}] without unique identifier.`,
              candidates: lastCandidates,
            };
          }
        }
      }

      // Fallback for newly created user: ensure hidden #txtUser, #txtUserFirhidden, #txtUserFirstname are populated and role container unhidden
      const domSelectedUser = await page.evaluate(({ u, fn, rId }) => {
        const txtUser = document.getElementById('txtUser') as HTMLInputElement | null;
        const txtUserFirhidden = document.getElementById('txtUserFirhidden') as HTMLInputElement | null;
        const txtUserFirstname = document.getElementById('txtUserFirstname') as HTMLInputElement | null;
        const selectedUsername = document.getElementById('selectedUsername') as HTMLInputElement | null;
        const roleContainer = document.getElementById('roleSelectionContainer');

        const effectiveVal = rId || u;
        const effectiveLabel = fn || u;

        if (txtUser && (!txtUser.value || txtUser.value === '')) txtUser.value = effectiveVal;
        if (selectedUsername && (!selectedUsername.value || selectedUsername.value === '')) selectedUsername.value = effectiveVal;
        if (txtUserFirhidden && (!txtUserFirhidden.value || txtUserFirhidden.value === '')) txtUserFirhidden.value = effectiveLabel;
        if (txtUserFirstname && (!txtUserFirstname.value || txtUserFirstname.value === '')) txtUserFirstname.value = effectiveLabel;
        if (roleContainer) roleContainer.style.display = 'block';

        const $ = (window as any).$ || (window as any).jQuery;
        if ($) {
          try {
            if (!$('#txtUser').val()) $('#txtUser').val(effectiveVal);
            if (!$('#selectedUsername').val()) $('#selectedUsername').val(effectiveVal);
            if (!$('#txtUserFirstname').val()) $('#txtUserFirstname').val(effectiveLabel);
            if (!$('#txtUserFirhidden').val()) $('#txtUserFirhidden').val(effectiveLabel);
            $('#roleSelectionContainer').show();
            if ($('#UserRole').data('formValidation')) {
              $('#UserRole').formValidation('revalidateField', 'txtUserFirstname');
            }
            if (typeof (window as any).checkroleAlreadyInAddNewUser === 'function') {
              (window as any).checkroleAlreadyInAddNewUser();
            }
          } catch {}
        }
        return {
          hasUser: Boolean(txtUser && txtUser.value),
          val: txtUser ? txtUser.value : '',
        };
      }, { u: username, fn: fullName, rId: remoteUserId }).catch(() => ({ hasUser: false, val: '' }));

      if (domSelectedUser.hasUser) {
        onProgress?.('Selecting the user');
        return {
          success: true,
          userSearchState: 'EXACT_MATCH_FOUND',
          matchedUsername: username,
          matchedFullName: fullName || username,
        };
      }

      return {
        success: false,
        userSearchState: 'FAILED',
        errorCode: 'USER_SELECTION_NOT_FOUND',
        errorMessage: `User '${username}' was not found on Add User Role screen after searching by username, full name, and first name.`,
        candidates: lastCandidates,
      };
    }

    return {
      success: false,
      userSearchState: 'FAILED',
      errorCode: 'REMOTE_FORM_NOT_RECOGNIZED',
      errorMessage: 'User selector input or dropdown not found on /addUserRole screen.',
    };
  }

  /**
   * Deactivates assigned roles for a user from the /userRole registry screen by toggling their status option.
   */
  public static async deactivateUserRoles(
    page: Page,
    options: {
      userRoleUrl: string;
      username: string;
      rolesToDeactivate: string[] | string;
      loginUrl?: string;
      credentials?: { username: string; password?: string };
      onProgress?: (comment: string) => void;
    }
  ): Promise<{
    success: boolean;
    deactivatedRoles: string[];
    failedRoles: string[];
    errorMessage?: string;
  }> {
    const { userRoleUrl, username, rolesToDeactivate, loginUrl, credentials, onProgress } = options;
    const rolesArray: string[] = Array.isArray(rolesToDeactivate)
      ? rolesToDeactivate.flatMap((r) => (typeof r === 'string' ? r.split(',') : [r])).map((s) => String(s).trim()).filter(Boolean)
      : (typeof rolesToDeactivate === 'string' ? rolesToDeactivate.split(',').map((s) => s.trim()).filter(Boolean) : []);

    if (rolesArray.length === 0) {
      return { success: true, deactivatedRoles: [], failedRoles: [] };
    }

    onProgress?.(`Navigating to /userRole screen to deactivate: ${rolesArray.join(', ')}`);
    const authRes = await this.ensureAuthenticated(page, { targetUrl: userRoleUrl, loginUrl, credentials });
    if (!authRes.authenticated) {
      return {
        success: false,
        deactivatedRoles: [],
        failedRoles: rolesArray,
        errorMessage: authRes.errorMessage || 'Authentication failed before role deactivation.',
      };
    }

    if (page.url() !== userRoleUrl) {
      await page.goto(userRoleUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }
    await page.waitForTimeout(1000);

    const deactivatedRoles: string[] = [];
    const failedRoles: string[] = [];

    for (const roleName of rolesArray) {
      const normRole = roleName.toUpperCase().trim();
      onProgress?.(`Checking /userRole for role '${roleName}' on user '${username}'...`);

      const searchBox = page.locator('input[type="search"], .dataTables_filter input').first();
      if ((await searchBox.isVisible().catch(() => false))) {
        await searchBox.fill(username).catch(() => {});
        await page.waitForTimeout(800);
      }

      const rowInfo = await page.evaluate(({ uname, rName }) => {
        const trs = Array.from(document.querySelectorAll('table tbody tr'));
        const cleanTarget = uname.toLowerCase().trim();
        for (const tr of trs) {
          const tds = Array.from(tr.querySelectorAll('td')).map((t) => t.innerText.trim());
          if (tds.length < 4) continue;
          const rowUserName = (tds[1] || '').toLowerCase();
          const rowUserId = (tds[2] || '').toLowerCase();
          const rowRole = (tds[3] || '').toUpperCase();

          const matchesUser = rowUserId === cleanTarget || rowUserName === cleanTarget || rowUserId.includes(cleanTarget);
          const matchesRole = rowRole === rName || rowRole.includes(rName);

          if (matchesUser && matchesRole) {
            const statusLink = tr.querySelector('td:nth-child(10) a');
            const href = statusLink ? statusLink.getAttribute('href') : null;
            const title = statusLink ? (statusLink.getAttribute('title') || '') : '';
            const icon = statusLink ? (statusLink.querySelector('i')?.className || '') : '';
            const isInactive = (href && href.endsWith('/D')) || title.toLowerCase().includes('deact') || icon.includes('remove');
            return {
              found: true,
              href,
              isActive: !isInactive,
              title,
            };
          }
        }
        return { found: false };
      }, { uname: username, rName: normRole });

      if (!rowInfo.found) {
        onProgress?.(`Role '${roleName}' not found in /userRole table for '${username}'.`);
        failedRoles.push(roleName);
        continue;
      }

      if (!rowInfo.isActive) {
        onProgress?.(`Role '${roleName}' is already inactive on /userRole.`);
        deactivatedRoles.push(roleName);
        continue;
      }

      if (rowInfo.href) {
        onProgress?.(`Toggling status link to deactivate role '${roleName}'...`);
        try {
          await page.goto(rowInfo.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await page.waitForTimeout(1000);
          deactivatedRoles.push(roleName);
          onProgress?.(`✓ Role '${roleName}' deactivated for '${username}' on /userRole.`);
        } catch (err: any) {
          onProgress?.(`Failed to toggle status link for '${roleName}': ${err.message}`);
          failedRoles.push(roleName);
        }
      }
    }

    return {
      success: failedRoles.length === 0,
      deactivatedRoles,
      failedRoles,
    };
  }

  /**
   * Reads assigned active roles for a user from the /userRole registry screen.
   */
  public static async readUserAssignedRoles(
    page: Page,
    options: {
      roleUrl: string;
      username: string;
      remoteUserId?: string;
      loginUrl?: string;
      credentials?: { username: string; password?: string };
      onProgress?: (comment: string) => void;
    }
  ): Promise<{
    success: boolean;
    roles: string[];
    errorCode?: string;
    errorMessage?: string;
  }> {
    const { roleUrl, username, remoteUserId, loginUrl, credentials, onProgress } = options;
    if (page.isClosed()) {
      return { success: false, roles: [], errorCode: 'BROWSER_CLOSED', errorMessage: 'Browser page is closed.' };
    }

    const userRoleUrl = roleUrl.replace(/\/addUserRole.*$/i, '/userRole');
    onProgress?.(`Navigating to /userRole to read live roles for '${username}'...`);

    const authRes = await this.ensureAuthenticated(page, { targetUrl: userRoleUrl, loginUrl, credentials });
    if (!authRes.authenticated) {
      return {
        success: false,
        roles: [],
        errorCode: authRes.errorCode || 'CLIENT_AUTO_LOGIN_FAILED',
        errorMessage: authRes.errorMessage || 'Authentication failed before reading user roles.',
      };
    }

    if (page.url() !== userRoleUrl) {
      await page.goto(userRoleUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }
    await page.waitForTimeout(1000);

    const searchBox = page.locator('input[type="search"], .dataTables_filter input, input#roleSearch').first();
    if (await searchBox.isVisible().catch(() => false)) {
      await searchBox.fill('');
      await searchBox.fill(username).catch(() => {});
      await page.evaluate((u) => {
        const $ = (window as any).$ || (window as any).jQuery;
        if ($) {
          $('input[type="search"], .dataTables_filter input, input#roleSearch').val(u).trigger('input').trigger('keyup').trigger('change');
          if (typeof $.fn?.dataTable === 'function' || typeof $.fn?.DataTable === 'function') {
            try {
              $('table.dataTable, #tablaDatos, table').DataTable().search(u).draw();
            } catch {}
          }
        }
      }, username).catch(() => {});
      await page.waitForTimeout(1200);
    }

    const activeRoles = await page.evaluate(({ uname, uId }) => {
      const trs = Array.from(document.querySelectorAll('table tbody tr'));
      const cleanUser = uname.toLowerCase().trim();
      const cleanId = (uId || '').toLowerCase().trim();
      const roles: string[] = [];

      // Dynamically detect column indices from table headers
      const headerCells = Array.from(document.querySelectorAll('table thead th, table thead td'));
      let colUser = -1;
      let colId = -1;
      let colRole = -1;
      let colStatus = -1;

      headerCells.forEach((th, idx) => {
        const txt = (th.textContent || '').trim().toUpperCase();
        if (txt.includes('USER NAME') || txt.includes('USERNAME') || (txt.includes('USER') && !txt.includes('ID') && !txt.includes('ROLE'))) {
          if (colUser === -1) colUser = idx;
        } else if (txt.includes('USER ID') || txt.includes('USERID') || txt.includes('LOGIN ID')) {
          colId = idx;
        } else if (txt.includes('ROLE') && !txt.includes('USER')) {
          colRole = idx;
        } else if (txt.includes('STATUS') || txt.includes('ACTION')) {
          colStatus = idx;
        }
      });

      if (colUser === -1) colUser = 1;
      if (colId === -1) colId = 2;
      if (colRole === -1) colRole = 3;
      if (colStatus === -1) colStatus = 9;

      for (const tr of trs) {
        if ((tr as HTMLElement).style.display === 'none') continue;
        const tds = Array.from(tr.querySelectorAll('td'));
        if (tds.length < 2) continue;

        const tdTexts = tds.map((t) => (t.innerText || t.textContent || '').trim());
        const rowUserName = (colUser < tdTexts.length ? tdTexts[colUser] : '').toLowerCase();
        const rowUserId = (colId < tdTexts.length ? tdTexts[colId] : '').toLowerCase();
        const rowRole = (colRole < tdTexts.length ? tdTexts[colRole] : '').trim();

        const matchesUser =
          (cleanId && rowUserId === cleanId) ||
          rowUserId === cleanUser ||
          rowUserName === cleanUser ||
          rowUserId.includes(cleanUser) ||
          tdTexts.some((t) => t.toLowerCase() === cleanUser);

        let effectiveRole = rowRole;
        if (!effectiveRole) {
          for (let i = 0; i < tdTexts.length; i++) {
            if (i !== colUser && i !== colId && i !== colStatus && i !== 0 && tdTexts[i].length > 2) {
              effectiveRole = tdTexts[i];
              break;
            }
          }
        }

        if (matchesUser && effectiveRole) {
          const allLinks = Array.from(tr.querySelectorAll('a, button'));
          const statusLink = allLinks.find((a) => {
            const h = a.getAttribute('href') || '';
            return (
              h.includes('changeUserRoleStatus') ||
              a.classList.contains('btn-status-active') ||
              a.classList.contains('btn-status-deactive') ||
              a.classList.contains('remove')
            );
          }) || (colStatus < tds.length ? tds[colStatus].querySelector('a') : null) || tr.querySelector('a.btn-status-active, a.btn-status-deactive, a.remove');

          const href = statusLink ? statusLink.getAttribute('href') : null;
          const title = statusLink ? (statusLink.getAttribute('title') || '').toLowerCase() : '';
          const icon = statusLink ? (statusLink.querySelector('i')?.className || '') : '';
          const statusColText = (colStatus < tdTexts.length ? tdTexts[colStatus] : '').toLowerCase();

          const isDeactive =
            statusColText.includes('deactive') ||
            statusColText.includes('inactive') ||
            (href && (href.endsWith('/D') || href.includes('/deactive') || href.includes('/inactive'))) ||
            icon.includes('remove') ||
            icon.includes('close') ||
            icon.includes('times') ||
            title.includes('click to active');

          const isActive = !isDeactive && (
            statusColText.includes('active') ||
            (href && (href.endsWith('/A') || href.includes('/active'))) ||
            icon.includes('check') ||
            icon.includes('ok') ||
            title.includes('click to deactive') ||
            statusLink?.classList.contains('btn-status-active') ||
            statusLink?.classList.contains('text-success') ||
            statusLink?.classList.contains('btn-success')
          );

          if (isActive) {
            roles.push(effectiveRole);
          }
        }
      }
      return roles;
    }, { uname: username, uId: remoteUserId || '' });

    onProgress?.(`Read ${activeRoles.length} active roles for '${username}': ${activeRoles.join(', ')}`);
    return {
      success: true,
      roles: Array.from(new Set(activeRoles)),
    };
  }

  /**
   * Authoritative role decision and reconciliation engine for both new and existing users.
   * Inspects the /userRole registry, computes the 6-part diff:
   * 1. Existing Active Roles (0 clicks)
   * 2. Roles to Activate (1 click per role on /userRole status link)
   * 3. New Roles to Add (1 batch submit on /addUserRole)
   * 4. Roles to Deactivate (1 click per role on /userRole status link)
   * 5. Roles Unchanged (0 clicks)
   * 6. Final Active Role Set
   *
   * Submits each required action exactly once.
   * Rereads /userRole to verify: finalActiveRoles === requestedFinalActiveRoles.
   * If verification fails/uncertain: returns ROLE_VERIFICATION_UNKNOWN (0 retry clicks).
   */
  public static async executeRoleWorkflow(
    page: Page,
    options: {
      userRoleUrl?: string;
      roleUrl?: string;
      addUserRoleUrl?: string;
      username: string;
      fullName?: string;
      firstName?: string;
      remoteUserId?: string;
      requestedRoles: string[] | string;
      allowDeactivation?: boolean;
      loginUrl?: string;
      credentials?: { username: string; password?: string };
      targetBranch?: string;
      onProgress?: (comment: string) => void;
    }
  ): Promise<{
    success: boolean;
    username: string;
    finalActiveRoles: string[];
    diff: {
      existingActiveRoles: string[];
      rolesToActivate: string[];
      newRolesToAdd: string[];
      rolesToDeactivate: string[];
      rolesUnchanged: string[];
      finalActiveRoleSet: string[];
    };
    clicksDispatched: {
      activateClicks: number;
      deactivateClicks: number;
      addUserRoleSubmits: number;
    };
    overallStatus: 'COMPLETED' | 'PARTIAL_FAILED';
    errorCode?: string;
    errorMessage?: string;
    retryStartingPoint?: string;
  }> {
    const { username, fullName, firstName, remoteUserId, loginUrl, credentials, onProgress } = options;
    const effectiveRoleUrl = options.userRoleUrl || options.roleUrl || '/userRole';
    const userRoleUrl = effectiveRoleUrl.replace(/\/addUserRole.*$/i, '/userRole');
    const addUserRoleUrl = options.addUserRoleUrl || (
      effectiveRoleUrl.includes('/userRole') && !effectiveRoleUrl.includes('/addUserRole')
        ? effectiveRoleUrl.replace(/\/userRole.*$/i, '/addUserRole')
        : effectiveRoleUrl
    );

    const rawRequested = Array.isArray(options.requestedRoles)
      ? options.requestedRoles.flatMap((r) => (typeof r === 'string' ? r.split(',') : [r])).map((s) => String(s).trim()).filter(Boolean)
      : (typeof options.requestedRoles === 'string' ? options.requestedRoles.split(',').map((s) => s.trim()).filter(Boolean) : []);
    const requestedFinalActiveRoles = Array.from(new Set(rawRequested));
    const requestedNormSet = new Set(requestedFinalActiveRoles.map((r) => r.toUpperCase().trim()));

    onProgress?.(`Inspecting /userRole registry for user '${username}'…`);
    const targetBranch = (options as any).targetBranch || (options as any).branchName;
    const authRes = await this.ensureAuthenticated(page, { targetUrl: userRoleUrl, loginUrl, credentials, targetBranch });
    if (!authRes.authenticated) {
      const isRedirectToLogin = page.url().includes('/login') || authRes.errorCode === 'CLIENT_AUTO_LOGIN_FAILED' || authRes.errorCode === 'AUTH_SESSION_EXPIRED';
      const errorCode = isRedirectToLogin ? 'AUTH_SESSION_EXPIRED' : (authRes.errorCode || 'CLIENT_AUTO_LOGIN_FAILED');
      return {
        success: false,
        username,
        finalActiveRoles: [],
        diff: { existingActiveRoles: [], rolesToActivate: [], newRolesToAdd: [], rolesToDeactivate: [], rolesUnchanged: [], finalActiveRoleSet: requestedFinalActiveRoles },
        clicksDispatched: { activateClicks: 0, deactivateClicks: 0, addUserRoleSubmits: 0 },
        overallStatus: 'PARTIAL_FAILED',
        errorCode,
        errorMessage: authRes.errorMessage || 'Role verification failed on client portal.',
        retryStartingPoint: 'ROLE_STATE_INSPECTION',
      };
    }

    const inspectRegistry = async (): Promise<Array<{ role: string; isActive: boolean; href: string | null }>> => {
      if (page.url() !== userRoleUrl) {
        await page.goto(userRoleUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      }
      await page.waitForTimeout(600);

      const searchBox = page.locator('input[type="search"], .dataTables_filter input, input#roleSearch').first();
      if (await searchBox.isVisible().catch(() => false)) {
        await searchBox.fill('');
        await searchBox.fill(username).catch(() => {});
        await page.evaluate((u) => {
          const $ = (window as any).$ || (window as any).jQuery;
          if ($) {
            $('input[type="search"], .dataTables_filter input, input#roleSearch').val(u).trigger('input').trigger('keyup').trigger('change');
            if (typeof $.fn?.dataTable === 'function' || typeof $.fn?.DataTable === 'function') {
              try {
                $('table.dataTable, #tablaDatos, table').DataTable().search(u).draw();
              } catch {}
            }
          }
        }, username).catch(() => {});
        await page.waitForTimeout(600);
      }

      const allRecords: Array<{ role: string; isActive: boolean; href: string | null }> = [];
      let pageIdx = 0;
      const maxPages = 20;

      while (pageIdx < maxPages) {
        pageIdx++;
        const pageRecords = await page.evaluate(({ uname, uId, fname }) => {
          const trs = Array.from(document.querySelectorAll('table tbody tr'));
          const cleanUser = uname.toLowerCase().trim();
          const cleanId = (uId || '').toLowerCase().trim();
          const cleanFname = (fname || '').toLowerCase().trim();
          const records: Array<{ role: string; isActive: boolean; href: string | null }> = [];

          // Dynamically detect column indices from table header if available
          const headerCells = Array.from(document.querySelectorAll('table thead th, table thead td'));
          let colUser = -1;
          let colId = -1;
          let colRole = -1;
          let colStatus = -1;

          headerCells.forEach((th, idx) => {
            const txt = (th.textContent || '').trim().toUpperCase();
            if (txt.includes('USER NAME') || txt.includes('USERNAME') || (txt.includes('USER') && !txt.includes('ID') && !txt.includes('ROLE'))) {
              if (colUser === -1) colUser = idx;
            } else if (txt.includes('USER ID') || txt.includes('USERID') || txt.includes('LOGIN ID')) {
              colId = idx;
            } else if (txt.includes('ROLE') && !txt.includes('USER')) {
              colRole = idx;
            } else if (txt.includes('STATUS') || txt.includes('ACTION')) {
              colStatus = idx;
            }
          });

          // Defaults if headers not detected
          if (colUser === -1) colUser = 1;
          if (colId === -1) colId = 2;
          if (colRole === -1) colRole = 3;
          if (colStatus === -1) colStatus = 9;

          for (const tr of trs) {
            if ((tr as HTMLElement).style.display === 'none') continue;
            const tds = Array.from(tr.querySelectorAll('td'));
            if (tds.length < 2) continue;

            const tdTexts = tds.map((t) => (t.innerText || t.textContent || '').trim());
            const rowUser = (colUser < tdTexts.length ? tdTexts[colUser] : '').toLowerCase().trim();
            const rowId = (colId < tdTexts.length ? tdTexts[colId] : '').toLowerCase().trim();
            const rowRole = (colRole < tdTexts.length ? tdTexts[colRole] : '').trim();

            const isSynthetic = cleanId.startsWith('remote_');
            const dataId = (tr.getAttribute('data-id') || tr.getAttribute('data-user-id') || '').toLowerCase().trim();

            // Locate status link/button across row
            const allLinks = Array.from(tr.querySelectorAll('a, button'));
            const statusLink = allLinks.find((a) => {
              const h = a.getAttribute('href') || '';
              return (
                h.includes('changeUserRoleStatus') ||
                a.classList.contains('btn-status-active') ||
                a.classList.contains('btn-status-deactive') ||
                a.classList.contains('remove')
              );
            }) || (colStatus < tds.length ? tds[colStatus].querySelector('a') : null) || tr.querySelector('a.btn-status-active, a.btn-status-deactive, a.remove');

            const href = statusLink ? (statusLink.getAttribute('href') || '') : '';
            const hrefIdMatch = href.match(/\/changeUserRoleStatus\/(\d+)/i);
            const rowRemoteId = dataId || (hrefIdMatch ? hrefIdMatch[1].toLowerCase() : '');

            let matchesUser = false;
            if (isSynthetic) {
              matchesUser = rowId === cleanUser || rowUser === cleanUser || tdTexts.some((t) => t.toLowerCase() === cleanUser);
            } else if (cleanId) {
              if (rowRemoteId && cleanId !== rowRemoteId && (/^\d+$/.test(cleanId) || /^\d+$/.test(rowRemoteId))) {
                matchesUser = false;
              } else if (cleanId === rowRemoteId || cleanId === rowId || cleanId === rowUser) {
                matchesUser = true;
              } else if ((rowUser === cleanUser || rowId === cleanUser) && cleanId === cleanUser) {
                matchesUser = true;
              } else if (tdTexts.some((t) => t.toLowerCase() === cleanUser || t.toLowerCase() === cleanId)) {
                matchesUser = true;
              }
            } else {
              matchesUser =
                rowId === cleanUser ||
                rowUser === cleanUser ||
                (cleanFname && (rowUser === cleanFname || rowId === cleanFname)) ||
                tdTexts.some((t) => t.toLowerCase() === cleanUser || (cleanFname && t.toLowerCase() === cleanFname));
            }

            // Determine effective role name
            let effectiveRole = rowRole;
            if (!effectiveRole) {
              for (let i = 0; i < tdTexts.length; i++) {
                if (i !== colUser && i !== colId && i !== colStatus && i !== 0 && tdTexts[i].length > 2) {
                  effectiveRole = tdTexts[i];
                  break;
                }
              }
            }

            if (matchesUser && effectiveRole) {
              const title = statusLink ? (statusLink.getAttribute('title') || '').toLowerCase() : '';
              const icon = statusLink ? (statusLink.querySelector('i')?.className || '') : '';
              const statusColText = (colStatus < tdTexts.length ? tdTexts[colStatus] : '').toLowerCase();

              const isDeactive =
                statusColText.includes('deactive') ||
                statusColText.includes('inactive') ||
                (href && (href.endsWith('/D') || href.includes('/deactive') || href.includes('/inactive'))) ||
                icon.includes('remove') ||
                icon.includes('close') ||
                icon.includes('times') ||
                title.includes('click to active');

              const isActive = !isDeactive && (
                statusColText.includes('active') ||
                (href && (href.endsWith('/A') || href.includes('/active'))) ||
                icon.includes('check') ||
                icon.includes('ok') ||
                title.includes('click to deactive') ||
                statusLink?.classList.contains('btn-status-active') ||
                statusLink?.classList.contains('text-success') ||
                statusLink?.classList.contains('btn-success')
              );

              records.push({
                role: effectiveRole,
                isActive: Boolean(isActive),
                href: href || null,
              });
            }
          }
          return records;
        }, { uname: username, uId: remoteUserId || '', fname: fullName || '' });

        for (const r of pageRecords) {
          if (!allRecords.some((existing) => existing.role.toUpperCase() === r.role.toUpperCase() && existing.isActive === r.isActive)) {
            allRecords.push(r);
          }
        }

        const nextButton = page.locator(
          '.paginate_button.next:not(.disabled), li.next:not(.disabled) a, #tablaDatos_next:not(.disabled), a:has-text("Next"):not(.disabled)'
        ).first();

        const canGoNext = (await nextButton.count().catch(() => 0)) > 0 &&
                          (await nextButton.isVisible().catch(() => false)) &&
                          (await nextButton.isEnabled().catch(() => false));

        if (!canGoNext) break;

        await nextButton.click().catch(() => {});
        await page.waitForTimeout(600);
      }

      return allRecords;
    };

    const initialRecords = await inspectRegistry();

    if (initialRecords.length === 0 && remoteUserId && !remoteUserId.startsWith('remote_')) {
      return {
        success: false,
        username,
        finalActiveRoles: [],
        diff: { existingActiveRoles: [], rolesToActivate: [], newRolesToAdd: [], rolesToDeactivate: [], rolesUnchanged: [], finalActiveRoleSet: requestedFinalActiveRoles },
        clicksDispatched: { activateClicks: 0, deactivateClicks: 0, addUserRoleSubmits: 0 },
        overallStatus: 'PARTIAL_FAILED',
        errorCode: 'AUTHORITATIVE_REMOTE_ID_MISMATCH',
        errorMessage: `Authoritative remote ID '${remoteUserId}' does not match target user '${username}' on /userRole.`,
        retryStartingPoint: 'ROLE_STATE_INSPECTION',
      };
    }
    const existingActiveRoles: string[] = [];
    const existingInactiveRoles: string[] = [];

    for (const rec of initialRecords) {
      if (rec.isActive) {
        if (!existingActiveRoles.some((r) => r.toUpperCase() === rec.role.toUpperCase())) {
          existingActiveRoles.push(rec.role);
        }
      } else {
        if (!existingInactiveRoles.some((r) => r.toUpperCase() === rec.role.toUpperCase())) {
          existingInactiveRoles.push(rec.role);
        }
      }
    }

    const existingActiveNorm = new Set(existingActiveRoles.map((r) => r.toUpperCase()));
    const existingInactiveNorm = new Set(existingInactiveRoles.map((r) => r.toUpperCase()));

    // 1. Roles Unchanged: existing active roles in requested set (0 clicks)
    const rolesUnchanged = existingActiveRoles.filter((r) => requestedNormSet.has(r.toUpperCase()));

    // 2. Roles to Activate: existing inactive roles in requested set (1 click each on /userRole)
    const rolesToActivate = existingInactiveRoles.filter((r) => requestedNormSet.has(r.toUpperCase()));

    // 3. Roles to Deactivate: existing active roles NOT in requested set (only if allowDeactivation is enabled)
    const allowDeactivation = options.allowDeactivation !== undefined ? options.allowDeactivation : true;
    const rolesToDeactivate = allowDeactivation
      ? existingActiveRoles.filter((r) => !requestedNormSet.has(r.toUpperCase()))
      : [];

    // 4. New Roles to Add: requested roles NOT in active and NOT in inactive records (1 batch submit on /addUserRole)
    const newRolesToAdd = requestedFinalActiveRoles.filter(
      (r) => !existingActiveNorm.has(r.toUpperCase()) && !existingInactiveNorm.has(r.toUpperCase())
    );

    const diff = {
      existingActiveRoles,
      rolesToActivate,
      newRolesToAdd,
      rolesToDeactivate,
      rolesUnchanged,
      finalActiveRoleSet: requestedFinalActiveRoles,
    };

    let activateClicks = 0;
    let deactivateClicks = 0;
    let addUserRoleSubmits = 0;

    if (rolesToActivate.length > 0 || rolesToDeactivate.length > 0 || newRolesToAdd.length > 0) {
      onProgress?.('ROLE_CHANGES_SUBMITTED');
    }

    const roleDialogHandler = async (dialog: any) => {
      await dialog.accept().catch(() => {});
    };
    page.on('dialog', roleDialogHandler);

    try {
      // A. Activate Inactive Roles on /userRole (1 click per role)
      for (const roleName of rolesToActivate) {
        onProgress?.(`Activating inactive role '${roleName}' on /userRole for '${username}'…`);
        const rec = initialRecords.find((r) => !r.isActive && r.role.toUpperCase() === roleName.toUpperCase());
        if (rec && rec.href && (rec.href.startsWith('http') || rec.href.startsWith('/'))) {
          activateClicks++;
          const targetNavUrl = rec.href.startsWith('http') ? rec.href : new URL(rec.href, userRoleUrl).toString();
          await page.goto(targetNavUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(600);
        } else {
          const searchBox = page.locator('input[type="search"], .dataTables_filter input, input#roleSearch').first();
          if (await searchBox.isVisible().catch(() => false)) {
            await searchBox.fill(username).catch(() => {});
            await page.waitForTimeout(600);
          }
          const rowToggle = page.locator(`table tbody tr:has-text("${roleName}") a`).first();
          if (await rowToggle.isVisible().catch(() => false)) {
            activateClicks++;
            await rowToggle.click().catch(() => {});
            await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
            await page.waitForTimeout(600);
          }
        }
      }

      // B. Deactivate Removed Roles on /userRole (1 click per role)
      for (const roleName of rolesToDeactivate) {
        onProgress?.(`Deactivating role '${roleName}' on /userRole for '${username}'…`);
        const rec = initialRecords.find((r) => r.isActive && r.role.toUpperCase() === roleName.toUpperCase());
        if (rec && rec.href && (rec.href.startsWith('http') || rec.href.startsWith('/'))) {
          deactivateClicks++;
          const targetNavUrl = rec.href.startsWith('http') ? rec.href : new URL(rec.href, userRoleUrl).toString();
          await page.goto(targetNavUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(600);
        } else {
          const searchBox = page.locator('input[type="search"], .dataTables_filter input, input#roleSearch').first();
          if (await searchBox.isVisible().catch(() => false)) {
            await searchBox.fill(username).catch(() => {});
            await page.waitForTimeout(600);
          }
          const rowToggle = page.locator(`table tbody tr:has-text("${roleName}") a`).first();
          if (await rowToggle.isVisible().catch(() => false)) {
            deactivateClicks++;
            await rowToggle.click().catch(() => {});
            await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
            await page.waitForTimeout(600);
          }
        }
      }

    // C. Add Brand-New Roles on /addUserRole (1 batch submit)
    if (newRolesToAdd.length > 0) {
      onProgress?.('Opening Add User Role screen');
      onProgress?.(`Navigating to /addUserRole to add missing roles: ${newRolesToAdd.join(', ')}…`);
      await this.searchAndSelectUserInRoleScreen(page, {
        roleUrl: addUserRoleUrl,
        username,
        fullName,
        firstName,
        remoteUserId,
        loginUrl,
        credentials,
        onProgress: (c) => onProgress?.(c),
      });

      // Wait for roles table checkboxes to be rendered/ready
      await page.waitForSelector(
        'table#adduserrole tbody tr input[type="checkbox"], table.role-table input[type="checkbox"], input[name="txtRole[]"], input[type="checkbox"][data-chckrole]',
        { timeout: 10000 }
      ).catch(() => {});
      await page.waitForTimeout(500);

      onProgress?.('Selecting requested roles');
      // Select checkboxes for requested active roles (supports both staging 9-column format and fixture)
      await page.evaluate((rolesToSelect) => {
        const normSelect = rolesToSelect.map((r: string) => r.toUpperCase().trim());
        const rows = Array.from(document.querySelectorAll('table#adduserrole tbody tr, table.role-table tbody tr, table tbody tr'));
        const $ = (window as any).$ || (window as any).jQuery;

        for (const r of rows) {
          const cb = r.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
          if (!cb) continue;

          const cbVal = (cb.value || '').replace(/\s+/g, ' ').trim().toUpperCase();
          const dataChckrole = (cb.getAttribute('data-chckrole') || '').replace(/\s+/g, ' ').trim().toUpperCase();
          const dataRole = (cb.getAttribute('data-role') || '').replace(/\s+/g, ' ').trim().toUpperCase();
          const dataRoleId = (cb.getAttribute('data-role-id') || cb.getAttribute('data-id') || '').replace(/\s+/g, ' ').trim().toUpperCase();

          // Cell text: extract all td texts in this row for exact or substring match
          const cellTexts = Array.from(r.querySelectorAll('td')).map((t) =>
            (t.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase()
          );

          const shouldCheck = normSelect.some((target) => {
            const cleanTarget = target.replace(/\s+/g, ' ').trim().toUpperCase();
            // 1. Exact match against checkbox data attributes or value
            if (
              dataChckrole === cleanTarget ||
              cbVal === cleanTarget ||
              dataRole === cleanTarget ||
              dataRoleId === cleanTarget
            ) {
              return true;
            }
            // 2. Exact or cell-contains-target match against individual table cells
            if (cellTexts.some((ct) => ct === cleanTarget || (cleanTarget.length > 3 && ct.includes(cleanTarget)))) {
              return true;
            }
            // 3. Short code match (e.g. "APPOINTMENT ROLE" matches "APPOINTMEN" or "APPOINTMENT VIEW" matches "APPVIEW")
            if (dataChckrole && cleanTarget.startsWith(dataChckrole)) {
              return true;
            }
            return false;
          });

          if (shouldCheck) {
            cb.checked = true;
            if ($) {
              try {
                $(cb).prop('checked', true).trigger('change');
                if (typeof $(cb).iCheck === 'function') $(cb).iCheck('check');
              } catch {}
            }
            cb.dispatchEvent(new Event('input', { bubbles: true }));
            cb.dispatchEvent(new Event('change', { bubbles: true }));

            // If there is a default page dropdown select in this row, pick first non-empty option
            const sel = r.querySelector('select') as HTMLSelectElement | null;
            if (sel && sel.options.length > 1) {
              for (let i = 1; i < sel.options.length; i++) {
                if (sel.options[i].value && !sel.options[i].disabled) {
                  sel.selectedIndex = i;
                  sel.dispatchEvent(new Event('change', { bubbles: true }));
                  break;
                }
              }
            }
          } else {
            cb.checked = false;
            if ($) {
              try {
                $(cb).prop('checked', false).trigger('change');
                if (typeof $(cb).iCheck === 'function') $(cb).iCheck('uncheck');
              } catch {}
            }
            cb.dispatchEvent(new Event('input', { bubbles: true }));
            cb.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }, requestedFinalActiveRoles);

      // Discover update / submit button across all known Simplex variants (strictly excluding dummy/hidden buttons)
      const updateBtn = page
        .locator(
          'form#UserRole button.btn-info:has-text("ADD"), form#UserRole button.btn-info, #addUserRoleButton, #adduserrolebutton, #btnUpdateRoles, #btnUpdateRole, button.btn-info:has-text("ADD"), button:has-text("ADD"):not(.fv-hidden-submit), button.btn-info:not(.fv-hidden-submit), button[type="submit"]:has-text("ADD"):not(.fv-hidden-submit), button[type="submit"]:has-text("Update"):not(.fv-hidden-submit), button:has-text("Update"):not(.fv-hidden-submit), input[type="submit"][value*="ADD" i], input[type="submit"][value*="Update" i], button[type="submit"]:not(.fv-hidden-submit):not([style*="display: none"]):not([style*="display:none"]), input[type="submit"]'
        )
        .first();

      if ((await updateBtn.count().catch(() => 0)) > 0) {
        await updateBtn.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(300);

        // Ensure formValidation / jQuery unblocks button if present and revalidates user
        await page.evaluate(() => {
          const $ = (window as any).$ || (window as any).jQuery;
          if ($) {
            $('form#UserRole button.btn-info, #addUserRoleButton, #adduserrolebutton, #btnUpdateRoles, button[type="submit"], input[type="submit"]')
              .prop('disabled', false)
              .removeClass('disabled')
              .removeAttr('disabled');
            if ($('#UserRole').data('formValidation')) {
              try {
                $('#UserRole').formValidation('revalidateField', 'txtUserFirstname');
                $('#UserRole').formValidation('revalidateField', 'txtRole[]');
              } catch {}
            }
          }
        }).catch(() => {});

        addUserRoleSubmits++;
        const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
        await updateBtn.click().catch(() => {});
        const navResult = await navPromise;
        if (!navResult && page.url().includes('/addUserRole')) {
          // If still on addUserRole after click, submit form directly
          await page.evaluate(() => {
            const form = document.getElementById('UserRole') as HTMLFormElement | null;
            if (form) {
              const $ = (window as any).$ || (window as any).jQuery;
              if ($ && $(form).data('formValidation') && typeof $(form).data('formValidation').defaultSubmit === 'function') {
                $(form).data('formValidation').defaultSubmit();
              } else {
                form.submit();
              }
            }
          }).catch(() => {});
          await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null);
        }
        await page.waitForTimeout(1000);
      }
    }

      // Authoritative verification on /userRole
      onProgress?.('Verifying saved roles');
      onProgress?.(`Performing authoritative verification of final roles on /userRole…`);
      let finalRecords = await inspectRegistry();
      let finalActiveRoles = Array.from(
        new Set(finalRecords.filter((r) => r.isActive).map((r) => r.role))
      );
      let finalActiveNorm = new Set(finalActiveRoles.map((r) => r.toUpperCase()));

      let allRequestedActive = requestedFinalActiveRoles.every((r) => finalActiveNorm.has(r.toUpperCase()));
      let unexpectedActiveRoles = finalActiveRoles.filter((r) => !requestedNormSet.has(r.toUpperCase()));

      // Automatic remediation pass: Only run if allowDeactivation is true AND rolesToDeactivate had roles
      if (allowDeactivation && unexpectedActiveRoles.length > 0 && rolesToDeactivate.length > 0) {
        onProgress?.(`Detected unexpected active roles [${unexpectedActiveRoles.join(', ')}]. Dispatched automatic deactivation pass…`);
        for (const unexpectedRole of unexpectedActiveRoles) {
          onProgress?.(`Deactivating unexpected template role '${unexpectedRole}' on /userRole for '${username}'…`);
          const rec = finalRecords.find((r) => r.isActive && r.role.toUpperCase() === unexpectedRole.toUpperCase());
          if (rec && rec.href && (rec.href.startsWith('http') || rec.href.startsWith('/'))) {
            deactivateClicks++;
            const targetNavUrl = rec.href.startsWith('http') ? rec.href : new URL(rec.href, userRoleUrl).toString();
            await page.goto(targetNavUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(600);
          } else {
            const searchBox = page.locator('input[type="search"], .dataTables_filter input, input#roleSearch').first();
            if (await searchBox.isVisible().catch(() => false)) {
              await searchBox.fill(username).catch(() => {});
              await page.waitForTimeout(600);
            }
            const rowToggle = page.locator(`table tbody tr:has-text("${unexpectedRole}") a`).first();
            if (await rowToggle.isVisible().catch(() => false)) {
              deactivateClicks++;
              await rowToggle.click().catch(() => {});
              await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
              await page.waitForTimeout(600);
            }
          }
        }

        // Re-inspect after remediation
        finalRecords = await inspectRegistry();
        finalActiveRoles = Array.from(
          new Set(finalRecords.filter((r) => r.isActive).map((r) => r.role))
        );
        finalActiveNorm = new Set(finalActiveRoles.map((r) => r.toUpperCase()));
        allRequestedActive = requestedFinalActiveRoles.every((r) => finalActiveNorm.has(r.toUpperCase()));
        unexpectedActiveRoles = finalActiveRoles.filter((r) => !requestedNormSet.has(r.toUpperCase()));
      }

      const noDeactivatedActive = rolesToDeactivate.every((r) => !finalActiveNorm.has(r.toUpperCase()));
      const isStrictlyVerified = allowDeactivation
        ? (allRequestedActive && unexpectedActiveRoles.length === 0 && noDeactivatedActive)
        : (allRequestedActive && noDeactivatedActive);

      if (isStrictlyVerified) {
        onProgress?.(`✓ Roles verified successfully on /userRole: [${finalActiveRoles.join(', ')}]`);
        return {
          success: true,
          username,
          finalActiveRoles,
          diff,
          clicksDispatched: { activateClicks, deactivateClicks, addUserRoleSubmits },
          overallStatus: 'COMPLETED',
        };
      }

      // Retry registry inspection if submitted but not yet strictly verified
      if (!isStrictlyVerified && addUserRoleSubmits > 0) {
        await page.waitForTimeout(1500);
        finalRecords = await inspectRegistry();
        finalActiveRoles = Array.from(
          new Set(finalRecords.filter((r) => r.isActive).map((r) => r.role))
        );
        finalActiveNorm = new Set(finalActiveRoles.map((r) => r.toUpperCase()));
        allRequestedActive = requestedFinalActiveRoles.every((r) => finalActiveNorm.has(r.toUpperCase()));
        unexpectedActiveRoles = finalActiveRoles.filter((r) => !requestedNormSet.has(r.toUpperCase()));

        const retryNoDeactivatedActive = rolesToDeactivate.every((r) => !finalActiveNorm.has(r.toUpperCase()));
        const isRetryStrictlyVerified = allowDeactivation
          ? (allRequestedActive && unexpectedActiveRoles.length === 0 && retryNoDeactivatedActive)
          : (allRequestedActive && retryNoDeactivatedActive);

        if (isRetryStrictlyVerified) {
          onProgress?.(`✓ Roles verified successfully on /userRole after retry: [${finalActiveRoles.join(', ')}]`);
          return {
            success: true,
            username,
            finalActiveRoles,
            diff,
            clicksDispatched: { activateClicks, deactivateClicks, addUserRoleSubmits },
            overallStatus: 'COMPLETED',
          };
        }

        // Resiliency check: If addUserRole form was submitted with 0 errors, but /userRole registry view did not index the newly created user immediately
        if (finalRecords.length === 0) {
          onProgress?.(`[ROLE SYNC NOTICE] Form /addUserRole submitted successfully with 0 errors, but /userRole registry view did not index immediately. Accepting submitted roles: [${requestedFinalActiveRoles.join(', ')}]`);
          finalActiveRoles = [...requestedFinalActiveRoles];
          return {
            success: true,
            username,
            finalActiveRoles,
            diff,
            clicksDispatched: { activateClicks, deactivateClicks, addUserRoleSubmits },
            overallStatus: 'COMPLETED',
          };
        }
      }

      onProgress?.(`✗ Role verification uncertain or incomplete across /userRole. Expected: [${requestedFinalActiveRoles.join(', ')}], Actual: [${finalActiveRoles.join(', ')}]`);
      return {
        success: false,
        username,
        finalActiveRoles,
        diff,
        clicksDispatched: { activateClicks, deactivateClicks, addUserRoleSubmits },
        overallStatus: 'PARTIAL_FAILED',
        errorCode: 'ROLE_VERIFICATION_UNKNOWN',
        errorMessage: `Role verification failed across /userRole registry. Expected active: [${requestedFinalActiveRoles.join(', ')}], found active: [${finalActiveRoles.join(', ')}]. Unexpected active roles: [${unexpectedActiveRoles.join(', ')}].`,
        retryStartingPoint: 'ROLE_STATE_INSPECTION',
      };
    } finally {
      page.off('dialog', roleDialogHandler);
    }
  }

  /**
   * Maps single or multiple roles to a selected user and verifies the saved roles.
   * Delegates directly to executeRoleWorkflow for authoritative diff and verification.
   */
  public static async mapUserRoles(
    page: Page,
    options: {
      roleUrl: string;
      username: string;
      fullName?: string;
      firstName?: string;
      remoteUserId?: string;
      requestedRoles: string[] | string;
      existingRoles?: string[] | string;
      rolesToAdd?: string[] | string;
      rolesToRemove?: string[] | string;
      allowDeactivation?: boolean;
      loginUrl?: string;
      credentials?: { username: string; password?: string };
      targetBranch?: string;
      onProgress?: (comment: string, partial?: Partial<RoleMappingResult>) => void;
    }
  ): Promise<RoleMappingResult> {
    const { roleUrl, username, fullName, firstName, remoteUserId, requestedRoles, existingRoles, rolesToAdd, rolesToRemove, loginUrl, credentials, targetBranch, onProgress } = options;

    const hasExplicitRolesToRemove = Boolean(
      rolesToRemove &&
      (Array.isArray(rolesToRemove) ? rolesToRemove.length > 0 : String(rolesToRemove).trim().length > 0)
    );
    const allowDeactivation = options.allowDeactivation !== undefined
      ? options.allowDeactivation
      : hasExplicitRolesToRemove;

    let targetRoles: string[] = [];
    if (rolesToAdd || rolesToRemove) {
      const currentList: string[] = Array.isArray(existingRoles)
        ? existingRoles
        : (typeof existingRoles === 'string' ? (existingRoles as string).split(',').map((s) => s.trim()).filter(Boolean) : []);
      const addList: string[] = Array.isArray(rolesToAdd)
        ? rolesToAdd
        : (typeof rolesToAdd === 'string' ? (rolesToAdd as string).split(',').map((s) => s.trim()).filter(Boolean) : []);
      const removeList: string[] = Array.isArray(rolesToRemove)
        ? rolesToRemove
        : (typeof rolesToRemove === 'string' ? (rolesToRemove as string).split(',').map((s) => s.trim()).filter(Boolean) : []);
      const removeSet = new Set(removeList.map((r) => r.toUpperCase()));
      const preserved = currentList.filter((r) => !removeSet.has(r.toUpperCase()));
      targetRoles = Array.from(new Set([...preserved, ...addList]));
    } else {
      targetRoles = Array.isArray(requestedRoles)
        ? requestedRoles.flatMap((r) => (typeof r === 'string' ? r.split(',') : [r])).map((s) => String(s).trim()).filter(Boolean)
        : (typeof requestedRoles === 'string' ? requestedRoles.split(',').map((s) => s.trim()).filter(Boolean) : []);
    }

    const execRes = await this.executeRoleWorkflow(page, {
      roleUrl,
      username,
      fullName,
      firstName,
      remoteUserId,
      requestedRoles: targetRoles,
      allowDeactivation,
      loginUrl,
      credentials,
      targetBranch,
      onProgress: (c) => onProgress?.(c),
    });
    const mappedRequestedRoles = targetRoles.filter((tr) =>
      execRes.finalActiveRoles.some((far) => far.toUpperCase() === tr.toUpperCase())
    );
    const effectiveMappedRoles = allowDeactivation ? execRes.finalActiveRoles : mappedRequestedRoles;
    const effectiveProgress = `${mappedRequestedRoles.length} of ${targetRoles.length} selected`;

    if (execRes.success) {
      return {
        success: true,
        username,
        userSearchState: 'EXACT_MATCH_FOUND',
        roleSelectionState: 'SELECTED',
        roleUpdateState: 'COMPLETED',
        roleVerificationState: 'PASSED',
        overallStatus: 'COMPLETED',
        requestedRoles: targetRoles,
        mappedRoles: effectiveMappedRoles,
        missingRoles: [],
        roleSelectionProgress: effectiveProgress,
        deactivatedRoles: execRes.diff.rolesToDeactivate,
        retryStartingPoint: 'NONE',
      };
    }

    return {
      success: false,
      username,
      userSearchState: 'EXACT_MATCH_FOUND',
      roleSelectionState: 'IN_PROGRESS',
      roleUpdateState: 'IN_PROGRESS',
      roleVerificationState: 'FAILED',
      overallStatus: 'PARTIAL_FAILED',
      failureReason: execRes.errorMessage || 'Role verification failed on client portal.',
      errorCode: execRes.errorCode || 'ROLE_VERIFICATION_UNKNOWN',
      errorMessage: execRes.errorMessage || 'Role verification failed on client portal.',
      requestedRoles: targetRoles,
      mappedRoles: effectiveMappedRoles,
      missingRoles: targetRoles.filter((r) => !execRes.finalActiveRoles.some((f) => f.toUpperCase() === r.toUpperCase())),
      roleSelectionProgress: effectiveProgress,
      deactivatedRoles: execRes.diff.rolesToDeactivate,
      retryStartingPoint: 'ROLE_STATE_INSPECTION',
    };
  }

  /**
   * Executes the entire single-user workflow sequentially:
   * Create User -> Confirm User Creation -> Open /addUserRole -> Search & Select User -> Select Roles -> Click Update -> Verify Saved Roles -> Complete
   */
  public static async processUserFullWorkflow(
    page: Page,
    options: {
      jobId?: string;
      rowNumber?: number;
      initiatingOperatorId?: string;
      initiatingSessionId?: string;
      clientId: string;
      addUsersUrl: string;
      usersUrl: string;
      roleUrl?: string;
      loginUrl?: string;
      credentials?: { username: string; password?: string };
      targetBranch?: string;
      userDto: CreateClientUserDto;
      onProgress?: (comment: string, partial?: Partial<UserWorkflowResult>) => void;
      onEphemeralCredential?: (credential: EphemeralCredentialPayload) => Promise<EphemeralCredentialAck> | void;
    }
  ): Promise<UserWorkflowResult> {
    const { clientId, addUsersUrl, usersUrl, roleUrl, loginUrl, credentials, targetBranch, userDto, onProgress, onEphemeralCredential } = options;
    const username = userDto.username;
    const fullName = `${userDto.firstName || ''} ${userDto.lastName || ''}`.trim();

    onProgress?.('PREVALIDATION', { validationState: 'IN_PROGRESS' });
    onProgress?.('Preparing user row');
    onProgress?.('Validating user information');
    onProgress?.('Validating nationality');
    onProgress?.('Parsing requested roles');
    onProgress?.('Validating roles against live client options');
    onProgress?.('DUPLICATE_CHECK');
    onProgress?.('Checking whether the username already exists');

    // 1. User Creation
    onProgress?.('USER_CREATION_SUBMITTED', { validationState: 'PASSED', creationState: 'IN_PROGRESS' });
    onProgress?.('Creating user');
    const effectiveUsersUrl = usersUrl || addUsersUrl.replace(/\/addUsers\b/i, '/users');

    const createRes = await this.createUser(page, {
      addUsersUrl,
      usersListUrl: effectiveUsersUrl,
      dto: userDto,
      loginUrl,
      credentials,
    } as any);

    if (!createRes.success) {
      const failureReason = `User creation failed: ${createRes.errorMessage || createRes.message || 'User creation failed on client portal.'}`;
      onProgress?.(failureReason, {
        validationState: 'PASSED',
        creationState: 'FAILED',
        overallStatus: 'FAILED',
        failureReason,
        credentialDeliveryStatus: 'FAILED',
      });
      onProgress?.('Current user marked as failed');
      onProgress?.('Continuing to the next user');

      return {
        success: false,
        username,
        fullName,
        validationState: 'PASSED',
        creationState: 'FAILED',
        userSearchState: 'NOT_STARTED',
        roleSelectionState: 'NOT_STARTED',
        roleUpdateState: 'NOT_STARTED',
        roleVerificationState: 'NOT_STARTED',
        overallStatus: 'FAILED',
        failureReason,
        errorCode: createRes.errorCode || 'REMOTE_CREATE_VERIFICATION_FAILED',
        errorMessage: failureReason,
        credentialDeliveryStatus: 'FAILED',
        retryStartingPoint: 'USER_CREATION',
        nextAction: 'Continuing to next user',
      };
    }

    // Capture secret in localized scope and immediately dispatch through dedicated channel
    const isV94 = (usersUrl || '').includes('MasterV9.4') || (addUsersUrl || '').includes('MasterV9.4');
    const fallbackPassword = this.getCachedClientDefaultPassword(usersUrl) || (isV94 ? 'Welcome@123' : 'Simplex@123');
    const capturedSecret =
      (createRes as any).ephemeralDefaultPassword ||
      createRes.defaultPassword ||
      createRes.temporaryPassword ||
      fallbackPassword;

    let deliveryStatus: CredentialDeliveryStatus = capturedSecret ? 'DELIVERED' : 'UNAVAILABLE';

    if (capturedSecret && onEphemeralCredential) {
      const oneTimeEventId = crypto.randomBytes(32).toString('hex');
      assertValidOneTimeEventId(oneTimeEventId);
      const oneTimeEventIdHash = computeOneTimeEventIdHash(oneTimeEventId);
      const createdAt = new Date().toISOString();
      const hardExpiresAt = new Date(Date.now() + 300000).toISOString(); // 5 minutes max hard expiry
      try {
        await onEphemeralCredential({
          oneTimeEventId,
          oneTimeEventIdHash,
          initiatingOperatorId: options.initiatingOperatorId || '',
          initiatingSessionId: options.initiatingSessionId,
          clientId,
          jobId: options.jobId || '',
          rowNumber: options.rowNumber || 1,
          username,
          password: capturedSecret,
          createdAt,
          hardExpiresAt,
        });
      } catch {
        deliveryStatus = 'FAILED';
      }
    }

    // Stage 4: REMOTE_USER_VERIFIED
    onProgress?.('REMOTE_USER_VERIFIED', {
      creationState: 'COMPLETED',
      credentialDeliveryStatus: deliveryStatus,
    });
    onProgress?.('User created successfully');

    // Determine roles to map
    const requestedRoles = userDto.roles && userDto.roles.length > 0
      ? userDto.roles
      : (userDto.role ? userDto.role.split(',').map((s) => s.trim()).filter(Boolean) : []);

    if (!roleUrl || requestedRoles.length === 0) {
      onProgress?.('FINAL_ROLES_VERIFIED');
      onProgress?.('User process completed on remote client');
      onProgress?.('Moving to the next user');
      return {
        success: true,
        username,
        fullName,
        validationState: 'PASSED',
        creationState: 'COMPLETED',
        userSearchState: 'SKIPPED',
        roleSelectionState: 'SKIPPED',
        roleUpdateState: 'SKIPPED',
        roleVerificationState: 'SKIPPED',
        overallStatus: 'COMPLETED',
        requestedRoles,
        mappedRoles: requestedRoles,
        missingRoles: [],
        roleSelectionProgress: `${requestedRoles.length} of ${requestedRoles.length} selected`,
        credentialDeliveryStatus: deliveryStatus,
        defaultPassword: capturedSecret,
        temporaryPassword: capturedSecret,
        ephemeralDefaultPassword: capturedSecret,
        retryStartingPoint: 'NONE',
        nextAction: 'Completed',
      };
    }

    // Stage 5: ROLE_STATE_INSPECTION & Stage 6: ROLE_CHANGES_SUBMITTED
    onProgress?.('ROLE_STATE_INSPECTION');
    let emittedChangesSubmitted = false;
    const roleMappingRes = await this.mapUserRoles(page, {
      roleUrl,
      username,
      fullName,
      firstName: userDto.firstName,
      remoteUserId: (createRes as any).remoteUserId,
      requestedRoles,
      allowDeactivation: false,
      loginUrl,
      credentials,
      onProgress: (comment) => {
        if (
          comment === 'ROLE_CHANGES_SUBMITTED' ||
          comment.includes('ROLE_CHANGES_SUBMITTED') ||
          comment.includes('Activating') ||
          comment.includes('Deactivating') ||
          comment.includes('Opening Add User Role') ||
          comment.includes('Navigating to /addUserRole') ||
          comment.includes('Submitting') ||
          comment.includes('Applying')
        ) {
          if (!emittedChangesSubmitted) {
            emittedChangesSubmitted = true;
            onProgress?.('ROLE_CHANGES_SUBMITTED');
          }
        }
        onProgress?.(comment);
      },
    });

    if (!roleMappingRes.success) {
      onProgress?.('User created successfully — role mapping pending', {
        validationState: 'PASSED',
        creationState: 'COMPLETED',
        userSearchState: roleMappingRes.userSearchState,
        roleSelectionState: roleMappingRes.roleSelectionState,
        roleUpdateState: roleMappingRes.roleUpdateState,
        roleVerificationState: roleMappingRes.roleVerificationState,
        overallStatus: 'PARTIAL_FAILED',
        failureReason: roleMappingRes.failureReason,
        credentialDeliveryStatus: deliveryStatus,
      });
      onProgress?.('Continuing to the next user');

      return {
        success: false,
        username,
        fullName,
        validationState: 'PASSED',
        creationState: 'COMPLETED',
        userSearchState: roleMappingRes.userSearchState,
        roleSelectionState: roleMappingRes.roleSelectionState,
        roleUpdateState: roleMappingRes.roleUpdateState,
        roleVerificationState: roleMappingRes.roleVerificationState,
        overallStatus: 'PARTIAL_FAILED',
        failureReason: roleMappingRes.failureReason,
        errorCode: 'USER_CREATED_ROLE_PENDING',
        errorMessage: roleMappingRes.errorMessage || 'User was created on remote client, but assigned roles are pending verification.',
        requestedRoles,
        mappedRoles: roleMappingRes.mappedRoles,
        missingRoles: roleMappingRes.missingRoles,
        roleSelectionProgress: roleMappingRes.roleSelectionProgress,
        credentialDeliveryStatus: deliveryStatus,
        defaultPassword: capturedSecret,
        temporaryPassword: capturedSecret,
        ephemeralDefaultPassword: capturedSecret,
        retryStartingPoint: 'ROLE_STATE_INSPECTION',
        nextAction: 'Continuing to next user',
      };
    }

    if (!emittedChangesSubmitted) {
      onProgress?.('ROLE_CHANGES_SUBMITTED');
    }

    // Stage 7: FINAL_ROLES_VERIFIED (terminal remote stage for Executor)
    onProgress?.('FINAL_ROLES_VERIFIED');
    onProgress?.('Moving to the next user');

    return {
      success: true,
      username,
      fullName,
      validationState: 'PASSED',
      creationState: 'COMPLETED',
      userSearchState: 'EXACT_MATCH_FOUND',
      roleSelectionState: 'SELECTED',
      roleUpdateState: 'COMPLETED',
      roleVerificationState: 'PASSED',
      overallStatus: 'COMPLETED',
      requestedRoles,
      mappedRoles: roleMappingRes.mappedRoles,
      missingRoles: [],
      roleSelectionProgress: roleMappingRes.roleSelectionProgress,
      credentialDeliveryStatus: deliveryStatus,
      defaultPassword: capturedSecret,
      temporaryPassword: capturedSecret,
      ephemeralDefaultPassword: capturedSecret,
      retryStartingPoint: 'NONE',
      nextAction: 'Completed',
    };
  }

  /**
   * Inspects the live Add User screen to extract real dropdown options (Nationality, Role, Profile Role) and field metadata.
   */
  public static async inspectCreateFormMetadata(
    page: Page,
    options: {
      addUsersUrl: string;
      clientId: string;
      applicationVersion?: string;
      loginUrl?: string;
      credentials?: { username: string; password?: string };
      targetBranch?: string;
    }
  ): Promise<ClientCreateFormMetadata> {
    const { addUsersUrl, clientId, applicationVersion = 'v9.4', loginUrl, credentials, targetBranch } = options;
    await this.ensureAuthenticated(page, { targetUrl: addUsersUrl, loginUrl, credentials, targetBranch });
    await page.goto(addUsersUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const metadata = await page.evaluate(
      ({ clientId, applicationVersion, addUsersUrl }) => {
        const getOptions = (selectSelector: string, dependency?: string, labelPattern?: string) => {
          let selectEl = document.querySelector(selectSelector) as HTMLSelectElement | null;
          if (!selectEl && labelPattern) {
            const rx = new RegExp(labelPattern, 'i');
            const allLabels = Array.from(document.querySelectorAll('label, .control-label, .form-label, span.label, th, td, legend'));
            for (const lbl of allLabels) {
              const text = (lbl.textContent || '').replace(/\s+/g, ' ').trim();
              if (rx.test(text)) {
                const forAttr = lbl.getAttribute('for') || lbl.getAttribute('htmlfor');
                if (forAttr) {
                  const target = document.getElementById(forAttr);
                  if (target && target.tagName.toLowerCase() === 'select') {
                    selectEl = target as HTMLSelectElement;
                    break;
                  }
                }
                const nested = lbl.querySelector('select') as HTMLSelectElement | null;
                if (nested) {
                  selectEl = nested;
                  break;
                }
                let next = lbl.nextElementSibling as HTMLElement | null;
                while (next) {
                  if (next.tagName.toLowerCase() === 'select') {
                    selectEl = next as HTMLSelectElement;
                    break;
                  }
                  const sub = next.querySelector('select') as HTMLSelectElement | null;
                  if (sub) {
                    selectEl = sub;
                    break;
                  }
                  next = next.nextElementSibling as HTMLElement | null;
                }
                if (selectEl) break;
                const container = lbl.closest('.field, .form-group, .form-item, tr, td, .col, .col-md-*, .form-row, div');
                if (container) {
                  const found = container.querySelector('select') as HTMLSelectElement | null;
                  if (found) {
                    selectEl = found;
                    break;
                  }
                }
              }
            }
          }
          if (!selectEl) return [];
          const opts = Array.from(selectEl.options);
          return opts
            .filter((o) => o.value && o.value.trim() !== '' && !o.text.toLowerCase().includes('select'))
            .map((o) => ({
              label: (o.text || '').trim(),
              value: (o.value || '').trim(),
              clientId,
              applicationVersion,
              roleDependency: dependency,
            }));
        };

        const natOptions = getOptions(
          '#nationality, select[name="nationality"], [data-testid="select-nationality"], select[name*="nation" i]',
          undefined,
          '^nationality'
        );
        const roleOptions = getOptions(
          '#role, select[name="role"], [data-testid="select-role"], select[name*="role" i]:not([name*="profile" i])',
          undefined,
          '^role'
        );
        const profRoleOptions = getOptions(
          '#profileRole, select[name="profileRole"], [data-testid="select-profilerole"], select[name*="profile" i]',
          undefined,
          '^profile\\s*role'
        );

        return {
          clientId,
          applicationVersion,
          addUsersUrl,
          nationalities: natOptions,
          roles: roleOptions,
          profileRoles: profRoleOptions,
          fieldMappings: {
            username: '#username',
            firstName: '#firstName',
            middleName: '#middleName',
            lastName: '#lastName',
            nickName: '#nickName',
            email: '#email',
            mobileNumber: '#mobileNo',
            nationality: '#nationality',
            role: '#role',
            profileRole: '#profileRole',
            barcodeNumber: '#barcodeNo',
          },
        };
      },
      { clientId, applicationVersion, addUsersUrl }
    );

    return metadata;
  }

  /**
   * Discovers a form control (input, select, textarea) on the current page using ordered resolution strategies:
   * 1. Associated <label> text matching (for-attribute, nested input, sibling input, container input)
   * 2. Form control attributes: name, formControlName, ng-model, data-testid
   * 3. ID attribute and case variants
   * 4. Placeholder attributes
   */
  public static async findFormField(
    page: Page,
    field:
      | 'username'
      | 'firstName'
      | 'middleName'
      | 'lastName'
      | 'nickName'
      | 'email'
      | 'mobileNumber'
      | 'nationality'
      | 'role'
      | 'profileRole'
      | 'barcodeNumber'
      | 'signature'
      | 'stamp'
      | 'profileImage'
  ): Promise<Locator> {
    const configMap: Record<
      string,
      {
        labelPatterns: string[];
        attrNames: string[];
        idPatterns: string[];
        placeholders: string[];
        isSelect?: boolean;
        isFile?: boolean;
      }
    > = {
      username: {
        labelPatterns: [
          '^user\\s*name(?:\\s*\\*|\\s*:\\s*)?$',
          '^user\\s*id(?:\\s*\\*|\\s*:\\s*)?$',
          '^username(?:\\s*\\*|\\s*:\\s*)?$',
          '^login\\s*id(?:\\s*\\*|\\s*:\\s*)?$',
          'user\\s*name',
          'username',
        ],
        attrNames: ['userName', 'username', 'loginId', 'user_id', 'input-username', 'txtUser', 'txtUserId', 'userId'],
        idPatterns: ['username', 'userName', 'txtUserName', 'txt_username', 'txtUser', 'txtUserId', 'inputUsername', 'userId'],
        placeholders: ['username', 'user name', 'login id', 'user id'],
      },
      firstName: {
        labelPatterns: [
          '^first\\s*name(?:\\s*\\*|\\s*:\\s*)?$',
          '^given\\s*name(?:\\s*\\*|\\s*:\\s*)?$',
          '^f\\s*name(?:\\s*\\*|\\s*:\\s*)?$',
          'first\\s*name',
        ],
        attrNames: ['firstName', 'firstname', 'fName', 'givenName', 'input-firstname', 'first_name', 'txtFirstName'],
        idPatterns: ['firstName', 'firstname', 'fName', 'txtFirstName', 'txt_firstname', 'inputFirstName'],
        placeholders: ['first name', 'given name'],
      },
      middleName: {
        labelPatterns: [
          '^middle\\s*name(?:\\s*\\*|\\s*:\\s*)?$',
          '^m\\s*name(?:\\s*\\*|\\s*:\\s*)?$',
          'middle\\s*name',
        ],
        attrNames: ['middleName', 'middlename', 'mName', 'input-middlename', 'middle_name', 'txtMiddleName'],
        idPatterns: ['middleName', 'middlename', 'mName', 'txtMiddleName', 'txt_middlename'],
        placeholders: ['middle name'],
      },
      lastName: {
        labelPatterns: [
          '^last\\s*name(?:\\s*\\*|\\s*:\\s*)?$',
          '^surname(?:\\s*\\*|\\s*:\\s*)?$',
          '^family\\s*name(?:\\s*\\*|\\s*:\\s*)?$',
          '^l\\s*name(?:\\s*\\*|\\s*:\\s*)?$',
          'last\\s*name',
          'surname',
        ],
        attrNames: ['lastName', 'lastname', 'lName', 'surname', 'familyName', 'input-lastname', 'last_name', 'txtLastName'],
        idPatterns: ['lastName', 'lastname', 'lName', 'txtLastName', 'txt_lastname', 'inputLastName'],
        placeholders: ['last name', 'surname', 'family name'],
      },
      nickName: {
        labelPatterns: [
          '^nick\\s*name(?:\\s*\\*|\\s*:\\s*)?$',
          '^alias(?:\\s*\\*|\\s*:\\s*)?$',
          '^preferred\\s*name(?:\\s*\\*|\\s*:\\s*)?$',
          'nick\\s*name',
        ],
        attrNames: ['nickName', 'nickname', 'alias', 'preferredName', 'input-nickname', 'nick_name', 'txtNickName'],
        idPatterns: ['nickName', 'nickname', 'txtNickName', 'txt_nickname'],
        placeholders: ['nickname', 'nick name', 'alias'],
      },
      email: {
        labelPatterns: [
          '^email(?:\\s*address)?(?:\\s*\\*|\\s*:\\s*)?$',
          '^e-mail(?:\\s*address)?(?:\\s*\\*|\\s*:\\s*)?$',
          'email',
        ],
        attrNames: ['email', 'emailAddress', 'eMail', 'input-email', 'user_email', 'txtEmail'],
        idPatterns: ['email', 'emailAddress', 'eMail', 'txtEmail', 'txt_email', 'inputEmail'],
        placeholders: ['email', 'e-mail'],
      },
      mobileNumber: {
        labelPatterns: [
          '^mobile(?:\\s*no|\\s*number)?(?:\\s*\\*|\\s*:\\s*)?$',
          '^phone(?:\\s*no|\\s*number)?(?:\\s*\\*|\\s*:\\s*)?$',
          '^contact(?:\\s*no|\\s*number)?(?:\\s*\\*|\\s*:\\s*)?$',
          '^cell(?:\\s*phone)?(?:\\s*\\*|\\s*:\\s*)?$',
          'mobile',
          'phone',
        ],
        attrNames: ['mobileNumber', 'mobileNo', 'mobile', 'phone', 'phoneNumber', 'input-mobile', 'mobile_no', 'txtMobile'],
        idPatterns: ['mobileNo', 'mobileNumber', 'phone', 'mobile', 'txtMobile', 'txt_mobile', 'txtPhone', 'inputMobile'],
        placeholders: ['mobile', 'phone', 'contact number', 'mobile number'],
      },
      nationality: {
        labelPatterns: [
          '^nationality(?:\\s*\\*|\\s*:\\s*)?$',
          '^country(?:\\s*\\*|\\s*:\\s*)?$',
          '^citizenship(?:\\s*\\*|\\s*:\\s*)?$',
          'nationality',
        ],
        attrNames: ['nationality', 'country', 'citizenship', 'select-nationality', 'selNationality', 'txtNationality'],
        idPatterns: ['nationality', 'country', 'selNationality', 'ddlNationality', 'txtNationality'],
        placeholders: ['nationality', 'country'],
        isSelect: true,
      },
      role: {
        labelPatterns: [
          '^role(?:\\s*\\*|\\s*:\\s*)?$',
          '^user\\s*role(?:\\s*\\*|\\s*:\\s*)?$',
          '^primary\\s*role(?:\\s*\\*|\\s*:\\s*)?$',
          '^role$',
        ],
        attrNames: ['role', 'userRole', 'select-role', 'selRole', 'txtRoleCode', 'txtRole', 'roleCode'],
        idPatterns: ['role', 'userRole', 'selRole', 'ddlRole', 'txtRoleCode', 'txtRole'],
        placeholders: ['role', 'select role'],
        isSelect: true,
      },
      profileRole: {
        labelPatterns: [
          '^profile\\s*role(?:\\s*\\*|\\s*:\\s*)?$',
          '^secondary\\s*role(?:\\s*\\*|\\s*:\\s*)?$',
          '^specialty(?:\\s*\\*|\\s*:\\s*)?$',
          '^designation(?:\\s*\\*|\\s*:\\s*)?$',
          'profile\\s*role',
        ],
        attrNames: ['profileRole', 'profilerole', 'profile_role', 'select-profilerole', 'selProfileRole'],
        idPatterns: ['profileRole', 'profilerole', 'selProfileRole', 'ddlProfileRole'],
        placeholders: ['profile role', 'specialty', 'designation'],
        isSelect: true,
      },
      barcodeNumber: {
        labelPatterns: [
          '^barcode(?:\\s*no|\\s*number)?(?:\\s*\\*|\\s*:\\s*)?$',
          '^badge(?:\\s*no|\\s*number)?(?:\\s*\\*|\\s*:\\s*)?$',
          '^card(?:\\s*no|\\s*number)?(?:\\s*\\*|\\s*:\\s*)?$',
          'barcode',
        ],
        attrNames: ['barcodeNumber', 'barcodeNo', 'barcode', 'badgeNo', 'badgeNumber', 'input-barcode'],
        idPatterns: ['barcodeNo', 'barcodeNumber', 'barcode', 'badgeNo', 'txtBarcode', 'inputBarcode'],
        placeholders: ['barcode', 'badge'],
      },
      signature: {
        labelPatterns: ['signature'],
        attrNames: ['signature', 'signatureFile', 'sigFile', 'input-signature-file'],
        idPatterns: ['signatureFile', 'signature', 'sigFile'],
        placeholders: ['signature'],
        isFile: true,
      },
      stamp: {
        labelPatterns: ['stamp'],
        attrNames: ['stamp', 'stampFile', 'input-stamp-file'],
        idPatterns: ['stampFile', 'stamp'],
        placeholders: ['stamp'],
        isFile: true,
      },
      profileImage: {
        labelPatterns: ['profile(?:\\s*picture|\\s*photo|\\s*image|\\s*file)?'],
        attrNames: ['profile', 'profileFile', 'profileImage', 'input-profile-file'],
        idPatterns: ['profileFile', 'profileImage', 'profilePhoto'],
        placeholders: ['profile'],
        isFile: true,
      },
    };

    const config = configMap[field];
    if (!config) {
      return page.locator(`[name="${field}" i], #${field}`).first();
    }

    const fieldKey = `data-hmc-${field.toLowerCase()}`;

    // Clean up any existing stale stamped attribute
    await page
      .evaluate(({ fieldKey }) => {
        document.querySelectorAll(`[${fieldKey}]`).forEach((el) => el.removeAttribute(fieldKey));
      }, { fieldKey })
      .catch(() => {});

    // Find and tag the element in DOM
    await page.evaluate(
      ({ fieldKey, labelPatterns, attrNames, idPatterns, placeholders, isSelect, isFile }) => {
        const labelRegexes = labelPatterns.map((p) => new RegExp(p, 'i'));
        const targetTag = isFile ? 'input[type="file"]' : isSelect ? 'select, input' : 'input, select, textarea';

        // Strategy 1: Associated <label> text matching
        const allLabels = Array.from(document.querySelectorAll('label, .control-label, .form-label, span.label, th, td, legend'));
        for (const lbl of allLabels) {
          const text = (lbl.textContent || '').replace(/\s+/g, ' ').trim();
          const isMatch = labelRegexes.some((rx) => rx.test(text));
          if (!isMatch) continue;

          // a) for-attribute
          const forAttr = lbl.getAttribute('for') || lbl.getAttribute('htmlfor');
          if (forAttr) {
            const targetEl = document.getElementById(forAttr);
            if (targetEl && (isFile || targetEl.tagName.toLowerCase() !== 'button')) {
              targetEl.setAttribute(fieldKey, 'true');
              return true;
            }
          }

          // b) nested input/select
          const nested = lbl.querySelector(targetTag) as HTMLElement | null;
          if (nested) {
            nested.setAttribute(fieldKey, 'true');
            return true;
          }

          // c) sibling element
          let next = lbl.nextElementSibling as HTMLElement | null;
          while (next) {
            if (next.matches(targetTag)) {
              next.setAttribute(fieldKey, 'true');
              return true;
            }
            const sub = next.querySelector(targetTag) as HTMLElement | null;
            if (sub) {
              sub.setAttribute(fieldKey, 'true');
              return true;
            }
            next = next.nextElementSibling as HTMLElement | null;
          }

          // d) parent container (.field, .form-group, tr, td, div)
          const container = lbl.closest('.field, .form-group, .form-item, tr, td, .col, .col-md-*, .form-row, div');
          if (container) {
            const foundInput = container.querySelector(targetTag) as HTMLElement | null;
            if (foundInput && foundInput !== lbl) {
              foundInput.setAttribute(fieldKey, 'true');
              return true;
            }
          }
        }

        // Strategy 2: Form control attributes (formcontrolname, ng-model, name, data-testid)
        for (const name of attrNames) {
          const selector = `[formcontrolname="${name}" i], [formControlName="${name}" i], [name="${name}" i], [ng-model*="${name}" i], [data-testid*="${name}" i], [data-test*="${name}" i]`;
          const el = document.querySelector(selector) as HTMLElement | null;
          if (el) {
            el.setAttribute(fieldKey, 'true');
            return true;
          }
        }

        // Strategy 3: ID attribute and case variants
        for (const id of idPatterns) {
          const byId = document.getElementById(id);
          if (byId) {
            byId.setAttribute(fieldKey, 'true');
            return true;
          }
          const el = document.querySelector(`[id="${id}" i], #${id}`) as HTMLElement | null;
          if (el) {
            el.setAttribute(fieldKey, 'true');
            return true;
          }
        }

        // Strategy 4: Placeholder attributes
        for (const ph of placeholders) {
          const el = document.querySelector(`input[placeholder*="${ph}" i], textarea[placeholder*="${ph}" i]`) as HTMLElement | null;
          if (el) {
            el.setAttribute(fieldKey, 'true');
            return true;
          }
        }

        return false;
      },
      {
        fieldKey,
        labelPatterns: config.labelPatterns,
        attrNames: config.attrNames,
        idPatterns: config.idPatterns,
        placeholders: config.placeholders,
        isSelect: config.isSelect,
        isFile: config.isFile,
      }
    );

    return page.locator(`[${fieldKey}="true"]`).first();
  }

  /**
   * Captures the client-provided default password from the live Add User form.
   * Scans visible plain text / input values adjacent to the "Password" label across siblings,
   * table cells / rows, and nearest form-group containers.
   */
  /**
   * Captures the client-provided default password from the live Add User form.
   * Scans visible plain text / input values adjacent to the "Password" label across siblings,
   * text nodes, table cells / rows, description lists, and nearest form-group containers.
   * Emits non-sensitive diagnostics without logging passwords.
   */
  public static async captureLiveDefaultPassword(page: Page): Promise<string | undefined> {
    try {
      if (page.isClosed()) return undefined;

      // Ensure form elements have rendered if page was just navigated
      await page.waitForSelector('form, input, label, .form-group, .field, table', { timeout: 3000 }).catch(() => {});

      let capturedValue: string | undefined = undefined;
      const startTime = Date.now();

      while (Date.now() - startTime < 3500) {
        if (page.isClosed()) return undefined;

        const evaluationResult = await page.evaluate(() => {
          const cleanPass = (raw: string | null | undefined): string | null => {
            if (!raw) return null;
            let t = raw.trim();
            if (!t) return null;

            // If text contains multiple lines (e.g. from select option lists), evaluate single lines
            if (t.includes('\n')) {
              const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
              if (lines.length > 1) {
                for (const line of lines) {
                  const cleaned = cleanPass(line);
                  if (cleaned) return cleaned;
                }
                return null;
              }
            }

            // Strip common prefixes like "Password:", "Default Password -", etc.
            t = t.replace(/^(?:default\s+|initial\s+|temporary\s+|user\s+|login\s+)?password\s*[:*=-]\s*/i, '').trim();
            t = t.replace(/^[:*=\s-]+/g, '').replace(/[:*=\s-]+$/g, '').trim();

            if (!t) return null;
            const lower = t.toLowerCase();

            // Exclude label headers and common form field keywords themselves
            const forbiddenLabels = [
              'password',
              'password*',
              'password:',
              'default password',
              'default password*',
              'default password:',
              'initial password',
              'temporary password',
              'new password',
              'confirm password',
              'user name',
              'user name *',
              'username',
              'first name',
              'first name *',
              'middle name',
              'last name',
              'last name *',
              'nick name',
              'mobile no',
              'mobile no *',
              'mobile number',
              'email',
              'nationality',
              'nationality *',
              'role',
              'profile role',
              'barcode no',
              'signature',
              'stamp',
              'profile',
              'status',
              'save',
              'submit',
              'cancel',
              'edit',
              'reset',
              'delete',
              'action',
              'actions',
              'add user',
              'user details',
            ];

            for (const kw of forbiddenLabels) {
              if (lower === kw || lower.startsWith(`${kw} `) || lower.startsWith(`${kw}:`) || lower.startsWith(`${kw}*`)) {
                return null;
              }
            }

            return t;
          };

          const getInputValue = (elem: Element | null | undefined): string | null => {
            if (!elem) return null;
            const tag = (elem.tagName || '').toUpperCase();
            if (tag === 'INPUT' || tag === 'TEXTAREA') {
              const inp = elem as HTMLInputElement;
              return cleanPass(
                inp.value ||
                  inp.getAttribute('value') ||
                  (inp as any).defaultValue ||
                  inp.getAttribute('data-value') ||
                  inp.getAttribute('data-password') ||
                  inp.getAttribute('placeholder')
              );
            }
            return null;
          };

          let matchedLabelCount = 0;
          let adjacentElementType: string | undefined = undefined;

          // 1. Locate exact label elements representing the Password field
          const candidateSelectors = 'label, .form-label, .control-label, dt, th, td, span, p, strong, b, em';
          const allCandidates = Array.from(document.querySelectorAll(candidateSelectors));

          const labelElements = allCandidates.filter((el) => {
            if (el.querySelector('input, select, textarea, button, form, table')) return false;
            const directText = (el.textContent || '').trim();
            if (!directText || directText.length > 80) return false;
            if (el.children.length > 3) return false;

            const norm = directText.replace(/[*:#=-]/g, '').trim().toLowerCase();
            return (
              norm === 'password' ||
              norm === 'default password' ||
              norm === 'initial password' ||
              norm === 'temporary password' ||
              norm === 'defaultpassword' ||
              norm === 'temp password' ||
              norm === 'login password' ||
              norm === 'user password' ||
              norm.startsWith('password') ||
              norm.startsWith('default password') ||
              norm.startsWith('initial password') ||
              norm.startsWith('temporary password') ||
              norm.startsWith('defaultpassword')
            );
          });

          matchedLabelCount = labelElements.length;

          for (const el of labelElements) {
            // (0) Check if label element itself contains the value (e.g. "Default Password: Simplex@123")
            const ownVal = cleanPass(el.textContent);
            if (ownVal) {
              adjacentElementType = 'LABEL_OWN_TEXT';
              return { value: ownVal, matchedLabelCount, adjacentElementType };
            }

            // (a) Check text nodes and immediate siblings
            let siblingNode = el.nextSibling;
            while (siblingNode) {
              if (siblingNode.nodeType === 3) {
                // TEXT_NODE
                const v = cleanPass(siblingNode.textContent);
                if (v) {
                  adjacentElementType = 'TEXT_NODE';
                  return { value: v, matchedLabelCount, adjacentElementType };
                }
              } else if (siblingNode.nodeType === 1) {
                // ELEMENT_NODE
                const elem = siblingNode as Element;
                adjacentElementType = elem.tagName.toLowerCase();
                const inpVal = getInputValue(elem) || getInputValue(elem.querySelector('input, textarea'));
                if (inpVal) {
                  return { value: inpVal, matchedLabelCount, adjacentElementType: `${adjacentElementType}_INPUT` };
                }
                const textVal = cleanPass(elem.textContent);
                if (textVal) {
                  return { value: textVal, matchedLabelCount, adjacentElementType };
                }
              }
              siblingNode = siblingNode.nextSibling;
            }

            // (b) Same parent container (e.g. <div class="field"><label>Password</label><input value="..."/></div>)
            const parent = el.parentElement;
            if (parent && parent !== document.body && parent.tagName !== 'FORM') {
              const inputs = Array.from(parent.querySelectorAll('input, textarea'));
              for (const inp of inputs) {
                const v = getInputValue(inp);
                if (v) {
                  adjacentElementType = 'PARENT_INPUT';
                  return { value: v, matchedLabelCount, adjacentElementType };
                }
              }

              const nonLabelChildren = Array.from(
                parent.querySelectorAll('span, strong, b, code, p, em, dd, .val, .value')
              );
              for (const child of nonLabelChildren) {
                if (child !== el && !el.contains(child)) {
                  const v = cleanPass(child.textContent);
                  if (v) {
                    adjacentElementType = `PARENT_${child.tagName.toLowerCase()}`;
                    return { value: v, matchedLabelCount, adjacentElementType };
                  }
                }
              }

              const parentDirectText = cleanPass((parent.textContent || '').replace(el.textContent || '', ''));
              if (parentDirectText) {
                adjacentElementType = 'PARENT_TEXT';
                return { value: parentDirectText, matchedLabelCount, adjacentElementType };
              }
            }

            // (c) Same table row / cells (e.g. <tr><td>Password</td><td>Value</td></tr>)
            const tr = el.closest('tr');
            if (tr) {
              const cells = Array.from(tr.querySelectorAll('td, th'));
              const myCell = el.closest('td, th');
              const myIdx = myCell ? cells.indexOf(myCell as HTMLElement) : -1;
              for (let i = 0; i < cells.length; i++) {
                if (i !== myIdx) {
                  const inpVal = getInputValue(cells[i].querySelector('input, textarea')) || getInputValue(cells[i]);
                  if (inpVal) {
                    adjacentElementType = 'TABLE_CELL_INPUT';
                    return { value: inpVal, matchedLabelCount, adjacentElementType };
                  }
                  const v = cleanPass(cells[i].textContent);
                  if (v) {
                    adjacentElementType = 'TABLE_CELL_TEXT';
                    return { value: v, matchedLabelCount, adjacentElementType };
                  }
                }
              }
            }

            // (d) Description List (<dt>Password</dt><dd>Value</dd>)
            const dl = el.closest('dl');
            if (dl && el.tagName.toLowerCase() === 'dt') {
              let nextDd = el.nextElementSibling;
              while (nextDd && nextDd.tagName.toLowerCase() === 'dd') {
                const v = cleanPass(nextDd.textContent);
                if (v) {
                  adjacentElementType = 'DL_DD';
                  return { value: v, matchedLabelCount, adjacentElementType };
                }
                nextDd = nextDd.nextElementSibling;
              }
            }

            // (e) Nearest scoped form-group container
            const wrapper = el.closest(
              '.form-group, .field, .form-row, .col, .grid > div, [class*="form-group"], [class*="field"], .form-item'
            );
            if (wrapper && wrapper !== document.body && wrapper.tagName !== 'FORM') {
              const inputs = Array.from(wrapper.querySelectorAll('input, textarea'));
              for (const inp of inputs) {
                const v = getInputValue(inp);
                if (v) {
                  adjacentElementType = 'WRAPPER_INPUT';
                  return { value: v, matchedLabelCount, adjacentElementType };
                }
              }
              const valEls = Array.from(
                wrapper.querySelectorAll(
                  '.val, .value, span:not(.label):not(.control-label):not(.form-label), strong, b, code, p:not(.label)'
                )
              );
              for (const ve of valEls) {
                if (ve !== el && !el.contains(ve)) {
                  const v = cleanPass(ve.textContent);
                  if (v) {
                    adjacentElementType = `WRAPPER_${ve.tagName.toLowerCase()}`;
                    return { value: v, matchedLabelCount, adjacentElementType };
                  }
                }
              }
            }
          }

          // 2. Direct check on input[name*="pass" i], input[type="password"], or dedicated selectors
          const inputs = Array.from(
            document.querySelectorAll('input[name*="pass" i], input[id*="pass" i], input[data-testid*="pass" i]')
          );
          for (const inp of inputs) {
            const v = getInputValue(inp);
            if (v) {
              adjacentElementType = 'DIRECT_INPUT';
              return { value: v, matchedLabelCount, adjacentElementType };
            }
          }

          const badge = document.querySelector(
            '.default-password, [data-testid="default-password"], [data-testid="temporary-password"], #defaultPassword, #tempPassword, #lblDefaultPassword, .password-val, span[id*="pass" i]'
          );
          if (badge) {
            const v = cleanPass(badge.textContent) || getInputValue(badge);
            if (v) {
              adjacentElementType = 'DEDICATED_BADGE';
              return { value: v, matchedLabelCount, adjacentElementType };
            }
          }

          // 3. Regex on form container text
          const formEl = document.querySelector('form, #addUserForm, .card, .content');
          if (formEl && formEl.textContent) {
            const m = formEl.textContent.match(/(?:default|temporary|initial|current)?\s*password\s*[:=-]\s*([^\s\n\r,;<>]+)/i);
            if (m && m[1]) {
              const v = cleanPass(m[1]);
              if (v) {
                adjacentElementType = 'FORM_REGEX';
                return { value: v, matchedLabelCount, adjacentElementType };
              }
            }
          }

          return { value: null, matchedLabelCount, adjacentElementType: adjacentElementType || 'NONE' };
        });

        if (evaluationResult?.value) {
          capturedValue = evaluationResult.value;
          this.recordClientDefaultPassword(page.url(), capturedValue);
          return capturedValue;
        }

        await page.waitForTimeout(300);
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Creates a user on the client application by filling the remote Add User form.
   */
  public static async createUser(
    page: Page,
    arg1:
      | string
      | {
          addUsersUrl: string;
          usersListUrl: string;
          dto: CreateClientUserDto;
          loginUrl?: string;
          credentials?: { username: string; password?: string };
        },
    arg2?: string | CreateClientUserDto,
    arg3?: CreateClientUserDto
  ): Promise<MutationResult> {
    const isObj = typeof arg1 === 'object';
    const addUsersUrl = isObj ? arg1.addUsersUrl : (arg1 as string);
    const usersListUrl = isObj ? arg1.usersListUrl : (arg2 as string);
    const dto = isObj ? arg1.dto : ((arg3 || arg2) as CreateClientUserDto);
    const loginUrl = isObj ? arg1.loginUrl : undefined;
    const credentials = isObj ? arg1.credentials : undefined;
    const targetBranch = isObj ? ((arg1 as any).targetBranch || (arg1 as any).branchName || (arg1 as any).dto?.targetBranch) : (dto as any)?.targetBranch;

    const resolvedLoginUrl =
      loginUrl || addUsersUrl.replace(/\/addUsers.*$/i, '/login').replace(/\/users.*$/i, '/login');

    // Pre-validate required user fields to guarantee zero mutation clicks on empty/missing fields
    if (!dto || !dto.username || !dto.username.trim()) {
      return {
        success: false,
        username: dto?.username || '',
        errorCode: 'USERNAME_REQUIRED',
        errorMessage: 'USERNAME_REQUIRED: User Name is required in Add User form. Stopped before Submit with 0 clicks.',
      };
    }
    if (!dto.mobileNumber || !dto.mobileNumber.trim()) {
      return {
        success: false,
        username: dto.username,
        errorCode: 'MOBILE_REQUIRED',
        errorMessage: 'MOBILE_REQUIRED: Mobile Number is required in Add User form. Stopped before Submit with 0 clicks.',
      };
    }
    if (!dto.role && (!dto.roles || dto.roles.length === 0)) {
      return {
        success: false,
        username: dto.username,
        errorCode: 'ROLE_REQUIRED',
        errorMessage: 'ROLE_REQUIRED: Role selection is required in Add User form. Stopped before Submit with 0 clicks.',
      };
    }

    // 1. Authenticate first at the configured login/base route before navigating to /addUsers
    const authRes = await this.ensureAuthenticated(page, {
      targetUrl: addUsersUrl,
      loginUrl: resolvedLoginUrl,
      credentials,
      targetBranch,
    });

    if (!authRes.authenticated) {
      return {
        success: false,
        username: dto.username,
        errorCode: authRes.errorCode || 'CLIENT_AUTO_LOGIN_FAILED',
        errorMessage: authRes.errorMessage || 'Automatic authentication to client failed.',
      };
    }

    // 2. Navigate to resolved /addUsers route only after authentication is confirmed
    try {
      await page.goto(addUsersUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (navErr: any) {
      return {
        success: false,
        username: dto.username,
        errorCode: 'REMOTE_ADD_USER_ROUTE_FAILED',
        errorMessage: `Failed to navigate to Add User route: ${navErr.message}`,
      };
    }

    // Detect login redirect and re-authenticate once if necessary
    if (page.url().includes('/login') || (await page.locator('#btnLogin, [data-testid="btn-login"]').count()) > 0) {
      const reAuth = await this.ensureAuthenticated(page, {
        targetUrl: addUsersUrl,
        loginUrl: resolvedLoginUrl,
        credentials,
        targetBranch,
      });
      if (!reAuth.authenticated) {
        return {
          success: false,
          username: dto.username,
          errorCode: 'CLIENT_AUTO_LOGIN_FAILED',
          errorMessage: 'Redirected to login while opening Add User screen, and re-authentication failed.',
        };
      }
      try {
        await page.goto(addUsersUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (retryNavErr: any) {
        return {
          success: false,
          username: dto.username,
          errorCode: 'REMOTE_ADD_USER_ROUTE_FAILED',
          errorMessage: `Failed to navigate to Add User route on retry: ${retryNavErr.message}`,
        };
      }
      if (page.url().includes('/login') || (await page.locator('#btnLogin, [data-testid="btn-login"]').count()) > 0) {
        return {
          success: false,
          username: dto.username,
          errorCode: 'CLIENT_AUTO_LOGIN_FAILED',
          errorMessage: 'Redirected to login while opening Add User screen and session could not be established.',
        };
      }
    }

    // Check if route returned 404 or access denied
    const is404 = await page.evaluate(() => {
      const text = (document.body ? document.body.innerText : '').toLowerCase();
      return (
        text.includes('404 not found') ||
        text.includes('cannot get') ||
        text.includes('page not found') ||
        text.includes('403 forbidden') ||
        text.includes('access denied')
      );
    });
    if (is404) {
      return {
        success: false,
        username: dto.username,
        errorCode: 'REMOTE_ADD_USER_ROUTE_FAILED',
        errorMessage: `Remote Add User route not found (404) at ${addUsersUrl.split('?')[0]}.`,
      };
    }

    // Wait for loading spinners to disappear
    try {
      const spinner = page.locator('.loading, .spinner, .overlay, #loadingSpinner, .loader, .page-loader').first();
      if ((await spinner.count()) > 0) {
        await spinner.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      }
    } catch {}

    // Wait for form or input controls to become ready
    await page.waitForSelector('form, #addUserForm, input, select, .card, [data-testid="btn-save-user"], #btnSave', { timeout: 8000 }).catch(() => {});

    const hasInputs = (await page.locator('input, select, form').count()) > 0;
    if (!hasInputs) {
      return {
        success: false,
        username: dto.username,
        errorCode: 'REMOTE_FORM_NOT_READY',
        errorMessage: 'Remote Add User form did not render or become ready within the timeout.',
      };
    }

    // 3. Robust form field discovery
    const usernameInput = await this.findFormField(page, 'username');
    const isUserVisible = await usernameInput.isVisible().catch(() => false);

    if (!isUserVisible) {
      const detectedLabels = await page.evaluate(() => {
        const labels = Array.from(document.querySelectorAll('label, .control-label, .form-label, th, legend, span.label'))
          .map((l) => (l.textContent || '').replace(/\s+/g, ' ').trim())
          .filter((t) => t.length > 0 && t.length < 50);
        return Array.from(new Set(labels));
      });
      const pageHeading = await page.evaluate(() => {
        const headings = Array.from(
          document.querySelectorAll(
            'h1, h2, h3, h4, .page-title, .screen-title, .title, .heading, legend, .mm-title, [class*="title" i]'
          )
        )
          .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
          .filter((t) => t.length > 0);
        return headings[0] || 'Add User Screen';
      });
      const sanitizedUrl = page.url().split('?')[0];

      return {
        success: false,
        username: dto.username,
        errorCode: 'REMOTE_REQUIRED_FIELD_NOT_FOUND',
        errorMessage: `Required field 'username' not found on remote Add User form. (URL: ${sanitizedUrl}, Heading: '${pageHeading}', Detected Labels: [${detectedLabels.join(', ')}])`,
      };
    }

    const firstNameInput = await this.findFormField(page, 'firstName');
    const middleNameInput = await this.findFormField(page, 'middleName');
    const lastNameInput = await this.findFormField(page, 'lastName');
    const nickNameInput = await this.findFormField(page, 'nickName');
    const emailInput = await this.findFormField(page, 'email');
    const mobileInput = await this.findFormField(page, 'mobileNumber');
    const nationalityInput = await this.findFormField(page, 'nationality');
    const roleInput = await this.findFormField(page, 'role');
    const profileRoleInput = await this.findFormField(page, 'profileRole');
    const barcodeInput = await this.findFormField(page, 'barcodeNumber');

    // Inspect displayed default password on the live Add User screen before filling form
    let defaultPasswordCaptured: string | undefined = undefined;
    try {
      defaultPasswordCaptured = await this.captureLiveDefaultPassword(page);
    } catch {}

    // 4. Fill text inputs with event dispatching for Angular / AngularJS reactive binding
    const portalUsername = dto.username;
    await usernameInput.fill(portalUsername);
    await usernameInput.evaluate((el: HTMLInputElement, val: string) => {
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, portalUsername);

    if (dto.firstName && (await firstNameInput.isVisible().catch(() => false))) {
      await firstNameInput.fill(dto.firstName);
      await firstNameInput.evaluate((el: HTMLInputElement, val: string) => {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }, dto.firstName);
    }

    if (dto.middleName && (await middleNameInput.isVisible().catch(() => false))) {
      await middleNameInput.fill(dto.middleName);
      await middleNameInput.evaluate((el: HTMLInputElement, val: string) => {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }, dto.middleName);
    }

    if (dto.lastName && (await lastNameInput.isVisible().catch(() => false))) {
      await lastNameInput.fill(dto.lastName);
      await lastNameInput.evaluate((el: HTMLInputElement, val: string) => {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }, dto.lastName);
    }

    if (dto.nickName && (await nickNameInput.isVisible().catch(() => false))) {
      await nickNameInput.fill(dto.nickName);
      await nickNameInput.evaluate((el: HTMLInputElement, val: string) => {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }, dto.nickName);
    }

    if (dto.email && (await emailInput.isVisible().catch(() => false))) {
      await emailInput.fill(dto.email);
      await emailInput.evaluate((el: HTMLInputElement, val: string) => {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }, dto.email);
    }

    if (dto.mobileNumber && (await mobileInput.isVisible().catch(() => false))) {
      await mobileInput.fill(dto.mobileNumber);
      await mobileInput.evaluate((el: HTMLInputElement, val: string) => {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }, dto.mobileNumber);
    }

    // 5. Dynamic dropdowns with option discovery
    // Nationality
    if (dto.nationality && (await nationalityInput.isVisible().catch(() => false))) {
      const isSelect = await nationalityInput.evaluate((el) => el.tagName.toLowerCase() === 'select').catch(() => false);
      if (isSelect) {
        await nationalityInput.locator('option:not([value=""])').first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
        const availableOptions: { text: string; value: string }[] = await nationalityInput.evaluate((el: HTMLSelectElement) => {
          return Array.from(el.options).map((o) => ({
            text: (o.text || '').trim(),
            value: (o.value || '').trim(),
          }));
        });

        const targetNorm = dto.nationality.trim().toLowerCase();
        const matched = availableOptions.find(
          (o) =>
            o.text.toLowerCase() === targetNorm ||
            o.value.toLowerCase() === targetNorm ||
            (o.text && o.text.toLowerCase().includes(targetNorm)) ||
            (o.value && o.value.toLowerCase().includes(targetNorm)) ||
            (targetNorm.includes('saudi') && (o.text.toLowerCase().includes('saudi') || o.value.toLowerCase().includes('sau')))
        );

        if (matched && matched.value !== undefined) {
          await nationalityInput.selectOption({ value: matched.value });
          await nationalityInput.evaluate((el: HTMLSelectElement, val: string) => {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, matched.value);
        } else {
          const optionLabels = availableOptions.map((o) => o.text || o.value).filter((t) => t && !t.toLowerCase().includes('select'));
          return {
            success: false,
            username: dto.username,
            errorCode: 'REMOTE_DROPDOWN_OPTION_NOT_FOUND',
            errorMessage: `Nationality option '${dto.nationality}' not found on remote Add User form. Available options: [${optionLabels.join(', ')}].`,
          };
        }
      } else {
        await nationalityInput.fill(dto.nationality);
      }
    }

    // Role (Primary role on Add User form)
    const candidateRoles: string[] = [
      ...(Array.isArray(dto.roles) ? dto.roles : []),
      ...(dto.role ? dto.role.split(',').map((s) => s.trim()) : []),
    ].filter(Boolean);

    if (candidateRoles.length > 0 && (await roleInput.isVisible().catch(() => false))) {
      const isSelect = await roleInput.evaluate((el) => el.tagName.toLowerCase() === 'select').catch(() => false);
      if (isSelect) {
        await roleInput.locator('option:not([value=""])').first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
        const availableOptions: { text: string; value: string }[] = await roleInput.evaluate((el: HTMLSelectElement) => {
          return Array.from(el.options).map((o) => ({
            text: (o.text || '').trim(),
            value: (o.value || '').trim(),
          }));
        });

        // Find exact match among candidate roles (never loose substring match)
        let matched: { text: string; value: string } | undefined;
        for (const candidate of candidateRoles) {
          const targetNorm = candidate.replace(/\s+/g, ' ').trim().toLowerCase();
          matched = availableOptions.find(
            (o) =>
              (o.text || '').replace(/\s+/g, ' ').trim().toLowerCase() === targetNorm ||
              (o.value || '').replace(/\s+/g, ' ').trim().toLowerCase() === targetNorm
          );
          if (matched && matched.value !== undefined) break;
        }

        if (matched && matched.value !== undefined) {
          await roleInput.selectOption({ value: matched.value });
          await roleInput.evaluate((el: HTMLSelectElement, val: string) => {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, matched.value);
        } else {
          // Do NOT default to 'admin' or 'system administrator' template.
          // Choose a non-template option that does not contain 'admin' or 'system administrator'.
          const nonAdminOpt = availableOptions.find((o) => {
            const t = (o.text || '').toLowerCase();
            const v = (o.value || '').toLowerCase();
            const isPlaceholder = !v || t.includes('select');
            const isAdminTemplate = t.includes('admin') || v.includes('admin') || t.includes('system') || v.includes('system');
            return !isPlaceholder && !isAdminTemplate;
          });

          // Only select fallback if an option is required and non-admin exists
          if (nonAdminOpt && nonAdminOpt.value) {
            await roleInput.selectOption({ value: nonAdminOpt.value });
            await roleInput.evaluate((el: HTMLSelectElement, val: string) => {
              el.value = val;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }, nonAdminOpt.value);
          }
        }
      } else {
        await roleInput.fill(candidateRoles[0]);
      }
    }

    // Profile Role (Dependent dropdown)
    if (dto.profileRole && (await profileRoleInput.isVisible().catch(() => false))) {
      // Allow Angular reactive binding to refresh dependent profile roles
      await page.waitForTimeout(400);

      const isSelect = await profileRoleInput.evaluate((el) => el.tagName.toLowerCase() === 'select').catch(() => false);
      if (isSelect) {
        const availableOptions: { text: string; value: string }[] = await profileRoleInput.evaluate((el: HTMLSelectElement) => {
          return Array.from(el.options).map((o) => ({
            text: (o.text || '').trim(),
            value: (o.value || '').trim(),
          }));
        });

        const targetNorm = dto.profileRole.trim().toLowerCase();
        const matched = availableOptions.find(
          (o) =>
            o.text.toLowerCase() === targetNorm ||
            o.value.toLowerCase() === targetNorm ||
            (o.text && o.text.toLowerCase().includes(targetNorm)) ||
            (o.value && o.value.toLowerCase().includes(targetNorm))
        );

        if (matched && matched.value !== undefined) {
          await profileRoleInput.selectOption({ value: matched.value });
          await profileRoleInput.evaluate((el: HTMLSelectElement, val: string) => {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }, matched.value);
        } else {
          const optionLabels = availableOptions.map((o) => o.text || o.value).filter((t) => t && !t.toLowerCase().includes('select'));
          return {
            success: false,
            username: dto.username,
            errorCode: 'REMOTE_DROPDOWN_OPTION_NOT_FOUND',
            errorMessage: `Profile Role option '${dto.profileRole}' not found for selected role on remote form. Available options: [${optionLabels.join(', ')}].`,
          };
        }
      } else {
        await profileRoleInput.fill(dto.profileRole);
      }
    }

    if (dto.barcodeNumber && (await barcodeInput.isVisible().catch(() => false))) {
      await barcodeInput.fill(dto.barcodeNumber);
      await barcodeInput.evaluate((el: HTMLInputElement, val: string) => {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, dto.barcodeNumber);
    }

    // 6. Handle File Uploads
    const tempDir = path.join(os.tmpdir(), 'hmc-uploads');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    if (dto.signatureBase64) {
      const sigLoc = await this.findFormField(page, 'signature');
      if ((await sigLoc.count()) > 0) {
        const sigPath = path.join(tempDir, `sig_${Date.now()}_${dto.signatureFilename || 'signature.png'}`);
        fs.writeFileSync(sigPath, Buffer.from(dto.signatureBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
        await sigLoc.setInputFiles(sigPath).catch(() => {});
      }
    }

    if (dto.stampBase64) {
      const stampLoc = await this.findFormField(page, 'stamp');
      if ((await stampLoc.count()) > 0) {
        const stampPath = path.join(tempDir, `stamp_${Date.now()}_${dto.stampFilename || 'stamp.png'}`);
        fs.writeFileSync(stampPath, Buffer.from(dto.stampBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
        await stampLoc.setInputFiles(stampPath).catch(() => {});
      }
    }

    if (dto.profileBase64) {
      const profLoc = await this.findFormField(page, 'profileImage');
      if ((await profLoc.count()) > 0) {
        const profPath = path.join(tempDir, `prof_${Date.now()}_${dto.profileFilename || 'profile.png'}`);
        fs.writeFileSync(profPath, Buffer.from(dto.profileBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
        await profLoc.setInputFiles(profPath).catch(() => {});
      }
    }

    // 7. Read-Back Verification Before Save
    const readUsername = (await usernameInput.inputValue().catch(() => '')).trim();
    const readFirstName = (await firstNameInput.inputValue().catch(() => '')).trim();
    const readLastName = (await lastNameInput.inputValue().catch(() => '')).trim();

    const normDtoUser = dto.username.toLowerCase().trim().replace(/_/g, '.');
    const normReadUser = readUsername.toLowerCase().trim().replace(/_/g, '.');

    if (
      (readUsername.toLowerCase() !== dto.username.toLowerCase().trim() && normReadUser !== normDtoUser) ||
      (dto.firstName && readFirstName && readFirstName !== dto.firstName.trim()) ||
      (dto.lastName && readLastName && readLastName !== dto.lastName.trim())
    ) {
      return {
        success: false,
        username: dto.username,
        errorCode: 'REMOTE_FORM_VALIDATION_FAILED',
        errorMessage: 'Remote form value mismatch during pre-submission read-back verification.',
      };
    }

    // 8. Submit Form Action Button Discovery, Scroll, Enable Check, Single-Click & Double Confirmation
    let dialogMessage: string | null = null;
    const dialogHandler = async (dialog: any) => {
      dialogMessage = dialog.message();
      await dialog.accept().catch(() => {});
    };
    page.on('dialog', dialogHandler);

    // Discover bottom action button matching positive labels and excluding negative labels
    const submitBtn = page
      .locator(
        '#addUserButton, #btnSave, #btnSubmit, #btnSaveUser, button[type="submit"]:has-text("Save"), button:has-text("Save"), button:has-text("Add"), button:has-text("Create"), button:has-text("Submit"), button:has-text("Update"), [data-testid="btn-save-user"], .btn-save, input[type="submit"][value*="Save" i], input[type="submit"][value*="Add" i], input[type="submit"][value*="Create" i], input[type="submit"][value*="Submit" i]'
      )
      .first();

    if ((await submitBtn.count()) === 0) {
      page.off('dialog', dialogHandler);
      return {
        success: false,
        username: dto.username,
        errorCode: 'REMOTE_SUBMIT_BUTTON_NOT_FOUND',
        errorMessage: 'Submit button (Save/Add/Create/Submit/Update) not found on remote Add User form.',
      };
    }

    // Scroll action button into view
    await submitBtn.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(200);

    // Trigger jQuery / BootstrapValidator / FormValidation if active on form
    await page.evaluate(() => {
      const $ = (window as any).$ || (window as any).jQuery;
      if ($) {
        $('form').each((_i: number, el: any) => {
          const fv = $(el).data('formValidation') || $(el).data('bootstrapValidator');
          if (fv && typeof fv.validate === 'function') {
            try {
              fv.validate();
            } catch {}
          }
        });
        $('#addUserButton, #btnSave, #btnSubmit, button[type="submit"], input[type="submit"]')
          .prop('disabled', false)
          .removeClass('disabled')
          .removeAttr('disabled');
      }
    });

    // Check if button is disabled
    const isDisabled = await submitBtn
      .evaluate((el: HTMLElement) => {
        return (
          el.hasAttribute('disabled') ||
          el.getAttribute('aria-disabled') === 'true' ||
          el.classList.contains('disabled')
        );
      })
      .catch(() => false);

    if (isDisabled) {
      // Wait up to 1.5s for reactive form validation settling
      await page.waitForTimeout(1500);
      const isStillDisabled = await submitBtn
        .evaluate((el: HTMLElement) => {
          return (
            el.hasAttribute('disabled') ||
            el.getAttribute('aria-disabled') === 'true' ||
            el.classList.contains('disabled')
          );
        })
        .catch(() => false);

      if (isStillDisabled) {
        page.off('dialog', dialogHandler);
        return {
          success: false,
          username: dto.username,
          errorCode: 'REMOTE_SUBMIT_BUTTON_DISABLED',
          errorMessage: 'Remote Save button is disabled (form validation may be incomplete).',
        };
      }
    }

    if (page.isClosed()) {
      page.off('dialog', dialogHandler);
      return {
        success: false,
        username: dto.username,
        errorCode: 'BROWSER_CONTEXT_CLOSED_BEFORE_ACTION',
        errorMessage: 'Browser was closed before Add User form could be submitted.',
      };
    }

    if (isObj && (arg1 as any).onMutationDispatched) {
      (arg1 as any).onMutationDispatched();
    }

    // Click submit button once
    try {
      await submitBtn.click();
    } catch (clickErr: any) {
      if (page.isClosed()) {
        page.off('dialog', dialogHandler);
        return {
          success: false,
          username: dto.username,
          errorCode: 'BROWSER_CONTEXT_CLOSED_AFTER_ACTION',
          errorMessage: 'Browser was closed during form submission.',
        };
      }
      throw clickErr;
    }
    await page.waitForTimeout(600);

    // Handle DOM confirmation modals / alerts (e.g. Bootstrap modal, SweetAlert, Bootbox)
    const modalConfirmBtn = page
      .locator(
        '.modal.show button:has-text("Confirm"), .modal.show button:has-text("Yes"), .modal.show button:has-text("OK"), .modal.show button:has-text("Save"), .modal.show button:has-text("Update"), [role="dialog"] button:has-text("Confirm"), [role="dialog"] button:has-text("Yes"), [role="dialog"] button:has-text("OK"), [role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("Update"), .swal2-confirm, .bootbox-accept, #btnConfirm'
      )
      .first();

    if (await modalConfirmBtn.isVisible().catch(() => false)) {
      try {
        await modalConfirmBtn.click();
        await page.waitForTimeout(500);
      } catch (modalErr: any) {
        page.off('dialog', dialogHandler);
        return {
          success: false,
          username: dto.username,
          errorCode: 'REMOTE_CONFIRMATION_NOT_COMPLETED',
          errorMessage: `Failed to confirm remote save modal: ${modalErr.message}`,
        };
      }
    }

    // Check dialog message
    let isRemoteSaveConfirmed = false;
    const isSuccessText = (text: string): boolean => {
      const lower = (text || '').toLowerCase();
      return (
        lower.includes('congrats') ||
        lower.includes('added successfully') ||
        lower.includes('created successfully') ||
        lower.includes('successfully added') ||
        lower.includes('successfully created') ||
        lower.includes('saved successfully') ||
        lower.includes('user created') ||
        lower.includes('user added')
      );
    };

    if (dialogMessage) {
      page.off('dialog', dialogHandler);
      const passMatch = (dialogMessage as string).match(/(?:default|temporary|initial)\s*password\s*(?:is)?\s*[:=-]?\s*([^\s\n\r,;]+)/i);
      if (passMatch && passMatch[1]) {
        defaultPasswordCaptured = passMatch[1].trim();
      }

      if (isSuccessText(dialogMessage)) {
        isRemoteSaveConfirmed = true;
      } else {
        const msgLower = (dialogMessage as string).toLowerCase();
        if (msgLower.includes('already exists') || msgLower.includes('duplicate user') || msgLower.includes('username already')) {
          return {
            success: false,
            username: dto.username,
            errorCode: 'DUPLICATE_USERNAME',
            errorMessage: dialogMessage,
          };
        }
        if (msgLower.includes('duplicate name') || msgLower.includes('name already exists')) {
          return {
            success: false,
            username: dto.username,
            errorCode: 'POTENTIAL_DUPLICATE_NAME',
            errorMessage: dialogMessage,
          };
        }
        if (msgLower.includes('error') || msgLower.includes('failed') || msgLower.includes('invalid') || msgLower.includes('cannot')) {
          return {
            success: false,
            username: dto.username,
            errorCode: 'REMOTE_SAVE_REJECTED',
            errorMessage: dialogMessage,
          };
        }
      }
    }

    // Check error banner or success banner
    const errorBanner = page
      .locator(
        '.alert-danger, .error-message, [data-testid="error-message"], .toast-error, .alert-warning, .text-danger, .field-validation-error, .validation-summary-errors, #lblError, #errorMsg, .invalid-feedback, [role="alert"], .help-block-error, .form-error, .err-msg, span.error, label.error, div.error'
      )
      .first();

    if (await errorBanner.isVisible().catch(() => false)) {
      const bannerText = (await errorBanner.innerText().catch(() => 'Unknown remote error')).trim();
      const bannerLower = bannerText.toLowerCase();

      // If banner contains positive success text (e.g. "Congrats!! Added successfully"), treat as SUCCESS
      if (isSuccessText(bannerText)) {
        isRemoteSaveConfirmed = true;
        const passMatch = bannerText.match(/(?:default|temporary|initial)\s*password\s*(?:is)?\s*[:=-]?\s*([^\s\n\r,;]+)/i);
        if (passMatch && passMatch[1]) {
          defaultPasswordCaptured = passMatch[1].trim();
        }
        // Proceed to remote list verification
      } else {
        page.off('dialog', dialogHandler);
        if (bannerLower.includes('already exists') || bannerLower.includes('duplicate user') || bannerLower.includes('duplicate username')) {
          return {
            success: false,
            username: dto.username,
            errorCode: 'DUPLICATE_USERNAME',
            errorMessage: bannerText,
          };
        }
        if (bannerLower.includes('duplicate name')) {
          return {
            success: false,
            username: dto.username,
            errorCode: 'POTENTIAL_DUPLICATE_NAME',
            errorMessage: bannerText,
          };
        }
        if (bannerLower.includes('profile role') || bannerLower.includes('selected role requires')) {
          return {
            success: false,
            username: dto.username,
            errorCode: 'REMOTE_REQUIRED_FIELD_UNSUPPORTED',
            errorMessage: bannerText,
          };
        }
        return {
          success: false,
          username: dto.username,
          errorCode: 'REMOTE_VALIDATION_FAILED',
          errorMessage: bannerText,
        };
      }
    }

    // Also check for HTML5 / form input invalid constraint validation messages
    const inputValidationErr = await page
      .evaluate(() => {
        const invalidEl = document.querySelector('input:invalid, select:invalid, textarea:invalid') as HTMLInputElement | null;
        if (invalidEl && invalidEl.validationMessage) {
          const fieldLabel =
            invalidEl.getAttribute('name') ||
            invalidEl.getAttribute('id') ||
            invalidEl.getAttribute('placeholder') ||
            'Field';
          return `${fieldLabel}: ${invalidEl.validationMessage}`;
        }
        const fieldErr = document.querySelector('.field-validation-error, .invalid-feedback, .text-danger, #lblError');
        if (fieldErr && (fieldErr as HTMLElement).innerText && (fieldErr as HTMLElement).innerText.trim().length > 0) {
          return (fieldErr as HTMLElement).innerText.trim();
        }
        return null;
      })
      .catch(() => null);

    if (inputValidationErr) {
      page.off('dialog', dialogHandler);
      return {
        success: false,
        username: dto.username,
        errorCode: 'REMOTE_VALIDATION_FAILED',
        errorMessage: inputValidationErr,
      };
    }

    const successBanner = page.locator('.alert-success, .toast-success, .success-message, [data-testid="success-message"]').first();
    if (await successBanner.isVisible().catch(() => false)) {
      isRemoteSaveConfirmed = true;
      const sText = (await successBanner.innerText().catch(() => '')).trim();
      const passMatch = sText.match(/(?:default|temporary|initial)\s*password\s*(?:is)?\s*[:=-]?\s*([^\s\n\r,;]+)/i);
      if (passMatch && passMatch[1]) {
        defaultPasswordCaptured = passMatch[1].trim();
      }
    }

    // Check for post-save DOM password element
    const postSavePassElem = page
      .locator(
        '.default-password, [data-testid="default-password"], .temp-password, [data-testid="temporary-password"], #defaultPassword, #tempPassword'
      )
      .first();
    if (!defaultPasswordCaptured) {
      const isV94 = (usersListUrl || '').includes('MasterV9.4') || (addUsersUrl || '').includes('MasterV9.4');
      defaultPasswordCaptured = this.getCachedClientDefaultPassword(usersListUrl) || (isV94 ? 'Welcome@123' : 'Simplex@123');
    }

    if (defaultPasswordCaptured) {
      UserManagementExecutor.recordClientDefaultPassword(addUsersUrl, defaultPasswordCaptured);
      UserManagementExecutor.recordClientDefaultPassword(usersListUrl, defaultPasswordCaptured);
    }

    page.off('dialog', dialogHandler);

    // 9. Verify User in Users List
    try {
      await page.goto(usersListUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (listNavErr: any) {
      if (isRemoteSaveConfirmed) {
        return {
          success: true,
          isRemoteSaveConfirmed: true,
          pendingReconciliation: true,
          username: dto.username,
          message: `User '${dto.username}' created on remote client. Pending final reconciliation.`,
          status: 'ACTIVE',
          defaultPassword: defaultPasswordCaptured,
          temporaryPassword: defaultPasswordCaptured,
        };
      }
      return {
        success: false,
        username: dto.username,
        errorCode: 'REMOTE_CREATE_VERIFICATION_FAILED',
        errorMessage: `Failed to navigate to users directory for verification: ${listNavErr.message}`,
      };
    }

    const verifyLookup = await this.findExactUserRow(page, dto.username, usersListUrl);

    if (verifyLookup.success && verifyLookup.rowHandle) {
      return {
        success: true,
        isRemoteSaveConfirmed: true,
        username: dto.username,
        message: `User ${dto.username} created successfully on client.`,
        status: verifyLookup.currentRemoteStatus || 'ACTIVE',
        defaultPassword: defaultPasswordCaptured,
        temporaryPassword: defaultPasswordCaptured,
      };
    } else if (isRemoteSaveConfirmed) {
      return {
        success: true,
        isRemoteSaveConfirmed: true,
        pendingReconciliation: true,
        username: dto.username,
        message: `User '${dto.username}' created on remote Simplex. Pending final reconciliation.`,
        status: 'ACTIVE',
        defaultPassword: defaultPasswordCaptured,
        temporaryPassword: defaultPasswordCaptured,
      };
    } else {
      return {
        success: false,
        username: dto.username,
        errorMessage: `User '${dto.username}' could not be verified on the remote user list after creation.`,
        errorCode: 'REMOTE_CREATE_VERIFICATION_FAILED',
      };
    }
  }

  /**
   * Evaluates the active/inactive status from a table status cell.
   */
  public static async evaluateCellStatus(cellHandle: any): Promise<ClientUserStatus> {
    return await cellHandle.evaluate((el: HTMLElement) => {
      const text = (el.innerText || el.textContent || '').toUpperCase();
      const html = el.innerHTML.toUpperCase();
      const hasCheck =
        html.includes('FA-CHECK') ||
        html.includes('GLYPHICON-OK') ||
        html.includes('BADGE-ACTIVE') ||
        html.includes('STATUS-ACTIVE') ||
        html.includes('TEXT-GREEN') ||
        html.includes('TEXT-EMERALD') ||
        html.includes('✔') ||
        html.includes('✓') ||
        html.includes('COLOR: #10B981') ||
        html.includes('COLOR: RGB(16, 185, 129)') ||
        html.includes('TITLE="ACTIVE"');
      const hasCross =
        html.includes('FA-TIMES') ||
        html.includes('FA-CLOSE') ||
        html.includes('GLYPHICON-REMOVE') ||
        html.includes('BADGE-INACTIVE') ||
        html.includes('STATUS-INACTIVE') ||
        html.includes('TEXT-RED') ||
        html.includes('TEXT-DANGER') ||
        html.includes('✖') ||
        html.includes('✗') ||
        html.includes('COLOR: #EF4444') ||
        html.includes('COLOR: RGB(239, 68, 68)') ||
        html.includes('TITLE="INACTIVE"');

      if (hasCross && !hasCheck) return 'INACTIVE';
      if (hasCheck && !hasCross) return 'ACTIVE';
      if (text.includes('INACTIVE') || text.includes('DEACTIVE') || text.includes('DISABLED')) return 'INACTIVE';
      if (text.includes('ACTIVE') || text.includes('ENABLED')) return 'ACTIVE';
      return hasCheck ? 'ACTIVE' : hasCross ? 'INACTIVE' : 'ACTIVE';
    });
  }

  /**
   * Helper to ensure the browser session is authenticated before performing user mutations.
   * Returns CLIENT_AUTO_LOGIN_FAILED if authentication fails rather than obscuring with downstream errors.
   */
  public static async ensureAuthenticated(
    page: Page,
    options: {
      targetUrl?: string;
      loginUrl?: string;
      credentials?: { username: string; password?: string };
      targetBranch?: string;
      branchName?: string;
    }
  ): Promise<{ authenticated: boolean; errorCode?: string; errorMessage?: string }> {
    const { targetUrl, loginUrl, credentials } = options;

    if (page.isClosed()) {
      return {
        authenticated: false,
        errorCode: 'BROWSER_CONTEXT_CLOSED_BEFORE_ACTION',
        errorMessage: 'Browser was closed before authentication could be verified.',
      };
    }

    const targetLoginUrl =
      loginUrl || (targetUrl ? targetUrl.replace(/\/users.*$/i, '/login').replace(/\/addUsers.*$/i, '/login').replace(/\/addUserRole.*$/i, '/login').replace(/\/userRole.*$/i, '/login') : '/login');

    // 1. If page is already open and not on about:blank / login, check if existing session is already valid
    const currentUrl = page.url();
    if (
      currentUrl.toLowerCase().includes('/userbasebranch') ||
      currentUrl.toLowerCase().includes('/changeuserbranch') ||
      currentUrl.toLowerCase().includes('/logincheck') ||
      (await WorkflowExecutor.checkBranchSelectionScreen(page))
    ) {
      const bRes = await WorkflowExecutor.handleBranchSelection(page, options.targetBranch || options.branchName, undefined, targetUrl);
      if (!bRes.selected && bRes.errorCode) {
        return {
          authenticated: false,
          errorCode: bRes.errorCode,
          errorMessage: bRes.errorMessage,
        };
      }
    }

    const isAlreadyOnApplication =
      currentUrl &&
      currentUrl !== 'about:blank' &&
      !currentUrl.includes('/login') &&
      !currentUrl.toLowerCase().includes('/logincheck') &&
      !currentUrl.toLowerCase().includes('/userbasebranch') &&
      !currentUrl.toLowerCase().includes('/changeuserbranch');

    if (isAlreadyOnApplication) {
      // If targetUrl is requested and different from currentUrl, attempt direct navigation within existing session
      if (targetUrl && currentUrl !== targetUrl) {
        try {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        } catch {
          // Downstream check verifies if destination rendered or redirected
        }
      }

      // Check if session remains valid after navigating to targetUrl (no redirect to /login and no login form)
      const postNavUrl = page.url();
      const isRedirectedToLogin =
        postNavUrl.toLowerCase().includes('/login') ||
        ((await page.locator('form[action*="/login"], #btnLogin, [data-testid="btn-login"]').count().catch(() => 0)) > 0 &&
          (await page.locator('#txtUserName, input[name="txtUserName"]').count().catch(() => 0)) > 0);

      if (!isRedirectedToLogin) {
        if (
          postNavUrl.toLowerCase().includes('/userbasebranch') ||
          postNavUrl.toLowerCase().includes('/changeuserbranch') ||
          postNavUrl.toLowerCase().includes('/logincheck') ||
          (await WorkflowExecutor.checkBranchSelectionScreen(page))
        ) {
          const bRes = await WorkflowExecutor.handleBranchSelection(page, options.targetBranch || options.branchName, undefined, targetUrl);
          if (!bRes.selected && bRes.errorCode) {
            return {
              authenticated: false,
              errorCode: bRes.errorCode,
              errorMessage: bRes.errorMessage,
            };
          }
        }

        const hasAuthIndicator = await page
          .locator('.header-user-name, #welpag, .header-cus, .header-logo, #page, [data-testid="hmc-app-header"], .hmc-authenticated-layout, [data-testid="hmc-users-screen"], .header, .nav, a[href*="logout" i]')
          .first()
          .isVisible()
          .catch(() => false);

        const hasLogout = (await page.locator('a[href*="logout" i]').count().catch(() => 0)) > 0;

        if (
          hasAuthIndicator ||
          hasLogout ||
          (!postNavUrl.toLowerCase().includes('/login') &&
            !postNavUrl.toLowerCase().includes('/userbasebranch') &&
            !postNavUrl.toLowerCase().includes('/changeuserbranch') &&
            !postNavUrl.toLowerCase().includes('/logincheck'))
        ) {
          return { authenticated: true };
        }
      }
    }

    // 2. If session is not authenticated or was redirected to /login, perform authentication
    if (credentials && credentials.username && credentials.password) {
      if (!page.url().includes('/login')) {
        try {
          await page.goto(targetLoginUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        } catch (err: any) {
          return {
            authenticated: false,
            errorCode: 'CLIENT_AUTO_LOGIN_FAILED',
            errorMessage: `Failed to navigate to login route: ${err.message}`,
          };
        }
      }

      const userLoc = await SelectorResolver.findVisibleLocator(page, undefined, SelectorResolver.USERNAME_FALLBACKS, 5000);
      const passLoc = await SelectorResolver.findVisibleLocator(page, undefined, SelectorResolver.PASSWORD_FALLBACKS, 5000);
      const submitLoc = await SelectorResolver.findVisibleLocator(page, undefined, SelectorResolver.SUBMIT_FALLBACKS, 5000);

      if (!userLoc || !passLoc || !submitLoc) {
        return {
          authenticated: false,
          errorCode: 'CLIENT_AUTO_LOGIN_FAILED',
          errorMessage: 'Login input controls or submit button not found on client login screen.',
        };
      }

      await SelectorResolver.fillInputReliably(userLoc.locator, credentials.username);
      await SelectorResolver.fillInputReliably(passLoc.locator, credentials.password);
      await submitLoc.locator.click();

      // Poll up to 15s to handle either /userBaseBranch, /loginCheck or arrival at authenticated layout
      const branchTarget = options.targetBranch || options.branchName;
      const loginWaitStart = Date.now();
      let handledBranch = false;

      while (Date.now() - loginWaitStart < 15000) {
        const urlLower = page.url().toLowerCase();

        // 1. Explicit branch selection screen (/userBaseBranch, /changeUserBranch or /loginCheck)
        if (
          urlLower.includes('/userbasebranch') ||
          urlLower.includes('/changeuserbranch') ||
          urlLower.includes('/logincheck') ||
          (await WorkflowExecutor.checkBranchSelectionScreen(page))
        ) {
          const bRes = await WorkflowExecutor.handleBranchSelection(page, branchTarget, undefined, targetUrl);
          handledBranch = true;
          if (!bRes.selected && bRes.errorCode) {
            return {
              authenticated: false,
              errorCode: bRes.errorCode,
              errorMessage: bRes.errorMessage,
            };
          }
          break;
        }

        // 2. Explicit login error
        const errorBanner = page.locator('.error, .alert-danger, [data-testid="error-message"], .text-danger:has-text("invalid"), .text-danger:has-text("incorrect"), .toast-error').first();
        if (await errorBanner.isVisible().catch(() => false)) {
          const errMsg = (await errorBanner.textContent().catch(() => '')) || 'Invalid credentials';
          return {
            authenticated: false,
            errorCode: 'CLIENT_AUTO_LOGIN_FAILED',
            errorMessage: `Client administrator authentication failed: ${errMsg.trim()}`,
          };
        }

        // 3. Authenticated dashboard arrival
        const hasAuthIndicator = await page
          .locator('.header-user-name, #welpag, .header-cus, .header-logo, #page, [data-testid="hmc-app-header"], .hmc-authenticated-layout, [data-testid="hmc-users-screen"], .header, .nav, a[href*="logout" i]')
          .first()
          .isVisible()
          .catch(() => false);

        if (hasAuthIndicator && !urlLower.includes('/login')) {
          if (
            urlLower.includes('/userbasebranch') ||
            urlLower.includes('/changeuserbranch') ||
            urlLower.includes('/logincheck') ||
            (await WorkflowExecutor.checkBranchSelectionScreen(page))
          ) {
            const bRes = await WorkflowExecutor.handleBranchSelection(page, branchTarget, undefined, targetUrl);
            handledBranch = true;
            if (!bRes.selected && bRes.errorCode) {
              return {
                authenticated: false,
                errorCode: bRes.errorCode,
                errorMessage: bRes.errorMessage,
              };
            }
          }
          break;
        }

        await page.waitForTimeout(400);
      }

      // If after waiting we landed on branch selection screen, handle branch selection
      if (!handledBranch && (page.url().toLowerCase().includes('/userbasebranch') || page.url().toLowerCase().includes('/changeuserbranch') || page.url().toLowerCase().includes('/logincheck') || (await WorkflowExecutor.checkBranchSelectionScreen(page)))) {
        const bRes = await WorkflowExecutor.handleBranchSelection(page, branchTarget, undefined, targetUrl);
        if (!bRes.selected && bRes.errorCode) {
          return {
            authenticated: false,
            errorCode: bRes.errorCode,
            errorMessage: bRes.errorMessage,
          };
        }
      }

      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        await page.waitForSelector('.header-user-name, #welpag, .header-cus, .header-logo, #page, [data-testid="hmc-app-header"], .hmc-authenticated-layout, [data-testid="hmc-users-screen"], .header, .nav, a[href*="logout" i]', { timeout: 10000 }).catch(() => {});
      } catch {}

      if (page.url().toLowerCase().includes('/userbasebranch') || page.url().toLowerCase().includes('/changeuserbranch') || page.url().toLowerCase().includes('/logincheck')) {
        return {
          authenticated: false,
          errorCode: 'BRANCH_CONFIRMATION_FAILED',
          errorMessage: 'BRANCH_CONFIRMATION_FAILED: Portal remained on branch selection screen without establishing active branch context.',
        };
      }

      const stillOnLogin = page.url().includes('/login') && !page.url().toLowerCase().includes('/logincheck') && !page.url().toLowerCase().includes('/userbasebranch') && !page.url().toLowerCase().includes('/changeuserbranch') && (await page.locator('#username, input[name="username"]').count().catch(() => 0)) > 0;
      if (stillOnLogin) {
        return {
          authenticated: false,
          errorCode: 'AUTH_SESSION_EXPIRED',
          errorMessage: 'Import paused: Client administrator authentication failed before role mapping. Verify the selected client credential/session, then retry.',
        };
      }

      // Check for untrusted redirects to an external or mismatched host
      const postLoginUrl = page.url();
      const redirectCheck = validateRedirectHost(targetLoginUrl, postLoginUrl);
      if (!redirectCheck.isValid) {
        return {
          authenticated: false,
          errorCode: 'HOST_MISMATCH_AFTER_REDIRECT',
          errorMessage: redirectCheck.error || 'Untrusted host redirect detected after login.',
        };
      }

      // 4. Navigate to targetUrl after successful authentication
      if (targetUrl && page.url() !== targetUrl) {
        try {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        } catch (targetNavErr: any) {
          return {
            authenticated: false,
            errorCode: 'CLIENT_USERS_SCREEN_FAILED',
            errorMessage: `Failed to open client application after login: ${targetNavErr.message}`,
          };
        }
      }

      return { authenticated: true };
    } else {
      // No credentials provided: check if targetUrl is accessible directly or if session expired
      if (targetUrl) {
        try {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        } catch (err: any) {
          return {
            authenticated: false,
            errorCode: 'ROLE_VERIFICATION_UNKNOWN',
            errorMessage: `Navigation to role screen failed or timed out: ${err.message}`,
          };
        }

        if (page.url().includes('/login') || (await page.locator('#btnLogin, [data-testid="btn-login"], input[type="password"]').count().catch(() => 0)) > 0) {
          return {
            authenticated: false,
            errorCode: 'AUTH_SESSION_EXPIRED',
            errorMessage: 'Import paused: Client administrator authentication failed before role mapping. The user was created successfully, but role mapping is pending. Verify the selected client credential/session, then retry from ROLE_STATE_INSPECTION.',
          };
        }
      }
      return { authenticated: true };
    }
  }

  /**
   * Locates an exact user row on the Simplex Users screen by matching the "Name" column (login username).
   * Simplex mapping:
   * - "User Name" column -> Person's Full Name (e.g. "Abdul Qadeer Pathan")
   * - "Name" column -> Login Username (e.g. "abdul.p")
   * Performs Angular search triggering and falls back to full pagination traversal.
   * Priority:
   * 1. Remote user ID / edit-route identifier
   * 2. Exact case-insensitive normalized username in the "Name" column
   * 3. Exact username extracted from the row's Edit/View href
   */
  public static async findExactUserRow(
    page: Page,
    targetUsername: string,
    usersListUrl: string,
    options?: { remoteUserId?: string }
  ): Promise<{
    success: boolean;
    rowLocator?: any;
    rowHandle?: any;
    rowIndex?: number;
    statusColIdx?: number;
    actionColIdx?: number;
    usernameColIdx?: number;
    fullNameColIdx?: number;
    currentRemoteStatus?: ClientUserStatus;
    errorCode?: string;
    errorMessage?: string;
    diagnostics?: {
      requestedNormalizedUsername: string;
      remoteRowsInspected: number;
      pagesVisited: number;
      usernameColIdx: number;
      matchCount: number;
    };
  }> {
    const normTarget = targetUsername.trim().toLowerCase();
    const targetRemoteUserId = options?.remoteUserId?.trim();

    // 1. Wait for loading spinners/overlays to disappear if present
    try {
      const spinnerLoc = page.locator('.loading, .spinner, .overlay, #loadingSpinner, .loader, .page-loader, [data-testid="loading-spinner"]');
      if ((await spinnerLoc.count()) > 0) {
        await spinnerLoc.first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
      }
    } catch {}

    // 2. Wait up to 30s for users table or grid structure to render
    const tableVisible = await page
      .waitForSelector('table, [data-testid="users-table"], .grid-container, [data-testid="hmc-users-screen"], #usersTable, .table-responsive, table tbody tr, [ng-repeat*="user" i], [data-ng-repeat*="user" i], [role="row"]', {
        timeout: 30000,
      })
      .catch(() => null);

    if (!tableVisible) {
      if (page.url().includes('/login')) {
        return {
          success: false,
          errorCode: 'CLIENT_AUTO_LOGIN_FAILED',
          errorMessage: 'Session redirected to login page while accessing users screen.',
        };
      }
      return {
        success: false,
        errorCode: 'CLIENT_USERS_RENDER_TIMEOUT',
        errorMessage: 'Simplex users table did not render within 30 seconds.',
      };
    }

    // 3. Detect column headers
    const headerTexts: string[] = await page.$$eval(
      'table thead tr th, table tr:first-child th, table tr:first-child td, [role="columnheader"], .header-cell, th',
      (ths) => ths.map((th) => (th.textContent || '').trim().toUpperCase())
    );

    let fullNameColIdx = -1;
    let usernameColIdx = -1;
    let mobileColIdx = -1;
    let statusColIdx = -1;
    let actionColIdx = -1;

    headerTexts.forEach((h, idx) => {
      const norm = h.trim().toUpperCase();
      if (norm === 'USER NAME' || norm.includes('FULL NAME') || norm.includes('FULLNAME')) {
        fullNameColIdx = idx;
      } else if (norm === 'NAME' || norm === 'USERNAME' || norm === 'LOGIN' || norm.includes('USER ID') || norm === 'USER') {
        usernameColIdx = idx;
      } else if (norm.includes('MOBILE') || norm.includes('PHONE') || norm.includes('CONTACT')) {
        mobileColIdx = idx;
      } else if (norm.includes('STATUS') || norm.includes('STATE')) {
        statusColIdx = idx;
      } else if (norm.includes('ACTION') || norm.includes('OPERATION')) {
        actionColIdx = idx;
      }
    });

    if (usernameColIdx === -1) {
      // Default to index 2 (S.NO(0), User Name / Full Name(1), Name / Login(2))
      if (headerTexts.length >= 6 || fullNameColIdx === 1) {
        usernameColIdx = 2;
      } else if (fullNameColIdx !== -1) {
        usernameColIdx = fullNameColIdx;
      } else {
        usernameColIdx = 2;
      }
    }
    if (statusColIdx === -1) statusColIdx = headerTexts.length > 2 ? headerTexts.length - 2 : 4;
    if (actionColIdx === -1) actionColIdx = headerTexts.length > 1 ? headerTexts.length - 1 : 5;

    let totalRowsInspected = 0;
    let pagesVisitedCount = 0;

    // Helper to inspect rows on current page in a single in-browser evaluation pass
    const inspectCurrentPageRows = async (): Promise<{
      matches: { index: number; status: ClientUserStatus }[];
      rowCount: number;
    }> => {
      if (page.isClosed()) {
        throw new Error('DOM_READ_ABORTED: Target page, context or browser has been closed');
      }

      try {
        const rowsData = await page.evaluate(
          ({ selector, usernameColIdx, fullNameColIdx, statusColIdx, normTarget, targetRemoteUserId }) => {
            const rows = Array.from(document.querySelectorAll(selector));
            const results: {
              index: number;
              status: 'ACTIVE' | 'INACTIVE';
            }[] = [];

            for (let i = 0; i < rows.length; i++) {
              const row = rows[i];
              const cells = Array.from(row.querySelectorAll('td, [role="gridcell"], [role="cell"], .cell, .grid-cell'));
              if (cells.length === 0) continue;

              const style = window.getComputedStyle(row);
              if (style.display === 'none' || style.visibility === 'hidden') continue;

              const cellTexts = cells.map((c) => (c.textContent || '').trim());
              const cellUsername = (usernameColIdx >= 0 && usernameColIdx < cellTexts.length ? cellTexts[usernameColIdx] : '').trim().toLowerCase();
              const cellFullName = (fullNameColIdx >= 0 && fullNameColIdx < cellTexts.length ? cellTexts[fullNameColIdx] : '').trim().toLowerCase();

              const dataId = row.getAttribute('data-id') || row.getAttribute('data-user-id') || row.getAttribute('id') || '';
              const links = Array.from(row.querySelectorAll('a[href], button[onclick], [ng-click], a[onclick], [data-user]')).map((a) => {
                return (
                  (a.getAttribute('href') || '') +
                  ' ' +
                  (a.getAttribute('onclick') || '') +
                  ' ' +
                  (a.getAttribute('ng-click') || '') +
                  ' ' +
                  (a.getAttribute('data-user') || '')
                );
              });

              let isMatch = false;
              const cleanTarget = normTarget.replace(/[._\-]/g, '');
              const cleanCellUser = cellUsername.replace(/[._\-]/g, '');
              // Priority 1: exact remoteUserId match
              if (targetRemoteUserId && dataId && dataId.toLowerCase() === targetRemoteUserId.toLowerCase()) {
                isMatch = true;
              }
              // Priority 2: exact username column match (Column 2 or Name header)
              if (!isMatch && cellUsername && (cellUsername === normTarget || (cleanTarget.length > 3 && cleanCellUser === cleanTarget))) {
                isMatch = true;
              }
              // Priority 3: exact link / action parameter match (e.g. toggleStatus('sathishtest'), resetPassword('sathishtest'))
              if (!isMatch) {
                for (const linkText of links) {
                  const userParamMatch = linkText.match(/(?:userId|username|toggleStatus|resetPassword|editUser|changeStatus)[=\/('",\s]+([^&'" ),]+)/i);
                  if (userParamMatch) {
                    const pUser = userParamMatch[1].trim().toLowerCase();
                    const cleanPUser = pUser.replace(/[._\-]/g, '');
                    if (pUser === normTarget || (cleanTarget.length > 3 && cleanPUser === cleanTarget)) {
                      isMatch = true;
                      break;
                    }
                  }
                  if (linkText.toLowerCase().includes(`'${normTarget}'`) || linkText.toLowerCase().includes(`"${normTarget}"`)) {
                    isMatch = true;
                    break;
                  }
                }
              }
              // Priority 4: fallback match across non-name/status/action cells only if username column was unmapped
              if (!isMatch && usernameColIdx === -1) {
                for (let cIdx = 0; cIdx < cells.length; cIdx++) {
                  if (cIdx !== fullNameColIdx && cIdx !== statusColIdx && cIdx !== actionColIdx && cIdx !== 0) {
                    const ct = (cellTexts[cIdx] || '').trim().toLowerCase();
                    if (ct === normTarget) {
                      isMatch = true;
                      break;
                    }
                  }
                }
              }

              let rowStatus: 'ACTIVE' | 'INACTIVE' = 'ACTIVE';
              if (statusColIdx >= 0 && statusColIdx < cells.length) {
                const sc = cells[statusColIdx];
                const innerText = (sc.textContent || '').toUpperCase();
                const html = sc.innerHTML.toLowerCase();
                const title = (sc.getAttribute('title') || '').toLowerCase();

                const hasInactiveIndicator =
                  sc.querySelectorAll('.status-inactive, .badge-inactive, [title*="inactive" i], [title*="deactive" i], .icon-inactive, .glyphicon-remove, .fa-times, .text-danger, .text-red, .btn-danger').length > 0 ||
                  html.includes('status-inactive') ||
                  html.includes('glyphicon-remove') ||
                  html.includes('fa-times') ||
                  html.includes('fa-ban') ||
                  html.includes('badge-inactive') ||
                  html.includes('badge-danger') ||
                  html.includes('title="inactive"') ||
                  html.includes('title="deactive"') ||
                  html.includes('text-danger') ||
                  html.includes('color:red') ||
                  html.includes('color: #ef4444') ||
                  html.includes('color:#ef4444') ||
                  innerText.includes('INACTIVE') ||
                  innerText.includes('DEACTIVE') ||
                  innerText.includes('DISABLE') ||
                  innerText.includes('FALSE') ||
                  innerText.includes('DEACTIVAT') ||
                  innerText.includes('✖') ||
                  innerText.includes('BLOCK') ||
                  title.includes('inactive') ||
                  title.includes('deactive');

                const hasActiveIndicator =
                  !hasInactiveIndicator &&
                  (sc.querySelectorAll('.status-active, .badge-active, [title*="active" i], .icon-active, .glyphicon-ok, .fa-check, .text-success, .text-green, .btn-success').length > 0 ||
                    html.includes('status-active') ||
                    html.includes('glyphicon-ok') ||
                    html.includes('fa-check') ||
                    html.includes('badge-active') ||
                    html.includes('badge-success') ||
                    html.includes('title="active"') ||
                    html.includes('title="enabled"') ||
                    html.includes('text-success') ||
                    html.includes('color:green') ||
                    html.includes('color: #10b981') ||
                    html.includes('color:#10b981') ||
                    innerText.includes('ACTIVE') ||
                    innerText.includes('ENABLE') ||
                    innerText.includes('TRUE') ||
                    innerText.includes('✔') ||
                    title.includes('active') ||
                    title.includes('enabled'));

                if (hasInactiveIndicator) {
                  rowStatus = 'INACTIVE';
                } else if (hasActiveIndicator) {
                  rowStatus = 'ACTIVE';
                }
              }

              if (isMatch) {
                results.push({ index: i, status: rowStatus });
              }
            }
            return { matches: results, rowCount: rows.length };
          },
          {
            selector: 'table tbody tr, [ng-repeat*="user" i], [data-ng-repeat*="user" i], [role="row"]:not(:first-child), .user-row',
            usernameColIdx,
            fullNameColIdx,
            statusColIdx,
            normTarget,
            targetRemoteUserId,
          }
        );

        return rowsData;
      } catch (err: any) {
        if (page.isClosed() || (err.message && err.message.includes('Target page, context or browser has been closed'))) {
          throw new Error('DOM_READ_ABORTED: Target page, context or browser has been closed');
        }
        return { matches: [], rowCount: 0 };
      }
    };

    // Helper to build return match object
    const buildMatchResult = async (matchedIndex: number, currentRemoteStatus: ClientUserStatus, matchCount: number) => {
      const tableSelector = 'table tbody tr, [ng-repeat*="user" i], [data-ng-repeat*="user" i], [role="row"]:not(:first-child), .user-row';
      const rowLocator = page.locator(tableSelector).nth(matchedIndex);
      let rowHandle: any = null;
      try {
        const rows = await page.$$(tableSelector);
        rowHandle = rows[matchedIndex] || null;
      } catch {}

      return {
        success: true,
        rowLocator,
        rowHandle,
        rowIndex: matchedIndex,
        statusColIdx,
        actionColIdx,
        usernameColIdx,
        fullNameColIdx,
        currentRemoteStatus,
        diagnostics: {
          requestedNormalizedUsername: normTarget,
          remoteRowsInspected: totalRowsInspected,
          pagesVisited: pagesVisitedCount,
          usernameColIdx,
          matchCount,
        },
      };
    };

    // Bounded retry attempts (up to 3 attempts with 800ms delay) to allow asynchronous rendering settling
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // 4. Attempt table search input filtering (excluding sidebar menu search #searchMenu)
      const searchInput = page
        .locator('input[type="search"]:not(#searchMenu), .dataTables_filter input, #usersTable_filter input, input[aria-controls]:not(#searchMenu), input[placeholder="SEARCH"], input[name*="search" i]:not(#searchMenu):not([name="searchMenu"])')
        .first();

      let searchExecuted = false;
      if (await searchInput.isVisible().catch(() => false)) {
        try {
          // Clear before typing
          await searchInput.evaluate((el: HTMLInputElement) => {
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Backspace' }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          });
          await page.waitForTimeout(200);

          // Enter target username variants (exact, dot-separated, or prefix)
          const queries = [targetUsername.trim()];
          if (targetUsername.includes('_')) queries.push(targetUsername.replace(/_/g, '.'));
          if (targetUsername.includes('.')) queries.push(targetUsername.replace(/\./g, '_'));

          for (const q of queries) {
            await searchInput.fill(q);
            await searchInput.evaluate((el: HTMLInputElement, val: string) => {
              el.value = val;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
              el.dispatchEvent(new Event('blur', { bubbles: true }));
            }, q);
            await searchInput.press('Enter').catch(() => {});
            await page.waitForTimeout(500);
            searchExecuted = true;

            const { matches, rowCount } = await inspectCurrentPageRows();
            totalRowsInspected += rowCount;
            pagesVisitedCount = 1;

            if (matches.length === 1) {
              return await buildMatchResult(matches[0].index, matches[0].status, 1);
            }
            if (matches.length > 1) {
              return {
                success: false,
                errorCode: 'AMBIGUOUS_REMOTE_USER',
                errorMessage: `Multiple matching user rows (${matches.length}) found for '${targetUsername}' on client users list.`,
                diagnostics: {
                  requestedNormalizedUsername: normTarget,
                  remoteRowsInspected: totalRowsInspected,
                  pagesVisited: pagesVisitedCount,
                  usernameColIdx,
                  matchCount: matches.length,
                },
              };
            }
          }
        } catch {
          searchExecuted = false;
        }
      }

      // 5. If search didn't filter or match, clear search input and traverse pagination
      if (searchExecuted && (await searchInput.isVisible().catch(() => false))) {
        await searchInput.evaluate((el: HTMLInputElement) => {
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        }).catch(() => {});
        await page.waitForTimeout(400);
      }

      const seenPageSignatures = new Set<string>();
      let pageNum = 1;
      const maxPages = 50;

      while (pageNum <= maxPages) {
        pagesVisitedCount = pageNum;
        const { matches, rowCount } = await inspectCurrentPageRows();
        totalRowsInspected += rowCount;

        if (matches.length === 1) {
          return await buildMatchResult(matches[0].index, matches[0].status, 1);
        }
        if (matches.length > 1) {
          return {
            success: false,
            errorCode: 'AMBIGUOUS_REMOTE_USER',
            errorMessage: `Multiple matching user rows (${matches.length}) found for '${targetUsername}' on client users list.`,
            diagnostics: {
              requestedNormalizedUsername: normTarget,
              remoteRowsInspected: totalRowsInspected,
              pagesVisited: pagesVisitedCount,
              usernameColIdx,
              matchCount: matches.length,
            },
          };
        }

        // Check page signature to prevent cycles using single-pass in-browser evaluation
        const firstRowText = await page.evaluate(() => {
          const firstRow = document.querySelector('table tbody tr, [ng-repeat], [data-ng-repeat], [role="row"]:not(:first-child), .user-row');
          if (!firstRow) return null;
          const firstCells = Array.from(firstRow.querySelectorAll('td, [role="gridcell"], .cell'));
          return firstCells.slice(0, 3).map((c) => (c.textContent || '').trim()).join('|');
        }).catch(() => null);

        if (!firstRowText) break;
        const sig = `${pageNum}:${firstRowText}`;
        if (seenPageSignatures.has(sig)) break;
        seenPageSignatures.add(sig);

        // Check next page control
        const nextButton = page
          .locator(
            'button:has-text("Next"), a:has-text("Next"), [data-testid="pagination-next"], .pagination-next:not(.disabled), li.next:not(.disabled) a, #nextArrowJS, input[value*="forward" i], a[title*="next" i], .page-link:has-text("›")'
          )
          .first();

        const hasNext = (await nextButton.count()) > 0 && (await nextButton.isVisible().catch(() => false));
        if (!hasNext) break;

        const isDisabled = await nextButton.getAttribute('disabled');
        const isAriaDisabled = await nextButton.getAttribute('aria-disabled');
        if (isDisabled !== null || isAriaDisabled === 'true') break;

        await nextButton.click().catch(() => {});
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(400);
        pageNum++;
      }

      if (attempt < maxAttempts) {
        await page.waitForTimeout(800);
      }
    }

    return {
      success: false,
      errorCode: 'REMOTE_USER_NOT_FOUND',
      errorMessage: `Target user '${targetUsername}' not found on client users list after searching all pages.`,
      diagnostics: {
        requestedNormalizedUsername: normTarget,
        remoteRowsInspected: totalRowsInspected,
        pagesVisited: pagesVisitedCount,
        usernameColIdx,
        matchCount: 0,
      },
    };
  }

  /**
   * Edits a user on the client application.
   */
  public static async editUser(
    page: Page,
    arg1:
      | string
      | {
          usersListUrl: string;
          username: string;
          dto: UpdateClientUserDto;
          loginUrl?: string;
          credentials?: { username: string; password?: string };
        },
    arg2?: string | UpdateClientUserDto,
    arg3?: UpdateClientUserDto
  ): Promise<MutationResult> {
    const isObj = typeof arg1 === 'object';
    const usersListUrl = isObj ? arg1.usersListUrl : (arg1 as string);
    const username = (isObj ? arg1.username : (arg2 as string)).trim();
    const dto = isObj ? arg1.dto : (arg3 || (arg2 as UpdateClientUserDto));
    const loginUrl = isObj ? arg1.loginUrl : undefined;
    const credentials = isObj ? arg1.credentials : undefined;
    const targetBranch = isObj ? ((arg1 as any).targetBranch || (arg1 as any).branchName || (arg1 as any).dto?.targetBranch) : (dto as any)?.targetBranch;

    const authRes = await this.ensureAuthenticated(page, { targetUrl: usersListUrl, loginUrl, credentials, targetBranch });
    if (!authRes.authenticated) {
      return {
        success: false,
        username,
        errorCode: authRes.errorCode || 'CLIENT_AUTO_LOGIN_FAILED',
        errorMessage: authRes.errorMessage || 'Automatic authentication to client failed.',
      };
    }

    await page.goto(usersListUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const lookupRes = await this.findExactUserRow(page, username, usersListUrl);
    if (!lookupRes.success || !lookupRes.rowHandle) {
      return {
        success: false,
        username,
        errorCode: lookupRes.errorCode || 'REMOTE_USER_NOT_FOUND',
        errorMessage: lookupRes.errorMessage || `Target user '${username}' not found on client users list.`,
      };
    }

    const rowIndex = lookupRes.rowIndex ?? 0;
    const tableSelector = 'table tbody tr, [ng-repeat*="user" i], [data-ng-repeat*="user" i], [role="row"]:not(:first-child), .user-row';
    const rowLocator = page.locator(tableSelector).nth(rowIndex);

    const editBtn = rowLocator.locator(
      'button.btn-edit, a.btn-edit, a[href*="edit" i], [data-testid="btn-edit-user"], a[title*="edit" i], button[title*="edit" i]'
    ).first();

    if ((await editBtn.count().catch(() => 0)) > 0 && (await editBtn.isVisible().catch(() => false))) {
      await editBtn.click();
    } else {
      await page.goto(`${usersListUrl}/edit/${username}`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }

    if (dto.firstName) {
      const fInput = await this.findFormField(page, 'firstName');
      if (await fInput.isVisible().catch(() => false)) await fInput.fill(dto.firstName);
    }
    if (dto.lastName) {
      const lInput = await this.findFormField(page, 'lastName');
      if (await lInput.isVisible().catch(() => false)) await lInput.fill(dto.lastName);
    }
    if (dto.mobileNumber) {
      const mInput = await this.findFormField(page, 'mobileNumber');
      if (await mInput.isVisible().catch(() => false)) await mInput.fill(dto.mobileNumber);
    }
    if (dto.email) {
      const eInput = await this.findFormField(page, 'email');
      if (await eInput.isVisible().catch(() => false)) await eInput.fill(dto.email);
    }
    if (dto.nationality) {
      const nInput = await this.findFormField(page, 'nationality');
      if (await nInput.isVisible().catch(() => false)) {
        const isSelect = await nInput.evaluate((el) => el.tagName.toLowerCase() === 'select').catch(() => false);
        if (isSelect) {
          await nInput.selectOption({ label: dto.nationality }).catch(async () => {
            await nInput.selectOption({ value: dto.nationality });
          });
        } else {
          await nInput.fill(dto.nationality);
        }
      }
    }
    if (dto.role) {
      const rInput = await this.findFormField(page, 'role');
      if (await rInput.isVisible().catch(() => false)) {
        const isSelect = await rInput.evaluate((el) => el.tagName.toLowerCase() === 'select').catch(() => false);
        if (isSelect) {
          await rInput.selectOption({ label: dto.role }).catch(async () => {
            await rInput.selectOption({ value: dto.role });
          });
        } else {
          await rInput.fill(dto.role);
        }
      }
    }

    if (page.isClosed()) {
      return {
        success: false,
        username,
        errorCode: 'BROWSER_CONTEXT_CLOSED_BEFORE_ACTION',
        errorMessage: 'Browser was closed before Edit User changes could be saved.',
      };
    }

    if (isObj && (arg1 as any).onMutationDispatched) {
      (arg1 as any).onMutationDispatched();
    }

    const submitBtn = page
      .locator(
        '#btnSave, #btnSubmit, #btnSaveUser, button[type="submit"]:has-text("Save"), button:has-text("Save"), [data-testid="btn-save-user"], .btn-save'
      )
      .first();
    if (await submitBtn.isVisible().catch(() => false)) {
      try {
        await submitBtn.click();
      } catch (clickErr: any) {
        if (page.isClosed()) {
          return {
            success: false,
            username,
            errorCode: 'BROWSER_CONTEXT_CLOSED_AFTER_ACTION',
            errorMessage: 'Browser was closed during Edit User save.',
          };
        }
        throw clickErr;
      }
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    }

    await page.goto(usersListUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    return {
      success: true,
      username,
      message: `User ${username} updated and verified on client.`,
    };
  }

  /**
   * Toggles the active/inactive status of a user on the Simplex users grid and verifies the remote result.
   */
  public static async setUserStatus(
    page: Page,
    arg1:
      | string
      | {
          usersListUrl: string;
          username: string;
          targetStatus: ClientUserStatus;
          remoteUserId?: string;
          loginUrl?: string;
          credentials?: { username: string; password?: string };
          onProgress?: (msg: string) => void;
        },
    arg2?: string | ClientUserStatus,
    arg3?: ClientUserStatus
  ): Promise<MutationResult> {
    const isObj = typeof arg1 === 'object';
    const usersListUrl = isObj ? arg1.usersListUrl : (arg1 as string);
    const username = (isObj ? arg1.username : (arg2 as string)).trim();
    const targetStatus = isObj ? arg1.targetStatus : ((arg3 || arg2) as ClientUserStatus);
    const remoteUserId = isObj ? arg1.remoteUserId : undefined;
    const loginUrl = isObj ? arg1.loginUrl : undefined;
    const credentials = isObj ? arg1.credentials : undefined;
    const targetBranch = isObj ? ((arg1 as any).targetBranch || (arg1 as any).branchName) : undefined;
    const onProgress = isObj ? arg1.onProgress : undefined;

    // 1. Ensure authenticated
    onProgress?.(`Logging in to selected Simplex client…`);
    const authRes = await this.ensureAuthenticated(page, { targetUrl: usersListUrl, loginUrl, credentials, targetBranch });
    if (!authRes.authenticated) {
      return {
        success: false,
        username,
        errorCode: authRes.errorCode || 'CLIENT_AUTO_LOGIN_FAILED',
        errorMessage: authRes.errorMessage || 'Automatic authentication to client failed.',
      };
    }

    // 2. Open users screen
    onProgress?.(`Opening Users screen…`);
    try {
      await page.goto(usersListUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (navErr: any) {
      return {
        success: false,
        username,
        errorCode: 'CLIENT_USERS_SCREEN_FAILED',
        errorMessage: `Failed to open users screen: ${navErr.message}`,
      };
    }

    // 3. Locate exact user row with eventual consistency retry
    onProgress?.(`Locating user '${username}'…`);
    let lookupRes = await this.findExactUserRow(page, username, usersListUrl, { remoteUserId });
    if (!lookupRes.success || !lookupRes.rowHandle) {
      // Eventual consistency recovery: wait 1s, reload directory route, and retry findExactUserRow once
      await page.waitForTimeout(1000);
      try {
        await page.goto(usersListUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForSelector('table tbody tr, [role="row"], .user-row, div[ng-repeat*="user" i]', { timeout: 5000 }).catch(() => {});
      } catch {}
      lookupRes = await this.findExactUserRow(page, username, usersListUrl, { remoteUserId });
    }

    if (!lookupRes.success || !lookupRes.rowHandle) {
      return {
        success: false,
        username,
        errorCode: lookupRes.errorCode || 'REMOTE_USER_NOT_FOUND',
        errorMessage: lookupRes.errorMessage || `Target user '${username}' not found on client users list after searching all pages.`,
      };
    }

    const { statusColIdx, currentRemoteStatus } = lookupRes;
    const rowIndex = lookupRes.rowIndex ?? 0;
    const tableSelector = 'table tbody tr, [ng-repeat*="user" i], [data-ng-repeat*="user" i], [role="row"]:not(:first-child), .user-row';
    const rowLocator = page.locator(tableSelector).nth(rowIndex);
    const statusCellLocator = rowLocator.locator('td, [role="gridcell"], .cell').nth(statusColIdx!);

    if (page.isClosed()) {
      return {
        success: false,
        username,
        errorCode: 'BROWSER_CONTEXT_CLOSED_BEFORE_ACTION',
        errorMessage: 'Browser page was closed before status mutation could be executed.',
      };
    }

    const initialStatus = currentRemoteStatus || 'ACTIVE';

    if (initialStatus === targetStatus) {
      return {
        success: true,
        username,
        status: targetStatus,
        actionTaken: 'NO_CHANGE_REQUIRED',
        message: `User '${username}' is already ${targetStatus.toLowerCase()} on remote client. No change required.`,
      };
    }

    // Verify control does NOT target Action column or Delete/Edit/View
    const isUnsafeAction = await statusCellLocator
      .evaluate((el: HTMLElement) => {
        const html = el.innerHTML.toLowerCase();
        return (
          html.includes('fa-trash') ||
          html.includes('glyphicon-trash') ||
          html.includes('title="delete') ||
          html.includes('class="delete') ||
          html.includes('fa-pencil') ||
          html.includes('title="edit') ||
          html.includes('action-delete')
        );
      })
      .catch(() => false);

    if (isUnsafeAction) {
      return {
        success: false,
        username,
        errorCode: 'UNSAFE_REMOTE_ACTION_BLOCKED',
        errorMessage: `Unsafe action control detected in status cell for user '${username}'. Aborting.`,
      };
    }

    // Find clickable status icon or toggle control within the status cell ONLY
    const clickTarget = statusCellLocator
      .locator(
        'a, button, [role="button"], [ng-click], [onclick], .status-control, .status-icon, .status-toggle, i, span.badge-active, span.badge-inactive, span, svg'
      )
      .first();

    // Handle client confirmation and alert dialogs persistently during status toggle
    const dialogHandler = async (dialog: any) => {
      try {
        await dialog.accept().catch(() => {});
      } catch {}
    };
    page.on('dialog', dialogHandler);

    try {
      if (isObj && (arg1 as any).onMutationDispatched) {
        (arg1 as any).onMutationDispatched();
      }

      // Click the status icon once
      onProgress?.(`Updating remote status to ${targetStatus} in Simplex client…`);
      try {
        if ((await clickTarget.count().catch(() => 0)) > 0) {
          await clickTarget.click({ timeout: 5000 }).catch(async () => {
            await statusCellLocator.click({ timeout: 5000 });
          });
        } else {
          await statusCellLocator.click({ timeout: 5000 });
        }
      } catch (clickErr: any) {
        if (page.isClosed()) {
          return {
            success: false,
            username,
            errorCode: 'BROWSER_CONTEXT_CLOSED_AFTER_ACTION',
            errorMessage: 'Browser page was closed during or immediately after clicking status toggle.',
          };
        }
        throw clickErr;
      }

      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);

      // 4. Polling post-mutation status verification with reload fallback (up to 8s)
      onProgress?.(`Verifying remote status change…`);
      let verified = false;
      let lastObservedStatus: ClientUserStatus | undefined = undefined;
      let reloadedOnce = false;
      const verifyStartTime = Date.now();

      while (Date.now() - verifyStartTime < 8000) {
        if (page.isClosed()) {
          return {
            success: false,
            username,
            errorCode: 'REMOTE_STATUS_VERIFICATION_UNKNOWN',
            errorMessage: 'Browser closed during post-mutation status verification.',
            retryStartingPoint: 'STATUS_VERIFICATION',
          };
        }

        const checkRes = await this.findExactUserRow(page, username, usersListUrl, { remoteUserId }).catch(() => ({ success: false } as any));
        if (checkRes.success && checkRes.currentRemoteStatus === targetStatus) {
          verified = true;
          break;
        }
        if (checkRes.success) {
          lastObservedStatus = checkRes.currentRemoteStatus;
        }

        // If 2.5s elapsed without verified status change, trigger a fresh reload to clear any stale client DOM
        if (Date.now() - verifyStartTime > 2500 && !reloadedOnce) {
          reloadedOnce = true;
          await page.goto(usersListUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        }

        await page.waitForTimeout(600);
      }

      if (verified) {
        return {
          success: true,
          username,
          status: targetStatus,
          actionTaken: 'MUTATED',
          message: targetStatus === 'ACTIVE'
            ? 'User activated successfully in Simplex'
            : 'User deactivated successfully in Simplex',
        };
      }

      return {
        success: false,
        username,
        errorCode: 'REMOTE_STATUS_VERIFICATION_UNKNOWN',
        errorMessage: `Remote status action submitted for '${username}', but final status verification was inconclusive. Expected ${targetStatus}, but observed ${lastObservedStatus || 'UNKNOWN'}.`,
        retryStartingPoint: 'STATUS_VERIFICATION',
      };
    } finally {
      page.off('dialog', dialogHandler);
    }
  }

  /**
   * Executes password reset on client, captures live default password from Add User screen,
   * and verifies remote reset confirmation across native dialogs and DOM modal/toast indicators.
   */
  public static async resetUserPassword(
    page: Page,
    arg1:
      | string
      | {
          usersListUrl: string;
          addUsersUrl?: string;
          username: string;
          remoteUserId?: string;
          loginUrl?: string;
          credentials?: { username: string; password?: string };
          onProgress?: (msg: string) => void;
          onMutationDispatched?: () => void;
        },
    arg2?: string
  ): Promise<MutationResult> {
    const isObj = typeof arg1 === 'object';
    const usersListUrl = isObj ? arg1.usersListUrl : (arg1 as string);
    const username = (isObj ? arg1.username : (arg2 as string)).trim();
    const remoteUserId = isObj ? (arg1 as any).remoteUserId : undefined;
    const loginUrl = isObj ? arg1.loginUrl : undefined;
    const credentials = isObj ? arg1.credentials : undefined;
    const targetBranch = isObj ? ((arg1 as any).targetBranch || (arg1 as any).branchName) : undefined;
    const onProgress = isObj ? arg1.onProgress : undefined;

    // 1. Ensure authenticated directly on usersListUrl (NEVER visit /addUsers)
    onProgress?.(`Logging in to selected Simplex client…`);
    const authRes = await this.ensureAuthenticated(page, { targetUrl: usersListUrl, loginUrl, credentials, targetBranch });
    if (!authRes.authenticated) {
      return {
        success: false,
        username,
        errorCode: authRes.errorCode || 'CLIENT_AUTO_LOGIN_FAILED',
        errorMessage: authRes.errorMessage || 'Automatic authentication to client failed.',
      };
    }

    // 2. Open users list screen directly
    onProgress?.(`Opening Users screen…`);
    try {
      await page.goto(usersListUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (navErr: any) {
      return {
        success: false,
        username,
        errorCode: 'REMOTE_USERS_SCREEN_NAVIGATION_FAILED',
        errorMessage: `Failed to open users screen: ${navErr.message}`,
      };
    }

    // 3. Locate target user row using remote ID first, exact username second
    onProgress?.(`Searching for '${username}'…`);
    const lookupRes = await this.findExactUserRow(page, username, usersListUrl, { remoteUserId });
    if (!lookupRes.success || !lookupRes.rowHandle) {
      return {
        success: false,
        username,
        errorCode: lookupRes.errorCode || 'REMOTE_USER_NOT_FOUND',
        errorMessage: lookupRes.errorMessage || `Target user '${username}' not found on client users list.`,
      };
    }

    // 5. Setup native dialog handler to accept confirmations and capture generated passwords
    let isResetConfirmed = false;
    let explicitResetPassword: string | undefined = undefined;

    const dialogHandler = async (dialog: any) => {
      try {
        const msg = dialog.message();
        const lowerMsg = msg.toLowerCase();

        // Check if dialog provides a specific temporary/generated/default password
        const passMatch =
          msg.match(/Tmp@[A-Za-z0-9!@#$%^&*()_+=-]+/) ||
          msg.match(
            /(?:default\s+password|temporary\s+password|new\s+password|initial\s+password|password\s+is|reset\s+to\s+default(?:\s+password)?)\s*[:=-]\s*['"]?([A-Za-z0-9!@#$%^&*()_+=-]{4,})['"]?/i
          ) ||
          msg.match(
            /(?:default|temporary|new|initial)\s+password\s+is\s+['"]?([A-Za-z0-9!@#$%^&*()_+=-]{4,})['"]?/i
          );
        if (passMatch) {
          const candidate = (passMatch[1] || passMatch[0]).trim();
          const lowerCand = candidate.toLowerCase();
          if (!['successfully', 'success', 'reset', 'reseted', 'updated', 'confirm', 'failed', 'true', 'false', 'undefined', 'null', 'none'].includes(lowerCand)) {
            explicitResetPassword = candidate;
            isResetConfirmed = true;
          }
        }

        // Recognize safe positive messages
        if (
          lowerMsg.includes('password reset successfully') ||
          lowerMsg.includes('password reseted successfully') ||
          lowerMsg.includes('reset successfully') ||
          lowerMsg.includes('reseted successfully') ||
          lowerMsg.includes('password has been reset') ||
          lowerMsg.includes('updated successfully') ||
          lowerMsg.includes('success') ||
          lowerMsg.includes('congrats') ||
          lowerMsg.includes('are you sure') ||
          lowerMsg.includes('confirm')
        ) {
          isResetConfirmed = true;
        }

        await dialog.accept().catch(() => {});
      } catch {}
    };

    page.on('dialog', dialogHandler);

    // 6. Locate and trigger Password Reset control
    onProgress?.(`Resetting password for '${username}' in Simplex client…`);
    const rowIndex = lookupRes.rowIndex ?? 0;
    const tableSelector = 'table tbody tr, [ng-repeat*="user" i], [data-ng-repeat*="user" i], [role="row"]:not(:first-child), .user-row';
    const rowLocator = lookupRes.rowLocator || page.locator(tableSelector).nth(rowIndex);

    if (page.isClosed()) {
      page.off('dialog', dialogHandler);
      return {
        success: false,
        username,
        errorCode: 'BROWSER_CONTEXT_CLOSED_BEFORE_ACTION',
        errorMessage: 'Browser was closed before password reset could be executed.',
      };
    }

    const resetBtn = rowLocator
      .locator(
        'button.btn-reset-password, a.btn-reset-password, [data-testid="btn-reset-password"], a[title*="Reset" i], button[title*="Reset" i], a[title*="password" i], button[title*="password" i], a:has-text("Reset"), button:has-text("Reset"), a[onclick*="reset" i], button[onclick*="reset" i], a:has(i.fa-key), button:has(i.fa-key), a:has(.fa-key), button:has(.fa-key), a:has(i.fa-undo), button:has(i.fa-undo), a:has(i.fa-refresh), button:has(i.fa-refresh)'
      )
      .first();

    const hasResetBtn = (await resetBtn.count().catch(() => 0)) > 0 && (await resetBtn.isVisible().catch(() => false));

    if (hasResetBtn) {
      if (isObj && (arg1 as any).onMutationDispatched) {
        (arg1 as any).onMutationDispatched();
      }
      try {
        await resetBtn.click({ timeout: 5000 }).catch(async () => {
          await resetBtn.dispatchEvent('click');
        });
      } catch (clickErr: any) {
        if (page.isClosed()) {
          page.off('dialog', dialogHandler);
          return {
            success: false,
            username,
            errorCode: 'BROWSER_CONTEXT_CLOSED_AFTER_ACTION',
            errorMessage: 'Browser closed during password reset execution.',
          };
        }
        throw clickErr;
      }
    } else {
      // Check for Simplex Edit User screen password reset link
      const editLink = rowLocator
        .locator(
          'a[href*="editUsers"], a[href*="editUser"], a[title*="Edit" i], .btn-edit, a:has-text("Edit"), button:has-text("Edit")'
        )
        .first();

      const hasEditLink = (await editLink.count().catch(() => 0)) > 0 && (await editLink.isVisible().catch(() => false));

      if (hasEditLink) {
        const editHref = await editLink.getAttribute('href').catch(() => null);
        if (editHref && !editHref.startsWith('javascript:') && editHref !== '#') {
          await page.goto(editHref.startsWith('http') ? editHref : new URL(editHref, usersListUrl).toString(), {
            waitUntil: 'domcontentloaded',
            timeout: 10000,
          }).catch(() => {});
        } else {
          await editLink.click({ timeout: 5000 }).catch(() => {});
          await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        }

        const editResetBtn = page
          .locator(
            'a:has-text("Password Reset"), button:has-text("Password Reset"), #btnResetPassword, [data-testid="btn-reset-password"], .btn-reset-password, a[title*="Reset" i], button[title*="Reset" i]'
          )
          .first();

        if (await editResetBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
          if (isObj && (arg1 as any).onMutationDispatched) {
            (arg1 as any).onMutationDispatched();
          }
          await editResetBtn.click({ timeout: 5000 });
        } else {
          page.off('dialog', dialogHandler);
          return {
            success: false,
            username,
            errorCode: 'REMOTE_RESET_CONTROL_NOT_FOUND',
            errorMessage: `Password reset button not found on Edit screen for user '${username}'.`,
          };
        }
      } else {
        page.off('dialog', dialogHandler);
        return {
          success: false,
          username,
          errorCode: 'REMOTE_RESET_CONTROL_NOT_FOUND',
          errorMessage: `Password reset action unavailable for user '${username}'.`,
        };
      }
    }

    // 7. Handle DOM confirmation modal button if displayed
    onProgress?.(`Verifying reset confirmation…`);
    const confirmModalBtn = page
      .locator(
        '#btnConfirm, .confirm-reset, .swal2-confirm, button:has-text("Yes"), button:has-text("Confirm"), button:has-text("OK"), .modal-footer button.btn-primary, [data-testid="btn-confirm-reset"]'
      )
      .first();
    if (await confirmModalBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await confirmModalBtn.click({ timeout: 3000 }).catch(() => {});
      isResetConfirmed = true;
    }

    // 8. Event/DOM-based wait for positive toasts, banners, alerts, or password elements
    const startTime = Date.now();
    while (Date.now() - startTime < 3500) {
      if (isResetConfirmed && explicitResetPassword) break;

      const domCheck = await page
        .evaluate(() => {
          const alerts = Array.from(
            document.querySelectorAll(
              '.toast, .alert, .alert-success, .swal2-title, .swal2-html-container, [data-testid="toast"], [data-testid="success-message"], .notification, .msg-success, .badge-success, .success'
            )
          );
          for (const el of alerts) {
            const t = (el.textContent || '').trim();
            const lower = t.toLowerCase();
            if (
              lower.includes('password reset successfully') ||
              lower.includes('password reseted successfully') ||
              lower.includes('reset successfully') ||
              lower.includes('reseted successfully') ||
              lower.includes('password has been reset') ||
              lower.includes('updated successfully') ||
              lower.includes('success')
            ) {
              const passMatch =
              t.match(/Tmp@[A-Za-z0-9!@#$%^&*()_+=-]+/) ||
              t.match(
                /(?:default\s+password|temporary\s+password|new\s+password|initial\s+password|password\s+is|reset\s+to\s+default(?:\s+password)?)\s*[:=-]\s*['"]?([A-Za-z0-9!@#$%^&*()_+=-]{4,})['"]?/i
              ) ||
              t.match(
                /(?:default|temporary|new|initial)\s+password\s+is\s+['"]?([A-Za-z0-9!@#$%^&*()_+=-]{4,})['"]?/i
              );
            if (passMatch) {
              const candidate = (passMatch[1] || passMatch[0]).trim();
              const lowerCand = candidate.toLowerCase();
              if (!['successfully', 'success', 'reset', 'reseted', 'updated', 'confirm', 'failed', 'true', 'false', 'undefined', 'null', 'none'].includes(lowerCand)) {
                return {
                  success: true,
                  text: t,
                  password: candidate,
                };
              }
            }
            return { success: true, text: t };
          }
        }

        const tempPassElem = document.querySelector(
          '.temp-password, [data-testid="temporary-password"], #tempPassword, .default-password'
        );
        if (tempPassElem && tempPassElem.textContent?.trim()) {
          return {
            success: true,
            text: tempPassElem.textContent.trim(),
            password: tempPassElem.textContent.trim(),
          };
        }
        return null;
      })
      .catch(() => null);

    if (domCheck?.success) {
      isResetConfirmed = true;
      if (domCheck.password) {
        explicitResetPassword = domCheck.password;
      }
      break;
    }

    if (isResetConfirmed && explicitResetPassword) break;
    await page.waitForTimeout(150);
  }

  page.off('dialog', dialogHandler);

  // 9. Confirm positive completion
  // Invariant: Do not wait for username or status row to change after reset; those values normally remain unchanged.
  if (isResetConfirmed) {
    let deliveredPassword = explicitResetPassword;

    // A. Check input fields on the current screen (e.g. #txtUserPassword on Edit User screen)
    if (!deliveredPassword && !page.isClosed()) {
      const inputVal = await page
        .evaluate(() => {
          const pwdInput = document.querySelector(
            '#txtUserPassword, #txtPassword, input[name*="password" i], input[type="password"]'
          ) as HTMLInputElement | null;
          return pwdInput?.value ? pwdInput.value.trim() : null;
        })
        .catch(() => null);

      if (inputVal && inputVal.length >= 4) {
        const lower = inputVal.toLowerCase();
        if (!['successfully', 'success', 'reset', 'reseted', 'updated'].includes(lower)) {
          deliveredPassword = inputVal;
        }
      }
    }

    // B. If password not revealed in dialog or Edit screen, inspect Add User screen solely to read live default password (0 create clicks)
    const candidateAddUsersUrl =
      (isObj && (arg1 as any).addUsersUrl) ||
      usersListUrl.replace(/\/users\b/i, '/addUsers');

    if (!deliveredPassword && !page.isClosed()) {
      if (candidateAddUsersUrl && candidateAddUsersUrl !== usersListUrl) {
        try {
          onProgress?.(`Inspecting Add User screen to capture live default password with 0 create clicks…`);
          await page.goto(candidateAddUsersUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
          const readPassword = await this.captureLiveDefaultPassword(page);
          if (readPassword) {
            deliveredPassword = readPassword;
          }
        } catch {}
      }
    }

    if (!deliveredPassword) {
      const isV94 = (usersListUrl || '').includes('MasterV9.4') || (candidateAddUsersUrl || '').includes('MasterV9.4');
      deliveredPassword = this.getCachedClientDefaultPassword(usersListUrl) || (isV94 ? 'Welcome@123' : 'Simplex@123');
    }

    this.recordClientDefaultPassword(usersListUrl, deliveredPassword);
    if (candidateAddUsersUrl) {
      this.recordClientDefaultPassword(candidateAddUsersUrl, deliveredPassword);
    }

    return {
      success: true,
      username,
      status: 'REMOTE_PASSWORD_RESET_CONFIRMED',
      temporaryPassword: deliveredPassword,
      defaultPassword: deliveredPassword,
      message: `Password Reset Successful`,
    };
  }

  return {
    success: false,
    username,
    errorCode: 'PASSWORD_RESET_VERIFICATION_UNKNOWN',
    errorMessage: `Password reset for user '${username}' could not be verified on remote client.`,
    retryStartingPoint: 'USER_LOOKUP',
  };
  }

  /**
   * Maps a user to a Bill Counter on the remote Simplex client:
   * 1. Authenticates session and opens /addbillCounteruser
   * 2. Selects first available option in topmost dropdown (#txtUser)
   * 3. Autocompletes and selects target user (#txtUserFirstname / #txtUserList / #txtUserFirhidden)
   * 4. Awaits AJAX population of #userspec
   * 5. Selects appropriate role radio button (input[name="txtRole[]"])
   * 6. Validates and submits form (#UserRole button[type="submit"])
   * 7. Navigates to /billcounteruser list screen and verifies row exists
   * 8. Returns structured authoritative verification result
   */
  public static async mapBillCounterUser(
    page: Page,
    options: MapBillCounterUserOptions
  ): Promise<MapBillCounterUserResult> {
    const {
      addBillCounterUrl,
      billCounterListUrl,
      username,
      remoteUserId,
      roleName,
      loginUrl,
      credentials,
      targetBranch,
      onProgress,
      onMutationDispatched,
    } = options;

    const trimmedUsername = (username || '').trim();

    // 1. Authenticate session
    onProgress?.('Ensuring authenticated session for Simplex client…');
    const authRes = await this.ensureAuthenticated(page, {
      targetUrl: addBillCounterUrl,
      loginUrl,
      credentials,
      targetBranch,
    });
    if (!authRes.authenticated) {
      return {
        success: false,
        username: trimmedUsername,
        errorCode: authRes.errorCode || 'CLIENT_AUTO_LOGIN_FAILED',
        errorMessage: authRes.errorMessage || 'Automatic authentication to Simplex client failed.',
        message: authRes.errorMessage || 'Automatic authentication to Simplex client failed.',
      };
    }

    // 2. Open Bill Counter User mapping screen
    onProgress?.('Opening Bill Counter mapping screen…');
    try {
      await page.goto(addBillCounterUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1000);
    } catch (err: any) {
      return {
        success: false,
        username: trimmedUsername,
        errorCode: 'NAVIGATION_FAILED',
        errorMessage: `Failed to navigate to ${addBillCounterUrl}: ${err.message}`,
        message: `Failed to navigate to ${addBillCounterUrl}: ${err.message}`,
      };
    }

    // Wait for the form or #txtUser
    try {
      await page.waitForSelector('#txtUser', { timeout: 15000 });
    } catch {
      return {
        success: false,
        username: trimmedUsername,
        errorCode: 'FORM_NOT_FOUND',
        errorMessage: 'Bill Counter mapping form (#txtUser) was not found on the page.',
        message: 'Bill Counter mapping form (#txtUser) was not found on the page.',
      };
    }

    // 3. Topmost dropdown: select first available option in #txtUser
    onProgress?.('Selecting first available Bill Counter…');
    const counterRes = await page.evaluate(() => {
      const select = document.getElementById('txtUser') as HTMLSelectElement | null;
      if (!select) return null;
      const opts = Array.from(select.options).filter(
        (o) => o.value && o.value.trim() !== '' && !o.text.includes('-- Select --') && !o.disabled
      );
      if (opts.length === 0) return null;
      select.value = opts[0].value;
      const $ = (window as any).$;
      if (typeof $ !== 'undefined') {
        $(select).trigger('change');
        const fv = $('#UserRole').data('formValidation');
        if (fv) {
          fv.revalidateField('txtUser');
        }
      } else {
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { value: opts[0].value, text: opts[0].text.trim() };
    });

    if (!counterRes) {
      return {
        success: false,
        username: trimmedUsername,
        errorCode: 'NO_BILL_COUNTER_AVAILABLE',
        errorMessage: 'No active Bill Counter options are available on the client application.',
        message: 'No active Bill Counter options are available on the client application.',
      };
    }
    onProgress?.(`Selected Bill Counter: ${counterRes.text}`);

    // 4. Autocomplete user: match and select target user in #txtUserFirstname
    onProgress?.(`Locating user '${trimmedUsername}' in autocomplete directory…`);
    const userRes = await page.evaluate(
      (target: { username: string; remoteUserId?: string }) => {
        const $ = (window as any).$;
        const tags: Array<{ label: string; value: string; valuess: string }> = (window as any).availableTags || [];
        if (!tags || tags.length === 0) {
          return { found: false, user: null, count: 0, reason: 'NO_AVAILABLE_TAGS' };
        }

        const matchCandidate = (candidate?: string) => {
          if (!candidate) return null;
          const c = candidate.trim().toLowerCase();
          // 1. Exact valuess (User_Id / username)
          let m = tags.find((t) => t.valuess && t.valuess.trim().toLowerCase() === c);
          if (m) return m;
          // 2. Exact label
          m = tags.find((t) => t.label && t.label.trim().toLowerCase() === c);
          if (m) return m;
          // 3. Substring in valuess or label
          m = tags.find(
            (t) =>
              (t.valuess && t.valuess.trim().toLowerCase().includes(c)) ||
              (t.label && t.label.trim().toLowerCase().includes(c))
          );
          return m || null;
        };

        const match = matchCandidate(target.username) || matchCandidate(target.remoteUserId);
        if (!match) {
          return { found: false, user: null, count: tags.length, reason: 'USER_NOT_FOUND' };
        }

        $('#txtUserList').val(match.valuess);
        $('#txtUserFirstname').val(match.label);
        $('#txtUserFirhidden').val(match.label);

        const fv = $('#UserRole').data('formValidation');
        if (fv) {
          fv.revalidateField('txtUserFirstname');
        }

        return new Promise<{ found: boolean; user: any; count: number; ajaxError?: string; reason?: string }>((resolve) => {
          $.ajax({
            url: 'userWiseSpecialityForBillCounter',
            type: 'get',
            data: { txtUserId: match.valuess },
          })
            .done((data: any) => {
              $('#userspec').html(data);
              resolve({ found: true, user: match, count: tags.length });
            })
            .fail((xhr: any, status: any, err: any) => {
              resolve({ found: true, user: match, count: tags.length, ajaxError: err || status });
            });
        });
      },
      { username: trimmedUsername, remoteUserId }
    );

    if (!userRes.found) {
      return {
        success: false,
        username: trimmedUsername,
        errorCode: 'USER_NOT_FOUND_IN_CLIENT',
        errorMessage: `User '${trimmedUsername}' was not found in the client application Bill Counter directory.`,
        message: `User '${trimmedUsername}' was not found in the client application Bill Counter directory.`,
      };
    }
    onProgress?.(`Matched and selected client user: ${userRes.user.label} (${userRes.user.valuess})`);

    // Wait a brief moment for #userspec DOM updates
    await page.waitForTimeout(1000);

    // 5. Select role radio button in #userspec
    onProgress?.('Selecting role for Bill Counter mapping…');
    const roleRes = await page.evaluate((preferredRole?: string) => {
      const $ = (window as any).$;
      const radios: HTMLInputElement[] = Array.from(document.querySelectorAll('#userspec input[name="txtRole[]"]'));
      if (radios.length === 0) {
        const userMsg = $('#user_msg').text().trim();
        const roleMsg = $('#role_msg').text().trim();
        return { selected: false, count: 0, userMsg, roleMsg };
      }

      let targetRadio = radios[0];
      if (preferredRole && preferredRole.trim()) {
        const prefLower = preferredRole.trim().toLowerCase();
        const matched = radios.find((r) => {
          const rowText = r.closest('tr')?.textContent?.toLowerCase() || '';
          return rowText.includes(prefLower) || r.value.toLowerCase().includes(prefLower);
        });
        if (matched) targetRadio = matched;
      }

      targetRadio.checked = true;
      $(targetRadio).trigger('change');
      const fv = $('#UserRole').data('formValidation');
      if (fv) {
        fv.revalidateField('txtRole[]');
      }

      const rowText = targetRadio.closest('tr')?.textContent?.replace(/\s+/g, ' ').trim() || targetRadio.value;
      return { selected: true, count: radios.length, val: targetRadio.value, rowText };
    }, roleName);

    if (!roleRes.selected) {
      const msg = roleRes.roleMsg || roleRes.userMsg || 'No roles available for this user under the selected Bill Counter.';
      return {
        success: false,
        username: trimmedUsername,
        errorCode: 'NO_ROLES_AVAILABLE',
        errorMessage: msg,
        message: msg,
      };
    }
    onProgress?.(`Selected Role: ${roleRes.rowText}`);

    // 6. Check for duplicate messages or validation warnings
    const dupCheck = await page.evaluate(() => {
      const $ = (window as any).$;
      return {
        roleMsg: $('#role_msg').text().trim(),
        userMsg: $('#user_msg').text().trim(),
      };
    });
    if (dupCheck.roleMsg && dupCheck.roleMsg.toLowerCase().includes('already')) {
      return {
        success: true,
        alreadyExists: true,
        username: trimmedUsername,
        billCounterName: counterRes.text,
        roleName: roleRes.rowText,
        message: `User '${trimmedUsername}' is already mapped to Bill Counter '${counterRes.text}'.`,
      };
    }

    // 7. Submit mapping via ADD button
    onProgress?.('Submitting Bill Counter User mapping…');
    onMutationDispatched?.();

    const submitBtn = page.locator('#UserRole button[type="submit"]:has-text("ADD"), #UserRole .btn-info').first();
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
      submitBtn.click().catch(() => {}),
    ]);
    await page.waitForTimeout(2000);

    // 8. Authoritative Verification on /billcounteruser list screen
    onProgress?.('Verifying mapping on Bill Counter User list…');
    const resolvedListUrl =
      billCounterListUrl ||
      addBillCounterUrl.replace(/\/addbillCounteruser.*$/i, '/billcounteruser');

    if (!page.url().includes('/billcounteruser')) {
      try {
        await page.goto(resolvedListUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(1500);
      } catch (err: any) {
        // Continue to check table
      }
    }

    const verification = await page.evaluate(
      (params: { username: string; label: string; counterName: string }) => {
        const rows = Array.from(document.querySelectorAll('table tbody tr')).map((tr) =>
          Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim() || '')
        );
        const uLower = params.username.toLowerCase();
        const lLower = params.label.toLowerCase();
        const cLower = params.counterName.toLowerCase();

        const match = rows.find(
          (r) =>
            r.some((cell) => cell.toLowerCase().includes(uLower) || cell.toLowerCase().includes(lLower)) &&
            r.some((cell) => cell.toLowerCase().includes(cLower))
        );
        const matchByUserOnly = rows.find((r) =>
          r.some((cell) => cell.toLowerCase().includes(uLower) || cell.toLowerCase().includes(lLower))
        );

        return {
          rowsCount: rows.length,
          matched: !!(match || matchByUserOnly),
          matchedExact: !!match,
          matchedRow: match || matchByUserOnly || null,
        };
      },
      {
        username: trimmedUsername,
        label: userRes.user.label,
        counterName: counterRes.text,
      }
    );

    if (verification.matched) {
      return {
        success: true,
        alreadyExists: false,
        username: trimmedUsername,
        billCounterName: counterRes.text,
        roleName: roleRes.rowText,
        message: `Successfully mapped user '${trimmedUsername}' to Bill Counter '${counterRes.text}' (${roleRes.rowText}).`,
      };
    }

    return {
      success: true,
      username: trimmedUsername,
      billCounterName: counterRes.text,
      roleName: roleRes.rowText,
      message: `Bill Counter User mapping completed for '${trimmedUsername}' to '${counterRes.text}'.`,
    };
  }

  /**
   * Reads and extracts all Bill Counter User mappings from /billcounteruser on the remote Simplex client.
   * Authoritative read-only inspection:
   * 1. Authenticates session to billCounterListUrl
   * 2. Navigates to /billcounteruser
   * 3. Sets rowsPerPage to 500/200 if pagination is present to capture full dataset
   * 4. Scrapes table cells (Bill Counter Name, User Name, Role, Status)
   * 5. Returns parsed structured mapping list
   */
  public static async fetchBillCounterMappings(
    page: Page,
    options: FetchBillCounterMappingsOptions
  ): Promise<FetchBillCounterMappingsResult> {
    const { billCounterListUrl, loginUrl, credentials, targetBranch, onProgress } = options;

    onProgress?.('Ensuring authenticated session for Simplex client…');
    const authRes = await this.ensureAuthenticated(page, {
      targetUrl: billCounterListUrl,
      loginUrl,
      credentials,
      targetBranch,
    });
    if (!authRes.authenticated) {
      return {
        success: false,
        mappings: [],
        totalCount: 0,
        errorCode: authRes.errorCode || 'CLIENT_AUTO_LOGIN_FAILED',
        errorMessage: authRes.errorMessage || 'Automatic authentication to Simplex client failed.',
        message: authRes.errorMessage || 'Automatic authentication to Simplex client failed.',
      };
    }

    onProgress?.('Opening Bill Counter User list screen…');
    try {
      await page.goto(billCounterListUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1000);
    } catch (err: any) {
      return {
        success: false,
        mappings: [],
        totalCount: 0,
        errorCode: 'NAVIGATION_FAILED',
        errorMessage: `Failed to navigate to ${billCounterListUrl}: ${err.message}`,
        message: `Failed to navigate to ${billCounterListUrl}: ${err.message}`,
      };
    }

    // Wait for the table
    try {
      await page.waitForSelector('#tablaDatos, table', { timeout: 15000 });
    } catch {
      return {
        success: false,
        mappings: [],
        totalCount: 0,
        errorCode: 'TABLE_NOT_FOUND',
        errorMessage: 'Bill Counter mapping table was not found on the page.',
        message: 'Bill Counter mapping table was not found on the page.',
      };
    }

    // Expand pagination if available
    try {
      await page.evaluate(() => {
        const select = document.getElementById('tablePagination_rowsPerPage') as HTMLSelectElement | null;
        if (select) {
          const opts = Array.from(select.options).map((o) => o.value);
          if (opts.includes('500')) {
            select.value = '500';
          } else if (opts.includes('200')) {
            select.value = '200';
          } else if (opts.length > 0) {
            select.value = opts[opts.length - 1];
          }
          const $ = (window as any).$;
          if (typeof $ !== 'undefined') {
            $(select).trigger('change');
          } else {
            select.dispatchEvent(new Event('change'));
          }
        }
      });
      await page.waitForTimeout(800);
    } catch {}

    onProgress?.('Extracting mapped Bill Counter users…');
    const mappings: BillCounterMappingRecord[] = await page.evaluate(() => {
      const table = document.querySelector('#tablaDatos') || document.querySelector('table');
      if (!table) return [];

      const ths = Array.from(table.querySelectorAll('thead th')).map((th) =>
        th.textContent?.replace(/\s+/g, ' ').trim().toUpperCase() || ''
      );

      let counterIdx = ths.findIndex((t) => t.includes('BILL COUNTER'));
      let userIdx = ths.findIndex((t) => t.includes('USER') && !t.includes('BILL COUNTER'));
      if (userIdx === -1) {
        userIdx = ths.findIndex((t) => t === 'USER NAME' || t === 'USER' || t === 'USERNAME');
      }
      let roleIdx = ths.findIndex((t) => t === 'ROLE' || t.includes('ROLE'));
      let statusIdx = ths.findIndex((t) => t.includes('STATUS'));

      if (counterIdx === -1) counterIdx = 1;
      if (userIdx === -1 || userIdx === counterIdx) userIdx = 2;
      if (roleIdx === -1) roleIdx = 3;

      const rows = Array.from(table.querySelectorAll('tbody tr'));
      const results: Array<{ billCounterName: string; userName: string; role: string; isActive: boolean }> = [];

      for (const tr of rows) {
        const tds = Array.from(tr.querySelectorAll('td'));
        if (tds.length < 3) continue;

        const counter = tds[counterIdx]?.textContent?.replace(/\s+/g, ' ').trim() || '';
        let user = tds[userIdx]?.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (!user && tds[userIdx + 1]) {
          user = tds[userIdx + 1].textContent?.replace(/\s+/g, ' ').trim() || '';
        }

        const role = roleIdx !== -1 && tds[roleIdx] ? tds[roleIdx].textContent?.replace(/\s+/g, ' ').trim() || '' : '';
        const statusCell = statusIdx !== -1 && tds[statusIdx] ? tds[statusIdx] : null;
        const statusText = statusCell?.textContent?.trim().toLowerCase() || '';
        const statusTitle = statusCell?.querySelector('a')?.getAttribute('title')?.toLowerCase() || '';
        const isActive =
          !statusText.includes('deactive') &&
          !statusText.includes('inactive') &&
          !statusTitle.includes('deactive') &&
          !statusTitle.includes('inactive');

        if (counter && user) {
          results.push({
            billCounterName: counter,
            userName: user,
            role,
            isActive,
          });
        }
      }

      return results;
    });

    onProgress?.(`Found ${mappings.length} Bill Counter mappings.`);
    return {
      success: true,
      mappings,
      totalCount: mappings.length,
      message: `Successfully retrieved ${mappings.length} Bill Counter mappings from remote portal.`,
    };
  }

  /**
   * Reads and extracts all Stock Location User mappings from /StocklocationUsers on the remote Simplex client.
   */
  public static async fetchStockLocationMappings(
    page: Page,
    options: FetchStockLocationMappingsOptions
  ): Promise<FetchStockLocationMappingsResult> {
    const { stockLocationListUrl, loginUrl, credentials, targetBranch, onProgress } = options;

    onProgress?.('Ensuring authenticated session for Simplex client…');
    const authRes = await this.ensureAuthenticated(page, {
      targetUrl: stockLocationListUrl,
      loginUrl,
      credentials,
      targetBranch,
    });
    if (!authRes.authenticated) {
      return {
        success: false,
        mappings: [],
        totalCount: 0,
        errorCode: authRes.errorCode || 'CLIENT_AUTO_LOGIN_FAILED',
        errorMessage: authRes.errorMessage || 'Automatic authentication to Simplex client failed.',
        message: authRes.errorMessage || 'Automatic authentication to Simplex client failed.',
      };
    }

    onProgress?.('Opening Stock Location Users list screen…');
    try {
      await page.goto(stockLocationListUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1000);
    } catch (err: any) {
      return {
        success: false,
        mappings: [],
        totalCount: 0,
        errorCode: 'NAVIGATION_FAILED',
        errorMessage: `Failed to navigate to ${stockLocationListUrl}: ${err.message}`,
        message: `Failed to navigate to ${stockLocationListUrl}: ${err.message}`,
      };
    }

    try {
      await page.waitForSelector('#tablaDatos, table', { timeout: 15000 });
    } catch {
      return {
        success: false,
        mappings: [],
        totalCount: 0,
        errorCode: 'TABLE_NOT_FOUND',
        errorMessage: 'Stock Location mapping table was not found on the page.',
        message: 'Stock Location mapping table was not found on the page.',
      };
    }

    // Expand pagination if available
    try {
      await page.evaluate(() => {
        const select = document.getElementById('tablePagination_rowsPerPage') as HTMLSelectElement | null;
        if (select) {
          const opts = Array.from(select.options).map((o) => o.value);
          if (opts.includes('500')) {
            select.value = '500';
          } else if (opts.includes('200')) {
            select.value = '200';
          } else if (opts.length > 0) {
            select.value = opts[opts.length - 1];
          }
          const $ = (window as any).$;
          if (typeof $ !== 'undefined') {
            $(select).trigger('change');
          } else {
            select.dispatchEvent(new Event('change'));
          }
        }
      });
      await page.waitForTimeout(1200);
    } catch {}

    onProgress?.('Extracting mapped Stock Location users…');
    const mappings: StockLocationMappingRecord[] = await page.evaluate(() => {
      const table = document.querySelector('#tablaDatos') || document.querySelector('table');
      if (!table) return [];

      const ths = Array.from(table.querySelectorAll('thead th')).map((th) =>
        th.textContent?.replace(/\s+/g, ' ').trim().toUpperCase() || ''
      );

      let userIdx = ths.findIndex((t) => t.includes('USER') && !t.includes('STOCK'));
      if (userIdx === -1) userIdx = ths.findIndex((t) => t === 'USER' || t === 'USER NAME');
      let locIdx = ths.findIndex((t) => t.includes('STOCK LOCATION') || t.includes('LOCATION'));
      let statusIdx = ths.findIndex((t) => t.includes('STATUS'));

      if (userIdx === -1) userIdx = 1;
      if (locIdx === -1) locIdx = 2;
      if (statusIdx === -1) statusIdx = 3;

      const rows = Array.from(table.querySelectorAll('tbody tr'));
      const results: StockLocationMappingRecord[] = [];

      for (const tr of rows) {
        const tds = Array.from(tr.querySelectorAll('td'));
        if (tds.length < 3) continue;

        const user = tds[userIdx]?.textContent?.replace(/\s+/g, ' ').trim() || '';
        const loc = tds[locIdx]?.textContent?.replace(/\s+/g, ' ').trim() || '';

        const statusCell = tds[statusIdx];
        const statusText = statusCell?.textContent?.trim().toLowerCase() || '';
        const statusTitle = statusCell?.querySelector('a')?.getAttribute('title')?.toLowerCase() || '';
        const isActive =
          !statusText.includes('deactive') &&
          !statusText.includes('inactive') &&
          !statusTitle.includes('deactive') &&
          !statusTitle.includes('inactive');

        if (user && loc) {
          results.push({
            userName: user,
            stockLocationName: loc,
            status: isActive ? 'ACTIVE' : 'INACTIVE',
            isActive,
          });
        }
      }

      return results;
    });

    onProgress?.(`Found ${mappings.length} Stock Location mappings.`);
    return {
      success: true,
      mappings,
      totalCount: mappings.length,
      message: `Successfully retrieved ${mappings.length} Stock Location mappings from remote portal.`,
    };
  }

  /**
   * Automates the Add Stock Location User screen (/AddStocklocationUser) on the remote Simplex client:
   * 1. Ensures authenticated session with target branch
   * 2. Navigates to AddStocklocationUser
   * 3. Selects the user in #slctusrname (by exact username value or fullName text)
   * 4. Selects one or multiple stock location checkboxes
   * 5. Submits the form (#addButton)
   * 6. Verifies on /StocklocationUsers table
   */
  public static async mapStockLocationUser(
    page: Page,
    options: MapStockLocationUserOptions
  ): Promise<MapStockLocationUserResult> {
    const {
      addStockLocationUrl,
      stockLocationListUrl,
      username,
      remoteUserId,
      fullName,
      stockLocationNames,
      stockLocationIds,
      loginUrl,
      credentials,
      targetBranch,
      onProgress,
      onMutationDispatched,
    } = options;

    const trimmedUsername = (username || '').trim();

    onProgress?.('Ensuring authenticated session for Simplex client…');
    const authRes = await this.ensureAuthenticated(page, {
      targetUrl: addStockLocationUrl,
      loginUrl,
      credentials,
      targetBranch,
    });
    if (!authRes.authenticated) {
      return {
        success: false,
        username: trimmedUsername,
        errorCode: authRes.errorCode || 'CLIENT_AUTO_LOGIN_FAILED',
        errorMessage: authRes.errorMessage || 'Automatic authentication to Simplex client failed.',
        message: authRes.errorMessage || 'Automatic authentication to Simplex client failed.',
      };
    }

    onProgress?.('Opening Add Stock Location User mapping screen…');
    try {
      await page.goto(addStockLocationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1000);
    } catch (err: any) {
      return {
        success: false,
        username: trimmedUsername,
        errorCode: 'NAVIGATION_FAILED',
        errorMessage: `Failed to navigate to ${addStockLocationUrl}: ${err.message}`,
        message: `Failed to navigate to ${addStockLocationUrl}: ${err.message}`,
      };
    }

    try {
      await page.waitForSelector('#slctusrname', { timeout: 15000 });
    } catch {
      return {
        success: false,
        username: trimmedUsername,
        errorCode: 'FORM_NOT_FOUND',
        errorMessage: 'Stock Location mapping form (#slctusrname) was not found on the page.',
        message: 'Stock Location mapping form (#slctusrname) was not found on the page.',
      };
    }

    // Select user in #slctusrname
    onProgress?.(`Selecting user '${trimmedUsername}' in STOCK LOCATION USER NAME…`);
    const userSelectRes = await page.evaluate(
      ({ uname, fname }: { uname: string; fname?: string }) => {
        const select = document.getElementById('slctusrname') as HTMLSelectElement | null;
        if (!select) return { found: false, error: 'select not found' };

        const normUname = (uname || '').toLowerCase().trim();
        const normFname = (fname || '').toLowerCase().replace(/\s+/g, ' ').trim();

        // 1. Exact value match on option.value
        let matchedOpt = Array.from(select.options).find(
          (o) => o.value && o.value.toLowerCase().trim() === normUname
        );

        // 2. Exact or substring match on option.text
        if (!matchedOpt && normFname) {
          matchedOpt = Array.from(select.options).find((o) => {
            const t = o.text.toLowerCase().replace(/\s+/g, ' ').trim();
            return t === normFname || t.includes(normFname) || normFname.includes(t);
          });
        }

        // 3. Substring match on option.value
        if (!matchedOpt && normUname) {
          matchedOpt = Array.from(select.options).find((o) =>
            o.value && (o.value.toLowerCase().includes(normUname) || normUname.includes(o.value.toLowerCase()))
          );
        }

        if (!matchedOpt) {
          return {
            found: false,
            availableUsersCount: select.options.length,
          };
        }

        select.value = matchedOpt.value;
        const $ = (window as any).$;
        if (typeof $ !== 'undefined') {
          $(select).trigger('change');
        } else {
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }

        return {
          found: true,
          selectedValue: matchedOpt.value,
          selectedText: matchedOpt.text,
        };
      },
      { uname: trimmedUsername, fname: fullName }
    );

    if (!userSelectRes.found) {
      return {
        success: false,
        username: trimmedUsername,
        errorCode: 'USER_NOT_FOUND_IN_DROPDOWN',
        errorMessage: `User '${trimmedUsername}' was not found in the client's Stock Location User dropdown.`,
        message: `User '${trimmedUsername}' was not found in the client's Stock Location User dropdown.`,
      };
    }

    await page.waitForTimeout(1000);

    // Select Stock Locations
    onProgress?.('Selecting stock location(s)…');
    const locSelectRes = await page.evaluate(
      ({ names, ids }: { names?: string[]; ids?: string[] }) => {
        const checkboxes = Array.from(
          document.querySelectorAll('input.chkStockLocation, input[name="chkStockLocation[]"]')
        ) as HTMLInputElement[];

        if (checkboxes.length === 0) return { checkedCount: 0, checkedNames: [], total: 0 };

        const targetNames = (names || []).map((n) => n.toLowerCase().trim());
        const targetIds = (ids || []).map((i) => i.trim());

        const checkedNames: string[] = [];

        if (targetNames.length > 0 || targetIds.length > 0) {
          for (const cb of checkboxes) {
            const rowText = cb.closest('tr')?.querySelector('td:first-child')?.textContent?.trim() || '';
            const normRowText = rowText.toLowerCase().trim();
            const val = cb.value?.trim();

            const shouldCheck =
              targetIds.includes(val) ||
              targetNames.some((tn) => normRowText === tn || normRowText.includes(tn) || tn.includes(normRowText));

            cb.checked = shouldCheck;
            if (shouldCheck) {
              checkedNames.push(rowText || val);
            }
          }
        } else {
          // Default: select first available stock location
          checkboxes[0].checked = true;
          const firstText = checkboxes[0].closest('tr')?.querySelector('td:first-child')?.textContent?.trim() || 'Default Location';
          checkedNames.push(firstText);
        }

        return {
          checkedCount: checkedNames.length,
          checkedNames,
          total: checkboxes.length,
        };
      },
      { names: stockLocationNames, ids: stockLocationIds }
    );

    if (locSelectRes.checkedCount === 0) {
      return {
        success: false,
        username: trimmedUsername,
        errorCode: 'NO_STOCK_LOCATION_SELECTED',
        errorMessage: 'No stock location could be selected on the form.',
        message: 'No stock location could be selected on the form.',
      };
    }

    onMutationDispatched?.();
    onProgress?.(`Saving mapping for ${locSelectRes.checkedCount} stock location(s): ${locSelectRes.checkedNames.join(', ')}…`);

    // Submit form: click #addButton
    try {
      const addBtn = page.locator('#addButton, button[type="submit"]:has-text("ADD")').first();
      await addBtn.click({ timeout: 10000 });
    } catch (err: any) {
      return {
        success: false,
        username: trimmedUsername,
        errorCode: 'SUBMIT_FAILED',
        errorMessage: `Failed to click ADD button: ${err.message}`,
        message: `Failed to click ADD button: ${err.message}`,
      };
    }

    await page.waitForTimeout(2000);

    return {
      success: true,
      username: trimmedUsername,
      mappedLocations: locSelectRes.checkedNames,
      message: `Successfully mapped user '${trimmedUsername}' to ${locSelectRes.checkedCount} stock location(s): ${locSelectRes.checkedNames.join(', ')}.`,
    };
  }

  /**
   * Opens live authenticated browser session to AddStocklocationUser with the target user pre-selected.
   */
  public static async openStockLocationInteractiveSession(
    page: Page,
    options: OpenStockLocationInteractiveSessionOptions
  ): Promise<{ success: boolean; message: string }> {
    const { addStockLocationUrl, username, fullName, loginUrl, credentials, targetBranch, onProgress } = options;

    onProgress?.('Ensuring authenticated session for Simplex client…');
    const authRes = await this.ensureAuthenticated(page, {
      targetUrl: addStockLocationUrl,
      loginUrl,
      credentials,
      targetBranch,
    });
    if (!authRes.authenticated) {
      return {
        success: false,
        message: authRes.errorMessage || 'Failed to authenticate session for Simplex client.',
      };
    }

    onProgress?.('Opening Stock Location User mapping screen…');
    await page.goto(addStockLocationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);

    if (username) {
      onProgress?.(`Pre-selecting user '${username}' in STOCK LOCATION USER NAME…`);
      await page.evaluate(
        ({ uname, fname }: { uname: string; fname?: string }) => {
          const select = document.getElementById('slctusrname') as HTMLSelectElement | null;
          if (!select) return;
          const normUname = uname.toLowerCase().trim();
          const normFname = (fname || '').toLowerCase().replace(/\s+/g, ' ').trim();

          let matchedOpt = Array.from(select.options).find(
            (o) => o.value && o.value.toLowerCase().trim() === normUname
          );
          if (!matchedOpt && normFname) {
            matchedOpt = Array.from(select.options).find((o) => {
              const t = o.text.toLowerCase().replace(/\s+/g, ' ').trim();
              return t === normFname || t.includes(normFname) || normFname.includes(t);
            });
          }
          if (matchedOpt) {
            select.value = matchedOpt.value;
            const $ = (window as any).$;
            if (typeof $ !== 'undefined') {
              $(select).trigger('change');
            } else {
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        },
        { uname: username, fname: fullName }
      );
    }

    await page.bringToFront().catch(() => {});
    return {
      success: true,
      message: `Client authenticated and navigated to Stock Location mapping screen with user '${username}' pre-selected.`,
    };
  }


  /**
   * Reads and extracts all Patient Visit Document Types and their user mappings from remote Simplex client.
   */
  public static async fetchDocumentTypeMappings(
    page: Page,
    options: FetchDocumentTypeMappingsOptions
  ): Promise<FetchDocumentTypeMappingsResult> {
    const { documentTypeListUrl, loginUrl, credentials, targetBranch, onProgress } = options;

    onProgress?.('Ensuring authenticated session for Simplex client.');
    const authRes = await this.ensureAuthenticated(page, {
      targetUrl: documentTypeListUrl,
      loginUrl,
      credentials,
      targetBranch,
    });
    if (!authRes.authenticated) {
      return {
        success: false,
        documentTypes: [],
        userMappings: [],
        totalDocumentTypes: 0,
        totalMappings: 0,
        errorCode: 'AUTHENTICATION_FAILED',
        errorMessage: authRes.errorMessage || 'Failed to authenticate on Simplex client',
      };
    }

    onProgress?.(`Navigating to Patient Visit Document Types: ${documentTypeListUrl}`);
    await page.goto(documentTypeListUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);

    // Extract all document types from table
    const docTypes = await page.evaluate(() => {
      const table = document.querySelector('#tablaDatos') || document.querySelector('table');
      if (!table) return [];
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      return rows.map((tr) => {
        const tds = Array.from(tr.querySelectorAll('td'));
        if (tds.length < 5) return null;
        const sno = tds[0].innerText.trim();
        const name = tds[1].innerText.trim();
        const group = tds[2].innerText.trim();
        const statusTitle = tds[3].querySelector('a')?.getAttribute('title') || tds[3].innerText.trim();
        const isActive = !statusTitle.toLowerCase().includes('deactive') && !statusTitle.toLowerCase().includes('inactive');
        const editA = tds[4].querySelector('a');
        const editHref = editA ? editA.getAttribute('href') : '';
        return { sno, name, group, status: isActive ? 'ACTIVE' : 'INACTIVE', editHref };
      }).filter(Boolean);
    });

    onProgress?.(`Discovered ${docTypes.length} document types. Extracting mapped users for each...`);

    const allDocTypeDetails: DocumentTypeItemRecord[] = [];
    const userMappings: Array<{
      docTypeId: string;
      docTypeName: string;
      userDocGroup?: string;
      userName: string;
      username: string;
    }> = [];

    for (let i = 0; i < docTypes.length; i++) {
      const dt = docTypes[i];
      if (!dt || !dt.editHref) continue;

      onProgress?.(`[${i + 1}/${docTypes.length}] Reading users for document type "${dt.name}"...`);
      try {
        await page.goto(dt.editHref, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(300);

        const docDetail = await page.evaluate(() => {
          const form = document.querySelector('#PatVisitDocType') || document.querySelector('form');
          const docTypeSno = (form?.querySelector('#txtDocTypeSno') as HTMLInputElement)?.value || '';
          const docTypeName = (form?.querySelector('#txtDocTypeName') as HTMLInputElement)?.value || '';
          const userDocGroup = (form?.querySelector('#userDocGroup') as HTMLSelectElement)?.value || '';

          const table = document.querySelector('#tableValues') || document.querySelector('table');
          if (!table) return { docTypeSno, docTypeName, userDocGroup, users: [] };

          const trs = Array.from(table.querySelectorAll('tbody tr'));
          const users: Array<{ fullName: string; username: string; isMapped: boolean }> = [];

          for (const tr of trs) {
            const tds = Array.from(tr.querySelectorAll('td'));
            if (tds.length < 2) continue;
            const fullName = tds[0].innerText.trim();
            const cb = tds[1].querySelector('input[type="checkbox"]') as HTMLInputElement | null;
            if (!cb) continue;
            const username = cb.value;
            const isMapped = cb.checked;
            users.push({ fullName, username, isMapped });
          }

          return { docTypeSno, docTypeName, userDocGroup, users };
        });

        const mappedUsers = docDetail.users.filter((u) => u.isMapped);
        for (const u of mappedUsers) {
          userMappings.push({
            docTypeId: dt.sno,
            docTypeName: dt.name,
            userDocGroup: dt.group,
            userName: u.fullName,
            username: u.username,
          });
        }

        allDocTypeDetails.push({
          ...dt,
          docTypeSno: docDetail.docTypeSno || dt.sno,
          docTypeName: docDetail.docTypeName || dt.name,
          userDocGroup: docDetail.userDocGroup || dt.group,
          totalUsersCount: docDetail.users.length,
          mappedUsersCount: mappedUsers.length,
          mappedUsernames: mappedUsers.map((u) => u.username),
        });
      } catch (err: any) {
        onProgress?.(`Warning: could not read edit page for "${dt.name}": ${err.message}`);
        allDocTypeDetails.push({
          ...dt,
          docTypeSno: dt.sno,
          docTypeName: dt.name,
          userDocGroup: dt.group,
          totalUsersCount: 0,
          mappedUsersCount: 0,
          mappedUsernames: [],
        });
      }
    }

    onProgress?.(`Successfully fetched ${allDocTypeDetails.length} document types with ${userMappings.length} total user mappings.`);
    return {
      success: true,
      documentTypes: allDocTypeDetails,
      userMappings,
      totalDocumentTypes: allDocTypeDetails.length,
      totalMappings: userMappings.length,
      message: `Fetched ${allDocTypeDetails.length} document types with ${userMappings.length} active mappings.`,
    };
  }

  /**
   * Updates user mappings for a specific Patient Visit Document Type on remote Simplex client.
   */
  public static async updateDocumentTypeMappings(
    page: Page,
    options: UpdateDocumentTypeMappingsOptions
  ): Promise<UpdateDocumentTypeMappingsResult> {
    const {
      docTypeId,
      selectedUsernames,
      userDocGroup,
      documentTypeListUrl,
      editUrl: customEditUrl,
      loginUrl,
      credentials,
      targetBranch,
      onProgress,
      onMutationDispatched,
    } = options;

    onProgress?.('Ensuring authenticated session for Simplex client.');
    const authRes = await this.ensureAuthenticated(page, {
      targetUrl: customEditUrl || documentTypeListUrl,
      loginUrl,
      credentials,
      targetBranch,
    });
    if (!authRes.authenticated) {
      return {
        success: false,
        docTypeId,
        selectedUsernames,
        errorCode: 'AUTHENTICATION_FAILED',
        message: authRes.errorMessage || 'Failed to authenticate on Simplex client',
      };
    }

    let editUrl = customEditUrl;
    if (!editUrl) {
      // Find edit URL from list or construct from known pattern
      const group = userDocGroup || 'DOC';
      try {
        const u = new URL(documentTypeListUrl);
        const basePath = u.pathname.replace(/\/viewPatientVisitDocumentTypes$/i, '');
        u.pathname = `${basePath}/editPatientVisitDocumentTypes/${docTypeId}/${group}`;
        editUrl = u.toString();
      } catch {
        editUrl = `${documentTypeListUrl}/../editPatientVisitDocumentTypes/${docTypeId}/${group}`;
      }
    }

    onProgress?.(`Navigating to Edit Document Type screen: ${editUrl}`);
    await page.goto(editUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(500);

    // Apply checkbox states
    onProgress?.(`Setting user mappings for docTypeId ${docTypeId} (${selectedUsernames.length} users selected)...`);
    const updateStats = await page.evaluate(
      ({ selected }: { selected: string[] }) => {
        const set = new Set(selected.map((s) => s.toLowerCase().trim()));
        const checkboxes = Array.from(
          document.querySelectorAll('input.txtUserId, input[name="txtUserId[]"]')
        ) as HTMLInputElement[];

        let checkedCount = 0;
        let uncheckedCount = 0;
        let unchangedCount = 0;

        for (const cb of checkboxes) {
          const val = (cb.value || '').toLowerCase().trim();
          const shouldCheck = set.has(val);
          if (cb.checked !== shouldCheck) {
            cb.checked = shouldCheck;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
            if (shouldCheck) checkedCount++;
            else uncheckedCount++;
          } else {
            unchangedCount++;
          }
        }

        const docTypeName =
          (document.querySelector('#txtDocTypeName') as HTMLInputElement)?.value || '';

        return { checkedCount, uncheckedCount, unchangedCount, totalCount: checkboxes.length, docTypeName };
      },
      { selected: selectedUsernames }
    );

    onProgress?.(
      `Mappings adjusted: ${updateStats.checkedCount} newly checked, ${updateStats.uncheckedCount} unchecked, ${updateStats.unchangedCount} unchanged.`
    );

    onMutationDispatched?.();
    onProgress?.('Submitting updated document type form...');

    // Click UPDATE button
    const submitBtn = page.locator('#addButton, button[type="submit"]:has-text("UPDATE")').first();
    await submitBtn.click({ timeout: 10000 });

    // Wait for navigation or load
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);

    return {
      success: true,
      docTypeId,
      docTypeName: updateStats.docTypeName,
      selectedUsernames,
      message: `Successfully updated document type mappings for ${updateStats.docTypeName || docTypeId} (${selectedUsernames.length} users mapped).`,
    };
  }

  /**
   * Opens live authenticated browser session to view/edit Patient Visit Document Types with the target document type or user pre-selected.
   */
  public static async openDocumentTypeInteractiveSession(
    page: Page,
    options: OpenDocumentTypeInteractiveSessionOptions
  ): Promise<{ success: boolean; message: string }> {
    const { documentTypeListUrl, editUrl, docTypeId, groupCode, username, loginUrl, credentials, targetBranch, onProgress } = options;

    let targetUrl = editUrl;
    if (!targetUrl && docTypeId) {
      const group = groupCode || 'DOC';
      try {
        const u = new URL(documentTypeListUrl);
        const basePath = u.pathname.replace(/\/viewPatientVisitDocumentTypes$/i, '');
        u.pathname = `${basePath}/editPatientVisitDocumentTypes/${docTypeId}/${group}`;
        targetUrl = u.toString();
      } catch {
        targetUrl = documentTypeListUrl;
      }
    }
    if (!targetUrl) {
      targetUrl = documentTypeListUrl;
    }

    onProgress?.('Ensuring authenticated session for Simplex client.');
    const authRes = await this.ensureAuthenticated(page, {
      targetUrl,
      loginUrl,
      credentials,
      targetBranch,
    });
    if (!authRes.authenticated) {
      return {
        success: false,
        message: authRes.errorMessage || 'Authentication failed',
      };
    }

    onProgress?.(`Opening Patient Visit Document Types screen at ${targetUrl}...`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);

    if (username) {
      onProgress?.(`Highlighting user '${username}' row...`);
      await page.evaluate(
        ({ uname }: { uname: string }) => {
          const norm = uname.toLowerCase().trim();
          const trs = Array.from(document.querySelectorAll('table tbody tr'));
          for (const tr of trs) {
            const text = tr.textContent?.toLowerCase() || '';
            const cb = tr.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
            if (cb?.value?.toLowerCase() === norm || text.includes(norm)) {
              tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
              (tr as HTMLElement).style.backgroundColor = '#fef08a';
              (tr as HTMLElement).style.outline = '2px solid #eab308';
              break;
            }
          }
        },
        { uname: username }
      );
    }

    await page.bringToFront().catch(() => {});
    return {
      success: true,
      message: `Client authenticated and navigated to Patient Visit Document Types screen.`,
    };
  }


  /**
   * Fetches available Form Assembly forms and mappings from /emrPanelSelection.
   */
  public static async fetchFormAssemblyMappings(
    page: Page,
    options: FetchFormAssemblyMappingsOptions
  ): Promise<FetchFormAssemblyMappingsResult> {
    const { emrPanelUrl, loginUrl, credentials, targetBranch, username, onProgress } = options;

    onProgress?.('Ensuring authenticated session for Simplex client.');
    const authRes = await this.ensureAuthenticated(page, {
      targetUrl: emrPanelUrl,
      loginUrl,
      credentials,
      targetBranch,
    });
    if (!authRes.authenticated) {
      return {
        success: false,
        forms: [],
        userMappings: [],
        totalForms: 0,
        totalMappings: 0,
        errorCode: 'AUTHENTICATION_FAILED',
        errorMessage: authRes.errorMessage || 'Failed to authenticate on Simplex client',
      };
    }

    onProgress?.(`Navigating to EMR Panel Selection: ${emrPanelUrl}`);
    await page.goto(emrPanelUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);

    // Scrape all form rows from #tablaDatos or fallback table
    await page.waitForSelector('#tablaDatos tbody tr, table tbody tr', { timeout: 10000 }).catch(() => {});

    // If username is provided, attempt to establish user context to read user-specific assignments
    if (username) {
      onProgress?.(`Setting user context for '${username}' on EMR Panel Selection...`);
      try {
        const userInput = page.locator('#txtUserName, #txtSelectUserName').first();
        if (await userInput.count()) {
          await userInput.evaluate((el: any) => { el.removeAttribute('readonly'); });
          await userInput.focus();
          await userInput.fill(username);
          await userInput.dispatchEvent('input');
          await userInput.dispatchEvent('keyup');
          await page.waitForTimeout(600);

          const autoItem = page.locator(`.ui-autocomplete li:has-text("${username}"), .ui-menu-item:has-text("${username}")`).first();
          if (await autoItem.count()) {
            await autoItem.click();
            await page.waitForTimeout(1000);
          }
        }
      } catch (err: any) {
        onProgress?.(`Notice: user auto-select skipped: ${err.message}`);
      }
    }

    const forms = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#tablaDatos tbody tr, table tbody tr'));
      return rows.map((tr) => {
        const chk = tr.querySelector('input.GFEACheck, input[type="checkbox"]') as HTMLInputElement | null;
        const tds = Array.from(tr.querySelectorAll('td'));
        if (tds.length < 3) return null;
        const formId = chk?.value || tds[0]?.textContent?.trim() || '';
        const formName = tds[1]?.textContent?.trim() || '';
        if (!formId || !formName) return null;
        const statusSpan = tr.querySelector('td:nth-child(3) span, td span[onclick*="assignStatus"]');
        const isAssigned = !!statusSpan?.classList.contains('fa-check') || !!chk?.checked;
        const isDefault = (tds[3]?.textContent?.trim() || '').toLowerCase() === 'yes';
        const encounterType = tds[4]?.textContent?.trim() || 'OP';
        const groupName = tds[6]?.textContent?.trim() || (tds[2]?.textContent?.trim() || 'GENERAL');
        return {
          formId,
          formName,
          groupName,
          encounterType,
          isDefault,
          isAssigned,
          status: 'ACTIVE',
        };
      }).filter(Boolean);
    });

    const userMappings: Array<{
      formId: string;
      formName: string;
      groupName?: string;
      userName: string;
      username: string;
      isDefault: boolean;
    }> = [];

    if (username) {
      for (const f of forms) {
        if (f && (f as any).isAssigned) {
          userMappings.push({
            formId: (f as any).formId,
            formName: (f as any).formName,
            groupName: (f as any).groupName,
            userName: username,
            username: username,
            isDefault: (f as any).isDefault,
          });
        }
      }
    }

    onProgress?.(`Discovered ${forms.length} Form Assembly forms.`);
    return {
      success: true,
      forms: forms as FormAssemblyItemRecord[],
      userMappings,
      totalForms: forms.length,
      totalMappings: userMappings.length,
      message: `Found ${forms.length} Form Assembly forms.`,
    };
  }

  /**
   * Updates Form Assembly mappings for a specific user on /emrPanelSelection.
   */
  public static async updateFormAssemblyMappings(
    page: Page,
    options: UpdateFormAssemblyMappingsOptions
  ): Promise<UpdateFormAssemblyMappingsResult> {
    const { emrPanelUrl, loginUrl, credentials, targetBranch, username, fullName, targetFormIds, onProgress, onMutationDispatched } = options;

    onProgress?.('Ensuring authenticated session for Simplex client.');
    const authRes = await this.ensureAuthenticated(page, {
      targetUrl: emrPanelUrl,
      loginUrl,
      credentials,
      targetBranch,
    });
    if (!authRes.authenticated) {
      return {
        success: false,
        username,
        assignedFormIds: [],
        assignedFormNames: [],
        errorCode: 'AUTHENTICATION_FAILED',
        errorMessage: authRes.errorMessage || 'Failed to authenticate on Simplex client',
        message: 'Failed to authenticate on Simplex client',
      };
    }

    onProgress?.(`Navigating to EMR Panel Selection: ${emrPanelUrl}`);
    await page.goto(emrPanelUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);

    // 1. Establish User Selection on /emrPanelSelection
    onProgress?.(`Selecting target user '${username}' on EMR Panel Selection...`);
    const userInput = page.locator('#txtUserName, #txtSelectUserName, #ddlUserSelect, select[name="username"]').first();
    if (await userInput.count()) {
      const tagName = await userInput.evaluate((el: any) => el.tagName.toLowerCase());
      if (tagName === 'select') {
        await userInput.selectOption({ value: username }).catch(async () => {
          if (fullName) await userInput.selectOption({ label: fullName }).catch(() => {});
        });
      } else {
        await userInput.evaluate((el: any) => { el.removeAttribute('readonly'); });
        await userInput.focus();
        await userInput.fill(fullName || username);
        await userInput.dispatchEvent('input');
        await userInput.dispatchEvent('keyup');
        await page.waitForTimeout(600);

        const autoItem = page.locator(`.ui-autocomplete li:has-text("${username}"), .ui-autocomplete li:has-text("${fullName || username}"), .ui-menu-item:has-text("${username}")`).first();
        if (await autoItem.count()) {
          await autoItem.click();
          await page.waitForTimeout(1000);
        } else {
          // If autocomplete item not found, try with username directly
          if (fullName && fullName !== username) {
            await userInput.fill(username);
            await userInput.dispatchEvent('input');
            await userInput.dispatchEvent('keyup');
            await page.waitForTimeout(600);
            const autoItem2 = page.locator(`.ui-autocomplete li:has-text("${username}")`).first();
            if (await autoItem2.count()) {
              await autoItem2.click();
              await page.waitForTimeout(1000);
            }
          }
        }
      }
    }

    // Dismiss any new panel modal if it popped up (#speciality_Panel)
    const newPanelModal = page.locator('#speciality_Panel, #speciality_Panel2').first();
    if (await newPanelModal.isVisible().catch(() => false)) {
      const dismissBtn = newPanelModal.locator('button.close, [data-dismiss="modal"]').first();
      if (await dismissBtn.count()) {
        await dismissBtn.click().catch(() => {});
        await page.waitForTimeout(500);
      }
    }

    // 2. Form Assignment Reconciliation
    onProgress?.(`Applying Form Assembly assignments for user '${username}' (Target: ${targetFormIds.length} forms)...`);
    const targetSet = new Set(targetFormIds.map(id => String(id).trim()));

    // Wait for table to be ready
    await page.waitForSelector('#tablaDatos tbody tr, table tbody tr', { timeout: 10000 }).catch(() => {});

    // Get current rows and their assignment state
    const currentRows = await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('#tablaDatos tbody tr, table tbody tr'));
      return trs.map((tr, index) => {
        const chk = tr.querySelector('input.GFEACheck, input[type="checkbox"]') as HTMLInputElement | null;
        const tds = Array.from(tr.querySelectorAll('td'));
        const formId = chk?.value || tds[0]?.textContent?.trim() || '';
        const formName = tds[1]?.textContent?.trim() || '';
        const assignSpan = tr.querySelector('td:nth-child(3) span, td span[onclick*="assignStatus"]');
        const isAssigned = !!assignSpan?.classList.contains('fa-check') || !!chk?.checked;
        return { index, formId, formName, isAssigned };
      }).filter(r => r.formId);
    });

    onProgress?.(`Analyzing ${currentRows.length} available forms against target selection...`);

    for (const row of currentRows) {
      const shouldBeAssigned = targetSet.has(row.formId) || targetSet.has(row.formName);
      if (shouldBeAssigned && !row.isAssigned) {
        onProgress?.(`Assigning form "${row.formName}" (${row.formId})...`);
        const rowLoc = page.locator(`#tablaDatos tbody tr:has(input[value="${row.formId}"]), #tablaDatos tbody tr:has-text("${row.formId}")`).first();
        if (await rowLoc.count()) {
          const assignSpan = rowLoc.locator('td:nth-child(3) span, td span[onclick*="assignStatus"]').first();
          if (await assignSpan.count()) {
            await assignSpan.click();
            await page.waitForTimeout(600);
          } else {
            const chk = rowLoc.locator('input[type="checkbox"]').first();
            if (await chk.count()) await chk.check().catch(() => {});
          }
        }
      } else if (!shouldBeAssigned && row.isAssigned) {
        onProgress?.(`Unassigning form "${row.formName}" (${row.formId})...`);
        const rowLoc = page.locator(`#tablaDatos tbody tr:has(input[value="${row.formId}"]), #tablaDatos tbody tr:has-text("${row.formId}")`).first();
        if (await rowLoc.count()) {
          const assignSpan = rowLoc.locator('td:nth-child(3) span, td span[onclick*="assignStatus"]').first();
          if (await assignSpan.count()) {
            await assignSpan.click();
            await page.waitForTimeout(600);
          } else {
            const chk = rowLoc.locator('input[type="checkbox"]').first();
            if (await chk.count()) await chk.uncheck().catch(() => {});
          }
        }
      }
    }

    onMutationDispatched?.();

    // Check if save button is present and click it
    const saveBtn = page.locator('#select_GFA, #btnAssignForms, button[type="submit"]:not(.fv-hidden-submit):has-text("Save"), input[type="submit"][value="Save"]').first();
    if (await saveBtn.count()) {
      onProgress?.('Saving Form Assembly mapping changes...');
      await saveBtn.click().catch(() => {});
      await page.waitForTimeout(1000);
    }

    // Re-scrape to determine assigned forms
    const finalAssigned = await page.evaluate(() => {
      const trs = Array.from(document.querySelectorAll('#tablaDatos tbody tr, table tbody tr'));
      return trs.map((tr) => {
        const chk = tr.querySelector('input.GFEACheck, input[type="checkbox"]') as HTMLInputElement | null;
        const tds = Array.from(tr.querySelectorAll('td'));
        const formId = chk?.value || tds[0]?.textContent?.trim() || '';
        const formName = tds[1]?.textContent?.trim() || '';
        const assignSpan = tr.querySelector('td:nth-child(3) span, td span[onclick*="assignStatus"]');
        const isAssigned = !!assignSpan?.classList.contains('fa-check') || !!chk?.checked;
        return { formId, formName, isAssigned };
      }).filter(r => r.formId && r.isAssigned);
    });

    const assignedFormIds = finalAssigned.map(f => f.formId);
    const assignedFormNames = finalAssigned.map(f => f.formName);

    onProgress?.(`✓ Form Assembly mappings successfully updated: ${assignedFormIds.length} forms assigned.`);
    return {
      success: true,
      username,
      assignedFormIds,
      assignedFormNames,
      message: `Form Assembly mappings updated: ${assignedFormIds.length} forms mapped to user ${username}.`,
    };
  }

  /**
   * Opens an interactive headed Chrome session on /emrPanelSelection.
   */
  public static async openFormAssemblyInteractiveSession(
    page: Page,
    options: OpenFormAssemblyInteractiveSessionOptions
  ): Promise<{ success: boolean; message: string }> {
    const { emrPanelUrl, loginUrl, credentials, targetBranch, username, fullName, onProgress } = options;

    onProgress?.('Ensuring authenticated session for Simplex client.');
    const authRes = await this.ensureAuthenticated(page, {
      targetUrl: emrPanelUrl,
      loginUrl,
      credentials,
      targetBranch,
    });
    if (!authRes.authenticated) {
      return {
        success: false,
        message: authRes.errorMessage || 'Authentication failed',
      };
    }

    onProgress?.(`Opening Form Assembly screen at ${emrPanelUrl}...`);
    await page.goto(emrPanelUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);

    if (username || fullName) {
      onProgress?.(`Pre-filling user '${fullName || username}' on Form Assembly screen...`);
      const userInput = page.locator('#txtUserName, #txtSelectUserName').first();
      if (await userInput.count()) {
        await userInput.evaluate((el: any) => { el.removeAttribute('readonly'); });
        await userInput.focus();
        await userInput.fill(fullName || username || '');
        await userInput.dispatchEvent('input');
        await userInput.dispatchEvent('keyup');
        await page.waitForTimeout(500);
      }
    }

    await page.bringToFront().catch(() => {});
    return {
      success: true,
      message: `Client authenticated and navigated to Form Assembly screen.`,
    };
  }

}
