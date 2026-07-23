'use client';

import { useEffect, useRef } from 'react';
import { AnimatedNumber } from '../../ui/AnimatedNumber';
import { useRenderSurface } from '../../../hooks/use-render-surface';
import { t } from '../../../i18n/index';
import type { FlowDirection } from '../../../workers/render-protocol';

/**
 * The hero visual (§8 #1/#2/#5): a data-flow field whose particles carry
 * the live reading — speed and density from throughput, direction from
 * the phase, turbulence from jitter, and a visible swell from congestion.
 *
 * The number is rendered in the DOM, not in the field, and comes straight
 * from the sample. That split is deliberate: the field may ease between
 * frames to look like flow, but the figure a user reads and screenshots
 * is never a smoothed value (§5.7 rule 1).
 */
export function DataFlowGauge({
  mbps,
  ceilingMbps,
  direction,
  jitterMs,
  congestion,
}: {
  mbps: number | null;
  ceilingMbps: number;
  direction: FlowDirection;
  jitterMs: number;
  congestion: number;
}) {
  const { attach, sendMetrics, capability, surfaceKey } = useRenderSurface();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    sendMetrics({ mbps: mbps ?? 0, ceilingMbps, direction, jitterMs, congestion });
  }, [mbps, ceilingMbps, direction, jitterMs, congestion, sendMetrics]);

  const color = direction === 'upload' ? 'var(--color-upload)' : 'var(--color-download)';
  const label = direction === 'upload' ? t.test.liveMetric.upload : t.test.liveMetric.download;
  const fill = Math.max(0, Math.min(1, (mbps ?? 0) / Math.max(1, ceilingMbps)));

  return (
    <div ref={containerRef} className="relative flex w-full flex-col items-center gap-1">
      <div className="relative h-40 w-full overflow-hidden rounded-xl">
        {capability.tier === 'static' ? (
          /*
           * Reduced-motion or no OffscreenCanvas. Same numbers, no
           * animation — a bar sized by the same ratio the field would
           * have drawn. Someone who asked for less motion still gets the
           * full reading (§8.1).
           */
          <div className="absolute inset-0 flex items-center px-4" aria-hidden>
            <div className="h-3 w-full overflow-hidden rounded-full bg-hairline dark:bg-hairline-dark">
              <div
                className="h-full rounded-full"
                style={{ width: `${String(fill * 100)}%`, backgroundColor: color }}
              />
            </div>
          </div>
        ) : (
          /*
           * `key` so a remount gets a genuinely new element: a canvas
           * that has been transferred to a worker can never host another
           * one, and reusing it throws.
           */
          <canvas
            key={surfaceKey}
            ref={attach}
            className="absolute inset-0 h-full w-full"
            aria-hidden
          />
        )}
      </div>

      <div className="flex items-baseline gap-2" style={{ color }}>
        <AnimatedNumber
          value={mbps ?? 0}
          decimals={1}
          className="text-6xl font-semibold tracking-tight sm:text-7xl"
        />
        <span className="text-xl font-medium text-ink-muted">Mbps</span>
      </div>
      <p className="text-sm font-medium text-ink-secondary dark:text-ink-secondary-dark">{label}</p>
    </div>
  );
}
