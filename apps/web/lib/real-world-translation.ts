import { BUFFERBLOAT_GRADES, type BufferbloatGrade, type TestResult } from '@netverdict/contracts';

/**
 * Converts raw measurements into the plain-language capability checks
 * §1.4 of the build brief calls for ("supports 4K streaming ✓, 3
 * simultaneous video calls ✓, competitive gaming ✗"). Thresholds are
 * documented estimates (mirrored in `docs/methodology.md`) — a capability
 * that a given run could not honestly assess is reported `unavailable`,
 * never guessed from a proxy metric that would overstate it (§5.7 rule 6).
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

/**
 * Competitive play tolerates a small, steady queueing delay but not a
 * large one; B is the last grade where the added delay stays inside the
 * band a fast-paced game survives (§5.4's v1 profile puts B at ≤60ms of
 * increase over idle).
 */
const GAMING_ACCEPTABLE_GRADES = new Set<BufferbloatGrade>(['A+', 'A', 'B']);

/**
 * The worse of the two grades decides, because a connection is only as
 * playable as its worst direction — and on asymmetric consumer links the
 * upload side is usually the one that ruins a game.
 */
function worseBufferbloatGrade(
  down: BufferbloatGrade | 'unavailable',
  up: BufferbloatGrade | 'unavailable',
): BufferbloatGrade | 'unavailable' {
  if (down === 'unavailable' || up === 'unavailable') {
    return 'unavailable';
  }
  return BUFFERBLOAT_GRADES.indexOf(down) >= BUFFERBLOAT_GRADES.indexOf(up) ? down : up;
}

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

  // Gaming suitability hinges on latency *under load*, not idle latency —
  // a link can have excellent idle latency and still be unplayable the
  // moment anything else in the house starts downloading. The bufferbloat
  // grade is exactly that measurement, so it decides this verdict; idle
  // latency is never substituted for it (§5.7 rule 6).
  const worstGrade = worseBufferbloatGrade(result.bufferbloatGradeDown, result.bufferbloatGradeUp);
  const gaming: CapabilityVerdict =
    worstGrade === 'unavailable'
      ? { status: 'unavailable', reason: 'needs a bufferbloat grade' }
      : GAMING_ACCEPTABLE_GRADES.has(worstGrade)
        ? { status: 'supported' }
        : {
            status: 'not-supported',
            reason: `bufferbloat grade ${worstGrade} — latency spikes under load`,
          };

  return { streaming4k, streamingHd, videoCalls, gaming };
}
