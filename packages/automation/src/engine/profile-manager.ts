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
    const profilePath = path.join(this.BASE_PROFILE_DIR, `client_${cleanClientId}`, `user_${cleanUserId}`);

    if (!fs.existsSync(profilePath)) {
      fs.mkdirSync(profilePath, { recursive: true });
    }
    return profilePath;
  }

  /**
   * Launches a persistent Chromium context isolated to this client and user.
   */
  public static async launchPersistentContext(options: ProfileOptions): Promise<BrowserContext> {
    const userDataDir = this.getProfilePath(options.clientId, options.userId);

    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: options.isHeaded === false ? true : false,
      viewport: options.viewport || { width: 1440, height: 900 },
      slowMo: options.slowMo || 100,
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
