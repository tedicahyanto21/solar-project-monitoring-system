import { describe, it, expect, vi } from 'vitest';
// MP#4 R1 Test Reliability Corrective: force LOCAL MODE deterministically,
// exactly as in progressRepository.test.js -- these PM-identity/assignment
// tests must exercise the mock store, never whatever real Firebase project
// happens to be configured via .env on the machine running the tests
// (that was the actual cause of the reported "proj-004 not found" and
// "no ACTIVE SITE_MANAGER" failures: the repository functions below
// correctly branch on isLocalMode, but nothing was pinning that value
// during the test run).
vi.mock('../firebase/config', () => ({ isLocalMode: true }));
import { setProjectManager, assignUser, getAssignments } from './projectDetailRepository';
import { getProjectById } from './projectRepository';
import { getUsers } from './userRepository';
import { initialProjects } from '../../data/mockProjects';
import { ROLES } from '../../constants/roles';

// Master Prompt #4, Finding #1: PM identity consistency. These tests prove
// project.projectManagerId and the projects/{id}/projectAssignments
// PROJECT_MANAGER record can never silently diverge -- both are only ever
// changed through the SAME domain operation (setProjectManager), whether
// the caller is TeamTab's assignUser(role=PROJECT_MANAGER) or Project
// Master's Add/Edit form.
const mp4ProjectId = initialProjects[3].id; // isolated from other test files' project

async function getRealPmUsers() {
  const users = await getUsers();
  return users.filter((u) => u.role === ROLES.PROJECT_MANAGER && u.status === 'ACTIVE');
}

describe('Master Prompt #4, Finding #1, Test A: assigning a PM syncs both representations', () => {
  it('after setProjectManager, project.projectManagerId and the PROJECT_MANAGER assignment.userId are the SAME value', async () => {
    const [userA] = await getRealPmUsers();
    await setProjectManager(mp4ProjectId, { userId: userA.userId, name: userA.name }, 'test-admin');

    const project = await getProjectById(mp4ProjectId);
    const assignments = await getAssignments(mp4ProjectId);
    const pmAssignment = assignments.find((a) => a.role === ROLES.PROJECT_MANAGER);

    expect(project.projectManagerId).toBe(userA.userId);
    expect(pmAssignment.userId).toBe(userA.userId);
    expect(project.projectManagerId).toBe(pmAssignment.userId);
  });

  it('the denormalized project.projectManager NAME is also kept in sync (for display/filtering)', async () => {
    const [userA] = await getRealPmUsers();
    await setProjectManager(mp4ProjectId, { userId: userA.userId, name: userA.name }, 'test-admin');
    const project = await getProjectById(mp4ProjectId);
    expect(project.projectManager).toBe(userA.name);
  });
});

describe('Master Prompt #4, Finding #1, Test B: changing the PM keeps both representations in sync', () => {
  it('User A -> User B: both project.projectManagerId and the assignment update together, never one without the other', async () => {
    const [userA, userB] = await getRealPmUsers();
    await setProjectManager(mp4ProjectId, { userId: userA.userId, name: userA.name }, 'test-admin');
    let project = await getProjectById(mp4ProjectId);
    expect(project.projectManagerId).toBe(userA.userId);

    await setProjectManager(mp4ProjectId, { userId: userB.userId, name: userB.name }, 'test-admin');
    project = await getProjectById(mp4ProjectId);
    const assignments = await getAssignments(mp4ProjectId);
    const pmAssignment = assignments.find((a) => a.role === ROLES.PROJECT_MANAGER);

    expect(project.projectManagerId).toBe(userB.userId);
    expect(pmAssignment.userId).toBe(userB.userId);
    expect(project.projectManagerId).not.toBe(userA.userId);
  });

  it('assignUser(role=PROJECT_MANAGER) -- the TeamTab entry point -- produces the identical synced result as calling setProjectManager directly', async () => {
    const [userA, userB] = await getRealPmUsers();
    await setProjectManager(mp4ProjectId, { userId: userA.userId, name: userA.name }, 'test-admin');
    // TeamTab calls the generic assignUser(); this must delegate to the
    // SAME sync logic, not a second, independent code path.
    await assignUser(mp4ProjectId, ROLES.PROJECT_MANAGER, { userId: userB.userId, name: userB.name }, 'test-admin');
    const project = await getProjectById(mp4ProjectId);
    expect(project.projectManagerId).toBe(userB.userId);
  });
});

describe('Master Prompt #4, Finding #1, Test C: exactly one active PROJECT_MANAGER assignment per project', () => {
  it('reassigning the PM updates the existing PROJECT_MANAGER row rather than creating a second one', async () => {
    const [userA, userB] = await getRealPmUsers();
    await setProjectManager(mp4ProjectId, { userId: userA.userId, name: userA.name }, 'test-admin');
    await setProjectManager(mp4ProjectId, { userId: userB.userId, name: userB.name }, 'test-admin');
    const assignments = await getAssignments(mp4ProjectId);
    const pmAssignments = assignments.filter((a) => a.role === ROLES.PROJECT_MANAGER);
    expect(pmAssignments.length).toBe(1);
    expect(pmAssignments[0].userId).toBe(userB.userId);
  });
});

describe('Master Prompt #4, Finding #1, Test D: existing authorization/eligibility behavior is unchanged', () => {
  it('setProjectManager still rejects an INACTIVE or wrong-role user, exactly as assignUser already did (FT-7 Part C)', async () => {
    const users = await getUsers();
    const inactiveOrWrongRole = users.find((u) => u.role !== ROLES.PROJECT_MANAGER);
    await expect(
      setProjectManager(mp4ProjectId, { userId: inactiveOrWrongRole.userId, name: inactiveOrWrongRole.name }, 'test-admin')
    ).rejects.toThrow();
  });

  it('non-PROJECT_MANAGER role assignments (e.g. SITE_MANAGER) are completely unaffected by this change -- they never touch projectManagerId', async () => {
    const users = await getUsers();
    const siteManager = users.find((u) => u.role === ROLES.SITE_MANAGER && u.status === 'ACTIVE');
    const projectBefore = await getProjectById(mp4ProjectId);
    await assignUser(mp4ProjectId, ROLES.SITE_MANAGER, { userId: siteManager.userId, name: siteManager.name }, 'test-admin');
    const projectAfter = await getProjectById(mp4ProjectId);
    expect(projectAfter.projectManagerId).toBe(projectBefore.projectManagerId);
  });
});
