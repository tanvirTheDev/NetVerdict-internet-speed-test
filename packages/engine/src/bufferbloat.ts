import type { BufferbloatGrade, GradingProfileId } from '@netverdict/contracts';

export interface BufferbloatGradingProfile {
  readonly id: GradingProfileId;
  /** Upper bound, in ms, of the loaded-minus-unloaded latency increase for each grade (ascending; anything above the last band is `F`). */
  readonly upperBoundMs: Readonly<Record<Exclude<BufferbloatGrade, 'F'>, number>>;
}

/**
 * v1 thresholds are calibrated against publicly documented bufferbloat
 * grading conventions (e.g. the Waveform Bufferbloat Test's published
 * bands) as a reasonable starting point — not yet validated against our
 * own production data. Revisit once `docs/accuracy.md` has real-world
 * samples to calibrate against. Thresholds are versioned (`gradingProfile`,
 * §4) precisely so that recalibration never silently reinterprets a
 * historical result.
 */
export const GRADING_PROFILE_V1: BufferbloatGradingProfile = {
  id: 'v1',
  upperBoundMs: {
    'A+': 5,
    A: 30,
    B: 60,
    C: 200,
    D: 400,
  },
};

const GRADE_ORDER: readonly BufferbloatGrade[] = ['A+', 'A', 'B', 'C', 'D', 'F'];

/**
 * Grades the *increase* of loaded latency over unloaded (idle) latency —
 * never the raw loaded latency itself, since a link with high but stable
 * latency isn't bufferbloated, it's just far away (§5.4).
 */
export function gradeBufferbloat(
  unloadedMs: number,
  loadedMs: number,
  profile: BufferbloatGradingProfile = GRADING_PROFILE_V1,
): BufferbloatGrade {
  const increaseMs = Math.max(0, loadedMs - unloadedMs);
  for (const grade of GRADE_ORDER) {
    if (grade === 'F') {
      return 'F';
    }
    if (increaseMs <= profile.upperBoundMs[grade]) {
      return grade;
    }
  }
  return 'F';
}
