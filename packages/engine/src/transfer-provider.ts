import {
  asMilliseconds,
  err,
  ok,
  type Bytes,
  type EngineError,
  type EpochMs,
  type Milliseconds,
  type Result,
  type TransferSample,
} from '@netverdict/contracts';
import type { Clock } from './clock';

export interface LatencyProbeResult {
  rttMs: Milliseconds;
  timedOut: boolean;
}

export interface TransferStreamParams {
  streamId: string;
  byteTarget: Bytes;
  clock: Clock;
  testStartMs: EpochMs;
  onSample: (sample: TransferSample) => void;
  signal: AbortSignal;
}

/**
 * The transfer backend is pluggable (§5.1) so a self-hosted fallback can
 * be added later without touching the orchestrator or the math. Every
 * implementation must run unmodified under both a browser Worker and
 * headless Node (§5.6) — so only Fetch-family APIs here, nothing
 * DOM-specific beyond what Node's `undici`-backed `fetch` also provides.
 */
export interface TransferProvider {
  readonly endpoint: string;
  probeLatency(signal: AbortSignal): Promise<Result<LatencyProbeResult, EngineError>>;
  download(params: TransferStreamParams): Promise<Result<void, EngineError>>;
  upload(params: TransferStreamParams): Promise<Result<void, EngineError>>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const UPLOAD_CHUNK_BYTES = 64 * 1024;

function combinedSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

function classifyFetchFailure(
  cause: unknown,
  signal: AbortSignal,
  phase: EngineError['phase'],
): EngineError {
  if (signal.aborted) {
    return { code: 'ABORTED_BY_USER', phase, retriable: false, message: 'Aborted by caller' };
  }
  if (cause instanceof DOMException && cause.name === 'TimeoutError') {
    return { code: 'TIMEOUT', phase, retriable: true, message: cause.message };
  }
  if (cause instanceof TypeError) {
    // fetch rejects with TypeError for network failures and CORS blocks alike;
    // we cannot reliably distinguish them from the error alone.
    return {
      code: 'NETWORK_UNAVAILABLE',
      phase,
      retriable: true,
      message: cause.message,
    };
  }
  return {
    code: 'NETWORK_UNAVAILABLE',
    phase,
    retriable: true,
    message: cause instanceof Error ? cause.message : String(cause),
  };
}

/**
 * Real byte transfer against Cloudflare's public speed endpoints (§5.1)
 * — our server never sees the payload. `fetchImpl` is injected so the
 * network boundary can be swapped in an integration test; it is not
 * exercised by the deterministic unit suite (§2.8 — no live network in
 * CI).
 */
export class CloudflareTransferProvider implements TransferProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(
    readonly endpoint = 'https://speed.cloudflare.com',
    fetchImpl?: typeof fetch,
  ) {
    // `fetch` MUST be bound to the global scope. Stored on an instance and
    // called as `this.fetchImpl(...)`, its receiver becomes this provider,
    // and browsers reject that with
    // `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`.
    // Node's fetch is receiver-agnostic, so an unbound reference passes the
    // CLI harness and fails 100% of requests in the browser — bind it here
    // rather than relying on every call site. An injected fake is used
    // as-is; test doubles are plain functions with no receiver requirement.
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async probeLatency(signal: AbortSignal): Promise<Result<LatencyProbeResult, EngineError>> {
    const probeSignal = combinedSignal(signal, DEFAULT_TIMEOUT_MS);
    const startedAt = performance.now();
    try {
      const response = await this.fetchImpl(`${this.endpoint}/__down?bytes=0`, {
        signal: probeSignal,
        cache: 'no-store',
      });
      const rttMs = asMilliseconds(performance.now() - startedAt);
      if (!response.ok) {
        return err({
          code: 'ENDPOINT_REJECTED',
          phase: 'idle_latency',
          retriable: true,
          message: `Latency probe got HTTP ${String(response.status)}`,
        });
      }
      // Draining the (empty) body lets the connection be reused by the next probe.
      await response.body?.cancel();
      return ok({ rttMs, timedOut: false });
    } catch (cause) {
      if (probeSignal.aborted && !signal.aborted) {
        // Our own timeout fired, not a caller-initiated abort — a timed-out probe, not an error.
        return ok({ rttMs: asMilliseconds(DEFAULT_TIMEOUT_MS), timedOut: true });
      }
      return err(classifyFetchFailure(cause, signal, 'idle_latency'));
    }
  }

  async download(params: TransferStreamParams): Promise<Result<void, EngineError>> {
    const { streamId, byteTarget, clock, testStartMs, onSample, signal } = params;
    const requestSignal = combinedSignal(signal, DEFAULT_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${this.endpoint}/__down?bytes=${String(byteTarget)}`, {
        signal: requestSignal,
        cache: 'no-store',
      });
      if (!response.ok) {
        return err({
          code: 'ENDPOINT_REJECTED',
          phase: 'download',
          retriable: true,
          message: `Download endpoint got HTTP ${String(response.status)}`,
        });
      }
      if (!response.body) {
        return err({
          code: 'UNSUPPORTED_ENVIRONMENT',
          phase: 'download',
          retriable: false,
          message: 'Streaming response bodies are not supported in this environment',
        });
      }
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        onSample({
          atMs: clock.now() - testStartMs,
          bytes: value.byteLength,
          streamId,
        });
      }
      return ok(undefined);
    } catch (cause) {
      return err(classifyFetchFailure(cause, signal, 'download'));
    }
  }

  /**
   * Upload has two transports because no single one works in both
   * environments:
   *
   * - **Browser → XHR.** Chrome rejects a streaming `ReadableStream`
   *   request body against this endpoint outright (`TypeError: Failed to
   *   fetch`), so the fetch path is not merely less accurate there, it
   *   does not work. XHR is also the *more* honest signal:
   *   `upload.onprogress` reports bytes actually handed to the network
   *   stack, whereas the streaming-fetch path could only observe the rate
   *   at which we enqueued them.
   * - **Node → streaming fetch.** Node has no `XMLHttpRequest`, and its
   *   fetch accepts a streaming body fine.
   *
   * Both feed identical `TransferSample`s into the same windowing math,
   * so §5.6 headless parity holds: one implementation of the
   * measurement, two transports beneath it.
   */
  upload(params: TransferStreamParams): Promise<Result<void, EngineError>> {
    return typeof XMLHttpRequest === 'undefined'
      ? this.uploadViaStreamingFetch(params)
      : this.uploadViaXhr(params);
  }

  private uploadViaXhr(params: TransferStreamParams): Promise<Result<void, EngineError>> {
    const { streamId, byteTarget, clock, testStartMs, onSample, signal } = params;

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      let settled = false;
      const settle = (result: Result<void, EngineError>): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      };
      function onAbort(): void {
        xhr.abort();
      }

      // `loaded` is cumulative; the windowing math wants per-interval deltas.
      let lastLoaded = 0;
      xhr.upload.onprogress = (event: ProgressEvent) => {
        const delta = event.loaded - lastLoaded;
        lastLoaded = event.loaded;
        if (delta > 0) {
          onSample({ atMs: clock.now() - testStartMs, bytes: delta, streamId });
        }
      };

      xhr.onload = () => {
        settle(
          xhr.status >= 200 && xhr.status < 300
            ? ok(undefined)
            : err({
                code: 'ENDPOINT_REJECTED',
                phase: 'upload',
                retriable: true,
                message: `Upload endpoint got HTTP ${String(xhr.status)}`,
              }),
        );
      };
      xhr.onerror = () => {
        settle({
          ok: false,
          error: {
            code: 'NETWORK_UNAVAILABLE',
            phase: 'upload',
            retriable: true,
            message: 'Upload request failed at the network layer',
          },
        });
      };
      xhr.ontimeout = () => {
        settle(
          err({
            code: 'TIMEOUT',
            phase: 'upload',
            retriable: true,
            message: `Upload exceeded ${String(DEFAULT_TIMEOUT_MS)}ms`,
          }),
        );
      };
      xhr.onabort = () => {
        settle(
          err({
            code: 'ABORTED_BY_USER',
            phase: 'upload',
            retriable: false,
            message: 'Aborted by caller',
          }),
        );
      };

      if (signal.aborted) {
        settle(
          err({
            code: 'ABORTED_BY_USER',
            phase: 'upload',
            retriable: false,
            message: 'Aborted by caller',
          }),
        );
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });

      xhr.open('POST', `${this.endpoint}/__up`);
      xhr.timeout = DEFAULT_TIMEOUT_MS;
      xhr.send(createRandomPayload(byteTarget));
    });
  }

  private async uploadViaStreamingFetch(
    params: TransferStreamParams,
  ): Promise<Result<void, EngineError>> {
    const { streamId, byteTarget, clock, testStartMs, onSample, signal } = params;
    const requestSignal = combinedSignal(signal, DEFAULT_TIMEOUT_MS);
    let bytesSent = 0;

    // NOTE (§5.7 honesty): this observes the rate at which we *enqueue*
    // bytes, not confirmed on-wire delivery — Node's fetch exposes no
    // socket-level upload progress. Stream backpressure keeps enqueue
    // rate close to send rate, but this is a documented approximation.
    // The browser path uses XHR precisely because it can do better.
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        if (bytesSent >= byteTarget) {
          controller.close();
          return;
        }
        const chunkSize = Math.min(UPLOAD_CHUNK_BYTES, byteTarget - bytesSent);
        const chunk = new Uint8Array(chunkSize);
        crypto.getRandomValues(chunk);
        controller.enqueue(chunk);
        bytesSent += chunkSize;
        onSample({
          atMs: clock.now() - testStartMs,
          bytes: chunkSize,
          streamId,
        });
      },
    });

    try {
      const response = await this.fetchImpl(`${this.endpoint}/__up`, {
        method: 'POST',
        body,
        // @ts-expect-error -- `duplex` is required by the Fetch spec for streaming request bodies but missing from lib.dom.d.ts's RequestInit as of this TypeScript version.
        duplex: 'half',
        signal: requestSignal,
        cache: 'no-store',
      });
      if (!response.ok) {
        return err({
          code: 'ENDPOINT_REJECTED',
          phase: 'upload',
          retriable: true,
          message: `Upload endpoint got HTTP ${String(response.status)}`,
        });
      }
      await response.body?.cancel();
      return ok(undefined);
    } catch (cause) {
      return err(classifyFetchFailure(cause, signal, 'upload'));
    }
  }
}

/**
 * Random bytes for the upload payload, generated in chunks — both
 * because `crypto.getRandomValues` rejects requests over 65,536 bytes,
 * and because §5.2 forbids materialising one giant buffer. The chunks
 * are handed to a `Blob`, which browsers back with their own storage
 * rather than the JS heap.
 */
function createRandomPayload(byteTarget: number): Blob {
  const chunks: Uint8Array[] = [];
  let remaining = byteTarget;
  while (remaining > 0) {
    const size = Math.min(UPLOAD_CHUNK_BYTES, remaining);
    const chunk = new Uint8Array(size);
    crypto.getRandomValues(chunk);
    chunks.push(chunk);
    remaining -= size;
  }
  return new Blob(chunks as BlobPart[], { type: 'application/octet-stream' });
}

export function randomStreamId(index: number): string {
  return `stream-${String(index)}`;
}
