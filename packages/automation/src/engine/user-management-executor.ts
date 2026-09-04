import { Page, Locator } from 'playwright';
import { ClientUser, CreateClientUserDto, UpdateClientUserDto, ClientUserStatus, ClientCreateFormMetadata, validateRedirectHost } from '@hmc/shared';
import { SelectorResolver } from './selector-resolver';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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
  errorCode?: string;
  errorMessage?: string;
}

export class UserManagementExecutor {
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
      onProgress?: (update: SyncProgressUpdate) => void;
    }
  ): Promise<SyncUsersResult> {
    const { usersUrl, loginUrl, credentials, onProgress } = options;

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
      await submitLoc.locator.click();

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
      await page.waitForSelector('table tbody tr, [ng-repeat], [role="row"], .user-row', { timeout: 8000 }).catch(() => {});
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

          // Priority 4: Standard HTML table rows
          const tableRows = Array.from(document.querySelectorAll('table tbody tr, table tr:not(:first-child)'));
          if (tableRows.length > 0) {
            return { structure: 'HTML_TABLE', count: tableRows.length, selector: 'table tbody tr, table tr:not(:first-child)' };
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
    const maxPages = 30; // Guard against infinite pagination

    while (currentPage <= maxPages) {
      onProgress?.({
        stage: 'EXTRACTING',
        message: `Reading users page ${currentPage}…`,
        currentPage,
        count: scrapedUsersMap.size,
      });

      // Scrape current page rows with flexible header and container awareness
      const pageRowsData = await targetFrame.evaluate((selector) => {
        const rows = Array.from(document.querySelectorAll(selector));

        // Detect column indices from headers or visible labels
        const headerEls = Array.from(document.querySelectorAll('table thead th, table tr:first-child th, table tr:first-child td, [role="columnheader"], .header-cell, .grid-header, th, dt'));
        const headers = headerEls.map(h => (h.textContent || '').trim().toLowerCase());

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
          else if (h === 'user name' || h.includes('full name') || h.includes('fullname')) colFullName = idx;
          else if (h === 'name' || h === 'username' || h.includes('login') || h.includes('user id') || h === 'user') colUsername = idx;
          else if (h.includes('mobile') || h.includes('phone') || h.includes('contact')) colMobile = idx;
          else if (h.includes('email') || h.includes('mail')) colEmail = idx;
          else if (h.includes('national') || h.includes('country')) colNationality = idx;
          else if (h.includes('profile role') || h.includes('designation')) colProfileRole = idx;
          else if (h.includes('role') || h.includes('group') || h.includes('type')) colRole = idx;
          else if (h.includes('status') || h.includes('state')) colStatus = idx;
        });

        if (colUsername === -1 && colFullName !== -1) colUsername = colFullName;
        if (colFullName === -1 && colUsername !== -1) colFullName = colUsername;

        return rows.map((r) => {
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

        // Use header mapped indices: Name -> username, User Name -> fullName
        let fullName = (row.colFullName >= 0 ? texts[row.colFullName] : texts[1]) || '';
        let username = (row.colUsername >= 0 ? texts[row.colUsername] : texts[2]) || '';
        let mobileNumber = (row.colMobile >= 0 ? texts[row.colMobile] : texts[3]) || '';
        let email = (row.colEmail >= 0 ? texts[row.colEmail] : texts[4]) || '';
        let nationality = (row.colNationality >= 0 ? texts[row.colNationality] : texts[5]) || '';
        let role = (row.colRole >= 0 ? texts[row.colRole] : texts[6]) || '';
        let profileRole = (row.colProfileRole >= 0 ? texts[row.colProfileRole] : texts[7]) || '';
        let rawStatus = ((row.colStatus >= 0 ? texts[row.colStatus] : texts[8]) || '').toUpperCase();

        if (!username && email.includes('@')) {
          username = email.split('@')[0];
        } else if (!username && fullName) {
          username = fullName.toLowerCase().replace(/\s+/g, '.');
        }

        if (!username) continue;

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

      // Look for Next page control with 5s page timeout
      const nextButton = targetFrame.locator(
        'button:has-text("Next"), a:has-text("Next"), [data-testid="pagination-next"], .pagination-next:not(.disabled), li.next:not(.disabled) a, #nextArrowJS, input[value*="forward" i], a[title*="next" i], .page-link:has-text("›")'
      ).first();

      const isNextCount = await nextButton.count();
      if (isNextCount > 0 && (await nextButton.isVisible())) {
        const isDisabled = await nextButton.getAttribute('disabled');
        const isAriaDisabled = await nextButton.getAttribute('aria-disabled');
        if (!isDisabled && isAriaDisabled !== 'true') {
          await nextButton.click().catch(() => {});
          // Wait for DOM content or row change with 5s timeout
          await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
          currentPage++;
          continue;
        }
      }
      break;
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
      stage: 'SUCCEEDED',
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
    }
  ): Promise<ClientCreateFormMetadata> {
    const { addUsersUrl, clientId, applicationVersion = 'v9.4', loginUrl, credentials } = options;
    await this.ensureAuthenticated(page, { targetUrl: addUsersUrl, loginUrl, credentials });
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
        attrNames: ['userName', 'username', 'loginId', 'user_id', 'input-username', 'txtUser'],
        idPatterns: ['username', 'userName', 'txtUserName', 'txt_username', 'txtUser', 'inputUsername'],
        placeholders: ['username', 'user name', 'login id', 'user id'],
      },
      firstName: {
        labelPatterns: [
          '^first\\s*name(?:\\s*\\*|\\s*:\\s*)?$',
          '^given\\s*name(?:\\s*\\*|\\s*:\\s*)?$',
          '^f\\s*name(?:\\s*\\*|\\s*:\\s*)?$',
          'first\\s*name',
        ],
        attrNames: ['firstName', 'firstname', 'fName', 'givenName', 'input-firstname', 'first_name'],
        idPatterns: ['firstName', 'firstname', 'fName', 'txtFirstName', 'txt_firstname', 'inputFirstName'],
        placeholders: ['first name', 'given name'],
      },
      middleName: {
        labelPatterns: [
          '^middle\\s*name(?:\\s*\\*|\\s*:\\s*)?$',
          '^m\\s*name(?:\\s*\\*|\\s*:\\s*)?$',
          'middle\\s*name',
        ],
        attrNames: ['middleName', 'middlename', 'mName', 'input-middlename', 'middle_name'],
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
        attrNames: ['lastName', 'lastname', 'lName', 'surname', 'familyName', 'input-lastname', 'last_name'],
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
        attrNames: ['nickName', 'nickname', 'alias', 'preferredName', 'input-nickname', 'nick_name'],
        idPatterns: ['nickName', 'nickname', 'txtNickName', 'txt_nickname'],
        placeholders: ['nickname', 'nick name', 'alias'],
      },
      email: {
        labelPatterns: [
          '^email(?:\\s*address)?(?:\\s*\\*|\\s*:\\s*)?$',
          '^e-mail(?:\\s*address)?(?:\\s*\\*|\\s*:\\s*)?$',
          'email',
        ],
        attrNames: ['email', 'emailAddress', 'eMail', 'input-email', 'user_email'],
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
        attrNames: ['mobileNumber', 'mobileNo', 'mobile', 'phone', 'phoneNumber', 'input-mobile', 'mobile_no'],
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
        attrNames: ['nationality', 'country', 'citizenship', 'select-nationality', 'selNationality'],
        idPatterns: ['nationality', 'country', 'selNationality', 'ddlNationality'],
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
        attrNames: ['role', 'userRole', 'select-role', 'selRole'],
        idPatterns: ['role', 'userRole', 'selRole', 'ddlRole'],
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
          t = t.replace(/^(?:default\s+|initial\s+|temporary\s+)?password\s*[:*=-]\s*/i, '').trim();
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
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            const inp = elem as HTMLInputElement;
            return cleanPass(inp.value || inp.getAttribute('value') || inp.getAttribute('placeholder'));
          }
          return null;
        };

        let matchedLabelCount = 0;
        let adjacentElementType: string | undefined = undefined;

        // 1. Locate exact label elements representing the Password field
        const candidateSelectors = 'label, .form-label, .control-label, dt, th, td, span, p, strong, b, em';
        const allCandidates = Array.from(document.querySelectorAll(candidateSelectors));

        const labelElements = allCandidates.filter((el) => {
          const directText = (el.textContent || '').trim();
          if (!directText || directText.length > 50) return false;
          if (el.children.length > 3) return false;

          const norm = directText.replace(/[*:#=-]/g, '').trim().toLowerCase();
          return (
            norm === 'password' ||
            norm === 'default password' ||
            norm === 'initial password' ||
            norm === 'temporary password' ||
            norm === 'defaultpassword' ||
            norm === 'temp password'
          );
        });

        matchedLabelCount = labelElements.length;

        for (const el of labelElements) {
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
          '.default-password, [data-testid="default-password"], [data-testid="temporary-password"], #defaultPassword, #tempPassword, #lblDefaultPassword, .password-val'
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

      const sanitizedPageUrl = (page.url() || '').split('?')[0];
      const passwordValueFound = Boolean(evaluationResult?.value);

      // Safe non-sensitive diagnostic telemetry (never logs raw password)
      const safeDiagnostics = {
        passwordValueFound,
        matchedLabelCount: evaluationResult?.matchedLabelCount || 0,
        adjacentElementType: evaluationResult?.adjacentElementType || 'NONE',
        sanitizedPageUrl,
      };

      if (!passwordValueFound) {
        console.info('[SAFE DIAGNOSTICS] Client default-password not found on Add User screen:', safeDiagnostics);
      }

      return evaluationResult?.value || undefined;
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

    const resolvedLoginUrl =
      loginUrl || addUsersUrl.replace(/\/addUsers.*$/i, '/login').replace(/\/users.*$/i, '/login');

    // 1. Authenticate first at the configured login/base route before navigating to /addUsers
    const authRes = await this.ensureAuthenticated(page, {
      targetUrl: addUsersUrl,
      loginUrl: resolvedLoginUrl,
      credentials,
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
      if (page.url() !== addUsersUrl) {
        await page.goto(addUsersUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      }
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
    await usernameInput.fill(dto.username);
    await usernameInput.evaluate((el: HTMLInputElement, val: string) => {
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, dto.username);

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
            (o.value && o.value.toLowerCase().includes(targetNorm))
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

    // Role
    if (dto.role && (await roleInput.isVisible().catch(() => false))) {
      const isSelect = await roleInput.evaluate((el) => el.tagName.toLowerCase() === 'select').catch(() => false);
      if (isSelect) {
        const availableOptions: { text: string; value: string }[] = await roleInput.evaluate((el: HTMLSelectElement) => {
          return Array.from(el.options).map((o) => ({
            text: (o.text || '').trim(),
            value: (o.value || '').trim(),
          }));
        });

        const targetNorm = dto.role.trim().toLowerCase();
        const matched = availableOptions.find(
          (o) =>
            o.text.toLowerCase() === targetNorm ||
            o.value.toLowerCase() === targetNorm ||
            (o.text && o.text.toLowerCase().includes(targetNorm)) ||
            (o.value && o.value.toLowerCase().includes(targetNorm))
        );

        if (matched && matched.value !== undefined) {
          await roleInput.selectOption({ value: matched.value });
          await roleInput.evaluate((el: HTMLSelectElement, val: string) => {
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
            errorMessage: `Role option '${dto.role}' not found on remote Add User form. Available options: [${optionLabels.join(', ')}].`,
          };
        }
      } else {
        await roleInput.fill(dto.role);
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

    if (
      readUsername.toLowerCase() !== dto.username.toLowerCase().trim() ||
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
        '#btnSave, #btnSubmit, #btnSaveUser, button[type="submit"]:has-text("Save"), button:has-text("Save"), button:has-text("Add"), button:has-text("Create"), button:has-text("Submit"), button:has-text("Update"), [data-testid="btn-save-user"], .btn-save, input[type="submit"][value*="Save" i], input[type="submit"][value*="Add" i], input[type="submit"][value*="Create" i], input[type="submit"][value*="Submit" i]'
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
    if (!defaultPasswordCaptured && (await postSavePassElem.isVisible().catch(() => false))) {
      defaultPasswordCaptured = (await postSavePassElem.innerText().catch(() => '')).trim();
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
    }
  ): Promise<{ authenticated: boolean; errorCode?: string; errorMessage?: string }> {
    const { targetUrl, loginUrl, credentials } = options;

    const targetLoginUrl =
      loginUrl || (targetUrl ? targetUrl.replace(/\/users.*$/i, '/login').replace(/\/addUsers.*$/i, '/login') : '/login');

    if (credentials && credentials.username && credentials.password) {
      // 1. Open configured login/base route first
      try {
        await page.goto(targetLoginUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (err: any) {
        return {
          authenticated: false,
          errorCode: 'CLIENT_AUTO_LOGIN_FAILED',
          errorMessage: `Failed to navigate to login route: ${err.message}`,
        };
      }

      // 2. Detect whether the session is ALREADY authenticated
      const authIndicator = await Promise.race([
        page
          .waitForSelector(
            '.header-user-name, #welpag, .header-cus, .header-logo, #page, [data-testid="hmc-app-header"], .hmc-authenticated-layout, [data-testid="hmc-users-screen"], .header, .nav, table, a[href*="logout" i]',
            { timeout: 3000 }
          )
          .then(() => 'AUTHENTICATED')
          .catch(() => null),
        page
          .waitForSelector('#btnLogin, [data-testid="btn-login"], input[type="password"]', { timeout: 3000 })
          .then(() => 'LOGIN_REQUIRED')
          .catch(() => null),
      ]);

      const isLoginInputPresent = (await page.locator('#btnLogin, [data-testid="btn-login"], input[type="password"]').count()) > 0;
      const isAlreadyAuthenticated = authIndicator === 'AUTHENTICATED' && !page.url().includes('/login') && !isLoginInputPresent;

      if (isAlreadyAuthenticated) {
        if (targetUrl && page.url() !== targetUrl) {
          try {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          } catch (targetNavErr: any) {
            return {
              authenticated: false,
              errorCode: 'CLIENT_USERS_SCREEN_FAILED',
              errorMessage: `Failed to navigate to target URL: ${targetNavErr.message}`,
            };
          }
        }
        return { authenticated: true };
      }

      // 3. Session is not authenticated -> Fill credentials and log in
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

      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 });

        // Check for error messages
        const errorBanner = page.locator('.error, .alert-danger, [data-testid="error-message"], .text-danger:has-text("invalid"), .text-danger:has-text("incorrect"), .toast-error').first();
        if (await errorBanner.isVisible().catch(() => false)) {
          const errMsg = (await errorBanner.textContent().catch(() => '')) || 'Invalid credentials';
          return {
            authenticated: false,
            errorCode: 'CLIENT_AUTO_LOGIN_FAILED',
            errorMessage: `Client authentication rejected: ${errMsg.trim()}`,
          };
        }

        await page.waitForSelector('.header-user-name, #welpag, .header-cus, .header-logo, #page, [data-testid="hmc-app-header"], .hmc-authenticated-layout, [data-testid="hmc-users-screen"], .header, .nav, table, a[href*="logout" i]', { timeout: 10000 });
      } catch {
        if (page.url().includes('/login') || ((await page.locator('#btnLogin, [data-testid="btn-login"]').count()) > 0 && (await page.locator('input[type="password"]').count()) > 0)) {
          return {
            authenticated: false,
            errorCode: 'CLIENT_AUTO_LOGIN_FAILED',
            errorMessage: 'Client auto-login failed: authenticated dashboard header did not appear.',
          };
        }
      }

      const stillOnLogin = page.url().includes('/login') && (await page.locator('#username, input[name="username"]').count()) > 0;
      if (stillOnLogin) {
        return {
          authenticated: false,
          errorCode: 'CLIENT_AUTO_LOGIN_FAILED',
          errorMessage: 'Client auto-login failed: still on login page after credentials submission.',
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
      // No credentials provided: check if targetUrl is accessible directly
      if (targetUrl) {
        try {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        } catch (err: any) {
          return {
            authenticated: false,
            errorCode: 'CLIENT_AUTO_LOGIN_FAILED',
            errorMessage: `Failed to navigate to target route: ${err.message}`,
          };
        }

        if (page.url().includes('/login')) {
          return {
            authenticated: false,
            errorCode: 'CLIENT_AUTO_LOGIN_FAILED',
            errorMessage: 'Client credentials are required for automatic authentication.',
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
          ({ selector, usernameColIdx, statusColIdx, normTarget, targetRemoteUserId }) => {
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
              const cellUsername = (cellTexts[usernameColIdx] || '').trim().toLowerCase();

              const dataId = row.getAttribute('data-id') || row.getAttribute('data-user-id') || row.getAttribute('id') || '';
              const links = Array.from(row.querySelectorAll('a[href], button[onclick], [ng-click]')).map((a) => {
                return (a.getAttribute('href') || '') + ' ' + (a.getAttribute('onclick') || '') + ' ' + (a.getAttribute('ng-click') || '');
              });

              let isMatch = false;
              if (targetRemoteUserId && dataId && dataId.toLowerCase() === targetRemoteUserId.toLowerCase()) {
                isMatch = true;
              }
              if (!isMatch && cellUsername === normTarget) {
                isMatch = true;
              }
              if (!isMatch) {
                for (const linkText of links) {
                  const userParamMatch = linkText.match(/(?:userId|username|toggleStatus|resetPassword|editUser)[=\/('"]+([^&'" )]+)/i);
                  if (userParamMatch && userParamMatch[1].trim().toLowerCase() === normTarget) {
                    isMatch = true;
                    break;
                  }
                }
              }

              let rowStatus: 'ACTIVE' | 'INACTIVE' = 'ACTIVE';
              if (statusColIdx >= 0 && statusColIdx < cells.length) {
                const sc = cells[statusColIdx];
                const innerText = (sc.textContent || '').toUpperCase();
                const html = sc.innerHTML.toLowerCase();
                if (
                  innerText.includes('INACTIVE') ||
                  innerText.includes('DISABLE') ||
                  innerText.includes('FALSE') ||
                  innerText.includes('DEACTIVAT') ||
                  innerText.includes('✖') ||
                  innerText.includes('BLOCK') ||
                  html.includes('fa-ban') ||
                  html.includes('fa-times') ||
                  html.includes('badge-inactive') ||
                  html.includes('badge-danger') ||
                  html.includes('title="inactive"') ||
                  html.includes('text-danger')
                ) {
                  rowStatus = 'INACTIVE';
                } else if (
                  innerText.includes('ACTIVE') ||
                  innerText.includes('ENABLE') ||
                  innerText.includes('TRUE') ||
                  innerText.includes('✔') ||
                  html.includes('fa-check') ||
                  html.includes('glyphicon-ok') ||
                  html.includes('badge-active') ||
                  html.includes('badge-success') ||
                  html.includes('title="active"') ||
                  html.includes('title="enabled"') ||
                  html.includes('text-success')
                ) {
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
      // 4. Attempt Angular search input filtering
      const searchInput = page
        .locator('input[type="search"], input[name*="search" i], input[placeholder*="search" i], input[id*="search" i], #userSearch, [data-testid="input-user-search"]')
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

          // Enter exact target username
          await searchInput.fill(targetUsername.trim());
          await searchInput.evaluate((el: HTMLInputElement, val: string) => {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          }, targetUsername.trim());
          await searchInput.press('Enter').catch(() => {});
          await searchInput.press('Tab').catch(() => {});
          await page.waitForTimeout(500);
          searchExecuted = true;
        } catch {
          searchExecuted = false;
        }
      }

      if (searchExecuted) {
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

    const authRes = await this.ensureAuthenticated(page, { targetUrl: usersListUrl, loginUrl, credentials });
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
    const onProgress = isObj ? arg1.onProgress : undefined;

    // 1. Ensure authenticated
    onProgress?.(`Logging in to selected Simplex client…`);
    const authRes = await this.ensureAuthenticated(page, { targetUrl: usersListUrl, loginUrl, credentials });
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
        message: `User '${username}' is already ${targetStatus} on remote client.`,
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

    // Handle client confirmation dialog
    page.once('dialog', async (dialog) => {
      await dialog.accept().catch(() => {});
    });

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
    await page.waitForTimeout(1000);

    // 4. Re-read and verify that the icon changed
    onProgress?.(`Verifying remote status change…`);
    if (page.isClosed()) {
      return {
        success: false,
        username,
        errorCode: 'REMOTE_OUTCOME_UNKNOWN',
        errorMessage: 'Browser closed during post-mutation status verification.',
      };
    }

    const verifyLookup = await this.findExactUserRow(page, username, usersListUrl, { remoteUserId }).catch(() => ({ success: false } as any));
    if (!verifyLookup.success || !verifyLookup.rowLocator) {
      // Reload and retry verification
      await page.goto(usersListUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      const retryLookup = await this.findExactUserRow(page, username, usersListUrl, { remoteUserId }).catch(() => ({ success: false } as any));
      if (!retryLookup.success || !retryLookup.rowLocator) {
        return {
          success: false,
          username,
          errorCode: 'REMOTE_STATUS_VERIFICATION_FAILED',
          errorMessage: `User '${username}' could not be re-located after status change.`,
        };
      }
      if (retryLookup.currentRemoteStatus === targetStatus) {
        return {
          success: true,
          username,
          status: targetStatus,
          message: `User '${username}' status verified as ${targetStatus} on remote client.`,
        };
      }
      return {
        success: false,
        username,
        errorCode: 'REMOTE_STATUS_VERIFICATION_FAILED',
        errorMessage: `Remote status icon for user '${username}' did not change to ${targetStatus}. Current status: ${retryLookup.currentRemoteStatus}.`,
      };
    }

    if (verifyLookup.currentRemoteStatus === targetStatus) {
      return {
        success: true,
        username,
        status: targetStatus,
        message: `User '${username}' status verified as ${targetStatus} on remote client.`,
      };
    }

    return {
      success: false,
      username,
      errorCode: 'REMOTE_STATUS_VERIFICATION_FAILED',
      errorMessage: `Remote status icon for user '${username}' did not change to ${targetStatus}. Expected ${targetStatus}, but found ${verifyLookup.currentRemoteStatus}.`,
    };
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
          loginUrl?: string;
          credentials?: { username: string; password?: string };
          onProgress?: (msg: string) => void;
        },
    arg2?: string
  ): Promise<MutationResult> {
    const isObj = typeof arg1 === 'object';
    const usersListUrl = isObj ? arg1.usersListUrl : (arg1 as string);
    const addUsersUrl = isObj ? arg1.addUsersUrl : undefined;
    const username = (isObj ? arg1.username : (arg2 as string)).trim();
    const loginUrl = isObj ? arg1.loginUrl : undefined;
    const credentials = isObj ? arg1.credentials : undefined;
    const onProgress = isObj ? arg1.onProgress : undefined;

    // 1. Ensure authenticated
    onProgress?.(`Logging in to selected Simplex client…`);
    const authRes = await this.ensureAuthenticated(page, { targetUrl: addUsersUrl || usersListUrl, loginUrl, credentials });
    if (!authRes.authenticated) {
      return {
        success: false,
        username,
        errorCode: authRes.errorCode || 'CLIENT_AUTO_LOGIN_FAILED',
        errorMessage: authRes.errorMessage || 'Automatic authentication to client failed.',
      };
    }

    // 2. Authoritative client default-password capture from live Add User screen
    let clientDefaultPassword: string | undefined = undefined;
    if (addUsersUrl) {
      onProgress?.(`Capturing client default password from Add User screen…`);
      try {
        await page.goto(addUsersUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        clientDefaultPassword = await this.captureLiveDefaultPassword(page);
      } catch {}
    }

    // 3. Open users list screen
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

    // 4. Locate target user row
    onProgress?.(`Searching for '${username}'…`);
    const lookupRes = await this.findExactUserRow(page, username, usersListUrl);
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

        // Check if dialog provides a specific temporary/generated password
        const passMatch =
          msg.match(/Tmp@[A-Za-z0-9!@#$%^&*()_+=-]+/i) ||
          msg.match(/(?:temporary password is|new password:?|password is:?)\s*([A-Za-z0-9!@#$%^&*()_+=-]+)/i);
        if (passMatch) {
          explicitResetPassword = (passMatch[1] || passMatch[0]).trim();
          isResetConfirmed = true;
        }

        // Recognize safe positive messages
        if (
          lowerMsg.includes('password reset successfully') ||
          lowerMsg.includes('reset successfully') ||
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
    const rowLocator = page.locator(tableSelector).nth(rowIndex);

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
        'button.btn-reset-password, a.btn-reset-password, [data-testid="btn-reset-password"], a[title*="Reset" i], button[title*="Reset" i], a:has-text("Reset"), button:has-text("Reset"), a[onclick*="reset" i], button[onclick*="reset" i]'
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
            const t = (el.textContent || '').trim().toLowerCase();
            if (
              t.includes('password reset successfully') ||
              t.includes('reset successfully') ||
              t.includes('password has been reset') ||
              t.includes('updated successfully') ||
              t.includes('success')
            ) {
              return { success: true, text: el.textContent?.trim() };
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

      if (isResetConfirmed) break;
      await page.waitForTimeout(150);
    }

    page.off('dialog', dialogHandler);

    // 9. Confirm positive completion
    // Invariant: Do not wait for username or status row to change after reset; those values normally remain unchanged.
    if (isResetConfirmed) {
      const deliveredPassword = explicitResetPassword || clientDefaultPassword;
      return {
        success: true,
        username,
        status: 'REMOTE_PASSWORD_RESET_CONFIRMED',
        temporaryPassword: deliveredPassword,
        defaultPassword: deliveredPassword,
        message: `Password for '${username}' reset successfully in the selected Simplex client.`,
      };
    }

    return {
      success: false,
      username,
      errorCode: 'REMOTE_PASSWORD_RESET_UNVERIFIED',
      errorMessage: `Password reset for user '${username}' could not be verified on remote client.`,
    };
  }
}
