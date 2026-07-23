import type {
  BufferbloatGrade,
  PhaseResult,
  LatencyResult,
  TestResult,
} from '@netverdict/contracts';
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

/** A+/A are healthy, B/C are noticeable, D/F are the grades that ruin calls and games. */
const GRADE_COLOR: Record<BufferbloatGrade, string> = {
  'A+': 'text-status-good',
  A: 'text-status-good',
  B: 'text-status-warning',
  C: 'text-status-warning',
  D: 'text-status-critical',
  F: 'text-status-critical',
};

function GradeRow({ label, grade }: { label: string; grade: BufferbloatGrade | 'unavailable' }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-sm text-ink-secondary dark:text-ink-secondary-dark">{label}</dt>
      <dd
        className={`text-sm font-semibold ${
          grade === 'unavailable' ? 'text-ink-muted' : GRADE_COLOR[grade]
        }`}
      >
        {grade === 'unavailable' ? t.result.unavailable : grade}
      </dd>
    </div>
  );
}

function latencyMs(phase: PhaseResult<LatencyResult>): string {
  return phase.status === 'complete' ? `${phase.data.medianMs.toFixed(0)}ms` : t.result.unavailable;
}

export function AdvancedMetricsPanel({ result }: { result: TestResult }) {
  const latency = result.idleLatency.status === 'complete' ? result.idleLatency.data : null;
  const down = result.download.status === 'complete' ? result.download.data : null;
  const up = result.upload.status === 'complete' ? result.upload.data : null;
  const rpmUnderLoad = result.rpm.down ?? result.rpm.up;

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
        <MetricRow
          label={t.test.advancedMetrics.server}
          value={
            result.conditions.server
              ? `${result.conditions.server.colo} · ${result.conditions.server.country}`
              : t.result.unavailable
          }
        />
      </dl>

      <h3 className="mb-1 mt-4 border-t border-hairline pt-3 text-sm font-semibold text-ink dark:border-hairline-dark dark:text-ink-dark">
        {t.test.advancedMetrics.underLoadHeading}
      </h3>
      <dl>
        <MetricRow
          label={t.test.advancedMetrics.loadedLatencyDown}
          value={latencyMs(result.loadedLatencyDown)}
        />
        <MetricRow
          label={t.test.advancedMetrics.loadedLatencyUp}
          value={latencyMs(result.loadedLatencyUp)}
        />
        <GradeRow
          label={t.test.advancedMetrics.bufferbloatDown}
          grade={result.bufferbloatGradeDown}
        />
        <GradeRow label={t.test.advancedMetrics.bufferbloatUp} grade={result.bufferbloatGradeUp} />
        <MetricRow
          label={t.test.advancedMetrics.rpm}
          value={rpmUnderLoad === undefined ? t.result.unavailable : rpmUnderLoad.toString()}
        />
      </dl>
      <p className="mt-2 text-xs text-ink-muted">{t.test.advancedMetrics.rpmExplainer}</p>

      <p className="mt-3 border-t border-hairline pt-3 text-xs text-ink-muted dark:border-hairline-dark">
        {t.test.advancedMetrics.serverExplainer}
      </p>
    </div>
  );
}
