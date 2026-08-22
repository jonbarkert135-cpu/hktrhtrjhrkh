/**
 * P14a acceptance: Auto Arrange is a proposal. It previews, it is accepted explicitly, the accept
 * is one undo step, and every entry point (button, palette, shortcut) opens the same surface.
 */

import { expect, test } from '@playwright/test';

import { addNotes, openNewBoard } from '../support/board';

test.describe('auto arrange', () => {
  test('preview → apply → undo, in one step', async ({ page }) => {
    await openNewBoard(page);
    await addNotes(page, 6);

    await page.getByTestId('auto-arrange-open').click();
    const panel = page.getByTestId('auto-arrange-panel');
    await expect(panel).toBeVisible();

    // Nothing is applied by opening the panel or by previewing.
    await page.getByTestId('auto-arrange-preview').click();
    await expect(page.getByTestId('auto-arrange-status')).toContainText(/nodes move/i);
    await expect(page.getByTestId('layout-ghosts')).toBeVisible();
    await expect(page.getByTestId('node-count')).toHaveAttribute('data-nodes', '6');

    await page.getByTestId('auto-arrange-apply').click();
    await expect(panel).toBeHidden();
    await expect(page.getByTestId('layout-toast')).toContainText(/One undo puts them back/i);

    // One undo, not six: `moveNodes` writes the whole layout in a single transaction.
    await expect(page.getByTestId('history-undo')).toBeEnabled();
    await page.getByTestId('layout-toast-undo').click();
    await expect(page.getByTestId('history-undo')).toBeDisabled();
  });

  test('discarding a preview leaves the board untouched', async ({ page }) => {
    await openNewBoard(page);
    await addNotes(page, 4);

    await page.keyboard.press('Control+Alt+r');
    await expect(page.getByTestId('auto-arrange-panel')).toBeVisible();
    await page.getByTestId('auto-arrange-preview').click();
    await expect(page.getByTestId('layout-ghosts')).toBeVisible();

    await page.getByTestId('auto-arrange-cancel').click();
    await expect(page.getByTestId('layout-ghosts')).toBeHidden();
    await expect(page.getByTestId('layout-toast')).toBeHidden();
    await expect(page.getByTestId('history-undo')).toBeEnabled(); // only the 4 creates
  });

  test('is reachable from the command palette and offers every algorithm', async ({ page }) => {
    await openNewBoard(page);
    await addNotes(page, 3);

    await page.keyboard.press('Control+k');
    await page.getByRole('textbox', { name: /command palette/i }).fill('arrange');
    await page
      .getByRole('option', { name: /auto arrange/i })
      .first()
      .click();

    const picker = page.getByLabel('Layout');
    await expect(picker).toBeVisible();
    for (const label of [
      'Hierarchical',
      'Tree',
      'Radial',
      'Force-directed',
      'Flow',
      'Timeline',
      'Cluster',
    ]) {
      await expect(picker.getByRole('option', { name: label })).toHaveCount(1);
    }

    // The picker is keyboard operable and the description follows the selection.
    await picker.selectOption('timeline');
    await expect(page.getByTestId('auto-arrange-description')).toContainText(/chronology/i);
  });

  test('says so when there is nothing to arrange', async ({ page }) => {
    await openNewBoard(page);
    await page.getByTestId('auto-arrange-open').click();
    await expect(page.getByTestId('auto-arrange-status')).toContainText(/Nothing to lay out yet/i);
    await expect(page.getByTestId('auto-arrange-preview')).toBeDisabled();
  });
});
