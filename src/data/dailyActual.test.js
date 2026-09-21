import { describe, it, expect, vi } from 'vitest';
vi.mock('../services/firebase/config', () => ({ isLocalMode: true }));
import fs from 'node:fs';
import {
  getOperations, updateConstructionActivity, createConstructionActivity,
  updateConstructionActivityPlan, computeCumulativeFromHistory,
} from './mockOperationalData';
import { initialProjects } from './mockProjects';

// C-01B: Daily Actual & PM Actual Access. Business decision: PM AND SM may
// both enter ACTUAL, as a DAILY quantity per date -- the system (this
// file's functions), not the caller, computes the resulting cumulative
// total. See mockOperationalData.computeCumulativeFromHistory and
// updateConstructionActivity for the implementation this suite exercises.
const c01bProjectId = initialProjects[6].id; // isolated from other test files' projects

describe('C-01B, Section B: daily data model (Tests 7-12)', () => {
  it('Test 7: the first daily entry creates a history record with the given date and dailyQuantity', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Trenching', plannedQuantity: 500, unit: 'pcs', weight: 20 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 100, date: '2026-09-18' });
    const result = getOperations(c01bProjectId).constructionActivities.find((a) => a.id === created.id);
    expect(result.history).toHaveLength(1);
    expect(result.history[0]).toEqual({ date: '2026-09-18', dailyQuantity: 100 });
  });

  it('Test 8/9: a second, DIFFERENT-date entry creates another history record, and cumulative equals the SUM of daily quantities', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Cable Laying', plannedQuantity: 500, unit: 'pcs', weight: 20 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 100, date: '2026-09-18' });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 150, date: '2026-09-19' });
    let result = getOperations(c01bProjectId).constructionActivities.find((a) => a.id === created.id);
    expect(result.history).toHaveLength(2);
    expect(result.actualQuantity).toBe(250); // 100 + 150, per the C-01B worked example

    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 125, date: '2026-09-20' });
    result = getOperations(c01bProjectId).constructionActivities.find((a) => a.id === created.id);
    expect(result.history).toHaveLength(3);
    expect(result.actualQuantity).toBe(375); // 100 + 150 + 125, exactly the C-01B example
  });

  it('Test 11/12: a SAME-date entry REPLACES that day\'s dailyQuantity (never appends, never adds to the existing value) -- and cumulative recalculates correctly', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Foundation', plannedQuantity: 500, unit: 'pcs', weight: 20 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 100, date: '2026-09-18' });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 150, date: '2026-09-19' });
    // Correction: 18 Sep was actually 120, not 100.
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 120, date: '2026-09-18' });
    const result = getOperations(c01bProjectId).constructionActivities.find((a) => a.id === created.id);
    expect(result.history).toHaveLength(2); // still 2 entries, NOT 3 -- no duplicate/append for the same date
    expect(result.history.find((h) => h.date === '2026-09-18').dailyQuantity).toBe(120); // replaced, not summed with the old 100
    expect(result.actualQuantity).toBe(270); // 120 + 150 -- the C-01B worked example's exact expected result (NOT 370)
  });

  it('Test 10: Item Progress (via the Progress Engine formula) uses the resulting cumulative actual, not the daily entries directly', async () => {
    const { calculateConstructionProgress } = await import('../services/repositories/progressRepository');
    const created = createConstructionActivity(c01bProjectId, { activity: 'Piling', plannedQuantity: 400, unit: 'pcs', weight: 100 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 100, date: '2026-09-18' });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 100, date: '2026-09-19' });
    const result = getOperations(c01bProjectId).constructionActivities.find((a) => a.id === created.id);
    // 200/400 = 50% -- calculateConstructionProgress reads activity.actualQuantity
    // (the computed cumulative), never activity.history, confirming the
    // C-01B audit's finding that the Progress Engine needs no changes.
    expect(calculateConstructionProgress([result])).toBe(50);
  });
});

