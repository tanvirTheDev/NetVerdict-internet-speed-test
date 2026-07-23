/**
 * Decides how much visual a device should be asked to draw (§8.1).
 *
 * The rule this encodes: **accuracy outranks spectacle, always.** Every
 * lever here throttles or removes visuals. None of them touches the
 * measurement, which runs in its own worker and is not aware this module
 * exists.
 */

export type RenderTier =
  /** Full WebGL particle field in an OffscreenCanvas worker. */
  | 'full'
  /** Same field, fewer particles and a lower frame cap — a weak device still gets the real visual. */
  | 'reduced'
  /** No animation at all: a static bar driven by the same numbers. Reduced-motion, or no OffscreenCanvas. */
  | 'static';

export interface RenderCapability {
  readonly tier: RenderTier;
  readonly maxFps: number;
  readonly particleCount: number;
  readonly reason: string;
}

const FULL: Omit<RenderCapability, 'reason'> = { tier: 'full', maxFps: 60, particleCount: 2_000 };
const REDUCED: Omit<RenderCapability, 'reason'> = {
  tier: 'reduced',
  maxFps: 30,
  particleCount: 500,
};
const STATIC: Omit<RenderCapability, 'reason'> = { tier: 'static', maxFps: 0, particleCount: 0 };

/**
 * `prefers-reduced-motion` is honoured as an instruction, not a hint —
 * someone who gets motion sick or seizures from a moving particle field
 * has said so, and "but the data is pretty" is not a reason to override
 * them. They still get every number; they just get it still.
 */
export function detectRenderCapability(win: Window = window): RenderCapability {
  if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return { ...STATIC, reason: 'prefers-reduced-motion' };
  }

  // Without OffscreenCanvas the field could only be drawn on the main
  // thread, which is precisely the contamination §8.1 forbids during a
  // live measurement. Better no animation than a skewed number.
  if (!('OffscreenCanvas' in win)) {
    return { ...STATIC, reason: 'no OffscreenCanvas support' };
  }

  // `deviceMemory` is non-standard, and `hardwareConcurrency` — though
  // typed as always present — is genuinely absent on some browsers. Both
  // are re-typed as optional so the fallbacks below are real rather than
  // dead code the type checker has been told to ignore.
  // `Omit` rather than an intersection: intersecting with an optional
  // property keeps the required one from `Navigator`, so the `??` below
  // would be dead code the compiler could see through.
  const nav = win.navigator as Omit<Navigator, 'hardwareConcurrency'> & {
    deviceMemory?: number;
    hardwareConcurrency?: number;
  };
  const cores = nav.hardwareConcurrency ?? 0;
  const memoryGb = nav.deviceMemory ?? 0;

  // Both signals are advisory and widely absent (Safari reports neither),
  // so a missing value must not by itself demote the device — only a
  // present-and-low one does.
  if ((cores > 0 && cores <= 4) || (memoryGb > 0 && memoryGb <= 4)) {
    return {
      ...REDUCED,
      reason: `low-end device (${String(cores)} cores, ${String(memoryGb)}GB)`,
    };
  }

  return { ...FULL, reason: 'full capability' };
}

/**
 * A `useSyncExternalStore` source for the capability.
 *
 * This is external state, not React state: it comes from the device and
 * from an OS-level accessibility preference, and it can change mid-session
 * when someone toggles "reduce motion". Reading it through a store rather
 * than computing it in an effect means the very first paint already has
 * the right answer, and a preference change takes effect immediately
 * instead of on the next run.
 *
 * The snapshot is cached because `useSyncExternalStore` compares
 * snapshots by identity — returning a fresh object each read would spin
 * forever.
 */
let cached: RenderCapability | null = null;

export function subscribeToRenderCapability(onChange: () => void): () => void {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const handler = (): void => {
    cached = null;
    onChange();
  };
  query.addEventListener('change', handler);
  return () => {
    query.removeEventListener('change', handler);
  };
}

export function getRenderCapabilitySnapshot(): RenderCapability {
  cached ??= detectRenderCapability();
  return cached;
}

/**
 * The server cannot know the device or its motion preference, so it
 * renders the still version. Guessing at the animated one would mean
 * hydrating into motion for someone who asked for none.
 */
const SERVER_CAPABILITY: RenderCapability = { ...STATIC, reason: 'server render' };

export function getRenderCapabilityServerSnapshot(): RenderCapability {
  return SERVER_CAPABILITY;
}

/**
 * Maps loaded latency against its idle baseline onto 0–1 for the clog
 * visual. Returns 0 when either figure is missing: an unknown congestion
 * level draws as "not congested" rather than inventing a swell the
 * measurement never saw (§5.7 rule 1).
 */
export function congestionFromLatency(
  idleMs: number | undefined,
  loadedMs: number | undefined,
): number {
  if (idleMs === undefined || loadedMs === undefined || idleMs <= 0) {
    return 0;
  }
  // 200ms of increase is a grade C — by then the pipe should look
  // thoroughly backed up, so that is where the visual saturates.
  const increaseMs = Math.max(0, loadedMs - idleMs);
  return Math.min(1, increaseMs / 200);
}
