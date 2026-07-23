import { describe, expect, it } from 'vitest';
import { asBits, asBytes, asMilliseconds, asSeconds } from '@netverdict/contracts';
import { bitsToMbps, bytesToBits, mbpsFromBytesOverWindow, millisecondsToSeconds } from './units';

describe('bytesToBits', () => {
  it('multiplies by 8', () => {
    expect(bytesToBits(asBytes(125_000))).toBe(1_000_000);
  });
});

describe('millisecondsToSeconds', () => {
  it('divides by 1000', () => {
    expect(millisecondsToSeconds(asMilliseconds(2_500))).toBe(2.5);
  });
});

describe('bitsToMbps', () => {
  it('divides bits by seconds by 1e6 (decimal mega, not mebibits)', () => {
    expect(bitsToMbps(asBits(8_000_000), asSeconds(1))).toBe(8);
  });

  it('throws on a non-positive window — an invariant violation, not a measurement outcome', () => {
    expect(() => bitsToMbps(asBits(1000), asSeconds(0))).toThrow(RangeError);
    expect(() => bitsToMbps(asBits(1000), asSeconds(-1))).toThrow(RangeError);
  });
});

describe('mbpsFromBytesOverWindow', () => {
  it('computes the textbook case: 1,000,000 bytes in 1 second is 8 Mbps', () => {
    expect(mbpsFromBytesOverWindow(asBytes(1_000_000), asMilliseconds(1_000))).toBe(8);
  });

  it('computes a 250ms window correctly', () => {
    // 250,000 bytes / 250ms == 1,000,000 bytes/sec == 8,000,000 bits/sec == 8 Mbps
    expect(mbpsFromBytesOverWindow(asBytes(250_000), asMilliseconds(250))).toBe(8);
  });

  it('returns 0 for a zero-byte window without dividing by zero', () => {
    expect(mbpsFromBytesOverWindow(asBytes(0), asMilliseconds(250))).toBe(0);
  });
});
