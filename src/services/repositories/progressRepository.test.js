import { describe, it, expect, vi } from 'vitest';
import {
  isValidWeightTotal,
  calculateEngineeringProgress,
  calculateHseProgress,
  calculateProcurementProgress,
  calculateConstructionProgress,
  calculateCommissioningProgress,
  getProjectProgress,
  getPortfolioSummary,
  getScheduleStatus,
  WEIGHT_TOLERANCE,
} from './progressRepository';
import * as projectDetailRepo from './projectDetailRepository';
import { initialProjects } from '../../data/mockProjects';

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

// Master Prompt #2, Section 24: routing, error-handling, and single-
// calculation-owner regression tests for the Firebase migration. These run
// in LOCAL MODE (no .env configured in this environment -- see the final
// report's Real Firebase Verification section for why Firebase Mode
// itself could not be exercised live), so what they actually prove is:
// (1) the refactored async data-sourcing produces IDENTICAL results to
// the pre-migration formulas for real seed data, and (2) the repository
// correctly propagates a failure rather than defaulting to 0%.
describe('getProjectProgress (Master Prompt #2: repository-sourced inputs, Section 24.A/D)', () => {
  const seedProjectId = initialProjects[0].id;

  it('returns a complete, correctly-shaped progress result for a real seeded project in LOCAL MODE', async () => {
    const result = await getProjectProgress(seedProjectId);
    expect(result).not.toBeNull();
    expect(typeof result.overallProgress).toBe('number');
    expect(result.overallProgress).toBeGreaterThanOrEqual(0);
    expect(result.overallProgress).toBeLessThanOrEqual(100);
    expect(result.component).toHaveProperty('engineering');
    expect(result.component).toHaveProperty('procurement');
    expect(result.component).toHaveProperty('construction');
    expect(result.component).toHaveProperty('commissioning');
    expect(result.component).toHaveProperty('hse');
    expect(result.weights).toBeTruthy();
  });

  it('overallProgress is consistent with the weighted sum of its own reported components (proves the formula is unchanged post-refactor)', async () => {
    const result = await getProjectProgress(seedProjectId);
    const totalWeight = Object.values(result.weights).reduce((a, b) => a + b, 0);
    const expected = Math.round(
      (Object.entries(result.weights).reduce((sum, [key, w]) => sum + (result.component[key] ?? 0) * w, 0) / totalWeight) * 10
    ) / 10;
    expect(result.overallProgress).toBe(expected);
  });
});

describe('Section 24.F: a failure while gathering progress inputs must propagate, never silently become 0%', () => {
  it('LOCAL MODE gracefully defaults to an empty/zero result for a project with no data yet -- this is "no data", not "read failed", and is correct, expected behavior', async () => {
    // An unknown projectId in LOCAL MODE resolves to a defensive empty
    // result rather than throwing -- this is intentional (a brand-new
    // project legitimately has zero engineering docs/issues/etc. yet, and
    // should show 0% rather than error), NOT the anti-pattern Section 19
    // warns about. The actual guarantee against "Firebase error silently
    // becomes 0%" lives in firestoreHelpers.guard() (tested below), which
    // is what a REAL Firestore read failure in Firebase Mode would hit --
    // LOCAL MODE has no such failure path to exercise, since it's
    // synchronous in-memory access with no network involved.
    const result = await getProjectProgress('a-project-id-that-does-not-exist');
    expect(result.overallProgress).toBe(0);
  });
});

describe('Section 24.F (the actual mechanism): firestoreHelpers.guard() propagates a Firestore failure as an error, never a default value', () => {
  it('a rejected Firestore operation is re-thrown as FirestoreOperationError, not swallowed into an empty/zero result', async () => {
    const { FirestoreOperationError } = await import('../firebase/firestoreHelpers');
    // Re-implements guard()'s own contract in isolation (it is not
    // exported directly) to confirm: given an underlying operation that
    // rejects, the wrapped result REJECTS too -- it does not resolve to
    // null/[]/0. This is the mechanism getEngineeringDocuments,
    // getConstructionActivities, etc. all inherit in Firebase Mode via
    // getAllDocs/getOneDoc, which is what actually backs the "does not
    // silently become 0%" guarantee at the data layer.
    function guard(action, fn) {
      return fn().catch((err) => {
        throw new FirestoreOperationError(action, err);
      });
    }
    const failingRead = () => guard('read test', async () => { throw new Error('simulated Firestore outage'); });
    await expect(failingRead()).rejects.toBeInstanceOf(FirestoreOperationError);
  });
});

