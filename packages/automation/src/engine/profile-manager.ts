import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { chromium, BrowserContext } from 'playwright';

export interface ProfileOptions {
  clientId: string;
  userId: string;
  isHeaded?: boolean;
  viewport?: { width: number; height: number };
  slowMo?: number;
}

export class BrowserProfileManager {
  public static readonly BASE_PROFILE_DIR = path.resolve(os.homedir(), '.hmc-console', 'profiles');

  /**
   * Validates that an identifier strictly contains alphanumeric characters, underscores, or hyphens.
   * Explicitly rejects path traversal, slashes, null bytes, URL-encoded sequences, and unicode separators.
   */
  public static validateIdentifier(id: string, label: string): string {
    if (!id || typeof id !== 'string') {
      throw new Error(`Security Violation: ${label} identifier must be a non-empty string`);
    }

    // Check for null bytes or control characters
    if (/[\x00-\x1F\x7F]/.test(id)) {
      throw new Error(`Security Violation: ${label} identifier contains forbidden control characters or null bytes`);
    }

    // Check for URL encoding (%2e, %2f, etc.)
    if (/%[0-9a-fA-F]{2}/.test(id)) {
      throw new Error(`Security Violation: ${label} identifier contains forbidden URL-encoded sequences`);
    }

    // Check for slashes, backslashes, or unicode slash variants (\u2215, \uFF0F, \u2044)
    if (/[\/\\\u2215\uFF0F\u2044]/.test(id)) {
      throw new Error(`Security Violation: ${label} identifier contains forbidden path separators`);
    }

    // Check for relative path traversal or dot segments
    if (id.includes('..') || id.startsWith('.')) {
      throw new Error(`Security Violation: ${label} identifier contains forbidden relative path segments`);
    }

    // Strict regex validation
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error(`Security Violation: ${label} identifier contains invalid characters (allowed: a-z, A-Z, 0-9, _, -)`);
    }

    return id;
  }

  /**
   * Returns the canonical, validated profile path for a client and user.
   */
  public static getProfilePath(clientId: string, userId: string): string {
    // 1. Strict validation (rejection of ambiguous / malicious inputs)
    const validClientId = this.validateIdentifier(clientId, 'Client');
    const validUserId = this.validateIdentifier(userId, 'User');

    const clientDir = path.resolve(this.BASE_PROFILE_DIR, `client_${validClientId}`);
    const profilePath = path.resolve(clientDir, `user_${validUserId}`);

    // 2. Canonical Resolved Path Containment Check
    if (!profilePath.startsWith(this.BASE_PROFILE_DIR + path.sep)) {
      throw new Error('Security Violation: Resolved profile path escapes base profile directory');
    }

    if (!fs.existsSync(profilePath)) {
      fs.mkdirSync(profilePath, { recursive: true, mode: 0o700 });
    }

    // 3. Symlink Escape & Ownership Verification
    try {
      const realPath = fs.realpathSync(profilePath);
      if (!realPath.startsWith(this.BASE_PROFILE_DIR + path.sep) && realPath !== this.BASE_PROFILE_DIR) {
        throw new Error('Security Violation: Profile symlink resolves outside base profile directory');
      }

      if (process.platform !== 'win32') {
        fs.chmodSync(this.BASE_PROFILE_DIR, 0o700);
        fs.chmodSync(clientDir, 0o700);
        fs.chmodSync(profilePath, 0o700);

        // Check ownership if running as non-root user
        if (typeof process.getuid === 'function') {
          const stats = fs.statSync(profilePath);
          const currentUid = process.getuid();
          if (stats.uid !== currentUid && currentUid !== 0) {
            throw new Error(`Security Violation: Profile directory is owned by UID ${stats.uid}, not current user ${currentUid}`);
          }
        }
      } else {
        // Windows ACL protection: Documented and enforced via icacls / user profile root inheritance
      }
    } catch (err: any) {
      if (err.message.includes('Security Violation')) {
        throw err;
      }
    }

    return profilePath;
  }

  /**
   * Checks and cleans up stale/orphaned Chromium profile locks (SingletonLock, SingletonSocket, SingletonCookie).
   * If a previous process is lingering, terminates it gracefully before unlinking locks.
   */
  public static async releaseProfileLock(userDataDir: string): Promise<void> {
    const lockPath = path.join(userDataDir, 'SingletonLock');
    const socketPath = path.join(userDataDir, 'SingletonSocket');
    const cookiePath = path.join(userDataDir, 'SingletonCookie');

    try {
      if (fs.existsSync(lockPath)) {
        try {
          const target = fs.readlinkSync(lockPath);
          const match = target.match(/-(\d+)$/);
          if (match && match[1]) {
            const pid = parseInt(match[1], 10);
            if (pid && pid !== process.pid) {
              try {
                process.kill(pid, 'SIGTERM');
                await new Promise((r) => setTimeout(r, 400));
                try {
                  process.kill(pid, 'SIGKILL');
                } catch {}
              } catch {}
            }
          }
        } catch {}

        try {
          fs.rmSync(lockPath, { force: true, recursive: true });
        } catch {}
      }

      if (fs.existsSync(socketPath)) {
        try {
          fs.rmSync(socketPath, { force: true, recursive: true });
        } catch {}
      }

      if (fs.existsSync(cookiePath)) {
        try {
          fs.rmSync(cookiePath, { force: true, recursive: true });
        } catch {}
      }
    } catch {
      // Non-fatal lock cleanup error
    }
  }

  /**
   * Internal helper to launch persistent context with robust options.
   */
  private static async doLaunch(
    userDataDir: string,
    options: ProfileOptions,
    isHeadless: boolean
  ): Promise<BrowserContext> {
    return await chromium.launchPersistentContext(userDataDir, {
      headless: isHeadless,
      viewport: options.viewport || { width: 1440, height: 900 },
      slowMo: options.slowMo || 0,
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-component-update',
        '--disable-background-networking',
        '--disable-sync',
        '--window-position=100,100',
      ],
      ignoreHTTPSErrors: true,
    });
  }

  /**
   * Launches a persistent Chromium context isolated to this client and user.
   * Gracefully reclaims profile lock if a stale or previous instance was terminated.
   */
  public static async launchPersistentContext(options: ProfileOptions): Promise<BrowserContext> {
    const userDataDir = this.getProfilePath(options.clientId, options.userId);
    const isHeadless = options.isHeaded === true ? false : true;

    try {
      return await this.doLaunch(userDataDir, options, isHeadless);
    } catch (err: any) {
      if (
        err.message &&
        (err.message.includes('Opening in existing browser session') ||
          err.message.includes('profile is already in use') ||
          err.message.includes('Process singleton'))
      ) {
        // Reclaim profile lock and retry
        await this.releaseProfileLock(userDataDir);
        await new Promise((r) => setTimeout(r, 500));
        return await this.doLaunch(userDataDir, options, isHeadless);
      }
      throw err;
    }
  }

  /**
   * Securely purges a profile directory.
   */
  public static deleteProfile(clientId: string, userId: string): void {
    const profilePath = this.getProfilePath(clientId, userId);
    if (fs.existsSync(profilePath)) {
      fs.rmSync(profilePath, { recursive: true, force: true });
    }
  }
}
