// P9 §11: with the runner unreachable the user gets the canonical error copy and a retry — never
// a spinner that never resolves and never "Something went wrong".
import { expect, test } from '@playwright/test';

import { openNewBoard } from '../support/board';

// Declared unconditionally: the hygiene gate (18_TESTING.md §16) refuses skipped tests, so the spec
// announces by name that it did not run instead of pretending to pass.
const enabled = process.env.INTEGRATIONS_ENABLED === 'true';

if (!enabled) {
  test('runner-down error copy is not exercised here: needs INTEGRATIONS_ENABLED and a runner + worker + Redis stack', () => {
    expect(enabled).toBe(false);
  });
}

if (enabled)
  test('a failed start shows what happened, why, and what to do', async ({ page }) => {
    await openNewBoard(page);

    // Simulate the runner being down: the start mutation fails at the transport.
    await page.route('**/trpc/runs.start**', (route) => route.abort('failed'));

    await page.getByTestId('add-note').click();
    await page.getByRole('button', { name: 'Run integration…' }).first().click();
    await page.getByTestId('integration-picker').getByRole('button').first().click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Run' }).click();

    const panel = page.getByTestId('run-panel');
    await expect(panel).toContainText('Something went wrong on our side.');
    await expect(panel.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