describe('C-01B, computeCumulativeFromHistory: legacy compatibility (no double-counting of pre-C-01B snapshots)', () => {
  it('a history made ENTIRELY of legacy entries (old field name actualQuantity, a cumulative snapshot) uses the LAST one as a baseline -- never summed', () => {
    // Mirrors the shape of history written before C-01B: each entry's
    // actualQuantity WAS the running total as of that date, not an
    // independent delta -- summing them (100 + 250) would double-count.
    const legacyHistory = [
      { date: '2026-08-01', actualQuantity: 100 },
      { date: '2026-08-15', actualQuantity: 250 },
    ];
    expect(computeCumulativeFromHistory(legacyHistory)).toBe(250); // NOT 350
  });

  it('a mix of legacy entries followed by new dailyQuantity entries adds the new daily deltas ON TOP of the legacy baseline', () => {
    const mixedHistory = [
      { date: '2026-08-01', actualQuantity: 100 }, // legacy baseline
      { date: '2026-08-15', actualQuantity: 250 }, // legacy baseline (supersedes the above)
      { date: '2026-09-18', dailyQuantity: 50 },   // new daily model begins
      { date: '2026-09-19', dailyQuantity: 30 },
    ];
    expect(computeCumulativeFromHistory(mixedHistory)).toBe(330); // 250 (legacy baseline) + 50 + 30
  });

  it('an empty history has zero cumulative', () => {
    expect(computeCumulativeFromHistory([])).toBe(0);
  });
});

describe('C-01B, Section A: role access (Tests 1-6)', () => {
  it('Test 1/2: both PROJECT_MANAGER and SITE_MANAGER can enter Daily Actual through the same repository function -- no role parameter gates this at the data layer, matching the Firestore rule (see below) which is where role enforcement actually lives for direct writes', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Access Check', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    // Simulates a PM's daily entry.
    const afterPm = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 20, date: '2026-09-18' });
    expect(afterPm.actualQuantity).toBe(20);
    // Simulates an SM's daily entry on a different date -- same function,
    // same project, no code-level distinction between the two roles.
    const afterSm = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 15, date: '2026-09-19' });
    expect(afterSm.actualQuantity).toBe(35);
  });

  it('Test 3: PM remains able to manage PLAN (activity/plannedQuantity/unit/weight) -- unaffected by gaining ACTUAL access', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Original', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    const updated = updateConstructionActivityPlan(c01bProjectId, created.id, { activity: 'Renamed', plannedQuantity: 150, weight: 15 });
    expect(updated.activity).toBe('Renamed');
    expect(updated.plannedQuantity).toBe(150);
    expect(updated.weight).toBe(15);
  });

  it('Test 4: SM (or anyone) cannot modify PLAN fields through the actual-entry mechanism -- updateConstructionActivity has no parameter for them', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Immutable Plan', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, {
      dailyQuantity: 10, date: '2026-09-18',
      activity: 'Hacked', plannedQuantity: 999, weight: 999, unit: 'kg',
    });
    const result = getOperations(c01bProjectId).constructionActivities.find((a) => a.id === created.id);
    expect(result.activity).toBe('Immutable Plan');
    expect(result.plannedQuantity).toBe(100);
    expect(result.weight).toBe(10);
    expect(result.unit).toBe('pcs');
  });

  it('Test 5/6: PM and SM actual-entry authorization is scoped to project assignment via firestore.rules\' isAssignedToProject -- documented and verified as a text-level contract here, since no live Firestore/emulator connection is available in this environment to execute the rule itself', () => {
    // This does not execute against Firestore -- it exists so the rule
    // text cannot silently regress (e.g. losing isAssignedToProject) for
    // either role's ACTUAL clause without this test failing, mirroring
    // the file's existing "Firestore rule / application code agreement"
    // pattern for the SITE_MANAGER clause.
    const rulesText = fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
    const constructionActivitiesBlock = rulesText.slice(rulesText.indexOf('match /constructionActivities/{activityId}'));
    const updateClause = constructionActivitiesBlock.slice(0, constructionActivitiesBlock.indexOf('match /commissioningItems') > -1
      ? constructionActivitiesBlock.indexOf('\n      }')
      : undefined);
    const pmActualClauseCount = (updateClause.match(/PROJECT_MANAGER'\]\) && isAssignedToProject\(projectId\)\s*\n\s*&& request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly\(\['actualQuantity', 'history', 'updatedAt'\]/g) || []).length;
    const smActualClauseCount = (updateClause.match(/SITE_MANAGER'\]\) && isAssignedToProject\(projectId\)\s*\n\s*&& request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly\(\['actualQuantity', 'history', 'updatedAt'\]/g) || []).length;
    expect(pmActualClauseCount).toBeGreaterThanOrEqual(1);
    expect(smActualClauseCount).toBeGreaterThanOrEqual(1);
  });
});

describe('C-01B, Section D: data safety (Tests 18-21)', () => {
  it('Test 18: a negative daily quantity is rejected, following the existing validation policy unchanged', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Negative Check', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    expect(() => updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: -5, date: '2026-09-18' })).toThrow(/cannot be negative/);
  });

  it('Test 19: a missing date defaults consistently to today, rather than failing or producing an undefined history entry', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'No Date Given', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    const result = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 10 });
    const todayIso = new Date().toISOString().slice(0, 10);
    expect(result.history[0].date).toBe(todayIso);
  });

  it('Test 20: Planned Quantity <= 0 still blocks any Actual entry, exactly as before this change', () => {
    // createConstructionActivity itself rejects plannedQuantity <= 0, so a
    // zero-planned activity can only exist via legacy/seed data -- exercise
    // the guard directly against a seeded activity forced to 0 planned.
    const created = createConstructionActivity(c01bProjectId, { activity: 'Zero Planned Setup', plannedQuantity: 1, unit: 'pcs', weight: 10 });
    const ops = getOperations(c01bProjectId);
    ops.constructionActivities = ops.constructionActivities.map((a) => (a.id === created.id ? { ...a, plannedQuantity: 0 } : a));
    expect(() => updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 10, date: '2026-09-18' })).toThrow(/Planned Quantity must be greater than zero/);
  });

  it('Test 21: existing (legacy-format) history is not double-counted when a new daily entry is added on top of it', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Legacy Mix', plannedQuantity: 500, unit: 'pcs', weight: 10 });
    const ops = getOperations(c01bProjectId);
    // Simulate a pre-C-01B activity that already has legacy-format history.
    ops.constructionActivities = ops.constructionActivities.map((a) =>
      a.id === created.id ? { ...a, actualQuantity: 200, history: [{ date: '2026-08-01', actualQuantity: 200 }] } : a
    );
    const result = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 50, date: '2026-09-18' });
    expect(result.actualQuantity).toBe(250); // 200 (legacy baseline) + 50, NOT 200 + 200 + 50
  });
});

