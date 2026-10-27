import * as fs from 'fs';
import * as path from 'path';
import { chromium, Browser, BrowserContext, Page } from 'playwright';

export interface ChromeLaunchConfig {
  browser: string;
  chromeGuest: boolean;
  headless: boolean;
  allowChromiumFallback: boolean;
  detectedExecutablePath: string | null;
}

export interface ChromeGuestSessionOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  slowMo?: number;
  ignoreHTTPSErrors?: boolean;
  additionalArgs?: string[];
  forceExecutablePath?: string;
  forceChannel?: string;
  allowChromiumFallback?: boolean;
}

export interface ChromeGuestSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  executablePath?: string;
  channel?: string;
  launchArgs: string[];
  isFallback: boolean;
}

export class ChromeGuestLauncher {
  public static readonly DEFAULT_MACOS_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

  /**
   * Detects the installed Google Chrome executable path for the current platform.
   */
  public static detectChromeExecutable(): string | null {
    if (process.platform === 'darwin') {
      if (fs.existsSync(this.DEFAULT_MACOS_CHROME_PATH)) {
        return this.DEFAULT_MACOS_CHROME_PATH;
      }
      // User Applications folder fallback
      const userAppPath = path.join(process.env.HOME || '', 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
      if (fs.existsSync(userAppPath)) {
        return userAppPath;
      }
      return null;
    }

    if (process.platform === 'win32') {
      const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env.PROGRAMFILES || '', 'Google\\Chrome\\Application\\chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
      ];
      for (const cand of candidates) {
        if (cand && fs.existsSync(cand)) {
          return cand;
        }
      }
      return null;
    }

    // Linux paths
    const linuxCandidates = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/local/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
    ];
    for (const cand of linuxCandidates) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }

    return null;
  }

  /**
   * Reads the effective automation browser launch configuration from environment variables.
   */
  public static getLaunchConfiguration(): ChromeLaunchConfig {
    const browser = (process.env.AUTOMATION_BROWSER || 'chrome').toLowerCase().trim();
    const chromeGuest = process.env.AUTOMATION_CHROME_GUEST !== 'false';
    const headless = process.env.AUTOMATION_HEADLESS === 'true';
    const allowChromiumFallback = process.env.ALLOW_CHROMIUM_FALLBACK === 'true';
    const detectedExecutablePath = this.detectChromeExecutable();

    return {
      browser,
      chromeGuest,
      headless,
      allowChromiumFallback,
      detectedExecutablePath,
    };
  }

  /**
   * Launches an isolated Google Chrome browser in Guest Mode with zero persistent storage.
   * Never uses launchPersistentContext or personal/default userDataDir.
   * Fails with GOOGLE_CHROME_GUEST_UNAVAILABLE if Chrome cannot be launched and fallback is disallowed.
   */
  public static async launchGuestSession(options: ChromeGuestSessionOptions = {}): Promise<ChromeGuestSession> {
    const config = this.getLaunchConfiguration();
    const effectiveHeadless = options.headless !== undefined ? options.headless : config.headless;
    const allowFallback = options.allowChromiumFallback !== undefined ? options.allowChromiumFallback : config.allowChromiumFallback;

    const baseArgs = [
      '--guest',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-component-update',
      '--disable-background-networking',
      '--disable-sync',
      '--start-maximized',
      '--new-window',
    ];

    if (options.additionalArgs && options.additionalArgs.length > 0) {
      for (const arg of options.additionalArgs) {
        if (!baseArgs.includes(arg)) {
          baseArgs.push(arg);
        }
      }
    }

    let browser: Browser | null = null;
    let selectedChannel: string | undefined = undefined;
    let selectedExecutablePath: string | undefined = undefined;
    let isFallback = false;

    // 1. Primary Attempt: launch using channel: 'chrome'
    const requestedChannel = options.forceChannel || (config.browser === 'chrome' ? 'chrome' : undefined);
    if (requestedChannel && !options.forceExecutablePath) {
      try {
        browser = await chromium.launch({
          channel: requestedChannel,
          headless: effectiveHeadless,
          slowMo: options.slowMo || 0,
          args: baseArgs,
        });
        selectedChannel = requestedChannel;
      } catch (channelErr: any) {
        // Channel failed, proceed to controlled executable path fallback
      }
    }

    // 2. Controlled Fallback Attempt: verified executable path
    if (!browser) {
      const execPath = options.forceExecutablePath || config.detectedExecutablePath;
      if (execPath && fs.existsSync(execPath)) {
        try {
          browser = await chromium.launch({
            executablePath: execPath,
            headless: effectiveHeadless,
            slowMo: options.slowMo || 0,
            args: baseArgs,
          });
          selectedExecutablePath = execPath;
        } catch (execErr: any) {
          // Executable path failed
        }
      }
    }

    // 3. Fallback to bundled Chromium ONLY IF explicitly permitted
    if (!browser) {
      if (allowFallback) {
        try {
          console.warn('[CHROME_GUEST] Warning: Google Chrome unavailable. Falling back to bundled Chromium as permitted by ALLOW_CHROMIUM_FALLBACK=true.');
          browser = await chromium.launch({
            headless: effectiveHeadless,
            slowMo: options.slowMo || 0,
            args: baseArgs,
          });
          isFallback = true;
        } catch (chromiumErr: any) {
          throw new Error(`GOOGLE_CHROME_GUEST_UNAVAILABLE: Bundled Chromium fallback also failed: ${chromiumErr.message}`);
        }
      } else {
        const error = new Error(
          'GOOGLE_CHROME_GUEST_UNAVAILABLE: Google Chrome is not installed or could not be launched. ' +
          `Verified executable path ${config.detectedExecutablePath || 'chrome.exe'} was not accessible, ` +
          'and ALLOW_CHROMIUM_FALLBACK is set to false.'
        );
        (error as any).code = 'GOOGLE_CHROME_GUEST_UNAVAILABLE';
        throw error;
      }
    }

    // 4. Create fresh, completely isolated context (zero persistent profile / zero userDataDir)
    const context = await browser.newContext({
      viewport: options.viewport !== undefined ? options.viewport : (effectiveHeadless ? { width: 1440, height: 900 } : null),
      ignoreHTTPSErrors: options.ignoreHTTPSErrors !== undefined ? options.ignoreHTTPSErrors : true,
    });

    const page = await context.newPage();

    return {
      browser,
      context,
      page,
      channel: selectedChannel,
      executablePath: selectedExecutablePath,
      launchArgs: baseArgs,
      isFallback,
    };
  }
}
