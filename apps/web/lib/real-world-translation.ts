import type { TestResult } from '@netverdict/contracts';

/**
 * Converts raw measurements into the plain-language capability checks
 * §1.4 of the build brief calls for ("supports 4K streaming ✓, 3
 * simultaneous video calls ✓, competitive gaming ✗"). Thresholds are
 * documented estimates (mirrored in `docs/methodology.md`) — a capability
 * this build cannot honestly assess (gaming needs bufferbloat, landing in
 * Phase 3) is reported `unavailable`, never guessed from a proxy metric
 * that would overstate it (§5.7 rule 6).
 */

// Netflix's published guidance: 5 Mbps for HD, 25 Mbps for Ultra HD/4K.
const HD_STREAMING_MIN_DOWN_MBPS = 5;
const UHD_STREAMING_MIN_DOWN_MBPS = 25;

// Rough estimate for a handful of simultaneous HD video calls (Zoom/Teams-class
// group-call guidance is ~3-4 Mbps symmetric per call cluster, not per participant).
const GROUP_VIDEO_MIN_DOWN_MBPS = 4;
const GROUP_VIDEO_MIN_UP_MBPS = 3;
// Above this, unloaded latency alone already predicts a poor call — below it,
// the call *might* still be fine, but loaded latency (Phase 3) is what actually decides.
const GROUP_VIDEO_MAX_IDLE_LATENCY_MS = 150;

export type CapabilityVerdict =
  | { readonly status: 'supported' }
  | { readonly status: 'not-supported'; readonly reason: string }
  | { readonly status: 'unavailable'; readonly reason: string };

export interface RealWorldTranslation {
  readonly streaming4k: CapabilityVerdict;
  readonly streamingHd: CapabilityVerdict;
  readonly videoCalls: CapabilityVerdict;
  readonly gaming: CapabilityVerdict;
}

function fromThreshold(
  actualMbps: number,
  minMbps: number,
  belowReason: string,
): CapabilityVerdict {
  return actualMbps >= minMbps
    ? { status: 'supported' }
    : { status: 'not-supported', reason: belowReason };
}

export function translateToRealWorldCapabilities(result: TestResult): RealWorldTranslation {
  const down = result.download.status === 'complete' ? result.download.data.mbps : undefined;
  const up = result.upload.status === 'complete' ? result.upload.data.mbps : undefined;
  const idleLatencyMs =
    result.idleLatency.status === 'complete' ? result.idleLatency.data.medianMs : undefined;

  const streaming4k: CapabilityVerdict =
    down === undefined
      ? { status: 'unavailable', reason: 'download speed unavailable' }
      : fromThreshold(
          down,
          UHD_STREAMING_MIN_DOWN_MBPS,
          `needs ~${String(UHD_STREAMING_MIN_DOWN_MBPS)} Mbps down`,
        );

  const streamingHd: CapabilityVerdict =
    down === undefined
      ? { status: 'unavailable', reason: 'download speed unavailable' }
      : fromThreshold(
          down,
          HD_STREAMING_MIN_DOWN_MBPS,
          `needs ~${String(HD_STREAMING_MIN_DOWN_MBPS)} Mbps down`,
        );

  const videoCalls: CapabilityVerdict =
    down === undefined || up === undefined || idleLatencyMs === undefined
      ? { status: 'unavailable', reason: 'download, upload, or latency unavailable' }
      : down >= GROUP_VIDEO_MIN_DOWN_MBPS &&
          up >= GROUP_VIDEO_MIN_UP_MBPS &&
          idleLatencyMs <= GROUP_VIDEO_MAX_IDLE_LATENCY_MS
        ? { status: 'supported' }
        : {
            status: 'not-supported',
            reason: `needs ~${String(GROUP_VIDEO_MIN_DOWN_MBPS)}↓/${String(GROUP_VIDEO_MIN_UP_MBPS)}↑ Mbps and low latency`,
          };

  // Gaming suitability hinges on loaded latency under saturation, not idle
  // latency — idle latency alone would systematically overstate it (a link
  // can have great idle latency and still be unplayable under load). That
  // measurement is Phase 3 work (§5.4); never substitute a proxy here.
  const gaming: CapabilityVerdict = {
    status: 'unavailable',
    reason: 'needs bufferbloat data — a later build phase',
  };

  return { streaming4k, streamingHd, videoCalls, gaming };
}
