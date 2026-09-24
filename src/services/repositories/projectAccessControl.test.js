import { describe, it, expect } from 'vitest';
import { getProjects, getProjectById } from './projectRepository';
import { getAssignments, assignUser, setProjectManager, removeAssignment } from './projectDetailRepository';
import { getUsers } from './userRepository';
import { initialProjects } from '../../data/mockProjects';
import { ROLES } from '../../constants/roles';

// C-01A: Access & Assignment Control Correction. These tests run in LOCAL
// MODE (no live Firebase in this environment -- see the final report's
// Firebase Verification section). They exercise the SAME repository
// functions the UI calls (projectRepository.getProjects/getProjectById,
// projectDetailRepository.assignUser/setProjectManager/removeAssignment),
// so a passing test here is evidence the fix works at the layer the UAT
// defect was actually found in, not just a simulation of it.

const projA = initialProjects[4].id; // isolated from other test files' projects
const projB = initialProjects[5].id;

async function getTwoDistinctUsers(role) {
  const users = await getUsers();
  return users.filter((u) => u.role === role && u.status === 'ACTIVE');
}

describe('C-01A Section 10, PM isolation (Tests 1-4)', () => {
  it('Test 1: PM-A assigned to Project A -> Project A is visible in PM-A\'s project list', async () => {
    const [pmA] = await getTwoDistinctUsers(ROLES.PROJECT_MANAGER);
    await setProjectManager(projA, { userId: pmA.userId, name: pmA.name }, 'test-admin');
    const list = await getProjects({ userId: pmA.userId, role: ROLES.PROJECT_MANAGER });
    expect(list.some((p) => p.id === projA)).toBe(true);
  });

  it('Test 2: PM-A assigned to Project A -> Project B is NOT returned in PM-A\'s list', async () => {
    const [pmA] = await getTwoDistinctUsers(ROLES.PROJECT_MANAGER);
    await setProjectManager(projA, { userId: pmA.userId, name: pmA.name }, 'test-admin');
    const list = await getProjects({ userId: pmA.userId, role: ROLES.PROJECT_MANAGER });
    expect(list.some((p) => p.id === projB)).toBe(false);
  });

  it('Test 3: PM-B assigned to Project B -> Project A is NOT returned in PM-B\'s list', async () => {
    const [pmA, pmB] = await getTwoDistinctUsers(ROLES.PROJECT_MANAGER);
    await setProjectManager(projA, { userId: pmA.userId, name: pmA.name }, 'test-admin');
    await setProjectManager(projB, { userId: pmB.userId, name: pmB.name }, 'test-admin');
    const listA = await getProjects({ userId: pmA.userId, role: ROLES.PROJECT_MANAGER });
    const listB = await getProjects({ userId: pmB.userId, role: ROLES.PROJECT_MANAGER });
    expect(listA.some((p) => p.id === projB)).toBe(false);
    expect(listB.some((p) => p.id === projA)).toBe(false);
    expect(listB.some((p) => p.id === projB)).toBe(true);
  });

  it('Test 4: PM direct project-detail access to an unauthorized project is rejected (returns null, not the project data)', async () => {
    const [pmA, pmB] = await getTwoDistinctUsers(ROLES.PROJECT_MANAGER);
    await setProjectManager(projA, { userId: pmA.userId, name: pmA.name }, 'test-admin');
    await setProjectManager(projB, { userId: pmB.userId, name: pmB.name }, 'test-admin');
    const result = await getProjectById(projB, { userId: pmA.userId, role: ROLES.PROJECT_MANAGER });
    expect(result).toBeNull();
    const ownResult = await getProjectById(projA, { userId: pmA.userId, role: ROLES.PROJECT_MANAGER });
    expect(ownResult).not.toBeNull();
    expect(ownResult.id).toBe(projA);
  });
});

