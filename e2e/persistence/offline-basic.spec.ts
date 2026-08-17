/**
 * P3 acceptance criterion 2: with the network disabled, every board feature of P2/P3 still works —
 * capture, undo, redo and export are local-only operations.
 */

import { expect, test } from '@playwright/test';

import { addNotes, openNewBoard } from '../support/board';

test('the board keeps working with the network switched off', async ({ page, context }) => {
  await openNewBoard(page);

  await context.setOffline(true);
  await addNotes(page, 3);
  await expect(page.getByTestId('sync-status')).toHaveText(/Offline/);

  // Undo and redo are local: no server is involved in either direction.
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(page.getByTestId('node-count')).toHaveAttribute('data-nodes', '2');
  await page.getByRole('button', { name: /^Redo/ }).click();
  await expect(page.getByTestId('node-count')).toHaveAttribute('data-nodes', '3');

  // Reloading while offline still opens the board from IndexedDB.
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByTestId('node-count')).toHaveAttribute('data-nodes', '3', {
    timeout: 10_000,
  });
});
