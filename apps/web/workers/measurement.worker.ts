/// <reference lib="webworker" />
import { workerCommandSchema, type WorkerCommand, type WorkerEvent } from '@netverdict/contracts';
import {
  CloudflareTransferProvider,
  DEFAULT_ORCHESTRATOR_CONFIG,
  ENGINE_VERSION,
  SystemClock,
  runMeasurement,
} from '@netverdict/engine';
import { detectConnectionType } from '../lib/connection-type';

/**
 * The measurement engine runs in this Worker so its timing is never
 * corrupted by main-thread render jank (§5/§8.1). This file is the only
 * "imperative glue" between the pure engine and the browser — it holds
 * no measurement logic of its own, only message marshaling.
 *
 * Messages are validated at the boundary (§5.5): a malformed command is
 * dropped, never crashes the worker.
 */
declare const self: DedicatedWorkerGlobalScope;

let activeController: AbortController | null = null;

function postEvent(event: WorkerEvent): void {
  self.postMessage(event);
}

function startMeasurement(command: Extract<WorkerCommand, { type: 'start' }>): void {
  activeController?.abort(); // guard against a stray double-start
  const controller = new AbortController();
  activeController = controller;

  const provider = new CloudflareTransferProvider(command.endpoint);
  const clock = new SystemClock();

  runMeasurement(
    {
      ...DEFAULT_ORCHESTRATOR_CONFIG,
      endpoint: provider.endpoint,
      connectionType: detectConnectionType(),
      userAgentClass: self.navigator.userAgent,
      tzOffsetMinutes: new Date().getTimezoneOffset(),
      engineVersion: ENGINE_VERSION,
    },
    { provider, clock },
    postEvent,
    controller.signal,
  ).catch((error: unknown) => {
    // runMeasurement returns typed errors through `onEvent`; reaching here
    // means an invariant broke, which must surface rather than vanish into
    // an unhandled rejection inside a Worker.
    console.error('[measurement worker] unexpected failure', error);
  });
}

self.onmessage = (messageEvent: MessageEvent<unknown>): void => {
  const parsed = workerCommandSchema.safeParse(messageEvent.data);
  if (!parsed.success) {
    return;
  }
  const command = parsed.data;

  if (command.type === 'stop') {
    activeController?.abort();
    return;
  }

  startMeasurement(command);
};
