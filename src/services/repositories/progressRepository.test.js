import { describe, it, expect } from 'vitest';
import {
  isValidWeightTotal,
  calculateEngineeringProgress,
  calculateHseProgress,
  calculateProcurementProgress,
  calculateConstructionProgress,
  calculateCommissioningProgress,
  WEIGHT_TOLERANCE,
} from './progressRepository';

describe('isValidWeightTotal (weight validation, must total exactly 100%)', () => {
  it('accepts weights summing to exactly 100', () => {
    expect(isValidWeightTotal({ engineering: 20, procurement: 20, construction: 45, commissioning: 15 })).toBe(true);
  });

  it('rejects weights that do not sum to 100', () => {
    expect(isValidWeightTotal({ engineering: 20, procurement: 20, construction: 45, commissioning: 10 })).toBe(false);
  });

  it('does not silently normalize -- an invalid total stays invalid regardless of key count', () => {
    expect(isValidWeightTotal({ engineering: 50, procurement: 60 })).toBe(false);
  });

  it('tolerates floating-point noise within WEIGHT_TOLERANCE (e.g. 99.999999)', () => {
    expect(isValidWeightTotal({ a: 33.333333, b: 33.333333, c: 33.333333 })).toBe(true); // sums to 99.999999
  });

  it('rejects a total that is off by more than the tolerance', () => {
    expect(isValidWeightTotal({ a: 50, b: 49 })).toBe(false); // 99, off by 1 > WEIGHT_TOLERANCE
  });

  it('accepts an optional HSE component as long as the whole set still totals 100', () => {
    expect(isValidWeightTotal({ engineering: 15, procurement: 15, construction: 40, commissioning: 15, hse: 15 })).toBe(true);
  });

  it('WEIGHT_TOLERANCE is a small, sane value (not accidentally disabled)', () => {
    expect(WEIGHT_TOLERANCE).toBeGreaterThan(0);
    expect(WEIGHT_TOLERANCE).toBeLessThan(1);
  });
});

describe('calculateEngineeringProgress (document-based, weighted; COMMENTED must NOT auto-equal 50%)', () => {
  it('computes a simple weighted average from progressContribution, ignoring reviewStatus entirely', () => {
    const docs = [
      { weight: 50, progressContribution: 100, reviewStatus: 'APPROVED' },
      { weight: 50, progressContribution: 77, reviewStatus: 'COMMENTED' }, // NOT hardcoded to 50
    ];
    expect(calculateEngineeringProgress(docs)).toBeCloseTo(88.5, 5); // (50*100 + 50*77) / 100
  });

  it('a REJECTED document can still carry a nonzero, explicitly-set contribution', () => {
    const docs = [{ weight: 100, progressContribution: 30, reviewStatus: 'REJECTED' }];
    expect(calculateEngineeringProgress(docs)).toBe(30);
  });

  it('returns 0 for an empty document list (no division by zero)', () => {
    expect(calculateEngineeringProgress([])).toBe(0);
  });

  it('is unaffected by reviewStatus when contribution is identical across different statuses', () => {
    const a = calculateEngineeringProgress([{ weight: 10, progressContribution: 40, reviewStatus: 'APPROVED' }]);
    const b = calculateEngineeringProgress([{ weight: 10, progressContribution: 40, reviewStatus: 'COMMENTED' }]);
    const c = calculateEngineeringProgress([{ weight: 10, progressContribution: 40, reviewStatus: 'REJECTED' }]);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe('calculateHseProgress (item-based, weighted; status independent of contribution)', () => {
  it('a "Pending" status item can carry a nonzero contribution', () => {
    const items = [{ weight: 100, progressContribution: 42, status: 'Pending' }];
    expect(calculateHseProgress(items)).toBe(42);
  });

  it('returns 0 for an empty item list', () => {
    expect(calculateHseProgress([])).toBe(0);
  });
});

describe('calculateProcurementProgress (milestone-based, weighted, configurable milestones)', () => {
  it('computes a weighted average across an arbitrary set of milestones (not a fixed list)', () => {
    const milestones = [
      { weight: 25, progressContribution: 100 },
      { weight: 25, progressContribution: 100 },
      { weight: 25, progressContribution: 0 },
      { weight: 25, progressContribution: 0 },
    ];
    expect(calculateProcurementProgress(milestones)).toBe(50);
  });

  it('works with a non-standard number/set of milestones', () => {
    const milestones = [{ weight: 60, progressContribution: 50 }, { weight: 40, progressContribution: 100 }];
    expect(calculateProcurementProgress(milestones)).toBeCloseTo(70, 5); // (60*50 + 40*100)/100
  });
});

describe('calculateConstructionProgress (quantity-based, weighted; guards div-by-zero)', () => {
  it('computes actual/planned per activity, weighted', () => {
    const activities = [
      { weight: 50, plannedQuantity: 100, actualQuantity: 50 }, // 50%
      { weight: 50, plannedQuantity: 200, actualQuantity: 200 }, // 100%
    ];
    expect(calculateConstructionProgress(activities)).toBe(75); // (50*50 + 50*100)/100
  });

  it('treats a zero Planned Quantity as 0% contribution rather than dividing by zero', () => {
    const activities = [{ weight: 100, plannedQuantity: 0, actualQuantity: 10 }];
    expect(calculateConstructionProgress(activities)).toBe(0);
    expect(Number.isFinite(calculateConstructionProgress(activities))).toBe(true);
  });

  it('clamps a negative Actual Quantity to 0 defensively (should never occur -- entry point rejects it)', () => {
    const activities = [{ weight: 100, plannedQuantity: 100, actualQuantity: -20 }];
    expect(calculateConstructionProgress(activities)).toBe(0);
  });

  it('does not cap progress display above 100% internally -- excess is a UI concern, not silently clipped in the math', () => {
    const activities = [{ weight: 100, plannedQuantity: 100, actualQuantity: 150 }];
    expect(calculateConstructionProgress(activities)).toBe(150);
  });
});

describe('calculateCommissioningProgress (checklist-based, equal or explicit weights)', () => {
  it('supports equal weights (default seed pattern: 25/25/25/25)', () => {
    const items = [
      { weight: 25, completionStatus: 'Complete' },
      { weight: 25, completionStatus: 'Complete' },
      { weight: 25, completionStatus: 'Pending' },
      { weight: 25, completionStatus: 'Pending' },
    ];
    expect(calculateCommissioningProgress(items)).toBe(50);
  });

  it('supports explicit, unequal per-item weights', () => {
    const items = [{ weight: 80, completionStatus: 'Complete' }, { weight: 20, completionStatus: 'Pending' }];
    expect(calculateCommissioningProgress(items)).toBe(80);
  });
});
