import { describe, expect, it } from 'vitest';
import { gradeBufferbloat, GRADING_PROFILE_V1 } from './bufferbloat';

describe('gradeBufferbloat', () => {
  it('grades the increase over baseline, not the raw loaded latency', () => {
    // A link with 200ms unloaded latency (far away) but zero increase under load is not bufferbloated.
    expect(gradeBufferbloat(200, 200)).toBe('A+');
  });

  it('treats a lower loaded reading than unloaded as zero increase, not negative', () => {
    expect(gradeBufferbloat(50, 40)).toBe('A+');
  });

  it.each([
    [0, 'A+'],
    [5, 'A+'],
    [5.01, 'A'],
    [30, 'A'],
    [30.01, 'B'],
    [60, 'B'],
    [60.01, 'C'],
    [200, 'C'],
    [200.01, 'D'],
    [400, 'D'],
    [400.01, 'F'],
    [1000, 'F'],
  ] as const)('grades a %sms increase as %s (v1 thresholds)', (increaseMs, expectedGrade) => {
    expect(gradeBufferbloat(20, 20 + increaseMs)).toBe(expectedGrade);
  });

  it('uses GRADING_PROFILE_V1 by default', () => {
    expect(gradeBufferbloat(20, 45, GRADING_PROFILE_V1)).toBe(gradeBufferbloat(20, 45));
  });
});
