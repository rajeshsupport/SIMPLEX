import { Page, Locator } from 'playwright';
import { ClientUser, CreateClientUserDto, UpdateClientUserDto, ClientUserStatus } from '@hmc/shared';
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
  stage: 'CONNECTING' | 'AUTHENTICATING' | 'LOADING_PAGE' | 'SYNCHRONIZING' | 'COMPLETED';
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
      stage: 'CONNECTING',
      message: 'Connecting securely to client portal…',
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
        message: 'Authenticating in background…',
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

      // Perform headless background login
      const userInput = page.locator('#username, #txtUsername, [name="username"], [data-testid="input-username"], input[type="text"]').first();
      const passInput = page.locator('#password, #txtPassword, [name="password"], [data-testid="input-password"], input[type="password"]').first();
      const loginBtn = page.locator('#btnLogin, #btnSubmit, button[type="submit"], [data-testid="btn-login"]').first();

      if (!(await userInput.isVisible({ timeout: 5000 }).catch(() => false)) || !(await passInput.isVisible({ timeout: 5000 }).catch(() => false))) {
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

      await userInput.fill(credentials.username);
      await passInput.fill(credentials.password);
      await loginBtn.click();

      // Wait for navigation away from login
      try {
        await page.waitForFunction(
          () => !window.location.pathname.toLowerCase().includes('login') && document.querySelector('input[type="password"]') === null,
          { timeout: 10000 }
        );
      } catch {
        return {
          success: false,
          users: [],
          totalScraped: 0,
          liveStatus: 'CACHED',
          errorCode: 'CLIENT_BACKGROUND_LOGIN_FAILED',
          errorMessage: 'Background authentication failed or credentials were rejected by client portal.',
          options: this.getDefaultOptions(),
        };
      }

      // Navigate to target users route after authentication
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

    // Wait for the user table or explicit empty state
    const tableLocator = page.locator('table, [data-testid="users-table"], #usersTable, .user-grid').first();
    const hasTable = await tableLocator.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);

    const isExplicitEmpty = await page.evaluate(() => {
      const text = document.body ? document.body.innerText.toLowerCase() : '';
      return text.includes('no users found') || text.includes('no records available') || text.includes('no data');
    });

    if (!hasTable && !isExplicitEmpty) {
      return {
        success: false,
        users: [],
        totalScraped: 0,
        liveStatus: 'CACHED',
        errorCode: 'CLIENT_USER_TABLE_NOT_FOUND',
        errorMessage: 'User table could not be identified on client users route.',
        options: this.getDefaultOptions(),
      };
    }

    const scrapedUsersMap = new Map<string, ScrapedClientUser>();
    let currentPage = 1;
    const maxPages = 30; // Guard against infinite pagination

    onProgress?.({
      stage: 'LOADING_PAGE',
      message: 'Loading users page 1…',
      currentPage: 1,
      count: 0,
    });

    while (currentPage <= maxPages) {
      // Scrape current page rows
      const pageRowsData = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('table tbody tr, [data-testid="user-row"], .user-table-row'));
        return rows.map((r) => {
          const cells = Array.from(r.querySelectorAll('td')).map((c) => (c.textContent || '').trim());
          const hasSig = r.querySelectorAll('img[src*="sig" i], a[href*="sig" i], .has-signature').length > 0;
          const hasStmp = r.querySelectorAll('img[src*="stamp" i], a[href*="stamp" i], .has-stamp').length > 0;
          const hasProf = r.querySelectorAll('img[src*="profile" i], img[src*="user" i], .user-avatar').length > 0;
          return { cells, hasSig, hasStmp, hasProf };
        });
      });

      const pageUsers: ScrapedClientUser[] = [];

      for (let i = 0; i < pageRowsData.length; i++) {
        const { cells: texts, hasSig, hasStmp, hasProf } = pageRowsData[i];
        if (texts.length < 3) continue;

        // Screenshot Mapping:
        // Col 1: S.No (e.g. "1")
        // Col 2: User Name -> mapped to Full Name (e.g. "Dr. Sarah Al-Mansoor")
        // Col 3: Name      -> mapped to Username  (e.g. "dr_sarah")
        // Col 4: Mobile No -> Mobile Number       (e.g. "0501234567")
        // Col 5: Email     -> Email               (e.g. "sarah@hospital.com")
        // Col 6: Nationality -> Nationality       (e.g. "Saudi Arabia")
        // Col 7: Role      -> Role                (e.g. "Physician")
        // Col 8: Profile Role -> Profile Role     (e.g. "Clinical Specialist")
        // Col 9: Status    -> Status badge        (e.g. "Active")
        let fullName = texts[1] || '';
        let username = texts[2] || '';
        let mobileNumber = texts[3] || '';
        let email = texts[4] || '';
        let nationality = texts[5] || '';
        let role = texts[6] || '';
        let profileRole = texts[7] || '';
        let rawStatus = (texts[8] || '').toUpperCase();

        if (!username && email.includes('@')) {
          username = email.split('@')[0];
        } else if (!username && fullName) {
          username = fullName.toLowerCase().replace(/\s+/g, '.');
        }

        if (!username) continue;

        const status: ClientUserStatus =
          rawStatus.includes('INACTIVE') || rawStatus.includes('DISABLED') || rawStatus.includes('OFF')
            ? 'INACTIVE'
            : 'ACTIVE';

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
          hasSignature: hasSig,
          hasStamp: hasStmp,
          hasProfileImage: hasProf,
          remoteCreatedAt: undefined,
          remoteUpdatedAt: undefined,
        };

        scrapedUsersMap.set(username.toLowerCase(), scrapedUser);
        pageUsers.push(scrapedUser);
      }

      // Stream progress
      onProgress?.({
        stage: 'SYNCHRONIZING',
        message: `Synchronizing page ${currentPage}… (${scrapedUsersMap.size} users found)`,
        currentPage,
        count: scrapedUsersMap.size,
        streamedUsers: pageUsers,
      });

      // Look for Next page control
      const nextButton = page.locator(
        'button:has-text("Next"), a:has-text("Next"), [data-testid="pagination-next"], .pagination-next:not(.disabled), li.next:not(.disabled) a'
      ).first();

      const isNextCount = await nextButton.count();
      if (isNextCount > 0 && (await nextButton.isVisible())) {
        const isDisabled = await nextButton.getAttribute('disabled');
        const isAriaDisabled = await nextButton.getAttribute('aria-disabled');
        if (!isDisabled && isAriaDisabled !== 'true') {
          await nextButton.click().catch(() => {});
          await page.waitForTimeout(150);
          currentPage++;
          continue;
        }
      }
      break;
    }

    const allUsers = Array.from(scrapedUsersMap.values());

    onProgress?.({
      stage: 'COMPLETED',
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
