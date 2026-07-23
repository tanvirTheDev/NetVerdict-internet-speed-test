import type { TestResult } from '@netverdict/contracts';
import { t } from '../../../i18n/index';

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-sm text-ink-secondary dark:text-ink-secondary-dark">{label}</dt>
      <dd className="font-mono-figures text-sm tabular-nums text-ink dark:text-ink-dark">
        {value}
      </dd>
    </div>
  );
}

export function AdvancedMetricsPanel({ result }: { result: TestResult }) {
  const latency = result.idleLatency.status === 'complete' ? result.idleLatency.data : null;
  const down = result.download.status === 'complete' ? result.download.data : null;
  const up = result.upload.status === 'complete' ? result.upload.data : null;

  return (
    <div className="w-full max-w-sm rounded-lg border border-hairline bg-surface p-4 dark:border-hairline-dark dark:bg-surface-dark">
      <h3 className="mb-1 text-sm font-semibold text-ink dark:text-ink-dark">
        {t.test.advancedMetrics.heading}
      </h3>
      <dl>
        <MetricRow
          label={t.test.advancedMetrics.idleLatency}
          value={latency ? `${latency.medianMs.toFixed(0)}ms` : t.result.unavailable}
        />
        <MetricRow
          label={t.test.advancedMetrics.jitter}
          value={latency ? `${latency.jitterMs.toFixed(1)}ms` : t.result.unavailable}
        />
        <MetricRow
          label={t.test.advancedMetrics.packetLoss}
          value={latency ? `${latency.packetLossPct.toFixed(1)}%` : t.result.unavailable}
        />
        <MetricRow
          label={t.test.liveMetric.download}
          value={
            down
              ? `${down.streamCount.toString()} ${t.test.advancedMetrics.streams}`
              : t.result.unavailable
          }
        />
        <MetricRow
          label={t.test.liveMetric.upload}
          value={
            up
              ? `${up.streamCount.toString()} ${t.test.advancedMetrics.streams}`
              : t.result.unavailable
          }
        />
      </dl>
      <p className="mt-3 border-t border-hairline pt-3 text-xs text-ink-muted dark:border-hairline-dark">
        {t.test.advancedMetrics.unavailableBufferbloat}
      </p>
    </div>
  );
}
