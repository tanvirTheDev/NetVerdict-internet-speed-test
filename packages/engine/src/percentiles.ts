/**
 * Pure statistics over arrays of samples. Empty input is a programmer
 * error here — callers (the throughput/latency modules) are responsible
 * for checking `sampleCount` against a minimum and returning the
 * `INSUFFICIENT_SAMPLES` engine error *before* reaching these functions
 * (§2.5: throwing is reserved for invariant violations, not expected
 * measurement failures).
 */

function assertNonEmpty(values: readonly number[], fnName: string): void {
  if (values.length === 0) {
    throw new RangeError(`${fnName}: called with an empty array`);
  }
}

/**
 * Bounds-checked array read that throws instead of asserting. A `??`
 * fallback would substitute a made-up number into the math below — the
 * one thing this whole codebase exists to never do (§5.7); a bounds
 * violation here is a bug in this file, not a plausible runtime state.
 */
function at(values: readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) {
    throw new RangeError(
      `index ${String(index)} out of bounds for array of length ${String(values.length)}`,
    );
  }
  return value;
}

/** Linear-interpolation percentile (the same method numpy's default `'linear'` uses), for `p` in [0, 100]. */
export function percentile(values: readonly number[], p: number): number {
  assertNonEmpty(values, 'percentile');
  if (p < 0 || p > 100) {
    throw new RangeError(`percentile: p must be in [0, 100], got ${String(p)}`);
  }
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) {
    return at(sorted, 0);
  }
  const rank = (p / 100) * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = at(sorted, lowerIndex);
  const upper = at(sorted, upperIndex);
  const fraction = rank - lowerIndex;
  return lower + (upper - lower) * fraction;
}

export function median(values: readonly number[]): number {
  assertNonEmpty(values, 'median');
  return percentile(values, 50);
}

/** Mean absolute difference between consecutive values — the jitter definition used throughout §5.3/§5.4. */
export function meanAbsoluteSuccessiveDifference(values: readonly number[]): number {
  assertNonEmpty(values, 'meanAbsoluteSuccessiveDifference');
  if (values.length === 1) {
    return 0;
  }
  let sum = 0;
  for (let i = 1; i < values.length; i += 1) {
    sum += Math.abs(at(values, i) - at(values, i - 1));
  }
  return sum / (values.length - 1);
}
