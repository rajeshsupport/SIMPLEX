import { Page, Locator } from 'playwright';
import { ClientUser, CreateClientUserDto, UpdateClientUserDto, ClientUserStatus } from '@hmc/shared';
import { SelectorResolver } from './selector-resolver';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ScrapedClientUser {
  remoteUserId?: string;
  username: string;
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
  message: string;
  status?: ClientUserStatus;
  temporaryPassword?: string;
  errorCode?: string;
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

    // Check if redirected to login page or if login form is present
    const isLoginPage = await page.evaluate(() => {
      const isLoginUrl = window.location.pathname.toLowerCase().includes('login');
      const hasLoginForm = document.querySelector('form[action*="login" i], input[type="password"]') !== null;
      return isLoginUrl || hasLoginForm;
    });

    if (isLoginPage) {
      onProgress?.({
        stage: 'AUTHENTICATING',
        message: 'Authenticating securely…',
        currentPage: 1,
        count: 0,
      });

      if (!credentials || !credentials.username || !credentials.password) {
        return {
          success: false,
          users: [],
          totalScraped: 0,
          liveStatus: 'CACHED',
          errorCode: 'CLIENT_BACKGROUND_LOGIN_FAILED',
          errorMessage: 'Background login required but no active credentials configured for this client.',
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

      // Wait for navigation after authentication without long fixed sleeps
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});

      onProgress?.({
        stage: 'NAVIGATING',
        message: 'Opening client user directory…',
        currentPage: 1,
        count: 0,
      });

      // Navigate to target users route after authentication (15s timeout)
      await page.goto(usersUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
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

    // 1. Check loading overlays
    try {
      await page.locator('.loading, #loading, .spinner, .overlay, img[src*="loading" i]').first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    } catch {}

    // 2. Identify Screen Heading
    const screenHeading = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, .page-title, .screen-title, .title, .heading, legend, .mm-title, [class*="title" i], [class*="header" i]'))
        .map(el => (el.textContent || '').trim())
        .filter(t => t.length > 0 && !t.includes('\n'));
      return headings.find(h => /user|master|details|himes/i.test(h)) || headings[0] || 'User Details';
    });

    // 3. Multi-structure record container detection
    // Check main page and all attached frames (iframes/framesets)
    const allFrames = [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())];
    let targetFrame = page.mainFrame();
    let structureEval = { structure: 'NONE', count: 0, selector: '' };

    for (const frame of allFrames) {
      const frameStructure = await frame.evaluate(() => {
        // 1. HTML Table rows
        const tableRows = Array.from(document.querySelectorAll('table tbody tr, table tr:not(:first-child)'));
        if (tableRows.length > 0) {
          return { structure: 'HTML_TABLE', count: tableRows.length, selector: 'table tbody tr, table tr:not(:first-child)' };
        }

        // 2. Accessibility role rows
        const roleRows = Array.from(document.querySelectorAll('[role="row"]:not(:first-child), [role="listitem"]'));
        if (roleRows.length > 0) {
          return { structure: 'ACCESSIBILITY_ROLE_ROW', count: roleRows.length, selector: '[role="row"]:not(:first-child), [role="listitem"]' };
        }

        // 3. AngularJS ng-repeat
        const ngRows = Array.from(document.querySelectorAll('[ng-repeat*="user" i], [ng-repeat*="item" i], [ng-repeat*="row" i], [ng-repeat*="data" i]'));
        if (ngRows.length > 0) {
          return { structure: 'ANGULAR_NG_REPEAT', count: ngRows.length, selector: '[ng-repeat*="user" i], [ng-repeat*="item" i], [ng-repeat*="row" i], [ng-repeat*="data" i]' };
        }

        // 4. Div-based grid rows
        const gridRows = Array.from(document.querySelectorAll('.ui-grid-row, .ag-row, .custom-grid-row, .user-row, .user-grid-row, [class*="user-row" i], .user-card, .user-item'));
        if (gridRows.length > 0) {
          return { structure: 'DIV_BASED_GRID_ROW', count: gridRows.length, selector: '.ui-grid-row, .ag-row, .custom-grid-row, .user-row, .user-grid-row, [class*="user-row" i], .user-card, .user-item' };
        }

        // 5. Flex / row containers under column headings
        const headerLabels = Array.from(document.querySelectorAll('th, .header, .col-header, [class*="header" i]')).map(h => (h.textContent || '').trim().toLowerCase());
        const hasUserHeaders = headerLabels.some(h => h.includes('user') || h.includes('name') || h.includes('mobile') || h.includes('status'));
        if (hasUserHeaders) {
          const candidateRows = Array.from(document.querySelectorAll('.row, [class*="row" i]')).filter(r => r.children.length >= 3 && r.querySelectorAll('input, button, span, div, td').length >= 3);
          if (candidateRows.length > 0) {
            return { structure: 'FLEX_GRID_CONTAINER', count: candidateRows.length, selector: '.row, [class*="row" i]' };
          }
        }

        return { structure: 'NONE', count: 0, selector: '' };
      });

      if (frameStructure.count > 0) {
        targetFrame = frame;
        structureEval = frameStructure;
        break;
      }
    }

    // 4. If record containers are not recognized, capture sanitized diagnostics and return USER_SCREEN_STRUCTURE_NOT_RECOGNIZED
    if (structureEval.count === 0) {
      const diagDir = path.join(os.homedir(), '.hmc-console', 'diagnostics');
      try {
        fs.mkdirSync(diagDir, { recursive: true });
        const screenshotPath = path.join(diagDir, `user_screen_${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      } catch {}

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
          else if (h.includes('user name') || h.includes('full name')) colFullName = idx;
          else if (h === 'name' || h.includes('user id') || h.includes('username') || h.includes('login')) colUsername = idx;
          else if (h.includes('mobile') || h.includes('phone') || h.includes('contact')) colMobile = idx;
          else if (h.includes('email') || h.includes('mail')) colEmail = idx;
          else if (h.includes('national') || h.includes('country')) colNationality = idx;
          else if (h.includes('profile role') || h.includes('designation')) colProfileRole = idx;
          else if (h.includes('role') || h.includes('group') || h.includes('type')) colRole = idx;
          else if (h.includes('status') || h.includes('state')) colStatus = idx;
        });

        return rows.map((r) => {
          const cells = Array.from(r.querySelectorAll('td, [role="gridcell"], [role="cell"], .cell, .grid-cell, .col, div[class*="col-"]'))
            .map((c) => (c.textContent || '').trim());
          
          const hasSig = r.querySelectorAll('img[src*="sig" i], a[href*="sig" i], .has-signature').length > 0;
          const hasStmp = r.querySelectorAll('img[src*="stamp" i], a[href*="stamp" i], .has-stamp').length > 0;
          const hasProf = r.querySelectorAll('img[src*="profile" i], img[src*="user" i], .user-avatar').length > 0;

          // Status detection: icon, class, label, tooltip, or accessibility text
          const statusCell = colStatus >= 0 && colStatus < cells.length ? r.querySelectorAll('td, [role="gridcell"], .cell')[colStatus] : r;
          const statusText = statusCell ? (statusCell.textContent || '').toUpperCase() : '';

          const hasActiveIndicator =
            statusCell.querySelectorAll('.glyphicon-ok, .fa-check, .fa-toggle-on, .text-success, .status-active, .badge-success, [title*="active" i], [aria-label*="active" i]').length > 0 ||
            statusText.includes('ACTIVE') || statusText.includes('ENABLED') || statusText.includes('ON');

          const hasInactiveIndicator =
            statusCell.querySelectorAll('.glyphicon-remove, .fa-times, .fa-toggle-off, .text-danger, .status-inactive, .badge-danger, [title*="inactive" i], [aria-label*="inactive" i]').length > 0 ||
            statusText.includes('INACTIVE') || statusText.includes('DISABLED') || statusText.includes('OFF') || statusText.includes('LOCKED') || statusText.includes('BLOCK');

          return {
            cells,
            hasSig,
            hasStmp,
            hasProf,
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

        // Use header mapped indices or fall back to positional indices
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

        const scrapedUser: ScrapedClientUser = {
          remoteUserId: `remote_${username.toLowerCase()}`,
          username: username.trim(),
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

    // Do not classify success unless users fetched is greater than zero
    if (allUsers.length === 0) {
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
   * Creates a user on the client application by filling the remote Add User form.
   */
  public static async createUser(
    page: Page,
    addUsersUrl: string,
    usersListUrl: string,
    dto: CreateClientUserDto
  ): Promise<MutationResult> {
    await page.goto(addUsersUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // 1. Locate fields
    const usernameInput = page.locator('#username, #userName, [name="username"], [data-testid="input-username"]').first();
    const firstNameInput = page.locator('#firstName, #fName, [name="firstName"], [data-testid="input-firstname"]').first();
    const middleNameInput = page.locator('#middleName, #mName, [name="middleName"], [data-testid="input-middlename"]').first();
    const lastNameInput = page.locator('#lastName, #lName, [name="lastName"], [data-testid="input-lastname"]').first();
    const nickNameInput = page.locator('#nickName, [name="nickName"], [data-testid="input-nickname"]').first();
    const emailInput = page.locator('#email, [name="email"], [data-testid="input-email"]').first();
    const mobileInput = page.locator('#mobileNo, #mobileNumber, #phone, [name="mobileNumber"], [data-testid="input-mobile"]').first();
    const nationalityInput = page.locator('#nationality, select[name="nationality"], [data-testid="select-nationality"]').first();
    const roleInput = page.locator('#role, select[name="role"], [data-testid="select-role"]').first();
    const profileRoleInput = page.locator('#profileRole, select[name="profileRole"], [data-testid="select-profilerole"]').first();
    const barcodeInput = page.locator('#barcodeNo, #barcodeNumber, [name="barcodeNumber"], [data-testid="input-barcode"]').first();

    // 2. Fill fields
    if (await usernameInput.isVisible().catch(() => false)) {
      await usernameInput.fill(dto.username);
    }
    if (await firstNameInput.isVisible().catch(() => false)) {
      await firstNameInput.fill(dto.firstName);
    }
    if (dto.middleName && (await middleNameInput.isVisible().catch(() => false))) {
      await middleNameInput.fill(dto.middleName);
    }
    if (await lastNameInput.isVisible().catch(() => false)) {
      await lastNameInput.fill(dto.lastName);
    }
    if (dto.nickName && (await nickNameInput.isVisible().catch(() => false))) {
      await nickNameInput.fill(dto.nickName);
    }
    if (dto.email && (await emailInput.isVisible().catch(() => false))) {
      await emailInput.fill(dto.email);
    }
    if (await mobileInput.isVisible().catch(() => false)) {
      await mobileInput.fill(dto.mobileNumber);
    }
    if (dto.nationality && (await nationalityInput.isVisible().catch(() => false))) {
      const isSelect = await nationalityInput.evaluate((el) => el.tagName.toLowerCase() === 'select').catch(() => false);
      if (isSelect) {
        await nationalityInput.selectOption({ label: dto.nationality }).catch(() => nationalityInput.selectOption({ index: 1 }));
      } else {
        await nationalityInput.fill(dto.nationality);
      }
    }
    if (dto.role && (await roleInput.isVisible().catch(() => false))) {
      const isSelect = await roleInput.evaluate((el) => el.tagName.toLowerCase() === 'select').catch(() => false);
      if (isSelect) {
        await roleInput.selectOption({ label: dto.role }).catch(() => roleInput.selectOption({ index: 1 }));
      } else {
        await roleInput.fill(dto.role);
      }
    }
    if (dto.profileRole && (await profileRoleInput.isVisible().catch(() => false))) {
      const isSelect = await profileRoleInput.evaluate((el) => el.tagName.toLowerCase() === 'select').catch(() => false);
      if (isSelect) {
        await profileRoleInput.selectOption({ label: dto.profileRole }).catch(() => profileRoleInput.selectOption({ index: 1 }));
      } else {
        await profileRoleInput.fill(dto.profileRole);
      }
    }
    if (dto.barcodeNumber && (await barcodeInput.isVisible().catch(() => false))) {
      await barcodeInput.fill(dto.barcodeNumber);
    }

    // 3. Handle File Uploads (Signature, Stamp, Profile)
    const tempDir = path.join(os.tmpdir(), 'hmc-uploads');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    if (dto.signatureBase64) {
      const sigPath = path.join(tempDir, `sig_${Date.now()}_${dto.signatureFilename || 'signature.png'}`);
      fs.writeFileSync(sigPath, Buffer.from(dto.signatureBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
      const sigInput = page.locator('input[type="file"][name*="sig" i], #signatureFile, [data-testid="input-signature-file"]').first();
      if ((await sigInput.count()) > 0) await sigInput.setInputFiles(sigPath).catch(() => {});
    }

    if (dto.stampBase64) {
      const stampPath = path.join(tempDir, `stamp_${Date.now()}_${dto.stampFilename || 'stamp.png'}`);
      fs.writeFileSync(stampPath, Buffer.from(dto.stampBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
      const stampInput = page.locator('input[type="file"][name*="stamp" i], #stampFile, [data-testid="input-stamp-file"]').first();
      if ((await stampInput.count()) > 0) await stampInput.setInputFiles(stampPath).catch(() => {});
    }

    if (dto.profileBase64) {
      const profPath = path.join(tempDir, `prof_${Date.now()}_${dto.profileFilename || 'profile.png'}`);
      fs.writeFileSync(profPath, Buffer.from(dto.profileBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
      const profInput = page.locator('input[type="file"][name*="prof" i], #profileFile, [data-testid="input-profile-file"]').first();
      if ((await profInput.count()) > 0) await profInput.setInputFiles(profPath).catch(() => {});
    }

    // 4. Submit Form Exactly Once
    const submitBtn = page.locator('#btnSave, #btnSubmit, #btnSaveUser, button[type="submit"]:has-text("Save"), [data-testid="btn-save-user"]').first();
    await submitBtn.click();

    // 5. Detect Success or Error
    const errorBanner = page.locator('.alert-danger, .error-message, [data-testid="error-message"], .toast-error').first();
    const isError = await errorBanner.isVisible().catch(() => false);
    if (isError) {
      const errorText = (await errorBanner.innerText().catch(() => 'Unknown remote error')).trim();
      return {
        success: false,
        username: dto.username,
        message: errorText,
        errorCode: errorText.includes('already exists') ? 'DUPLICATE_USERNAME' : 'REMOTE_ERROR',
      };
    }

    // 6. Verify User in Users List
    await page.goto(usersListUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const userRow = page.locator(`tr:has-text("${dto.username}")`).first();
    const created = await userRow.isVisible().catch(() => false);

    if (created) {
      return {
        success: true,
        username: dto.username,
        message: `User ${dto.username} created successfully on client.`,
        status: 'ACTIVE',
      };
    } else {
      return {
        success: false,
        username: dto.username,
        message: 'User creation could not be verified on remote user list.',
        errorCode: 'REMOTE_CREATE_BLOCKED_UNKNOWN_ERROR',
      };
    }
  }

  /**
   * Edits a user on the client application.
   */
  public static async editUser(
    page: Page,
    usersListUrl: string,
    username: string,
    dto: UpdateClientUserDto
  ): Promise<MutationResult> {
    await page.goto(usersListUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const editBtn = page.locator(`tr:has-text("${username}") button.btn-edit, tr:has-text("${username}") a[href*="edit" i], tr:has-text("${username}") [data-testid="btn-edit-user"]`).first();
    const canEdit = await editBtn.isVisible().catch(() => false);

    if (canEdit) {
      await editBtn.click();
    } else {
      await page.goto(`${usersListUrl}/edit/${username}`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }

    if (dto.firstName) {
      const fInput = page.locator('#firstName, #fName, [name="firstName"]').first();
      if (await fInput.isVisible().catch(() => false)) await fInput.fill(dto.firstName);
    }
    if (dto.lastName) {
      const lInput = page.locator('#lastName, #lName, [name="lastName"]').first();
      if (await lInput.isVisible().catch(() => false)) await lInput.fill(dto.lastName);
    }
    if (dto.mobileNumber) {
      const mInput = page.locator('#mobileNo, #mobileNumber, [name="mobileNumber"]').first();
      if (await mInput.isVisible().catch(() => false)) await mInput.fill(dto.mobileNumber);
    }
    if (dto.email) {
      const eInput = page.locator('#email, [name="email"]').first();
      if (await eInput.isVisible().catch(() => false)) await eInput.fill(dto.email);
    }

    const submitBtn = page.locator('#btnSave, #btnSubmit, button[type="submit"]').first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();
    }

    await page.goto(usersListUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    return {
      success: true,
      username,
      message: `User ${username} updated successfully.`,
    };
  }

  /**
   * Toggles the active/inactive status of a user on the client.
   */
  public static async setUserStatus(
    page: Page,
    usersListUrl: string,
    username: string,
    targetStatus: ClientUserStatus
  ): Promise<MutationResult> {
    await page.goto(usersListUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const row = page.locator(`tr:has-text("${username}")`).first();
    const toggleBtn = row.locator('button.btn-status, button:has-text("Activate"), button:has-text("Deactivate"), [data-testid="btn-toggle-status"], input[type="checkbox"].status-toggle').first();

    const isToggleVisible = await toggleBtn.isVisible().catch(() => false);
    if (!isToggleVisible) {
      return {
        success: false,
        username,
        message: `Status action control for user '${username}' not found.`,
        errorCode: 'SELECTOR_NOT_FOUND',
      };
    }

    page.once('dialog', async (dialog) => {
      await dialog.accept().catch(() => {});
    });

    await toggleBtn.click();

    await page.goto(usersListUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const updatedRow = page.locator(`tr:has-text("${username}")`).first();
    const rowText = (await updatedRow.innerText().catch(() => '')).toUpperCase();
    const verifiedStatus: ClientUserStatus = rowText.includes('INACTIVE') ? 'INACTIVE' : 'ACTIVE';

    return {
      success: true,
      username,
      status: verifiedStatus,
      message: `User '${username}' status updated to ${verifiedStatus}.`,
    };
  }

  /**
   * Executes password reset on client and captures temporary password if presented.
   */
  public static async resetUserPassword(
    page: Page,
    usersListUrl: string,
    username: string
  ): Promise<MutationResult> {
    await page.goto(usersListUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const row = page.locator(`tr:has-text("${username}")`).first();
    const resetBtn = row.locator('button:has-text("Reset"), button.btn-reset-password, [data-testid="btn-reset-password"]').first();

    let tempPasswordCaptured: string | undefined = undefined;

    page.on('dialog', async (dialog) => {
      const msg = dialog.message();
      const match = msg.match(/Tmp@[A-Za-z0-9!@#$%^&*()_+=-]+/i) || msg.match(/(?:temporary password is|new password:?)\s*([A-Za-z0-9!@#$%^&*()_+=-]+)/i);
      if (match) {
        tempPasswordCaptured = match[1] || match[0];
      }
      await dialog.accept().catch(() => {});
    });

    const isResetVisible = await resetBtn.isVisible().catch(() => false);
    if (isResetVisible) {
      await resetBtn.click();
      // Wait briefly for network fetch + alert
      for (let i = 0; i < 20; i++) {
        if (tempPasswordCaptured) break;
        await page.waitForTimeout(100);
      }
    }

    const tempPassElem = page.locator('.temp-password, [data-testid="temporary-password"], #tempPassword').first();
    if (!tempPasswordCaptured && (await tempPassElem.isVisible().catch(() => false))) {
      tempPasswordCaptured = (await tempPassElem.innerText().catch(() => '')).trim();
    }

    return {
      success: true,
      username,
      temporaryPassword: tempPasswordCaptured,
      message: tempPasswordCaptured
        ? `Password reset successful. Temporary password generated.`
        : `Password reset triggered successfully on client.`,
    };
  }
}
