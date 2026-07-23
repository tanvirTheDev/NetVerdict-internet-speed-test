import type { EngineError, EngineErrorCode } from '@netverdict/contracts';
import { t } from '../../../i18n/index';

/**
 * Maps a closed error code to a user-facing message (§2.5: the UI maps
 * `code` to a localized message; it never string-matches `error.message`,
 * which is for logs only).
 */
const MESSAGE_BY_CODE: Record<EngineErrorCode, string> = {
  NETWORK_UNAVAILABLE: t.test.error.networkUnavailable,
  ENDPOINT_REJECTED: t.test.error.endpointRejected,
  ENDPOINT_RATE_LIMITED: t.test.error.endpointRateLimited,
  CORS_BLOCKED: t.test.error.corsBlocked,
  TIMEOUT: t.test.error.timeout,
  ABORTED_BY_USER: t.test.error.unknown,
  INSUFFICIENT_SAMPLES: t.test.error.insufficientSamples,
  UNSUPPORTED_ENVIRONMENT: t.test.error.unsupportedEnvironment,
};

export function ErrorPanel({ error, onRetry }: { error: EngineError; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-status-critical bg-status-critical/5 px-6 py-5 text-center">
      <h2 className="text-base font-semibold text-ink dark:text-ink-dark">
        {t.test.error.heading}
      </h2>
      <p className="max-w-sm text-sm text-ink-secondary dark:text-ink-secondary-dark">
        {MESSAGE_BY_CODE[error.code]}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md bg-download px-4 py-2 text-sm font-medium text-white"
      >
        {t.test.error.retry}
      </button>
    </div>
  );
}
