import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOk } from '@netverdict/contracts';
import { CloudflareTransferProvider } from './transfer-provider';

/**
 * Regression guard for a bug that passed every Node-based test and then
 * failed 100% of requests in the browser: `fetch` was stored on the
 * instance and called as `this.fetchImpl(...)`, making the provider its
 * receiver. Browsers reject that with
 * `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`;
 * Node's fetch is receiver-agnostic, so the CLI harness never noticed.
 *
 * `browserLikeFetch` below reproduces the browser's requirement, so this
 * suite fails if the binding is ever dropped again.
 */
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function installBrowserLikeFetch(): void {
  function browserLikeFetch(this: unknown): Promise<Response> {
    if (this !== globalThis && this !== undefined) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return Promise.resolve(
      new Response(new Uint8Array(0), { status: 200, headers: { 'content-length': '0' } }),
    );
  }
  globalThis.fetch = browserLikeFetch;
}

describe('CloudflareTransferProvider fetch binding', () => {
  it('calls the global fetch with the global scope as receiver, not the provider instance', async () => {
    installBrowserLikeFetch();
    const provider = new CloudflareTransferProvider();

    const result = await provider.probeLatency(new AbortController().signal);

    // Before the fix this returned NETWORK_UNAVAILABLE for every single call —
    // a programmer error laundered into a plausible-looking network condition.
    expect(isOk(result)).toBe(true);
  });

  it('uses an injected fetch as-is, so tests can substitute a plain fake', async () => {
    const fake: typeof fetch = vi.fn(() =>
      Promise.resolve(new Response(new Uint8Array(0), { status: 200 })),
    );
    const provider = new CloudflareTransferProvider('https://example.test', fake);

    const result = await provider.probeLatency(new AbortController().signal);

    expect(isOk(result)).toBe(true);
    expect(fake).toHaveBeenCalledOnce();
    expect(vi.mocked(fake).mock.calls[0]?.[0]).toBe('https://example.test/__down?bytes=0');
  });
});
