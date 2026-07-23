import type { CapabilityVerdict, RealWorldTranslation } from '../../../lib/real-world-translation';
import { t } from '../../../i18n/index';

function VerdictRow({ label, verdict }: { label: string; verdict: CapabilityVerdict }) {
  const symbol =
    verdict.status === 'supported' ? '✓' : verdict.status === 'not-supported' ? '✗' : '–';
  const color =
    verdict.status === 'supported'
      ? 'var(--color-status-good)'
      : verdict.status === 'not-supported'
        ? 'var(--color-status-critical)'
        : 'var(--color-ink-muted)';

  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span aria-hidden style={{ color }} className="mt-0.5 w-4 text-center font-semibold">
        {symbol}
      </span>
      <span>
        <span className="text-sm text-ink dark:text-ink-dark">{label}</span>
        {verdict.status !== 'supported' && (
          <span className="block text-xs text-ink-muted">{verdict.reason}</span>
        )}
      </span>
    </li>
  );
}

export function RealWorldTranslationList({ translation }: { translation: RealWorldTranslation }) {
  return (
    <div className="w-full max-w-sm">
      <h3 className="mb-1 text-sm font-semibold text-ink dark:text-ink-dark">
        {t.realWorldTranslation.heading}
      </h3>
      <ul>
        <VerdictRow label={t.realWorldTranslation.streaming4k} verdict={translation.streaming4k} />
        <VerdictRow label={t.realWorldTranslation.streamingHd} verdict={translation.streamingHd} />
        <VerdictRow label={t.realWorldTranslation.videoCalls} verdict={translation.videoCalls} />
        <VerdictRow label={t.realWorldTranslation.gaming} verdict={translation.gaming} />
      </ul>
    </div>
  );
}
