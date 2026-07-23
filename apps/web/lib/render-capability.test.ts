import { describe, expect, it } from 'vitest';
import { congestionFromLatency, detectRenderCapability } from './render-capability';

/** A stand-in `Window` with only the properties the detector reads. */
function fakeWindow(options: {
  reducedMotion?: boolean;
  offscreenCanvas?: boolean;
  cores?: number;
  memoryGb?: number;
}): Window {
  const { reducedMotion = false, offscreenCanvas = true, cores = 16, memoryGb = 16 } = options;
  const win: Record<string, unknown> = {
    matchMedia: (query: string) => ({
      matches: query.includes('reduced-motion') ? reducedMotion : false,
    }),
    navigator: { hardwareConcurrency: cores, deviceMemory: memoryGb },
  };
  if (offscreenCanvas) {
    // The detector only checks for the name's presence, never constructs it.
    win['OffscreenCanvas'] = function OffscreenCanvasStub() {
      /* not constructed by the detector */
    };
  }
  return win as unknown as Window;
}

describe('detectRenderCapability', () => {
  it('gives a capable device the full field', () => {
    const capability = detectRenderCapability(fakeWindow({}));
    expect(capability.tier).toBe('full');
    expect(capability.maxFps).toBe(60);
  });

  it('honours prefers-reduced-motion by removing animation entirely, on any hardware', () => {
    // Someone who asked for less motion gets none of it, however fast
    // their machine is — the preference is an instruction, not a hint.
    const capability = detectRenderCapability(
      fakeWindow({ reducedMotion: true, cores: 32, memoryGb: 64 }),
    );
    expect(capability.tier).toBe('static');
    expect(capability.reason).toBe('prefers-reduced-motion');
  });

  it('falls back to static without OffscreenCanvas rather than drawing on the main thread', () => {
    // The main thread is where measurement timing gets corrupted (§8.1).
    // No animation beats a skewed number.
    const capability = detectRenderCapability(fakeWindow({ offscreenCanvas: false }));
    expect(capability.tier).toBe('static');
    expect(capability.reason).toBe('no OffscreenCanvas support');
  });

  it('throttles a low-end device instead of dropping its visual', () => {
    const capability = detectRenderCapability(fakeWindow({ cores: 4, memoryGb: 2 }));
    expect(capability.tier).toBe('reduced');
    expect(capability.maxFps).toBe(30);
    expect(capability.particleCount).toBeGreaterThan(0);
  });

  it('does not demote a device merely for withholding its specs', () => {
    // Safari reports neither figure. Absent is not the same as low, and
    // treating it as low would degrade the visual for every Safari user.
    const win = fakeWindow({});
    (win as unknown as { navigator: Record<string, unknown> }).navigator = {};
    expect(detectRenderCapability(win).tier).toBe('full');
  });
});

describe('congestionFromLatency', () => {
  it('reports no congestion when either figure is missing', () => {
    // An unknown congestion level draws as "not congested" rather than
    // inventing a swell no measurement produced (§5.7 rule 1).
    expect(congestionFromLatency(undefined, 300)).toBe(0);
    expect(congestionFromLatency(30, undefined)).toBe(0);
  });

  it('reports no congestion when loaded latency did not rise above idle', () => {
    expect(congestionFromLatency(30, 28)).toBe(0);
  });

  it('scales with the increase over idle, saturating at a grade-C swell', () => {
    expect(congestionFromLatency(30, 80)).toBeCloseTo(0.25, 5); // +50ms
    expect(congestionFromLatency(30, 130)).toBeCloseTo(0.5, 5); // +100ms
    expect(congestionFromLatency(30, 230)).toBeCloseTo(1, 5); // +200ms
    expect(congestionFromLatency(30, 2_000)).toBe(1); // clamped, never past full
  });
});
