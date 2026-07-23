import { expect, test } from '@playwright/test';

/**
 * The golden path, in a real browser, against the real Cloudflare
 * endpoints (§2.8 note: unlike the Vitest suite, E2E is explicitly where
 * live-network runs belong — this is what actually proves the Worker +
 * fetch-streaming plumbing works outside Node). Takes real time: idle
 * latency probing plus a real download/upload phase.
 */
test('runs a full measurement and renders a real, non-fabricated result', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'NetVerdict' })).toBeVisible();
  const startButton = page.getByRole('button', { name: 'Start test' });
  await expect(startButton).toBeVisible();
  await startButton.click();

  // Phase indicator appears once the worker starts probing latency.
  await expect(page.getByText('Measuring idle latency')).toBeVisible({ timeout: 15_000 });

  // Live download/upload phases follow; the run completes into a result card.
  await expect(page.getByRole('heading', { name: 'Your result' })).toBeVisible({ timeout: 60_000 });

  // The headline download/upload figures must be real numbers, not the
  // "unavailable" placeholder — the whole point of this build is that
  // nothing shown ever comes from thin air (§5.7).
  await expect(page.getByTestId('download-figure')).toHaveText(/^\d+\.\d$/);
  await expect(page.getByTestId('upload-figure')).toHaveText(/^\d+\.\d$/);

  await expect(page.getByRole('heading', { name: 'What this supports right now' })).toBeVisible();
});
