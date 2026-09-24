import { describe, it, expect, vi } from 'vitest';
vi.mock('../services/firebase/config', () => ({ isLocalMode: true }));
import {
  getOperations,
  createProcurementMilestone, updateProcurementMilestonePlan, updateProcurementMilestone,
  createCommissioningItem, updateCommissioningItemPlan, updateCommissioningItem,
} from './mockOperationalData';
import { initialProjects } from './mockProjects';

// C-01C: Procurement & Commissioning Operational Input. Business rules:
//   Procurement PLAN (name/weight/plannedDate)   -> PROJECT_MANAGER
//   Procurement ACTUAL (progressContribution/actualDate/status) -> SCM
//   Commissioning PLAN (item/weight)             -> PROJECT_MANAGER
//   Commissioning ACTUAL (completionStatus)      -> ENGINEERING / SITE_MANAGER
// Both follow the exact PLAN/ACTUAL split pattern already established for
// Construction (Master Prompt #3) and are role-enforced at the UI,
// repository, and Firestore rules layers -- these tests exercise the
// repository/data layer, where role identity is not itself a parameter
// (the actual role gate lives in the UI and firestore.rules; see
// projectDetailRepository.test.js / the rules-agreement test pattern for
// how that boundary is otherwise verified in this codebase).
const c01cProjectId = initialProjects[8].id; // isolated from other test files' projects

describe('C-01C, Procurement Tests 1-2: PM can create and edit PLAN', () => {
  it('Test 1: PM can create a Procurement Milestone with only PLAN fields', () => {
    const created = createProcurementMilestone(c01cProjectId, { name: 'Transformer Delivery', weight: 20, plannedDate: '2026-10-01' });
    expect(created.name).toBe('Transformer Delivery');
    expect(created.weight).toBe(20);
    expect(created.plannedDate).toBe('2026-10-01');
  });

  it('a newly created milestone starts at safe ACTUAL defaults -- immediately visible to the Progress Engine at 0%', () => {
    const created = createProcurementMilestone(c01cProjectId, { name: 'Inverter Delivery', weight: 15, plannedDate: '2026-10-05' });
    expect(created.progressContribution).toBe(0);
    expect(created.status).toBe('Not Started');
    expect(created.actualDate).toBeNull();
  });

  it('Test 2: PM can edit Procurement PLAN fields', () => {
    const created = createProcurementMilestone(c01cProjectId, { name: 'Original Name', weight: 10, plannedDate: '2026-10-01' });
    const updated = updateProcurementMilestonePlan(c01cProjectId, created.id, { name: 'Renamed Milestone', weight: 25, plannedDate: '2026-11-01' });
    expect(updated.name).toBe('Renamed Milestone');
    expect(updated.weight).toBe(25);
    expect(updated.plannedDate).toBe('2026-11-01');
  });
});

describe('C-01C, Procurement Test 3: PM cannot modify ACTUAL fields via the PLAN update function', () => {
  it('updateProcurementMilestonePlan has no parameter through which a caller could set progressContribution/actualDate/status', () => {
    const created = createProcurementMilestone(c01cProjectId, { name: 'Has Actuals', weight: 10, plannedDate: '2026-10-01' });
    updateProcurementMilestone(c01cProjectId, created.id, { progressContribution: 40, status: 'In Progress', actualDate: null });
    const beforePlanEdit = getOperations(c01cProjectId).procurementMilestones.find((m) => m.id === created.id);
    expect(beforePlanEdit.progressContribution).toBe(40);

    const afterPlanEdit = updateProcurementMilestonePlan(c01cProjectId, created.id, { weight: 30 });
    expect(afterPlanEdit.progressContribution).toBe(40); // untouched by the PLAN edit
    expect(afterPlanEdit.status).toBe('In Progress'); // untouched
    expect(afterPlanEdit.weight).toBe(30); // the PLAN change itself did apply
  });
});

describe('C-01C, Procurement Test 4: SCM can update ACTUAL/progress', () => {
  it('updateProcurementMilestone (ACTUAL) correctly applies progressContribution/actualDate/status', () => {
    const created = createProcurementMilestone(c01cProjectId, { name: 'SCM Actual Check', weight: 10, plannedDate: '2026-10-01' });
    const updated = updateProcurementMilestone(c01cProjectId, created.id, { progressContribution: 60, status: 'In Progress', actualDate: null });
    expect(updated.progressContribution).toBe(60);
    expect(updated.status).toBe('In Progress');
  });
});

