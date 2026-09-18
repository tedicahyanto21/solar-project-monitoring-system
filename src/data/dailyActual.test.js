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
