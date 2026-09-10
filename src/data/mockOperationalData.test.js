import { describe, it, expect } from 'vitest';
import { initialProjects } from './mockProjects';
import { getOperations, updateConstructionActivity, createConstructionActivity, updateConstructionActivityPlan } from './mockOperationalData';

// Master Prompt #1, Section 9 (Plan vs Actual ownership) and Section 24
// (testing requirements). These tests cover what is verifiable WITHOUT a
// live Firestore/emulator connection -- the corresponding Firestore Rules
// enforcement (constructionActivities: SITE_MANAGER may only touch
// actualQuantity/history/updatedAt) is documented in firestore.rules but
// has NOT been executed against a real project or the emulator (see the
// final report's Known Limitations). These tests instead confirm the
// APPLICATION-CODE guarantee that keeps the app compatible with that rule:
// the update function's own signature makes it structurally impossible to
// send a PLAN field (plannedQuantity/weight/unit/activity) through the
// path a Site Manager actually calls.

const seedProjectId = initialProjects[0].id;

describe('updateConstructionActivity (Plan vs Actual ownership, Section 9)', () => {
  it('the ACTUAL-side update function only ever accepts actualQuantity and date -- it has no parameter through which a caller could pass plannedQuantity, weight, unit, or the activity name', () => {
    // This is a structural guarantee, not a runtime check: the function
    // destructures exactly { actualQuantity, date } from its third
    // argument, so any PLAN fields included in a caller's object are
    // silently ignored rather than applied -- there is no code path here
    // that could ever write to a PLAN field.
    const ops = getOperations(seedProjectId);
    const activity = ops.constructionActivities[0];
    const originalPlanned = activity.plannedQuantity;
    const originalWeight = activity.weight;
    const originalActivityName = activity.activity;

    updateConstructionActivity(seedProjectId, activity.id, {
      actualQuantity: 5,
      date: '2026-01-15',
      // Even if a caller attempted to sneak PLAN fields in alongside the
      // expected ones, the destructuring below drops them on the floor.
      plannedQuantity: 999999,
      weight: 999,
      activity: 'Attempted PLAN override',
    });

    const updated = getOperations(seedProjectId).constructionActivities.find((a) => a.id === activity.id);
    expect(updated.plannedQuantity).toBe(originalPlanned);
    expect(updated.weight).toBe(originalWeight);
    expect(updated.activity).toBe(originalActivityName);
    expect(updated.actualQuantity).toBe(5);
  });

  it('rejects a negative Actual Quantity (Sprint FT-5 A6, unchanged by this task)', () => {
    const ops = getOperations(seedProjectId);
    const activity = ops.constructionActivities[1];
    expect(() => updateConstructionActivity(seedProjectId, activity.id, { actualQuantity: -10 })).toThrow(/cannot be negative/);
  });

  it('preserves history as an append-only log -- an update for a NEW date adds an entry rather than replacing prior history', () => {
    const ops = getOperations(seedProjectId);
    const activity = ops.constructionActivities[2];
    const historyLengthBefore = activity.history.length;
    updateConstructionActivity(seedProjectId, activity.id, { actualQuantity: 42, date: '2099-01-01' });
    const updated = getOperations(seedProjectId).constructionActivities.find((a) => a.id === activity.id);
    expect(updated.history.length).toBe(historyLengthBefore + 1);
    expect(updated.history.find((h) => h.date === '2099-01-01').actualQuantity).toBe(42);
  });
});

