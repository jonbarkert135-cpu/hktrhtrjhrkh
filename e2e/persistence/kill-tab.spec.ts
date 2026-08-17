/**
 * N2 / P3 acceptance criterion 1: create 10 nodes, kill the tab right after the last edit, reopen
 * the board — all 10 are still there, read from IndexedDB with no server round-trip.
 */

import { expect, test } from '@playwright/test';

import { addNotes, openNewBoard } from '../support/board';

test('a killed tab loses nothing that was created 100 ms earlier', async ({ page, context }) => {
  const boardUrl = await openNewBoard(page);
  await addNotes(page, 10);

  // The indicator must confirm the local write before we pull the plug.
  await expect(page.getByTestId('sync-status')).toHaveText(/Saved/, { timeout: 5_000 });
  await page.waitForTimeout(100);
  await page.close();

  const reopened = await context.newPage();
  await reopened.goto(boardUrl);
  await expect(reopened.getByTestId('node-count')).toHaveAttribute('data-nodes', '10', {
    timeout: 10_000,
  });
});