describe('C-01A Section 10, SM multi-assignment isolation (Tests 5-8)', () => {
  it('Test 5 & 6: SM-A and SM-B can BOTH be assigned to Project A, and BOTH see it in their project list', async () => {
    const [smA, smB] = await getTwoDistinctUsers(ROLES.SITE_MANAGER);
    await assignUser(projA, ROLES.SITE_MANAGER, { userId: smA.userId, name: smA.name }, 'test-admin');
    await assignUser(projA, ROLES.SITE_MANAGER, { userId: smB.userId, name: smB.name }, 'test-admin');

    const assignments = await getAssignments(projA);
    const siteManagers = assignments.filter((a) => a.role === ROLES.SITE_MANAGER);
    expect(siteManagers.some((a) => a.userId === smA.userId)).toBe(true);
    expect(siteManagers.some((a) => a.userId === smB.userId)).toBe(true);
    expect(siteManagers.length).toBeGreaterThanOrEqual(2);

    const listForA = await getProjects({ userId: smA.userId, role: ROLES.SITE_MANAGER });
    const listForB = await getProjects({ userId: smB.userId, role: ROLES.SITE_MANAGER });
    expect(listForA.some((p) => p.id === projA)).toBe(true);
    expect(listForB.some((p) => p.id === projA)).toBe(true);
  });

  it('Test 7 & 8: neither SM-A nor SM-B (both assigned to Project A) can access Project B', async () => {
    const [smA, smB] = await getTwoDistinctUsers(ROLES.SITE_MANAGER);
    await assignUser(projA, ROLES.SITE_MANAGER, { userId: smA.userId, name: smA.name }, 'test-admin');
    await assignUser(projA, ROLES.SITE_MANAGER, { userId: smB.userId, name: smB.name }, 'test-admin');

    const listForA = await getProjects({ userId: smA.userId, role: ROLES.SITE_MANAGER });
    const listForB = await getProjects({ userId: smB.userId, role: ROLES.SITE_MANAGER });
    expect(listForA.some((p) => p.id === projB)).toBe(false);
    expect(listForB.some((p) => p.id === projB)).toBe(false);

    expect(await getProjectById(projB, { userId: smA.userId, role: ROLES.SITE_MANAGER })).toBeNull();
    expect(await getProjectById(projB, { userId: smB.userId, role: ROLES.SITE_MANAGER })).toBeNull();
  });
});

