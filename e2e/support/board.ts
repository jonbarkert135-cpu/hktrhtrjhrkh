/**
 * Shared setup for board journeys: sign a fresh user up, create a project and a board, and return
 * the board URL. Selectors are accessible roles/names on purpose (18_TESTING.md §7).
 */

import { expect, type Page } from '@playwright/test';

export const unique = (): string => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

export async function signUp(page: Page): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel(/email/i).fill(`${unique()}@example.test`);
  await page
    .getByLabel(/password/i)
    .first()
    .fill('e2e-password-1234');
  await page.getByRole('button', { name: /create account|sign up/i }).click();
  await expect(page.getByRole('button', { name: /create (your first )?project/i })).toBeVisible();
}

/** Signs up and lands on a fresh board; returns its URL so the spec can reopen it. */
export async function openNewBoard(page: Page): Promise<string> {
  await signUp(page);

  await page.getByRole('button', { name: /create (your first )?project/i }).click();
  await page.getByLabel(/name/i).fill(`Project ${unique()}`);
  await page.getByRole('button', { name: /^create$/i }).click();

  await page.getByRole('button', { name: /create (your first )?board|new board/i }).click();
  await page.getByLabel(/name/i).fill(`Board ${unique()}`);
  await page.getByRole('button', { name: /^create$/i }).click();

  await expect(page).toHaveURL(/\/b\//);
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByTestId('node-count')).toBeVisible();
  return page.url();
}

export async function addNotes(page: Page, count: number): Promise<void> {
  const button = page.getByTestId('add-note');
  for (let i = 0; i < count; i += 1) await button.click();
  await expect(page.getByTestId('node-count')).toHaveAttribute('data-nodes', String(count));
}

export const nodeCount = (page: Page): Promise<string | null> =>
  page.getByTestId('node-count').getAttribute('data-nodes');
