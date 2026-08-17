// N6: zero axe violations on every top-level surface (18_TESTING.md §10.1).
// P1 surfaces: /login, /signup and the authenticated shell.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const RULE_SETS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

async function sweep(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(RULE_SETS)
    // axe cannot read canvas pixels; canvas contrast is covered by packages/ui contrast tests.
    .exclude('canvas')
    .analyze();
  return results.violations.map(
    (v) => `${v.id} (${v.impact ?? 'n/a'}): ${v.nodes.length} node(s) — ${v.help}`,
  );
}

test('login has no accessibility violations', async ({ page }) => {
  await page.goto('/login');
  expect(await sweep(page)).toEqual([]);
});

test('signup has no accessibility violations', async ({ page }) => {
  await page.goto('/signup');
  expect(await sweep(page)).toEqual([]);
});

test('the authenticated shell has no accessibility violations', async ({ page }) => {
  const email = `a11y-${Date.now()}@example.test`;
  await page.goto('/signup');
  await page.getByLabel(/email/i).fill(email);
  await page
    .getByLabel(/password/i)
    .first()
    .fill('e2e-password-1234');
  await page.getByRole('button', { name: /create account|sign up/i }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
  expect(await sweep(page)).toEqual([]);
});