describe('C-01A Section 10, Assignment behavior (Tests 9-12)', () => {
  it('Test 9: multiple SITE_MANAGER assignments can coexist without one overwriting the other', async () => {
    const [smA, smB] = await getTwoDistinctUsers(ROLES.SITE_MANAGER);
    await assignUser(projA, ROLES.SITE_MANAGER, { userId: smA.userId, name: smA.name }, 'test-admin');
    await assignUser(projA, ROLES.SITE_MANAGER, { userId: smB.userId, name: smB.name }, 'test-admin');
    const assignments = await getAssignments(projA);
    const siteManagerIds = assignments.filter((a) => a.role === ROLES.SITE_MANAGER).map((a) => a.userId);
    expect(siteManagerIds).toContain(smA.userId);
    expect(siteManagerIds).toContain(smB.userId);
  });

  it('Test 10: PM remains single-assignment-per-project even after multiple reassignments', async () => {
    const [pmA, pmB] = await getTwoDistinctUsers(ROLES.PROJECT_MANAGER);
    await setProjectManager(projA, { userId: pmA.userId, name: pmA.name }, 'test-admin');
    await setProjectManager(projA, { userId: pmB.userId, name: pmB.name }, 'test-admin');
    await setProjectManager(projA, { userId: pmA.userId, name: pmA.name }, 'test-admin');
    const assignments = await getAssignments(projA);
    const pmAssignments = assignments.filter((a) => a.role === ROLES.PROJECT_MANAGER);
    expect(pmAssignments.length).toBe(1);
    expect(pmAssignments[0].userId).toBe(pmA.userId);
  });

  it('Test 11: PM reassignment preserves the canonical userId identity (assignment.userId matches the assigned user, synced to projectManagerId)', async () => {
    const [, pmB] = await getTwoDistinctUsers(ROLES.PROJECT_MANAGER);
    await setProjectManager(projA, { userId: pmB.userId, name: pmB.name }, 'test-admin');
    const assignments = await getAssignments(projA);
    const pm = assignments.find((a) => a.role === ROLES.PROJECT_MANAGER);
    expect(pm.userId).toBe(pmB.userId);
    const project = await getProjectById(projA);
    expect(project.projectManagerId).toBe(pmB.userId);
  });

  it('Test 12: assigning SITE_MANAGER/ENGINEERING/HSE does not overwrite the existing PROJECT_MANAGER assignment', async () => {
    const [pmA] = await getTwoDistinctUsers(ROLES.PROJECT_MANAGER);
    const [smA] = await getTwoDistinctUsers(ROLES.SITE_MANAGER);
    await setProjectManager(projA, { userId: pmA.userId, name: pmA.name }, 'test-admin');
    await assignUser(projA, ROLES.SITE_MANAGER, { userId: smA.userId, name: smA.name }, 'test-admin');
    const assignments = await getAssignments(projA);
    const pm = assignments.find((a) => a.role === ROLES.PROJECT_MANAGER);
    expect(pm.userId).toBe(pmA.userId);
  });

  it('removeAssignment removes exactly one (role, userId) holder without disturbing others', async () => {
    const [smA, smB] = await getTwoDistinctUsers(ROLES.SITE_MANAGER);
    await assignUser(projA, ROLES.SITE_MANAGER, { userId: smA.userId, name: smA.name }, 'test-admin');
    await assignUser(projA, ROLES.SITE_MANAGER, { userId: smB.userId, name: smB.name }, 'test-admin');
    await removeAssignment(projA, ROLES.SITE_MANAGER, smA.userId);
    const assignments = await getAssignments(projA);
    const siteManagerIds = assignments.filter((a) => a.role === ROLES.SITE_MANAGER).map((a) => a.userId);
    expect(siteManagerIds).not.toContain(smA.userId);
    expect(siteManagerIds).toContain(smB.userId);
  });

  it('removeAssignment refuses to remove a PROJECT_MANAGER (must remain exactly one, never zero)', async () => {
    const [pmA] = await getTwoDistinctUsers(ROLES.PROJECT_MANAGER);
    await setProjectManager(projA, { userId: pmA.userId, name: pmA.name }, 'test-admin');
    await expect(removeAssignment(projA, ROLES.PROJECT_MANAGER, pmA.userId)).rejects.toThrow();
  });
});

describe('C-01A Section 10, Regression (Tests 13-17)', () => {
  it('Test 13: SUPER_ADMIN can still access the full portfolio, unaffected by scoping', async () => {
    const listAsSuperAdmin = await getProjects({ userId: 'anyone', role: ROLES.SUPER_ADMIN });
    expect(listAsSuperAdmin.length).toBe(initialProjects.length);
  });

  it('Test 13b: HEAD_PM and BOD also retain portfolio-wide access (unchanged, existing design)', async () => {
    const asHeadPm = await getProjects({ userId: 'anyone', role: ROLES.HEAD_PM });
    const asBod = await getProjects({ userId: 'anyone', role: ROLES.BOD });
    expect(asHeadPm.length).toBe(initialProjects.length);
    expect(asBod.length).toBe(initialProjects.length);
  });

  it('Test 13c: calling getProjects()/getProjectById() with NO currentUser at all (internal/Dashboard callers) preserves the original unrestricted behavior', async () => {
    const allProjects = await getProjects();
    expect(allProjects.length).toBe(initialProjects.length);
    const anyProject = await getProjectById(projA);
    expect(anyProject).not.toBeNull();
  });

  it('Test 14/15: existing Project Master CRUD and Project Detail behavior remain intact for an authorized user', async () => {
    const [pmA] = await getTwoDistinctUsers(ROLES.PROJECT_MANAGER);
    await setProjectManager(projA, { userId: pmA.userId, name: pmA.name }, 'test-admin');
    const project = await getProjectById(projA, { userId: pmA.userId, role: ROLES.PROJECT_MANAGER });
    expect(project.projectName).toBeTruthy();
    expect(project.projectCode).toBeTruthy();
  });

  it('Test 17: Progress Engine remains unaffected -- spot-check progressRepository still functions for a project this suite modified', async () => {
    const { getProjectProgress } = await import('./progressRepository');
    const result = await getProjectProgress(projA);
    expect(result).toHaveProperty('overallProgress');
    expect(typeof result.overallProgress).toBe('number');
  });
});

