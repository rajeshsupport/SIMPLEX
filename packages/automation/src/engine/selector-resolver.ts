import { Page, Frame, Locator } from 'playwright';
import { ElementSelectorConfig, SelectorStrategy } from '@hmc/shared';

export interface ResolvedLocatorResult {
  locator: Locator;
  frame: Page | Frame;
  matchedSelector: string;
}

export class SelectorResolver {
  public static readonly USERNAME_FALLBACKS = [
    '#username',
    '#userName',
    '#user',
    '#loginUsername',
    'input[name="username" i]',
    'input[name="userName"]',
    'input[name="user_name" i]',
    'input[name="email" i]',
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[type="email"]',
    '[data-testid="input-username"]',
    '[data-testid="username"]',
    'input[type="text"]:visible',
    'input:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):visible',
  ];

  public static readonly PASSWORD_FALLBACKS = [
    '#pasWord',
    '#password',
    '#passWord',
    '#pass',
    '#loginPassword',
    'input[name="password" i]',
    'input[name="pasWord"]',
    'input[name="pass"]',
    'input[autocomplete="current-password"]',
    'input[type="password"]',
    '[data-testid="input-password"]',
    '[data-testid="password"]',
  ];

  public static readonly SUBMIT_FALLBACKS = [
    '#SignIn',
    '#btnLogin',
    '#btn-login',
    '#submitBtn',
    '#loginSubmit',
    'button[type="submit"]',
    'input[type="submit"]',
    'button.btn-login',
    'button.btn-signin',
    'button:has-text("Sign In")',
    'button:has-text("Sign In Now")',
    'button:has-text("Log In")',
    'button:has-text("Login")',
    'button:has-text("Submit")',
    '[data-testid="btn-login"]',
    '[data-testid="submit"]',
  ];

  public static readonly DASHBOARD_FALLBACKS = [
    '[data-testid="hmc-dashboard"]',
    '[data-testid="dashboard"]',
    '#hmc-dashboard',
    '#dashboard',
    '.dashboard-container',
    '.main-dashboard',
    'a[href*="logout" i]',
    'button:has-text("Logout" i)',
    'a:has-text("Logout" i)',
    'a[href*="signout" i]',
    'button:has-text("Sign Out" i)',
    '#hmc-app-header',
  ];

  public static readonly MFA_CONTAINER_FALLBACKS = [
    '#showMFA:visible',
    '#adminOtpForm:visible',
    '#otpField:visible',
    '[data-testid="mfa-challenge"]:visible',
    '[data-testid="captcha-container"]:visible',
    '.mfa-box:visible',
    '.otp-container:visible',
    '#mfa-container:visible',
  ];

  /**
   * Converts an ElementSelectorConfig to a CSS or Playwright selector string
   */
  public static toSelectorString(strategy: SelectorStrategy, value: string, roleName?: string): string {
    switch (strategy) {
      case 'TEST_ID':
        return `[data-testid="${value}"]`;
      case 'ID':
        return `#${value.replace(/^#/, '')}`;
      case 'ROLE':
        return roleName ? `role=${value}[name="${roleName}"]` : `role=${value}`;
      case 'LABEL':
        return `label:has-text("${value}") + input, input[aria-label="${value}"]`;
      case 'NAME':
        return `[name="${value}"]`;
      case 'PLACEHOLDER':
        return `[placeholder="${value}"]`;
      case 'CSS':
        return value;
      case 'XPATH_LEGACY':
        return `xpath=${value}`;
      default:
        return value;
    }
  }

