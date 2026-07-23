'use client';

import { AnimatedNumber } from '../../ui/AnimatedNumber';
import { t } from '../../../i18n/index';

/**
 * Hero figure for the live reading (dataviz: "the single number a
 * dashboard leads with, ≥48px"). This is a placeholder for the WebGL
 * data-flow field (§8, Phase 3B) — a real number people can trust today,
 * not a decorative stand-in for one.
 */
export function LiveGauge({
  mbps,
  phase,
}: {
  mbps: number | null;
  phase: 'download' | 'upload' | null;
}) {
  const seriesColor = phase === 'upload' ? 'var(--color-upload)' : 'var(--color-download)';
  const label = phase === 'upload' ? t.test.liveMetric.upload : t.test.liveMetric.download;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-baseline gap-2" style={{ color: seriesColor }}>
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