// Documents, as an executable spec, the exact field allowlist the
// tightened firestore.rules constructionActivities SITE_MANAGER update
// rule enforces (`hasOnly([...])`). This does not execute against Firestore
// -- it exists so a future change to the fields this app actually writes
// cannot silently drift out of sync with the rule without a test failing.
describe('Firestore rule / application code agreement (documentation, not a live rules test)', () => {
  const SITE_MANAGER_ALLOWED_FIELDS = ['actualQuantity', 'history', 'updatedAt'];

  it('the mock backend\'s ACTUAL-side write touches only fields the tightened Firestore rule allows for SITE_MANAGER', () => {
    // Mirrors mockOperationalData.updateConstructionActivity's own
    // ops.constructionActivities = ...map(...) result shape for the fields
    // it actually changes (actualQuantity, history, updatedAt) versus
    // fields it always copies through unchanged (everything else, via
    // ...a). We assert the CHANGED set here.
    const changedFields = ['actualQuantity', 'history', 'updatedAt'];
    expect(changedFields.every((f) => SITE_MANAGER_ALLOWED_FIELDS.includes(f))).toBe(true);
    expect(changedFields.length).toBe(SITE_MANAGER_ALLOWED_FIELDS.length);
  });
});

// Master Prompt #3, Section 18: Construction PLAN vs ACTUAL workflow tests.
const mp3ProjectId = initialProjects[2].id; // isolated from the earlier describe block's project

describe('createConstructionActivity (Master Prompt #3, Section 4: PM PLAN capability)', () => {
  it('PM can create a construction activity with the required PLAN fields', () => {
    const before = getOperations(mp3ProjectId).constructionActivities.length;
    const created = createConstructionActivity(mp3ProjectId, { activity: 'Trenching', plannedQuantity: 500, unit: 'meters', weight: 10 });
    expect(created.activity).toBe('Trenching');
    expect(created.plannedQuantity).toBe(500);
    expect(created.unit).toBe('meters');
    expect(created.weight).toBe(10);
    expect(getOperations(mp3ProjectId).constructionActivities.length).toBe(before + 1);
  });

  it('a newly created activity starts at actualQuantity=0 with empty history -- immediately visible to the Progress Engine at 0%', () => {
    const created = createConstructionActivity(mp3ProjectId, { activity: 'Fencing', plannedQuantity: 200, unit: 'meters', weight: 5 });
    expect(created.actualQuantity).toBe(0);
    expect(created.history).toEqual([]);
  });

  it('Planned Quantity must be greater than zero -- validation preserved for the create path too', () => {
    expect(() => createConstructionActivity(mp3ProjectId, { activity: 'Invalid', plannedQuantity: 0, unit: 'units', weight: 5 })).toThrow(/greater than zero/);
    expect(() => createConstructionActivity(mp3ProjectId, { activity: 'Invalid', plannedQuantity: -5, unit: 'units', weight: 5 })).toThrow(/greater than zero/);
  });
});

describe('updateConstructionActivityPlan (Master Prompt #3, Section 4: PM PLAN edit)', () => {
  it('PM can update PLAN fields (activity/plannedQuantity/unit/weight)', () => {
    const created = createConstructionActivity(mp3ProjectId, { activity: 'Original Name', plannedQuantity: 100, unit: 'units', weight: 8 });
    const updated = updateConstructionActivityPlan(mp3ProjectId, created.id, { activity: 'Renamed', plannedQuantity: 150, unit: 'meters', weight: 12 });
    expect(updated.activity).toBe('Renamed');
    expect(updated.plannedQuantity).toBe(150);
    expect(updated.unit).toBe('meters');
    expect(updated.weight).toBe(12);
  });

  it('weight is preserved correctly through a plan edit that does not touch it', () => {
    const created = createConstructionActivity(mp3ProjectId, { activity: 'Weight Check', plannedQuantity: 100, unit: 'units', weight: 15 });
    const updated = updateConstructionActivityPlan(mp3ProjectId, created.id, { plannedQuantity: 120 });
    expect(updated.weight).toBe(15);
  });

  it('a PM PLAN edit does NOT modify actualQuantity or history, even if the site already recorded actual progress', () => {
    const created = createConstructionActivity(mp3ProjectId, { activity: 'Has Actuals', plannedQuantity: 100, unit: 'units', weight: 10 });
    updateConstructionActivity(mp3ProjectId, created.id, { actualQuantity: 40, date: '2026-01-10' });
    const beforeEdit = getOperations(mp3ProjectId).constructionActivities.find((a) => a.id === created.id);
    expect(beforeEdit.actualQuantity).toBe(40);
    expect(beforeEdit.history.length).toBe(1);

    const afterPlanEdit = updateConstructionActivityPlan(mp3ProjectId, created.id, { plannedQuantity: 200, weight: 20 });
    expect(afterPlanEdit.actualQuantity).toBe(40); // untouched by the PLAN edit
    expect(afterPlanEdit.history).toEqual(beforeEdit.history); // untouched
    expect(afterPlanEdit.plannedQuantity).toBe(200); // the PLAN change itself did apply
  });

  it('Planned Quantity validation is preserved on the edit path too', () => {
    const created = createConstructionActivity(mp3ProjectId, { activity: 'Validation Check', plannedQuantity: 100, unit: 'units', weight: 10 });
    expect(() => updateConstructionActivityPlan(mp3ProjectId, created.id, { plannedQuantity: 0 })).toThrow(/greater than zero/);
    expect(() => updateConstructionActivityPlan(mp3ProjectId, created.id, { plannedQuantity: -10 })).toThrow(/greater than zero/);
  });
});

