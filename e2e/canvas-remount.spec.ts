import { test, expect } from '@playwright/test';

/**
 * Regression: a transferred canvas can never be resized or transferred
 * again. A remount that reattached the ref to the same element threw
 * `InvalidStateError: Cannot resize canvas after call to
 * transferControlToOffscreen()`. Exercised here by running a test,
 * finishing it, and starting another — which unmounts and remounts the
 * gauge.
 */
test('surviving a gauge remount without an InvalidStateError', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Start test' }).click();
  await expect(page.getByRole('heading', { name: 'Your result' })).toBeVisible({
    timeout: 120_000,
  });

  // Second run: gauge unmounts with the result card, then remounts.
  await page.getByRole('button', { name: /run another test/i }).click();
  await page.waitForTimeout(6_000);

  const invalidState = pageErrors.filter((e) =>
    /InvalidStateError|transferControlToOffscreen/i.test(e),
  );
  expect(invalidState).toEqual([]);
});
