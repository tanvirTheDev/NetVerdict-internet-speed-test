'use client';

import { motion } from 'framer-motion';
import type { TestResult } from '@netverdict/contracts';
import { translateToRealWorldCapabilities } from '../../../lib/real-world-translation';
import { t } from '../../../i18n/index';
import { AdvancedMetricsPanel } from './AdvancedMetricsPanel';
import { RealWorldTranslationList } from './RealWorldTranslationList';

function FigureBlock({
  label,
  mbps,
  color,
  testId,
}: {
  label: string;
  mbps: number | undefined;
  color: string;
  testId: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="flex items-baseline gap-1.5">
        <span
          data-testid={testId}
          className="text-4xl font-semibold tracking-tight"
          style={{ color }}
        >
          {mbps === undefined ? t.result.unavailable : mbps.toFixed(1)}
        </span>
        {mbps !== undefined && <span className="text-sm font-medium text-ink-muted">Mbps</span>}
      </span>
      <span className="text-xs text-ink-secondary dark:text-ink-secondary-dark">{label}</span>
    </div>
  );
}

export function ResultCard({ result }: { result: TestResult }) {
  const down = result.download.status === 'complete' ? result.download.data.mbps : undefined;
  const up = result.upload.status === 'complete' ? result.upload.data.mbps : undefined;
  const translation = translateToRealWorldCapabilities(result);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 140, damping: 18 }}
      className="flex w-full max-w-2xl flex-col items-center gap-6"
    >
      <h2 className="text-lg font-semibold text-ink dark:text-ink-dark">{t.result.heading}</h2>

      {result.isPartial && (
        <p className="rounded-md border border-status-warning bg-status-warning/10 px-3 py-2 text-xs text-ink dark:text-ink-dark">
          {t.result.partialNotice}
        </p>
      )}
      {result.anomalyFlag && (
        <p className="rounded-md border border-status-warning bg-status-warning/10 px-3 py-2 text-xs text-ink dark:text-ink-dark">
          {t.result.anomalyNotice}
        </p>
      )}

      <div className="flex gap-10">
        <FigureBlock
          label={t.test.liveMetric.download}
          mbps={down}
          color="var(--color-download)"
          testId="download-figure"
        />
        <FigureBlock
          label={t.test.liveMetric.upload}
          mbps={up}
          color="var(--color-upload)"
          testId="upload-figure"
        />
      </div>

      <div className="flex flex-col items-start gap-8 sm:flex-row">
        <AdvancedMetricsPanel result={result} />
        <RealWorldTranslationList translation={translation} />
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          disabled
          title={t.result.saveToHistoryHint}
          className="cursor-not-allowed rounded-md border border-hairline px-4 py-2 text-sm text-ink-muted dark:border-hairline-dark"
        >
          {t.result.saveToHistory}
        </button>
        <button
          type="button"
          disabled
          title={t.result.shareAsEvidenceHint}
          className="cursor-not-allowed rounded-md border border-hairline px-4 py-2 text-sm text-ink-muted dark:border-hairline-dark"
        >
          {t.result.shareAsEvidence}
        </button>
      </div>
    </motion.div>
  );
}
