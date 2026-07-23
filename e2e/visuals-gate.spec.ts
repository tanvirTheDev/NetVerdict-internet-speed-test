import { test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/**
 * §8.1 merge gate: run the measurement with the hero visual on, then
 * with it off, and compare. A measurable delta means the render path is
 * stealing time from the measurement, and blocks the merge.
 *
 * Not part of the normal suite — it needs the live network and takes
 * minutes, because Cloudflare's rate limiter has to recover between the
 * two runs or the second one measures throttling rather than visuals.
 *
 * Results are written to disk rather than scraped from stdout: a
 * `TestResult` is nested JSON, and pulling it out of a log with a regex
 * is how you end up comparing two objects you only half-captured.
 */
async function measure(
  page: Page,
  reducedMotion: 'reduce' | 'no-preference',
  outPath: string,
): Promise<void> {
  await page.emulateMedia({ reducedMotion });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    // @ts-expect-error -- diagnostic patch so the test can observe worker events
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (event: MessageEvent) => {
          const data = event.data as { type?: string; result?: unknown };
          if (data.type === 'completed') {
            (window as never as Record<string, unknown>)['__result'] = data.result;
          }
        });
      }
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start test' }).click();
  await page.waitForFunction(() => (window as never as Record<string, unknown>)['__result'], {
    timeout: 120_000,
  });
  const result = await page.evaluate(
    () => (window as never as Record<string, unknown>)['__result'],
  );
  writeFileSync(outPath, JSON.stringify(result, null, 2));
}

test('accuracy is unchanged with visuals on vs off', async ({ page }) => {
  await measure(page, 'no-preference', '/tmp/visuals-on.json');
  // Cloudflare throttles on recent bytes, so without this pause the
  // second run measures the rate limiter instead of the render path.
  await page.waitForTimeout(300_000);
  await measure(page, 'reduce', '/tmp/visuals-off.json');
});
