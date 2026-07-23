'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getRenderCapabilityServerSnapshot,
  getRenderCapabilitySnapshot,
  subscribeToRenderCapability,
} from '../lib/render-capability';
import type { RenderCommand, RenderMetrics } from '../workers/render-protocol';

/**
 * Every canvas this hook has ever handed to a worker.
 *
 * `transferControlToOffscreen` is one-way and permanent: afterwards the
 * element cannot be transferred again, and even reading back is out —
 * assigning `width` throws `InvalidStateError`. React does not guarantee
 * a fresh DOM node across a remount, and an `AnimatePresence` subtree
 * that hides and reappears re-runs ref attachment on the *same* element.
 * Tracking liveness in a ref is not enough, because cleanup clears it
 * while the element stays spent — which is exactly the crash this
 * replaced.
 *
 * A `WeakSet` because entries must not keep detached canvases alive.
 */
const transferred = new WeakSet<HTMLCanvasElement>();

/**
 * Owns the render worker and the canvas it draws into (§8.1).
 *
 * The canvas is *transferred* to the worker, so the main thread cannot
 * draw to it afterwards even by accident — the isolation is enforced by
 * the platform rather than by everyone remembering. React re-renders
 * therefore cost the field nothing, and the field costs React nothing.
 *
 * `sendMetrics` is safe to call as often as measurements arrive: it is a
 * `postMessage`, not a `setState`, so it never triggers a React render.
 */
export function useRenderSurface() {
  const workerRef = useRef<Worker | null>(null);
  /**
   * Bumped to ask React for a brand-new `<canvas>`. A spent element can
   * never host a second worker, so recovering after a remount means
   * replacing the element, not reusing it.
   */
  const [surfaceKey, setSurfaceKey] = useState(0);
  const capability = useSyncExternalStore(
    subscribeToRenderCapability,
    getRenderCapabilitySnapshot,
    getRenderCapabilityServerSnapshot,
  );

  const attach = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (!canvas || capability.tier === 'static' || workerRef.current) {
        return;
      }

      if (transferred.has(canvas)) {
        // Remounted onto an element whose surface is already gone. Ask for
        // a fresh one rather than touching this one, which would throw.
        setSurfaceKey((key) => key + 1);
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1); // cap: past 2x the extra pixels cost more than they show
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));

      const worker = new Worker(new URL('../workers/render.worker.ts', import.meta.url));
      const offscreen = canvas.transferControlToOffscreen();
      transferred.add(canvas);
      const init: RenderCommand = {
        type: 'init',
        canvas: offscreen,
        devicePixelRatio: dpr,
        maxFps: capability.maxFps,
      };
      worker.postMessage(init, [offscreen]);
      workerRef.current = worker;
    },
    [capability],
  );

  const sendMetrics = useCallback((metrics: RenderMetrics) => {
    const command: RenderCommand = { type: 'metrics', metrics };
    workerRef.current?.postMessage(command);
  }, []);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  return { attach, sendMetrics, capability, surfaceKey };
}
