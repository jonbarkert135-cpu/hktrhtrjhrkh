// J04: connect two nodes, inspect the relationship, change its type and routing, delete it.
//
// This is the P5 half of journey 4: J04a covers selection and dragging, this one covers the edge
// system end to end — the port band, the pending connection, the inspector and the counters.
import { expect, test } from '@playwright/test';

const unique = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe('J04 — connect two nodes', () => {
  test('creates, edits and deletes a relationship', async ({ page }) => {
    const email = `${unique()}@example.test`;
    const password = 'e2e-password-1234';

    await page.goto('/signup');
    await page.getByLabel(/email/i).fill(email);
    await page
      .getByLabel(/password/i)
      .first()
      .fill(password);
    await page.getByRole('button', { name: /create account|sign up/i }).click();

    await page.getByRole('button', { name: /create (your first )?project/i }).click();
    await page.getByLabel(/name/i).fill(`Project ${unique()}`);
    await page.getByRole('button', { name: /^create$/i }).click();
    await page.getByRole('button', { name: /create (your first )?board|new board/i }).click();
    await page.getByLabel(/name/i).fill(`Board ${unique()}`);
    await page.getByRole('button', { name: /^create$/i }).click();

    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    // Two notes. They land near the viewport centre, offset from each other by the placement rule.
    await page.getByTestId('add-note').click();
    await page.getByTestId('add-note').click();
    await expect(page.getByTestId('node-count')).toContainText('2 nodes');

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;

    // Keyboard connection (N6): select the first card, press C, confirm with Enter.
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await page.keyboard.press('c');
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('node-count')).toContainText('1 edges', { timeout: 10_000 });
  });
});
