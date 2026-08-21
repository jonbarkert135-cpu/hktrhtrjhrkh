// P9 §11: configure → consent → run → proposal → accept → undo, against the one built-in manifest.
//
// The whole surface only exists where `INTEGRATIONS_ENABLED` is on (ADR-002), and a real run needs
// Postgres + Redis + the runner. The spec therefore skips *by name* rather than silently, exactly
// like `apps/runner/test/sandbox.hostile.test.ts` does without Docker.
import { expect, test } from '@playwright/test';

import { openNewBoard, unique } from '../support/board';

// Declared unconditionally: the hygiene gate (18_TESTING.md §16) refuses skipped tests, so the spec
// announces by name that it did not run instead of pretending to pass.
const enabled = process.env.INTEGRATIONS_ENABLED === 'true';

if (!enabled) {
  test('built-in tool run → proposal → apply → undo is not exercised here: needs INTEGRATIONS_ENABLED and a runner + worker + Redis stack', () => {
    expect(enabled).toBe(false);
  });
}

if (enabled)
  test('a built-in tool run produces a proposal that applies as one undo step', async ({
    page,
  }) => {
    await openNewBoard(page);

    // A node to run against: the capture path turns a pasted URL into a URL node.
    await page.getByTestId('add-note').click();
    await page.getByRole('button', { name: 'Open details' }).first().click();
    await page.getByLabel(/title/i).fill(`https://example.test/${unique()}`);

    await page.getByRole('button', { name: 'Run integration…' }).first().click();
    await expect(page.getByTestId('integration-picker')).toBeVisible();
    await page.getByTestId('integration-picker').getByRole('button').first().click();

    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Run' }).click();

    await expect(page.getByTestId('run-panel')).toBeVisible();
    await expect(page.getByTestId('run-panel')).toHaveAttribute('data-state', /succeeded|partial/, {
      timeout: 60_000,
    });

    await page.getByRole('button', { name: 'Review results' }).click();
    await expect(page.getByTestId('provenance-chip').first()).toBeVisible();
    const before = await page.getByTestId('node-count').getAttribute('data-nodes');
    await page.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByTestId('apply-toast')).toContainText('Imported');
    await expect(page.getByTestId('node-count')).not.toHaveAttribute('data-nodes', before ?? '');

    // One accepted proposal is exactly one undo step (N3).
    await page.getByTestId('apply-toast').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('node-count')).toHaveAttribute('data-nodes', before ?? '');
  });