  /**
   * Resolves a visible locator across the main page and any iframe frames,
   * checking configured selectors first, followed by safe fallbacks.
   * Completely event-driven without arbitrary sleep loops.
   */
  public static async findVisibleLocator(
    page: Page,
    config?: ElementSelectorConfig,
    fallbackList: string[] = [],
    timeoutMs: number = 8000,
    frameSelector?: string
  ): Promise<ResolvedLocatorResult | null> {
    const candidateSelectors: string[] = [];

    // 1. Configured primary selector and explicit fallbacks
    if (config) {
      const primary = this.toSelectorString(config.strategy, config.value, config.roleName);
      if (primary) candidateSelectors.push(primary);

      for (const fb of config.fallbackSelectors || []) {
        const fbStr = this.toSelectorString(fb.strategy, fb.value, fb.roleName);
        if (fbStr && !candidateSelectors.includes(fbStr)) {
          candidateSelectors.push(fbStr);
        }
      }
    }

    // 2. Safe built-in fallbacks
    for (const fb of fallbackList) {
      if (!candidateSelectors.includes(fb)) {
        candidateSelectors.push(fb);
      }
    }

    if (candidateSelectors.length === 0) return null;

    // Gather target frames (main page + all child iframes)
    const getFrames = async (): Promise<Array<Page | Frame>> => {
      const frames: Array<Page | Frame> = [];
      if (frameSelector) {
        const frameElement = await page.$(frameSelector);
        const frame = await frameElement?.contentFrame();
        if (frame) frames.push(frame);
      } else {
        frames.push(page);
        for (const f of page.frames()) {
          if (f !== page.mainFrame()) {
            frames.push(f);
          }
        }
      }
      return frames;
    };

    const frames = await getFrames();

    // Fast-path: Check if any candidate is already visible (0ms delay)
    for (const frame of frames) {
      for (const selector of candidateSelectors) {
        try {
          const loc = frame.locator(selector).first();
          if (await loc.isVisible({ timeout: 0 }).catch(() => false)) {
            return { locator: loc, frame, matchedSelector: selector };
          }
        } catch {}
      }
    }

    // Event-driven wait: Wait for the first visible element across candidates
    const startTime = Date.now();
    const waitPromises: Array<Promise<ResolvedLocatorResult | null>> = [];

    for (const frame of frames) {
      for (const selector of candidateSelectors) {
        const p = (async (): Promise<ResolvedLocatorResult | null> => {
          try {
            const loc = frame.locator(selector).first();
            const remaining = Math.max(100, timeoutMs - (Date.now() - startTime));
            await loc.waitFor({ state: 'visible', timeout: remaining });
            return { locator: loc, frame, matchedSelector: selector };
          } catch {
            return null;
          }
        })();
        waitPromises.push(p);
      }
    }

    try {
      const results = await Promise.all(waitPromises);
      const matched = results.find((r) => r !== null);
      if (matched) return matched;
    } catch {}

    return null;
  }

  /**
   * Fills an input reliably, handling React controlled inputs, readonly removal,
   * focus, clearing, typing, and standard DOM events (input, change, blur).
   */
  public static async fillInputReliably(
    locator: Locator,
    value: string,
    isPassword: boolean = false
  ): Promise<boolean> {
    try {
      await locator.waitFor({ state: 'visible', timeout: 5000 });

      // Remove readonly attribute if present (common in anti-autofill forms)
      await locator.evaluate((el: any) => {
        if (el && typeof el.removeAttribute === 'function') {
          el.removeAttribute('readonly');
          el.removeAttribute('disabled');
        }
      });

      await locator.focus();
      await locator.clear();
      await locator.fill(value);

      // Dispatch full input event sequence for React / jQuery / Angular listeners
      await locator.dispatchEvent('input');
      await locator.dispatchEvent('change');
      await locator.dispatchEvent('blur');

      // Verify input value is non-empty without logging or reading password
      const actualVal = await locator.inputValue();
      if (!actualVal || actualVal.length === 0) {
        // Fallback: sequential typing if direct fill was bypassed by keypress handlers
        await locator.focus();
        await locator.pressSequentially(value, { delay: 5 });
        await locator.dispatchEvent('input');
        await locator.dispatchEvent('change');
        await locator.dispatchEvent('blur');
      }

      const finalCheck = await locator.inputValue();
      return Boolean(finalCheck && finalCheck.length > 0);
    } catch {
      return false;
    }
  }

  /**
   * Triggers a login submit via click and keyboard Enter fallback.
   */
  public static async triggerSubmit(
    submitLocator?: Locator,
    passwordLocator?: Locator
  ): Promise<void> {
    if (submitLocator) {
      try {
        await submitLocator.scrollIntoViewIfNeeded({ timeout: 500 }).catch(() => {});
        await submitLocator.click();
        return;
      } catch {}
    }

    if (passwordLocator) {
      try {
        await passwordLocator.focus();
        await passwordLocator.press('Enter');
      } catch {}
    }
  }
}
