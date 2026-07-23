/**
 * Branded primitive units.
 *
 * A bare `number` cannot tell a caller whether they're holding bytes or
 * bits, milliseconds or seconds. That ambiguity is the single most common
 * silent bug in measurement code (see `docs/adr/0003-branded-units.md`).
 * Branding turns "which unit is this?" into a compile-time question.
 *
 * These are TYPES ONLY — no arithmetic lives here. Conversions between
 * units are pure functions in `@netverdict/engine`'s `units.ts`, so there
 * is exactly one place in the whole codebase that multiplies by 8 or
 * divides by 1e6.
 */

declare const brand: unique symbol;

/** Attaches a nominal tag to `T` so structurally-identical numbers can't be mixed. */
export type Brand<T, TBrand extends string> = T & { readonly [brand]: TBrand };

export type Bytes = Brand<number, 'Bytes'>;
export type Bits = Brand<number, 'Bits'>;
export type Milliseconds = Brand<number, 'Milliseconds'>;
export type Seconds = Brand<number, 'Seconds'>;
export type Mbps = Brand<number, 'Mbps'>;
export type EpochMs = Brand<number, 'EpochMs'>;

/**
 * Casts a raw number into a branded unit. Use only at the point where a
 * value is first produced (a measurement, a parsed input) — never to
 * paper over a type error elsewhere.
 */
export function asBytes(value: number): Bytes {
  return value as Bytes;
}

export function asBits(value: number): Bits {
  return value as Bits;
}

export function asMilliseconds(value: number): Milliseconds {
  return value as Milliseconds;
}

export function asSeconds(value: number): Seconds {
  return value as Seconds;
}

export function asMbps(value: number): Mbps {
  return value as Mbps;
}

export function asEpochMs(value: number): EpochMs {
  return value as EpochMs;
}
