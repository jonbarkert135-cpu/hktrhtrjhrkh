// P9 §11: nothing runs without consent — the checkbox is a gate, not a formality (§12.1).
import { expect, test } from '@playwright/test';

import { openNewBoard } from '../support/board';

// Declared unconditionally: the hygiene gate (18_TESTING.md §16) refuses skipped tests, so the spec
// announces by name that it did not run instead of pretending to pass.
const enabled = process.env.INTEGRATIONS_ENABLED === 'true';

if (!enabled) {
  test('consent gate is not exercised here: needs INTEGRATIONS_ENABLED and a runner + worker + Redis stack', () => {
    expect(enabled).toBe(false);
  });
}

if (enabled)
  test('Run stays disabled until the authorization box is ticked', async ({ page }) => {
    await openNewBoard(page);
    await page.getByTestId('add-note').click();
    await page.getByRole('button', { name: 'Run integration…' }).first().click();
    await page.getByTestId('integration-picker').getByRole('button').first().click();

    const run = page.getByRole('button', { name: 'Run' });
    await expect(run).toBeDisabled();
    await expect(page.getByTestId('consent-data')).toBeVisible();

    await page.getByRole('checkbox').check();
    await expect(run).toBeEnabled();

    // Unticking is not a one-way door: the gate closes again.
    await page.getByRole('checkbox').uncheck();
    await expect(run).toBeDisabled();
  });