// C-01B Corrective: Legacy Actual Consistency & UI Cleanup. Two confirmed
// defects from technical-lead review of the initial C-01B implementation:
// (1) the legacy baseline used Math.max() instead of the LATEST snapshot
// by date; (2) a new daily entry sharing a date with an existing LEGACY
// entry silently overwrote/destroyed that legacy entry instead of
// preserving it as a baseline. Both are fixed in
// mockOperationalData.computeCumulativeFromHistory /
// updateConstructionActivity (and the equivalent Firebase functions).
describe('C-01B Corrective, Test 1: legacy baseline is the LATEST snapshot by date, never Math.max()', () => {
  it('a legacy history with a numerically HIGHER but chronologically OLDER snapshot must not be used as the baseline', () => {
    // 2026-08-15's snapshot (180) is numerically larger than 2026-08-30's
    // (150), but 2026-08-30 is the LATEST date -- the correct baseline is
    // 150, proving the implementation does not use Math.max().
    const legacyHistory = [
      { date: '2026-08-01', actualQuantity: 100 },
      { date: '2026-08-15', actualQuantity: 180 },
      { date: '2026-08-30', actualQuantity: 150 },
    ];
    expect(computeCumulativeFromHistory(legacyHistory)).toBe(150); // NOT 180 (Math.max would give 180)
  });

  it('legacy entries out of chronological ORDER in the array still resolve to the latest-by-DATE snapshot, not the last array element or the largest value', () => {
    const legacyHistoryOutOfOrder = [
      { date: '2026-08-30', actualQuantity: 150 },
      { date: '2026-08-01', actualQuantity: 100 },
      { date: '2026-08-15', actualQuantity: 180 },
    ];
    expect(computeCumulativeFromHistory(legacyHistoryOutOfOrder)).toBe(150);
  });
});

