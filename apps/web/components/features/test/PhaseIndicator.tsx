'use client';

import { motion } from 'framer-motion';
import type { MeasurementPhase } from '@netverdict/contracts';
import { t } from '../../../i18n/index';

const PHASE_ORDER: readonly MeasurementPhase[] = ['idle_latency', 'download', 'upload'];

export function PhaseIndicator({
  phase,
  isRunning,
}: {
  phase: MeasurementPhase | null;
  isRunning: boolean;
}) {
  const label = phase ? t.test.phase[phase] : isRunning ? t.test.phase.idle : t.test.phase.idle;

  return (
    <div className="flex flex-col items-center gap-3">
      <motion.p
        key={label}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="text-sm font-medium text-ink-secondary dark:text-ink-secondary-dark"
      >
        {label}
      </motion.p>
      <div className="flex items-center gap-2" role="progressbar" aria-label={label}>
        {PHASE_ORDER.map((step) => {
          const stepIndex = PHASE_ORDER.indexOf(step);
          const currentIndex = phase ? PHASE_ORDER.indexOf(phase) : -1;
          const state =
            stepIndex < currentIndex ? 'done' : stepIndex === currentIndex ? 'active' : 'pending';
          return (
            <motion.span
              key={step}
              className="h-1.5 rounded-full"
              animate={{
                width: state === 'active' ? 28 : 8,
                backgroundColor:
                  state === 'pending' ? 'var(--color-hairline)' : 'var(--color-download)',
                opacity: state === 'pending' ? 0.6 : 1,
              }}
              transition={{ duration: 0.25 }}
            />
          );
        })}
      </div>
    </div>
  );
}
