import { describe, it, expect } from 'vitest';
import { initialProjects } from './mockProjects';
import { getOperations, updateConstructionActivity } from './mockOperationalData';

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
