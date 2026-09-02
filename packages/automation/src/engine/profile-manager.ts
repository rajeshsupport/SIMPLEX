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
  private static readonly BASE_PROFILE_DIR = path.resolve(os.homedir(), '.hmc-console', 'profiles');

  public static getProfilePath(clientId: string, userId: string): string {
    // 1. Strict sanitization to prevent path traversal
    const cleanClientId = clientId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');

    if (!cleanClientId || !cleanUserId) {
      throw new Error('Invalid client or user identifier for browser profile');
    }

    const clientDir = path.resolve(this.BASE_PROFILE_DIR, `client_${cleanClientId}`);
    const profilePath = path.resolve(clientDir, `user_${cleanUserId}`);

    // Path traversal containment check
    if (!profilePath.startsWith(this.BASE_PROFILE_DIR)) {
      throw new Error('Security Violation: Profile path escapes base profile directory');
    }

    if (!fs.existsSync(profilePath)) {
      fs.mkdirSync(profilePath, { recursive: true, mode: 0o700 });
    }

    // 2. Symlink Escape & Ownership Verification
    try {
      const realPath = fs.realpathSync(profilePath);
      if (!realPath.startsWith(this.BASE_PROFILE_DIR)) {
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
      }
    } catch (err: any) {
      if (err.message.includes('Security Violation')) {
        throw err;
      }
    }

    return profilePath;
  }

  /**
   * Launches a persistent Chromium context isolated to this client and user.
   */
  public static async launchPersistentContext(options: ProfileOptions): Promise<BrowserContext> {
    const userDataDir = this.getProfilePath(options.clientId, options.userId);
    const isHeadless = options.isHeaded === true ? false : true;

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: isHeadless,
      viewport: options.viewport || { width: 1440, height: 900 },
      slowMo: options.slowMo || 0,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-position=100,100',
      ],
      ignoreHTTPSErrors: true,
    });

    return context;
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