describe('C-01B Corrective, Test 2: a new daily entry on the SAME DATE as an existing legacy snapshot preserves the legacy baseline', () => {
  it('legacy 2026-09-18=200, then a new dailyQuantity=50 for the SAME date -- cumulative must be 250, never 50', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Legacy Same-Date Collision', plannedQuantity: 500, unit: 'pcs', weight: 10 });
    const ops = getOperations(c01bProjectId);
    ops.constructionActivities = ops.constructionActivities.map((a) =>
      a.id === created.id ? { ...a, actualQuantity: 200, history: [{ date: '2026-09-18', actualQuantity: 200 }] } : a
    );
    const result = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 50, date: '2026-09-18' });
    expect(result.actualQuantity).toBe(250); // 200 (legacy, preserved) + 50 (new)
    // The legacy entry itself must survive, untouched, alongside the new one.
    const legacyEntry = result.history.find((h) => h.actualQuantity === 200 && h.dailyQuantity === undefined);
    expect(legacyEntry).toBeTruthy();
    expect(legacyEntry.date).toBe('2026-09-18');
    const newEntry = result.history.find((h) => h.dailyQuantity === 50);
    expect(newEntry).toBeTruthy();
    expect(newEntry.date).toBe('2026-09-18');
  });

  it('a SUBSEQUENT correction to that same date\'s NEW entry replaces only the new-style entry -- the legacy entry remains untouched', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Legacy Then Correction', plannedQuantity: 500, unit: 'pcs', weight: 10 });
    const ops = getOperations(c01bProjectId);
    ops.constructionActivities = ops.constructionActivities.map((a) =>
      a.id === created.id ? { ...a, actualQuantity: 200, history: [{ date: '2026-09-18', actualQuantity: 200 }] } : a
    );
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 50, date: '2026-09-18' });
    const corrected = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 70, date: '2026-09-18' });
    expect(corrected.history).toHaveLength(2); // still legacy + one new entry, not three
    expect(corrected.actualQuantity).toBe(270); // 200 (legacy) + 70 (corrected, replacing the 50)
  });
});

describe('C-01B Corrective, Test 3: normal same-date daily correction (no legacy involved) is unaffected by this fix', () => {
  it('100 then 150 on different dates, then correcting the first date to 120, gives cumulative 270 -- not 370', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Normal Correction Regression', plannedQuantity: 500, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 100, date: '2026-09-18' });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 150, date: '2026-09-19' });
    const corrected = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 120, date: '2026-09-18' });
    expect(corrected.history).toHaveLength(2);
    expect(corrected.actualQuantity).toBe(270);
  });
});

describe('C-01B Corrective, Test 4: multi-date daily sum regression', () => {
  it('100 + 150 + 125 = 375, exactly the C-01B worked example', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Multi-Date Sum Regression', plannedQuantity: 500, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 100, date: '2026-09-18' });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 150, date: '2026-09-19' });
    const result = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 125, date: '2026-09-20' });
    expect(result.actualQuantity).toBe(375);
  });
});

describe('C-01B Corrective, Test 5: Progress Engine regression -- formula itself is untouched', () => {
  it('plannedQuantity=500, actualQuantity=250 -> construction progress is exactly 50%', async () => {
    const { calculateConstructionProgress } = await import('../services/repositories/progressRepository');
    expect(calculateConstructionProgress([{ plannedQuantity: 500, actualQuantity: 250, weight: 100 }])).toBe(50);
  });
});

// C-01B Small Corrective: Backdated Daily Actual Protection. Business
// rule: a Daily Actual date must be >= the latest legacy snapshot's date
// -- entering a date BEFORE that point would record a delta for a period
// the legacy cumulative snapshot already accounted for, double-counting
// progress. Same-date and after-date entries remain fully allowed.
function setupWithLegacySnapshot(activityId, date, actualQuantity) {
  const ops = getOperations(c01bProjectId);
  ops.constructionActivities = ops.constructionActivities.map((a) =>
    a.id === activityId ? { ...a, actualQuantity, history: [{ date, actualQuantity }] } : a
  );
}

