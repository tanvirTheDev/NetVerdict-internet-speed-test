/**
 * Main thread → render worker protocol (§8.1).
 *
 * Deliberately NOT in `@netverdict/contracts`: that package is the
 * measurement contract, and nothing about how a picture is drawn belongs
 * in it. Keeping the two apart is what stops a visual requirement from
 * ever reaching back and reshaping a measured type.
 *
 * The traffic here is one-way. The render worker is told what the
 * connection is doing and draws it; it never reports anything back that
 * could reach a result. A visual bug can therefore make the page ugly,
 * but it cannot make a number wrong.
 */

/** Which way the bytes are flowing, and so which way particles travel. */
export type FlowDirection = 'idle' | 'download' | 'upload';

export interface RenderMetrics {
  /** Live throughput. Particle speed and density are driven by this. */
  readonly mbps: number;
  /**
   * Scale the field is drawn against, so a 30 Mbps line and a 900 Mbps
   * line both fill the frame. Rescaled on the main thread rather than
   * inferred here — the worker must never guess at data.
   */
  readonly ceilingMbps: number;
  readonly direction: FlowDirection;
  /** Recent jitter in ms. Drives turbulence: a steady link flows straight, an erratic one churns. */
  readonly jitterMs: number;
  /**
   * How congested the link currently looks, 0–1, derived from loaded vs
   * idle latency. Drives the "clog" — the pipe visibly backs up (§8 #2).
   */
  readonly congestion: number;
}

export const IDLE_METRICS: RenderMetrics = {
  mbps: 0,
  ceilingMbps: 1,
  direction: 'idle',
  jitterMs: 0,
  congestion: 0,
};

export type RenderCommand =
  | {
      readonly type: 'init';
      readonly canvas: OffscreenCanvas;
      readonly devicePixelRatio: number;
      /**
       * Cap on the worker's frame rate. The low-end path lowers this
       * rather than dropping the visual, so a weak device still shows
       * something truthful (§8.1 — throttle visuals, never measurement).
       */
      readonly maxFps: number;
    }
  | { readonly type: 'resize'; readonly width: number; readonly height: number }
  | { readonly type: 'metrics'; readonly metrics: RenderMetrics }
  | { readonly type: 'stop' };
