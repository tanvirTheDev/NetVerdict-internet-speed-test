'use client';

import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMeasurement } from '../../../hooks/use-measurement';
import { congestionFromLatency } from '../../../lib/render-capability';
import { t } from '../../../i18n/index';
import { DataFlowGauge } from './DataFlowGauge';
import { ErrorPanel } from './ErrorPanel';
import { LiveLatency } from './LiveLatency';
import { PhaseIndicator } from './PhaseIndicator';
import { ResultCard } from './ResultCard';
import { ThroughputChart } from './ThroughputChart';

function PrimaryButton({
  onClick,
  children,
  color = 'var(--color-download)',
}: {
  onClick: () => void;
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-8 py-3 text-sm font-semibold text-white shadow-sm transition-transform active:scale-95"
      style={{ backgroundColor: color }}
    >
      {children}
    </button>
  );
}

export function TestScreen() {
  const { state, start, stop } = useMeasurement();

  /**
   * Everything the field is drawn from, derived only from measurements
   * that actually happened.
   *
   * The ceiling is the fastest reading this run has produced, so the
   * field fills the frame on a 30 Mbps line and a 900 Mbps line alike
   * without anyone hard-coding what "fast" means. It is a drawing scale,
   * never a reported figure.
   */
  const flow = useMemo(() => {
    const peakMbps = state.throughputHistory.reduce((max, point) => Math.max(max, point.mbps), 0);
    const loaded = state.latencySamples.filter((s) => s.underLoad !== 'none' && !s.timedOut);
    const idle = state.latencySamples.filter((s) => s.underLoad === 'none' && !s.timedOut);
    const mean = (xs: readonly number[]) =>
      xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;

    // Jitter over a short trailing window, so turbulence tracks how the
    // link behaves *now* rather than averaging the whole run flat.
    const recent = state.latencySamples.slice(-8).filter((s) => !s.timedOut);
    const jitterMs =
      recent.length >= 2
        ? recent
            .slice(1)
            .reduce((sum, s, i) => sum + Math.abs(s.rttMs - (recent[i]?.rttMs ?? s.rttMs)), 0) /
          (recent.length - 1)
        : 0;

    return {
      ceilingMbps: Math.max(1, peakMbps),
      jitterMs,
      congestion: congestionFromLatency(
        mean(idle.map((s) => s.rttMs)),
        mean(loaded.map((s) => s.rttMs)),
      ),
    };
  }, [state.throughputHistory, state.latencySamples]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-6">
      <AnimatePresence mode="wait">
        {state.status === 'idle' && (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-6 text-center"
          >
            <div>
              <h1 className="text-3xl font-semibold">{t.test.heading}</h1>
              <p className="mt-2 max-w-md text-ink-secondary dark:text-ink-secondary-dark">
                {t.test.tagline}
              </p>
            </div>
            <PrimaryButton onClick={start}>{t.test.startButton}</PrimaryButton>
          </motion.div>
        )}

        {state.status === 'running' && (
          <motion.div
            key="running"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex w-full max-w-md flex-col items-center gap-8"
          >
            <PhaseIndicator phase={state.phase} isRunning />
            {/*
              Only show the throughput gauge once a transfer phase is
              actually running. Before then there is no measured
              throughput, and rendering "0.0 Mbps" would put a number on
              screen that no transfer produced (§5.7).
            */}
            {state.throughputPhase === null ? (
              <LiveLatency samples={state.latencySamples} />
            ) : (
              <>
                <DataFlowGauge
                  mbps={state.instantaneousMbps}
                  ceilingMbps={flow.ceilingMbps}
                  direction={state.throughputPhase}
                  jitterMs={flow.jitterMs}
                  congestion={flow.congestion}
                />
                <ThroughputChart history={state.throughputHistory} />
              </>
            )}
            <PrimaryButton onClick={stop} color="var(--color-ink-muted)">
              {t.test.stopButton}
            </PrimaryButton>
          </motion.div>
        )}

        {state.status === 'completed' && state.result && (
          <motion.div
            key="completed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="flex flex-col items-center gap-6">
              <ResultCard result={state.result} />
              <PrimaryButton onClick={start}>{t.test.runAnotherButton}</PrimaryButton>
            </div>
          </motion.div>
        )}

        {state.status === 'aborted' && (
          <motion.div
            key="aborted"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4"
          >
            <p className="text-ink-secondary dark:text-ink-secondary-dark">
              {t.test.abortedMessage}
            </p>
            <PrimaryButton onClick={start}>{t.test.startButton}</PrimaryButton>
          </motion.div>
        )}

        {state.status === 'error' && state.error && (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <ErrorPanel error={state.error} onRetry={start} />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
