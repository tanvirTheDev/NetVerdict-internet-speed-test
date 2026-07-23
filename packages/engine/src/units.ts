import {
  asBits,
  asMbps,
  asSeconds,
  type Bits,
  type Bytes,
  type Mbps,
  type Milliseconds,
  type Seconds,
} from '@netverdict/contracts';

/**
 * The one module that converts between physical units (ADR-0003). Every
 * other file imports these instead of multiplying by 8 or dividing by
 * 1e6 itself.
 */

export function bytesToBits(bytes: Bytes): Bits {
  return asBits(bytes * 8);
}

export function millisecondsToSeconds(ms: Milliseconds): Seconds {
  return asSeconds(ms / 1000);
}

/** Mbps = megabits per second, i.e. bits / seconds / 1,000,000 (decimal mega, matching how ISPs advertise speeds — not mebibits). */
export function bitsToMbps(bits: Bits, seconds: Seconds): Mbps {
  if (seconds <= 0) {
    throw new RangeError(`bitsToMbps: window must be positive, got ${String(seconds)}s`);
  }
  return asMbps(bits / seconds / 1_000_000);
}

export function mbpsFromBytesOverWindow(bytes: Bytes, windowMs: Milliseconds): Mbps {
  return bitsToMbps(bytesToBits(bytes), millisecondsToSeconds(windowMs));
}
