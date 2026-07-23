'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ThroughputHistoryPoint } from '../../../hooks/use-measurement';
import { t } from '../../../i18n/index';

interface ChartRow {
  readonly t: number;
  readonly download: number | null;
  readonly upload: number | null;
}

function toChartRows(history: readonly ThroughputHistoryPoint[]): ChartRow[] {
  const startMs = history[0]?.atMs ?? 0;
  return history.map((point) => ({
    t: (point.atMs - startMs) / 1000,
    download: point.phase === 'download' ? point.mbps : null,
    upload: point.phase === 'upload' ? point.mbps : null,
  }));
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { value?: number; dataKey?: string }[];
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }
  const entry = payload.find((p) => typeof p.value === 'number');
  if (!entry) {
    return null;
  }
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-1.5 text-xs shadow-sm dark:border-hairline-dark dark:bg-surface-dark">
      <span className="font-mono-figures tabular-nums text-ink dark:text-ink-dark">
        {entry.value?.toFixed(1)} Mbps
      </span>
    </div>
  );
}

export function ThroughputChart({ history }: { history: readonly ThroughputHistoryPoint[] }) {
  const rows = toChartRows(history);
  const hasDownload = history.some((point) => point.phase === 'download');
  const hasUpload = history.some((point) => point.phase === 'upload');

  return (
    <div className="w-full">
      {(hasDownload || hasUpload) && (
        <div className="mb-1 flex items-center justify-center gap-4 text-xs text-ink-secondary dark:text-ink-secondary-dark">
          {hasDownload && (
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: 'var(--color-download)' }}
              />
              {t.test.liveMetric.download}
            </span>
          )}
          {hasUpload && (
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: 'var(--color-upload)' }}
              />
              {t.test.liveMetric.upload}
            </span>
          )}
        </div>
      )}
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
          <XAxis dataKey="t" hide />
          <YAxis hide domain={[0, (max: number) => Math.max(max * 1.15, 5)]} />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="download"
            stroke="var(--color-download)"
            strokeWidth={2}
            fill="var(--color-download)"
            fillOpacity={0.1}
            connectNulls={false}
            isAnimationActive={false}
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="upload"
            stroke="var(--color-upload)"
            strokeWidth={2}
            fill="var(--color-upload)"
            fillOpacity={0.1}
            connectNulls={false}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