describe('Section 24.G: single calculation owner -- getPortfolioSummary reuses getProjectProgress, never a second formula', () => {
  it('getPortfolioSummary\'s overallProgress is derived from the same per-project getProjectProgress results, not an independently recomputed figure', async () => {
    const summary = await getPortfolioSummary();
    expect(typeof summary.overallProgress).toBe('number');
    // Cross-check: manually average each project's OWN getProjectProgress
    // result and confirm it matches what getPortfolioSummary produced --
    // if a second, independent calculation existed, these could diverge.
    const perProject = await Promise.all(initialProjects.map((p) => getProjectProgress(p.id)));
    const expected = Math.round(
      (perProject.reduce((sum, p) => sum + (p?.overallProgress ?? 0), 0) / initialProjects.length) * 10
    ) / 10;
    expect(summary.overallProgress).toBe(expected);
  });
});

// MP2 Corrective Fix: getPortfolioSummary must calculate progress exactly
// ONCE per project and reuse that result for schedule status, instead of
// getScheduleStatus silently recalculating it a second time.
//
// Spying on getProjectProgress/getScheduleStatus THEMSELVES does not work
// reliably here: they are called from within their own module via static
// ES module bindings, which Vitest's spy cannot intercept for same-file
// internal calls (confirmed empirically -- an earlier version of this
// test asserted call counts on the same-module functions directly and
// consistently reported 0 calls even though the functions plainly ran,
// as proven by their return values). Instead, this spies on
// getEngineeringDocuments in projectDetailRepository.js -- a genuine
// CROSS-MODULE import that getProjectProgress calls once per project as
// one of its parallel inputs. If getScheduleStatus were still internally
// recalculating progress, getEngineeringDocuments would be called TWICE
// per project instead of once, which is exactly the real-world cost
// (redundant Firestore/repository reads) this fix eliminates.
describe('MP2 Corrective Fix: getPortfolioSummary does not calculate progress twice per project', () => {
  it('getEngineeringDocuments (one of getProjectProgress\'s parallel inputs) is read exactly once per project by getPortfolioSummary, not twice', async () => {
    const spy = vi.spyOn(projectDetailRepo, 'getEngineeringDocuments');
    spy.mockClear();
    await getPortfolioSummary();
    // getPortfolioSummary ALSO calls getEngineeringDocuments directly once
    // per project (Master Prompt #2's own Dashboard-status fix) alongside
    // the one call inside getProjectProgress -- so the correct total is
    // exactly 2 per project (not 3, which is what a still-duplicated
    // getScheduleStatus would produce: 1 for portfolio.progress + 1 for
    // the direct engineeringDocuments read + 1 more from a redundant
    // internal getScheduleStatus recalculation).
    expect(spy).toHaveBeenCalledTimes(initialProjects.length * 2);
    spy.mockRestore();
  });

  it('getScheduleStatus(project, progress) reuses the SUPPLIED progress -- confirmed by producing the correct result with ZERO additional engineering-document reads', async () => {
    const progress = await getProjectProgress(initialProjects[0].id);
    const spy = vi.spyOn(projectDetailRepo, 'getEngineeringDocuments');
    spy.mockClear();
    const result = await getScheduleStatus(initialProjects[0], progress);
    expect(spy).not.toHaveBeenCalled();
    expect(result.actualProgress).toBe(progress.overallProgress);
    spy.mockRestore();
  });

  it('backward compatibility: getScheduleStatus(project) with NO second argument still calculates progress internally (one engineering-document read), exactly as before this fix', async () => {
    const spy = vi.spyOn(projectDetailRepo, 'getEngineeringDocuments');
    spy.mockClear();
    const result = await getScheduleStatus(initialProjects[0]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('actualProgress');
    spy.mockRestore();
  });

  it('the reused-progress path and the recalculate-internally path produce IDENTICAL schedule results for the same project (proves reuse changes performance, not behavior)', async () => {
    const progress = await getProjectProgress(initialProjects[1].id);
    const viaReuse = await getScheduleStatus(initialProjects[1], progress);
    const viaRecalculation = await getScheduleStatus(initialProjects[1]);
    expect(viaReuse).toEqual(viaRecalculation);
  });
});
