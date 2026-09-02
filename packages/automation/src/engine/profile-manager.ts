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
  private static readonly BASE_PROFILE_DIR = path.join(os.homedir(), '.hmc-console', 'profiles');

  public static getProfilePath(clientId: string, userId: string): string {
    const cleanClientId = clientId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const clientDir = path.join(this.BASE_PROFILE_DIR, `client_${cleanClientId}`);
    const profilePath = path.join(clientDir, `user_${cleanUserId}`);

    if (!fs.existsSync(profilePath)) {
      fs.mkdirSync(profilePath, { recursive: true, mode: 0o700 });
    }

    try {
      if (process.platform !== 'win32') {
        fs.chmodSync(this.BASE_PROFILE_DIR, 0o700);
        fs.chmodSync(clientDir, 0o700);
        fs.chmodSync(profilePath, 0o700);
      }
    } catch {
      // Ignore on non-POSIX filesystems
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
}