describe('C-01C, Procurement Test 5: SCM cannot modify PM-owned PLAN fields via the ACTUAL update function', () => {
  it('updateProcurementMilestone has no parameter through which a caller could set name/weight/plannedDate', () => {
    const created = createProcurementMilestone(c01cProjectId, { name: 'Protected Plan', weight: 15, plannedDate: '2026-10-01' });
    updateProcurementMilestone(c01cProjectId, created.id, { progressContribution: 100, status: 'Completed', actualDate: '2026-10-01', name: 'Hacked', weight: 999, plannedDate: '2099-01-01' });
    const result = getOperations(c01cProjectId).procurementMilestones.find((m) => m.id === created.id);
    expect(result.name).toBe('Protected Plan');
    expect(result.weight).toBe(15);
    expect(result.plannedDate).toBe('2026-10-01');
    expect(result.progressContribution).toBe(100); // the ACTUAL change itself did apply
  });
});

describe('C-01C, Procurement Test 7: existing progress calculation still works, unchanged formula', () => {
  it('calculateProcurementProgress reads the same progressContribution/weight fields as before, no change needed', async () => {
    const { calculateProcurementProgress } = await import('../services/repositories/progressRepository');
    const created = createProcurementMilestone(c01cProjectId, { name: 'Formula Check', weight: 100, plannedDate: '2026-10-01' });
    const updated = updateProcurementMilestone(c01cProjectId, created.id, { progressContribution: 75, status: 'In Progress', actualDate: null });
    expect(calculateProcurementProgress([updated])).toBe(75);
  });
});

describe('C-01C, Commissioning Tests 9-10: PM can create and edit PLAN', () => {
  it('Test 9: PM can create a Commissioning checklist item with only PLAN fields', () => {
    const created = createCommissioningItem(c01cProjectId, { item: 'Insulation Resistance Test', weight: 25 });
    expect(created.item).toBe('Insulation Resistance Test');
    expect(created.weight).toBe(25);
  });

  it('a newly created item starts Pending -- immediately visible to the Progress Engine at 0%', () => {
    const created = createCommissioningItem(c01cProjectId, { item: 'Earthing Continuity Test', weight: 25 });
    expect(created.completionStatus).toBe('Pending');
  });

  it('Test 10: PM can edit Commissioning PLAN fields', () => {
    const created = createCommissioningItem(c01cProjectId, { item: 'Original Item', weight: 10 });
    const updated = updateCommissioningItemPlan(c01cProjectId, created.id, { item: 'Renamed Item', weight: 30 });
    expect(updated.item).toBe('Renamed Item');
    expect(updated.weight).toBe(30);
  });
});

describe('C-01C, Commissioning Test 11: PM cannot mark Complete/Pending', () => {
  it('updateCommissioningItemPlan has no parameter through which a caller could set completionStatus', () => {
    const created = createCommissioningItem(c01cProjectId, { item: 'Protected Status', weight: 20 });
    updateCommissioningItem(c01cProjectId, created.id, { completionStatus: 'Complete' });
    const beforePlanEdit = getOperations(c01cProjectId).commissioningChecklist.find((c) => c.id === created.id);
    expect(beforePlanEdit.completionStatus).toBe('Complete');

    const afterPlanEdit = updateCommissioningItemPlan(c01cProjectId, created.id, { weight: 40 });
    expect(afterPlanEdit.completionStatus).toBe('Complete'); // untouched by the PLAN edit
    expect(afterPlanEdit.weight).toBe(40); // the PLAN change itself did apply
  });
});

describe('C-01C, Commissioning Tests 12-13: ENGINEERING and SITE_MANAGER can update completionStatus', () => {
  it('Test 12/13: updateCommissioningItem correctly toggles completionStatus between Complete and Pending', () => {
    const created = createCommissioningItem(c01cProjectId, { item: 'Functional Test', weight: 25 });
    const marked = updateCommissioningItem(c01cProjectId, created.id, { completionStatus: 'Complete' });
    expect(marked.completionStatus).toBe('Complete');
    const unmarked = updateCommissioningItem(c01cProjectId, created.id, { completionStatus: 'Pending' });
    expect(unmarked.completionStatus).toBe('Pending');
  });

  it('an invalid completionStatus value is rejected -- allowed values remain exactly Complete/Pending', () => {
    const created = createCommissioningItem(c01cProjectId, { item: 'Invalid Status Check', weight: 25 });
    expect(() => updateCommissioningItem(c01cProjectId, created.id, { completionStatus: 'Done' })).toThrow('Completion status must be either "Complete" or "Pending".');
  });
});