describe('C-01B Small Corrective, Test A: no legacy snapshot -- Daily Actual entered normally, unaffected by this rule', () => {
  it('an activity with no legacy history accepts any date, including one that would otherwise look "early"', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'No Legacy Baseline', plannedQuantity: 500, unit: 'pcs', weight: 10 });
    const result = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 30, date: '2020-01-01' });
    expect(result.actualQuantity).toBe(30);
  });
});

describe('C-01B Small Corrective, Test B: SAME date as the latest legacy snapshot is allowed', () => {
  it('legacy 2026-09-18=200, Daily Actual also dated 2026-09-18=50 -> allowed, baseline preserved, cumulative = 250', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Same As Legacy Date', plannedQuantity: 500, unit: 'pcs', weight: 10 });
    setupWithLegacySnapshot(created.id, '2026-09-18', 200);
    const result = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 50, date: '2026-09-18' });
    expect(result.actualQuantity).toBe(250);
    expect(result.history.some((h) => h.actualQuantity === 200)).toBe(true); // legacy entry survives
  });
});

describe('C-01B Small Corrective, Test C: a date AFTER the latest legacy snapshot is allowed', () => {
  it('legacy 2026-09-18=200, then 2026-09-19=100 -> allowed, cumulative = 300; a further 2026-09-20=100 -> cumulative = 400 (the prompt\'s worked example variant)', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'After Legacy Date', plannedQuantity: 500, unit: 'pcs', weight: 10 });
    setupWithLegacySnapshot(created.id, '2026-09-18', 200);
    let result = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 100, date: '2026-09-19' });
    expect(result.actualQuantity).toBe(300);

    // Exact worked example from this corrective's spec: 200 + 50 + 100 = 350.
    const created2 = createConstructionActivity(c01bProjectId, { activity: 'Worked Example', plannedQuantity: 500, unit: 'pcs', weight: 10 });
    setupWithLegacySnapshot(created2.id, '2026-09-18', 200);
    updateConstructionActivity(c01bProjectId, created2.id, { dailyQuantity: 50, date: '2026-09-18' });
    result = updateConstructionActivity(c01bProjectId, created2.id, { dailyQuantity: 100, date: '2026-09-19' });
    expect(result.actualQuantity).toBe(350);
  });
});

describe('C-01B R2.1, STALE TEST UPDATED: a date BEFORE the latest legacy snapshot is now ACCEPTED (backdate restriction removed)', () => {
  // C-01B R2.1 explicitly reverses the C-01B Small Corrective's minimum-
  // date restriction: Site Manager may enter yesterday's (or any earlier
  // day's) work today, so a Daily Actual dated BEFORE a legacy snapshot is
  // no longer rejected on that basis alone -- only the Actual<=Plan
  // invariant (tested separately, C-01B R2/R2.1) can still reject a write.
  // These two tests replace the ones that asserted the now-removed
  // rejection; they are stale because the underlying business rule they
  // verified was intentionally reversed, not because they were wrong when
  // written.
  it('legacy 2026-09-18=200, Daily Actual dated 2026-09-17=50 -> accepted; cumulative = 250 (Example 5\'s shape, generous Plan)', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Before Legacy Date Now Allowed', plannedQuantity: 500, unit: 'pcs', weight: 10 });
    setupWithLegacySnapshot(created.id, '2026-09-18', 200);
    const result = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 50, date: '2026-09-17' });
    expect(result.actualQuantity).toBe(250);
    expect(result.history).toHaveLength(2); // legacy entry preserved + new backdated entry added
  });

  it('a date before the legacy snapshot is accepted just as readily as the legacy date itself or a later date -- no minimum-date boundary exists any more', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'No Boundary Any More', plannedQuantity: 500, unit: 'pcs', weight: 10 });
    setupWithLegacySnapshot(created.id, '2026-09-18', 200);
    expect(() => updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 10, date: '2026-09-17' })).not.toThrow();
    expect(() => updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 10, date: '2026-09-18' })).not.toThrow();
  });
});

