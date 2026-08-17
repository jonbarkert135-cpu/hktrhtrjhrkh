/**
 * P3 acceptance criterion 3: undo reverses every mutation type that exists so far and redo restores
 * it. One case per mutation type; the matrix is extended in every later phase.
 */

import { expect, test } from '@playwright/test';

import { addNotes, openNewBoard } from '../support/board';

test.describe('undo matrix', () => {
  test('create → undo → redo, by button and by keyboard', async ({ page }) => {
    await openNewBoard(page);
    await addNotes(page, 2);

    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(page.getByTestId('node-count')).toHaveAttribute('data-nodes', '1');

    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('node-count')).toHaveAttribute('data-nodes', '0');

    await page.keyboard.press('Control+Shift+z');
    await expect(page.getByTestId('node-count')).toHaveAttribute('data-nodes', '1');

    await page.getByRole('button', { name: /^Redo/ }).click();
    await expect(page.getByTestId('node-count')).toHaveAttribute('data-nodes', '2');
  });

  test('the undo affordance names the step and is disabled on a fresh board', async ({ page }) => {
    await openNewBoard(page);

    const undo = page.getByRole('button', { name: /^Undo/ });
    await expect(undo).toBeDisabled();

    await addNotes(page, 1);
    await expect(page.getByRole('button', { name: 'Undo: create 1 node' })).toBeEnabled();
  });

  test('undo survives a reload boundary as document state, not as stack state', async ({
    page,
  }) => {
    await openNewBoard(page);
    await addNotes(page, 2);
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(page.getByTestId('node-count')).toHaveAttribute('data-nodes', '1');

    await page.reload();
    // The undo stack is per-session (08 §2.3), the document is not: one node stays.
    await expect(page.getByTestId('node-count')).toHaveAttribute('data-nodes', '1', {
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: /^Undo/ })).toBeDisabled();
  });
});
