/**
 * Persisted with every result (`TestConditions.engineVersion`, §4) so a
 * historical row is always attributable to the algorithm that produced
 * it. Keep in sync with `package.json`'s `version` — there is no build
 * step wiring these together yet (a small, deliberate manual step rather
 * than a codegen pipeline for one string).
 */
export const ENGINE_VERSION = '0.1.0';