describe('C-01B Small Corrective, Test E: same-date correction still REPLACES, not appends -- unaffected by this rule', () => {
  it('an existing daily entry for a date on/after the legacy boundary is replaced, not duplicated, when corrected', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Same-Date Replace After Legacy', plannedQuantity: 500, unit: 'pcs', weight: 10 });
    setupWithLegacySnapshot(created.id, '2026-09-18', 200);
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 50, date: '2026-09-19' });
    const corrected = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 80, date: '2026-09-19' });
    expect(corrected.history).toHaveLength(2); // legacy + ONE daily entry for 2026-09-19, not two
    expect(corrected.actualQuantity).toBe(280); // 200 (legacy) + 80 (corrected), not 200 + 50 + 80
  });
});

// C-01B R2: Enforce Actual Quantity <= Plan Quantity. Data-integrity
// invariant -- Actual represents completed work, Plan represents the
// approved required quantity, so Actual can never legitimately exceed
// Plan. Evaluated against the RESULTING cumulative (after same-date
// replace/append), never by capping the value or the calculated progress.
describe('C-01B R2, Tests 1-2: Actual at or below Plan is accepted', () => {
  it('Test 1: Actual exactly equals Plan (100/100) -> accepted', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Exact Match', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    const result = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 100, date: '2026-09-20' });
    expect(result.actualQuantity).toBe(100);
  });

  it('Test 2: Actual below Plan (80/100) -> accepted', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Below Plan', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    const result = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 80, date: '2026-09-20' });
    expect(result.actualQuantity).toBe(80);
  });
});

describe('C-01B R2, Test 3: a new daily entry that would push cumulative over Plan is REJECTED, and the store is not mutated', () => {
  it('Plan=100, existing cumulative=80, new daily=30 (would be 110) -> rejected, history/actualQuantity unchanged', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Over Plan New Date', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 80, date: '2026-09-18' });
    expect(() => updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 30, date: '2026-09-19' }))
      .toThrow('Actual quantity cannot exceed planned quantity (100). Please update the plan first.');
    const unchanged = getOperations(c01bProjectId).constructionActivities.find((a) => a.id === created.id);
    expect(unchanged.actualQuantity).toBe(80); // unchanged
    expect(unchanged.history).toHaveLength(1); // the rejected entry was never added
  });
});

describe('C-01B R2, Test 4: a same-date correction that lowers cumulative remains valid', () => {
  it('Plan=100, existing date=30, replace same date with 50 -> cumulative=50 (not 30+50=80), accepted', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Same-Date Valid Correction', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 30, date: '2026-09-18' });
    const corrected = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 50, date: '2026-09-18' });
    expect(corrected.actualQuantity).toBe(50);
    expect(corrected.history).toHaveLength(1);
  });
});

describe('C-01B R2, Tests 5-6: same-date correction evaluated against the RESULTING cumulative, up to and including exactly Plan', () => {
  it('Test 5: Plan=100, cumulative=80 (other date=60, this date=20), correct this date to 30 -> resulting cumulative=90 -> accepted', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Resulting Cumulative Under Plan', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 60, date: '2026-09-17' });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 20, date: '2026-09-18' });
    const corrected = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 30, date: '2026-09-18' });
    expect(corrected.actualQuantity).toBe(90); // 60 + 30
  });

  it('Test 6: Plan=100, cumulative=90 (other date=80, this date=10), correct this date to 20 -> resulting cumulative=100 (exactly Plan) -> accepted', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Resulting Cumulative Exactly Plan', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 80, date: '2026-09-17' });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 10, date: '2026-09-18' });
    const corrected = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 20, date: '2026-09-18' });
    expect(corrected.actualQuantity).toBe(100);
  });
});

describe('C-01B R2, Test 7: a NEW date causing cumulative to exceed Plan is rejected', () => {
  it('Plan=100, cumulative=90, new date=20 (would be 110) -> rejected, history unchanged', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'New Date Over Plan', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 90, date: '2026-09-17' });
    expect(() => updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 20, date: '2026-09-19' })).toThrow();
    const unchanged = getOperations(c01bProjectId).constructionActivities.find((a) => a.id === created.id);
    expect(unchanged.actualQuantity).toBe(90);
    expect(unchanged.history).toHaveLength(1);
  });
});

