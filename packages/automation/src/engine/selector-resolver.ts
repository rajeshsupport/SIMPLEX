import { Page, Locator } from 'playwright';
import { ElementSelectorConfig, SelectorStrategy } from '@hmc/shared';

export class SelectorResolver {
  /**
   * Resolves a Playwright Locator given an ElementSelectorConfig.
   * Tests primary strategy first, then iterates through fallbacks if primary fails or is not attached.
   */
  public static async resolveLocator(page: Page, config: ElementSelectorConfig, timeoutMs: number = 5000): Promise<Locator> {
    const candidates = [
      { strategy: config.strategy, value: config.value, roleName: config.roleName },
      ...(config.fallbackSelectors || []),
    ];

    for (const candidate of candidates) {
      try {
        const locator = this.getLocatorByStrategy(page, candidate.strategy, candidate.value, candidate.roleName);
        const count = await locator.count();
        if (count > 0) {
          return locator.first();
        }
      } catch {
        // Continue to fallback candidate
      }
    }

    // Default to primary locator if fallbacks didn't match immediately
    return this.getLocatorByStrategy(page, config.strategy, config.value, config.roleName);
  }

  private static getLocatorByStrategy(
    page: Page,
    strategy: SelectorStrategy,
    value: string,
    roleName?: string
  ): Locator {
    switch (strategy) {
      case 'TEST_ID':
        return page.getByTestId(value).or(page.locator(`[data-testid="${value}"]`));
      case 'ID':
        return page.locator(`#${value}`);
      case 'ROLE':
        return page.getByRole(value as any, { name: roleName || undefined });
      case 'LABEL':
        return page.getByLabel(value);
      case 'NAME':
        return page.locator(`[name="${value}"]`);
      case 'PLACEHOLDER':
        return page.getByPlaceholder(value);
      case 'CSS':
        return page.locator(value);
      case 'XPATH_LEGACY':
        return page.locator(`xpath=${value}`);
      default:
        return page.locator(value);
    }
  }
}