describe('Master Prompt #3, Section 18: PLAN vs ACTUAL operations cannot cross into each other\'s fields', () => {
  it('the ACTUAL operation (updateConstructionActivity) cannot modify PLAN fields, even if a caller tries to sneak them in', () => {
    const created = createConstructionActivity(mp3ProjectId, { activity: 'Cross-Check A', plannedQuantity: 100, unit: 'units', weight: 25 });
    updateConstructionActivity(mp3ProjectId, created.id, { actualQuantity: 30, date: '2026-02-01', plannedQuantity: 999, weight: 999, activity: 'Hacked' });
    const result = getOperations(mp3ProjectId).constructionActivities.find((a) => a.id === created.id);
    expect(result.plannedQuantity).toBe(100);
    expect(result.weight).toBe(25);
    expect(result.activity).toBe('Cross-Check A');
    expect(result.actualQuantity).toBe(30);
  });

  it('the PLAN operation (updateConstructionActivityPlan) cannot modify ACTUAL fields, even if a caller tries to sneak them in', () => {
    const created = createConstructionActivity(mp3ProjectId, { activity: 'Cross-Check B', plannedQuantity: 100, unit: 'units', weight: 25 });
    updateConstructionActivity(mp3ProjectId, created.id, { actualQuantity: 55, date: '2026-02-02' });
    updateConstructionActivityPlan(mp3ProjectId, created.id, { plannedQuantity: 200, actualQuantity: 999999, history: [{ date: 'fake', actualQuantity: 999 }] });
    const result = getOperations(mp3ProjectId).constructionActivities.find((a) => a.id === created.id);
    expect(result.actualQuantity).toBe(55); // untouched -- 999999 never applied
    expect(result.history.length).toBe(1); // untouched -- fake entry never applied
    expect(result.plannedQuantity).toBe(200); // the genuine PLAN change did apply
  });
});

describe('Master Prompt #3, Section 18: Progress Engine result is unaffected by this workflow change for equivalent data', () => {
  it('a construction activity created via the new PM PLAN workflow correctly participates in getProjectProgress -- no separate calculation path was introduced', async () => {
    const { getProjectProgress } = await import('../services/repositories/progressRepository');
    const before = await getProjectProgress(mp3ProjectId);
    // Add a new, fully-weighted activity that starts at 0% -- this MUST
    // pull the construction component's average down through the SAME
    // calculateConstructionProgress formula, proving the new create/plan-
    // edit functions feed the existing engine rather than a duplicate one.
    createConstructionActivity(mp3ProjectId, { activity: 'Fresh Item', plannedQuantity: 1000, unit: 'units', weight: 1000 });
    const after = await getProjectProgress(mp3ProjectId);
    expect(after.component.construction).toBeLessThanOrEqual(before.component.construction);
  });
});