describe('C-01B R2, Tests 8-9: backdated actual remains fully allowed, still subject to the Actual<=Plan invariant', () => {
  it('Test 8: a backdated entry that keeps cumulative under Plan is accepted -- backdating itself is never restricted by this rule', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Backdated Under Plan', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 30, date: '2026-09-23' });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 40, date: '2026-09-24' });
    // Entering an EARLIER date than existing entries -- backdating -- must
    // still succeed on its own terms (this task does not reintroduce any
    // "date must be >= latest" restriction).
    const result = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 10, date: '2026-09-22' });
    expect(result.actualQuantity).toBe(80); // 30 + 40 + 10
    expect(result.history).toHaveLength(3);
  });

  it('Test 9: a backdated entry that would push cumulative over Plan is rejected, exactly like any other date', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Backdated Over Plan', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 60, date: '2026-09-23' });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 30, date: '2026-09-24' });
    expect(() => updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 20, date: '2026-09-22' })).toThrow(); // 60+30+20=110 > 100
    const unchanged = getOperations(c01bProjectId).constructionActivities.find((a) => a.id === created.id);
    expect(unchanged.actualQuantity).toBe(90);
    expect(unchanged.history).toHaveLength(2); // the rejected backdated entry was never added
  });
});

describe('C-01B R2, Test 10: PM increasing Plan unblocks further Actual entry', () => {
  it('Plan=100, Actual=100 (blocked from further entry), PM raises Plan to 120 -> further actual up to 120 is now accepted', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Plan Increase Unblocks', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 100, date: '2026-09-18' });
    expect(() => updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 10, date: '2026-09-19' })).toThrow();

    const revised = updateConstructionActivityPlan(c01bProjectId, created.id, { plannedQuantity: 120 });
    expect(revised.plannedQuantity).toBe(120);
    expect(revised.actualQuantity).toBe(100); // PLAN edit never touches ACTUAL

    const afterIncrease = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 15, date: '2026-09-19' });
    expect(afterIncrease.actualQuantity).toBe(115); // now valid against the raised plan (<=120)
  });
});

describe('C-01B R2, Test 11: regression -- existing valid C-01B daily history is unaffected by this rule', () => {
  it('the C-01B worked example (100+150+125=375 against a generous plan) still produces the same result', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'C-01B Worked Example Regression', plannedQuantity: 500, unit: 'pcs', weight: 20 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 100, date: '2026-09-18' });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 150, date: '2026-09-19' });
    const result = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 125, date: '2026-09-20' });
    expect(result.actualQuantity).toBe(375);
  });
});

describe('C-01B R2, Test 12: Progress Engine regression -- valid Actual/Plan values still produce the expected progress, formula untouched', () => {
  it('Plan=100, Actual=100 -> construction progress is exactly 100% (never artificially capped or altered by this change)', async () => {
    const { calculateConstructionProgress } = await import('../services/repositories/progressRepository');
    expect(calculateConstructionProgress([{ plannedQuantity: 100, actualQuantity: 100, weight: 100 }])).toBe(100);
  });

  it('Plan=500, Actual=250 -> construction progress is exactly 50%, matching the pre-existing C-01B regression test', async () => {
    const { calculateConstructionProgress } = await import('../services/repositories/progressRepository');
    expect(calculateConstructionProgress([{ plannedQuantity: 500, actualQuantity: 250, weight: 100 }])).toBe(50);
  });
});

