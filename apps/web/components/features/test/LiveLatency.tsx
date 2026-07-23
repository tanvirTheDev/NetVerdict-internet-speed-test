'use client';

import type { LatencySample } from '@netverdict/contracts';
import { AnimatedNumber } from '../../ui/AnimatedNumber';
import { t } from '../../../i18n/index';

/**
 * Shown during the idle-latency phase, where no bytes have been
 * transferred yet. Rendering a throughput gauge here would put "0.0
 * Mbps" on screen for a download that has not started — a number no
 * transfer produced, which §5.7 forbids. This shows the probe data that
 * genuinely exists at this point instead.
 */
export function LiveLatency({ samples }: { samples: readonly LatencySample[] }) {
  const answered = samples.filter((sample) => !sample.timedOut);
  const latest = answered.at(-1);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-baseline gap-2" style={{ color: 'var(--color-download)' }}>
        {latest ? (
          <AnimatedNumber
            value={latest.rttMs}
            decimals={0}
            className="text-6xl font-semibold tracking-tight sm:text-7xl"
          />
        ) : (
          <span className="text-6xl font-semibold tracking-tight sm:text-7xl">—</span>
        )}
        <span className="text-xl font-medium text-ink-muted">ms</span>
      </div>
      <p className="text-sm font-medium text-ink-secondary dark:text-ink-secondary-dark">
        {t.test.advancedMetrics.idleLatency}
        <span className="ml-2 text-ink-muted">
          {answered.length}/{samples.length}
        </span>
      </p>
    </div>
  );
}