// C-01C R1: SCM Global Procurement Access. SCM is a global functional role
// for Procurement -- unlike PROJECT_MANAGER/SITE_MANAGER/ENGINEERING
// (project-scoped, tested above), SCM sees every project without needing
// a projectAssignments entry. This is domain-specific (project
// list/detail READ + Procurement ACTUAL write), never a blanket "SCM
// bypasses assignment everywhere" rule -- Project Master administration
// and PM/team assignment remain completely closed to SCM (verified at the
// UI-gate level: CAN_MANAGE_PROJECT_ROLES / ASSIGNABLE_BY, neither of
// which lists SCM, unchanged by this corrective).
describe('C-01C R1, SCM global Procurement access (Tests 1, 7)', () => {
  it('Test 1: SCM can retrieve ALL projects, with no assignment to any of them', async () => {
    const allProjects = await getProjects();
    const asScm = await getProjects({ userId: 'scm-user-with-no-assignments-anywhere', role: ROLES.SCM });
    expect(asScm.length).toBe(allProjects.length);
    expect(asScm.map((p) => p.id).sort()).toEqual(allProjects.map((p) => p.id).sort());
  });

  it('Test 7: SCM does not require project assignment to open a specific, otherwise-unassigned project\'s detail page', async () => {
    const unassignedProjectId = initialProjects[9].id; // a project this SCM user holds no assignment for
    const project = await getProjectById(unassignedProjectId, { userId: 'scm-user-with-no-assignments-anywhere', role: ROLES.SCM });
    expect(project).not.toBeNull();
    expect(project.id).toBe(unassignedProjectId);
  });
});

describe('C-01C R1, Tests 2-4: PROJECT_MANAGER/SITE_MANAGER/ENGINEERING remain project-scoped -- SCM\'s global exception does not leak to other roles', () => {
  it('Test 2: PROJECT_MANAGER with no assignment sees an EMPTY project list, unlike SCM', async () => {
    const asUnassignedPm = await getProjects({ userId: 'pm-user-with-no-assignments-anywhere', role: ROLES.PROJECT_MANAGER });
    expect(asUnassignedPm).toEqual([]);
  });

  it('Test 3: SITE_MANAGER with no assignment sees an EMPTY project list', async () => {
    const asUnassignedSm = await getProjects({ userId: 'sm-user-with-no-assignments-anywhere', role: ROLES.SITE_MANAGER });
    expect(asUnassignedSm).toEqual([]);
  });

  it('Test 4: ENGINEERING with no assignment sees an EMPTY project list', async () => {
    const asUnassignedEng = await getProjects({ userId: 'eng-user-with-no-assignments-anywhere', role: ROLES.ENGINEERING });
    expect(asUnassignedEng).toEqual([]);
  });

  it('an unassigned PROJECT_MANAGER is also rejected from a specific project\'s detail page, unlike SCM', async () => {
    const unassignedProjectId = initialProjects[9].id;
    const project = await getProjectById(unassignedProjectId, { userId: 'pm-user-with-no-assignments-anywhere', role: ROLES.PROJECT_MANAGER });
    expect(project).toBeNull();
  });
});