describe('C-01C, Commissioning Test 14: ENGINEERING/SITE_MANAGER cannot modify PLAN fields', () => {
  it('updateCommissioningItem has no parameter through which a caller could set item/weight', () => {
    const created = createCommissioningItem(c01cProjectId, { item: 'Protected Plan Fields', weight: 15 });
    updateCommissioningItem(c01cProjectId, created.id, { completionStatus: 'Complete', item: 'Hacked', weight: 999 });
    const result = getOperations(c01cProjectId).commissioningChecklist.find((c) => c.id === created.id);
    expect(result.item).toBe('Protected Plan Fields');
    expect(result.weight).toBe(15);
    expect(result.completionStatus).toBe('Complete'); // the ACTUAL change itself did apply
  });
});

describe('C-01C, Commissioning Test 16: existing progress calculation still works, unchanged formula', () => {
  it('calculateCommissioningProgress reads the same completionStatus/weight fields as before, no change needed', async () => {
    const { calculateCommissioningProgress } = await import('../services/repositories/progressRepository');
    const itemA = createCommissioningItem(c01cProjectId, { item: 'Item A', weight: 50 });
    const itemB = createCommissioningItem(c01cProjectId, { item: 'Item B', weight: 50 });
    const markedA = updateCommissioningItem(c01cProjectId, itemA.id, { completionStatus: 'Complete' });
    expect(calculateCommissioningProgress([markedA, itemB])).toBe(50);
  });
});

describe('C-01C, Regression: Progress Engine formulas remain byte-for-byte unchanged', () => {
  it('calculateProcurementProgress and calculateCommissioningProgress produce identical results to the pre-C-01C formula tests', async () => {
    const { calculateProcurementProgress, calculateCommissioningProgress } = await import('../services/repositories/progressRepository');
    // Exact fixtures from the existing formula-level tests in progressRepository.test.js.
    expect(calculateProcurementProgress([{ weight: 50, progressContribution: 100 }, { weight: 50, progressContribution: 0 }])).toBe(50);
    expect(calculateCommissioningProgress([
      { weight: 25, completionStatus: 'Complete' }, { weight: 25, completionStatus: 'Complete' },
      { weight: 25, completionStatus: 'Pending' }, { weight: 25, completionStatus: 'Pending' },
    ])).toBe(50);
  });
});

// C-01C R1: SCM Global Procurement Access. The repository-layer functions
// exercised throughout this file (updateProcurementMilestone/Plan) never
// took a role parameter to begin with -- the PLAN/ACTUAL field split IS
// the enforcement, and it is unaffected by whether SCM's access is
// project-scoped or global. What genuinely changed for this corrective is
// the Firestore RULE text (dropping isAssignedToProject from SCM's ACTUAL
// clause specifically) and getProjects/getProjectById's portfolio-wide
// treatment of SCM (covered in projectAccessControl.test.js, Tests 1/7).
// This test guards the rule text itself, mirroring the file's existing
// "Firestore rule / application code agreement" documentation pattern, so
// a future edit cannot silently re-add the assignment requirement to
// SCM's clause without a test failing.
describe('C-01C R1, Test 5/6/8/9: Firestore rule text confirms SCM\'s Procurement ACTUAL clause is portfolio-wide (no isAssignedToProject), while PM\'s PLAN clause remains project-scoped', () => {
  it('the procurementMilestones update rule\'s SCM clause has no isAssignedToProject call; the PROJECT_MANAGER clause still does', async () => {
    const fs = await import('node:fs');
    const rulesText = fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
    const block = rulesText.slice(rulesText.indexOf('match /procurementMilestones/{milestoneId}'), rulesText.indexOf('match /constructionActivities'));
    // The PM clause: role check followed by isAssignedToProject before its hasOnly.
    expect(block).toMatch(/PROJECT_MANAGER'\]\) && isAssignedToProject\(projectId\)[\s\S]*?hasOnly\(\['name', 'weight', 'plannedDate'\]/);
    // The SCM clause: role check going STRAIGHT to hasOnly, with no isAssignedToProject in between.
    expect(block).toMatch(/hasRole\(\['SCM'\]\)\s*\n\s*&& request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly\(\['progressContribution', 'actualDate', 'status'\]/);
    // Negative check: SCM's clause text must not contain isAssignedToProject at all.
    const scmClauseMatch = block.match(/hasRole\(\['SCM'\]\)[\s\S]*?status'\]\)\)/);
    expect(scmClauseMatch).toBeTruthy();
    expect(scmClauseMatch[0]).not.toMatch(/isAssignedToProject/);
  });

  it('the projects/{projectId} read rule includes SCM alongside the other portfolio-wide roles', async () => {
    const fs = await import('node:fs');
    const rulesText = fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
    const block = rulesText.slice(rulesText.indexOf('match /projects/{projectId}'), rulesText.indexOf('match /projects/{projectId}') + 800);
    expect(block).toMatch(/allow read: if hasRole\(\['SUPER_ADMIN', 'HEAD_PM', 'BOD', 'SCM'\]\)/);
  });
});