// C-01B R2.1: Final Actual/Plan Integrity Correction. The invariant now
// holds in BOTH directions: an Actual write is rejected if the resulting
// cumulative would exceed the current Plan (C-01B R2, above), AND a Plan
// write is rejected if the new Plan would fall below the current Actual.
describe('C-01B R2.1, Finding #2: Plan cannot be reduced below current Actual', () => {
  it('Test 3: Plan=100, Actual=100, PM tries Plan=80 -> rejected', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Plan Reduce To Below Actual', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 100, date: '2026-09-18' });
    expect(() => updateConstructionActivityPlan(c01bProjectId, created.id, { plannedQuantity: 80 }))
      .toThrow('Planned quantity cannot be lower than current actual quantity (100).');
  });

  it('Test 4: Plan=100, Actual=80, PM changes Plan=90 -> accepted', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Plan Reduce Above Actual', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 80, date: '2026-09-18' });
    const revised = updateConstructionActivityPlan(c01bProjectId, created.id, { plannedQuantity: 90 });
    expect(revised.plannedQuantity).toBe(90);
    expect(revised.actualQuantity).toBe(80); // untouched
  });

  it('Test 5: Plan=100, Actual=80, PM changes Plan=70 -> rejected (below current Actual)', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Plan Reduce Below Actual', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 80, date: '2026-09-18' });
    expect(() => updateConstructionActivityPlan(c01bProjectId, created.id, { plannedQuantity: 70 })).toThrow();
  });

  it('Test 10: a rejected Plan reduction does not mutate the stored Plan (or Actual/history)', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Rejected Plan Reduction No Mutation', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 80, date: '2026-09-18' });
    expect(() => updateConstructionActivityPlan(c01bProjectId, created.id, { plannedQuantity: 70 })).toThrow();
    const unchanged = getOperations(c01bProjectId).constructionActivities.find((a) => a.id === created.id);
    expect(unchanged.plannedQuantity).toBe(100); // unchanged -- never clamped, never partially applied
    expect(unchanged.actualQuantity).toBe(80); // unchanged
    expect(unchanged.history).toHaveLength(1); // unchanged
  });

  it('a Plan edit that also changes other PLAN fields (activity/unit/weight) alongside a valid plannedQuantity still succeeds normally', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Combined Plan Edit', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 50, date: '2026-09-18' });
    const revised = updateConstructionActivityPlan(c01bProjectId, created.id, { activity: 'Renamed Combined Plan Edit', plannedQuantity: 200, weight: 25 });
    expect(revised.activity).toBe('Renamed Combined Plan Edit');
    expect(revised.plannedQuantity).toBe(200);
    expect(revised.weight).toBe(25);
  });

  it('a Plan edit that does not touch plannedQuantity at all is never blocked by this rule, regardless of current Actual', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Non-Quantity Plan Edit', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 100, date: '2026-09-18' }); // Actual == Plan already
    const revised = updateConstructionActivityPlan(c01bProjectId, created.id, { weight: 15 });
    expect(revised.weight).toBe(15);
    expect(revised.plannedQuantity).toBe(100);
  });
});

describe('C-01B R2.1, Finding #1 + Example 5: backdated Actual, exact worked example from the spec', () => {
  it('Plan=100, existing 2026-09-20=40 and 2026-09-21=30 (today 2026-09-23), user enters 2026-09-19=20 -> resulting Actual=90 -> accepted; backdate itself is never rejected', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Example 5 Worked Case', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 40, date: '2026-09-20' });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 30, date: '2026-09-21' });
    const result = updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 20, date: '2026-09-19' });
    expect(result.actualQuantity).toBe(90);
    expect(result.history).toHaveLength(3);
  });

  it('Test 7: a backdated entry causing Actual > Plan is rejected -- backdating does not exempt a write from the Actual<=Plan invariant', () => {
    const created = createConstructionActivity(c01bProjectId, { activity: 'Backdate Plan Violation', plannedQuantity: 100, unit: 'pcs', weight: 10 });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 40, date: '2026-09-20' });
    updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 30, date: '2026-09-21' });
    // 40 + 30 + 40 = 110 > 100 -- rejected even though 2026-09-19 predates both existing entries.
    expect(() => updateConstructionActivity(c01bProjectId, created.id, { dailyQuantity: 40, date: '2026-09-19' }))
      .toThrow('Actual quantity cannot exceed planned quantity (100). Please update the plan first.');
    const unchanged = getOperations(c01bProjectId).constructionActivities.find((a) => a.id === created.id);
    expect(unchanged.actualQuantity).toBe(70);
    expect(unchanged.history).toHaveLength(2);
  });
});
