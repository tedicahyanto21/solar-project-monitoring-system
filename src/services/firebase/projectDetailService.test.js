import { describe, it, expect, vi, beforeEach } from 'vitest';

// MP#4 Corrective Fix, Section 12/13: no Firebase Emulator is available in
// this environment (confirmed: identitytoolkit.googleapis.com,
// firestore.googleapis.com, and storage.googleapis.com all return
// `x-deny-reason: host_not_allowed` from this sandbox's network egress
// proxy -- see the final report). These tests instead mock the Firestore
// SDK directly so the ACTUAL LOGIC of the corrected assignUser/
// setProjectManager functions (which documents get deleted/created/
// updated, and in what batch) can be verified without a live connection.
// This is not a substitute for real emulator/rules testing -- it proves
// the code takes the right actions, not that Firestore actually accepts
// them.

const batchCalls = { deletes: [], sets: [], updates: [] };
const mockBatch = {
  delete: vi.fn((ref) => batchCalls.deletes.push(ref)),
  set: vi.fn((ref, data) => batchCalls.sets.push({ ref, data })),
  update: vi.fn((ref, data) => batchCalls.updates.push({ ref, data })),
  commit: vi.fn(() => Promise.resolve()),
};

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, ...segments) => ({ __type: 'collection', path: segments.join('/') })),
  doc: vi.fn((_db, ...segments) => ({ __type: 'doc', path: segments.join('/') })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(() => Promise.resolve()),
  query: vi.fn((ref) => ref),
  where: vi.fn(),
  orderBy: vi.fn(),
  writeBatch: vi.fn(() => mockBatch),
}));

vi.mock('../firebase/config', () => ({ db: {}, isLocalMode: false }));

// getAllDocs/createDoc/updateDocById/deleteDocById all funnel through the
// mocked firebase/firestore above -- but for assignUser/setProjectManager
// specifically we also need getAllDocs to return controlled fixture data
// (the "existing assignments" list), so that module is mocked directly too.
const existingAssignmentsFixture = [];
vi.mock('./firestoreHelpers', async () => {
  const actual = await vi.importActual('./firestoreHelpers');
  return {
    ...actual,
    getAllDocs: vi.fn(() => Promise.resolve(existingAssignmentsFixture)),
    createDoc: vi.fn((path, data, id) => Promise.resolve({ id, ...data })),
    updateDocById: vi.fn((path, id, patch) => Promise.resolve({ id, ...patch })),
    deleteDocById: vi.fn((path, id) => Promise.resolve({ id, deleted: true })),
  };
});

describe('MP#4 Corrective Fix: assignUser maintains the document-ID === userId invariant', () => {
  beforeEach(async () => {
    existingAssignmentsFixture.length = 0;
    vi.clearAllMocks();
  });

  it('C-01A supersedes this: a SECOND real user for a multi-holder role (SITE_MANAGER) is now ADDED alongside the first, never deleting the existing holder', async () => {
    // This test previously asserted the pre-C-01A "replace" behavior
    // (delete userA's doc, create userB's). C-01A Section on non-PM roles
    // explicitly REQUIRES the opposite: "If another user already has the
    // same role: ADD another assignment instead of replacing the existing
    // user" -- multiple Site Managers must be able to coexist. Updated to
    // assert the new, correct, approved behavior rather than the old one.
    const { deleteDocById, createDoc, updateDocById } = await import('./firestoreHelpers');
    existingAssignmentsFixture.push({ id: 'userA', role: 'SITE_MANAGER', userId: 'userA', name: 'User A' });
    const { assignUser } = await import('../firebase/projectDetailService');

    await assignUser('proj-x', 'SITE_MANAGER', { userId: 'userB', name: 'User B' }, 'admin');

    expect(deleteDocById).not.toHaveBeenCalled(); // userA's assignment is untouched
    expect(createDoc).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ userId: 'userB' }), 'userB');
    expect(updateDocById).not.toHaveBeenCalled();
  });

  it('C-01A: a DIFFERENT user replaces only an "Unassigned" PLACEHOLDER row for that role, not a real existing holder', async () => {
    const { deleteDocById, createDoc } = await import('./firestoreHelpers');
    existingAssignmentsFixture.push({ id: 'proj-x-eng', role: 'ENGINEERING', userId: 'proj-x-eng', name: 'Unassigned' });
    const { assignUser } = await import('../firebase/projectDetailService');

    await assignUser('proj-x', 'ENGINEERING', { userId: 'userC', name: 'User C' }, 'admin');

    expect(deleteDocById).toHaveBeenCalledWith(expect.any(String), 'proj-x-eng');
    expect(createDoc).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ userId: 'userC' }), 'userC');
  });

  it('re-confirming the SAME user in the same role updates the existing document in place -- no unnecessary delete+recreate', async () => {
    const { deleteDocById, createDoc, updateDocById } = await import('./firestoreHelpers');
    existingAssignmentsFixture.push({ id: 'userA', role: 'SITE_MANAGER', userId: 'userA', name: 'User A' });
    const { assignUser } = await import('../firebase/projectDetailService');

    await assignUser('proj-x', 'SITE_MANAGER', { userId: 'userA', name: 'User A (renamed)' }, 'admin');

    expect(deleteDocById).not.toHaveBeenCalled();
    expect(createDoc).not.toHaveBeenCalled();
    expect(updateDocById).toHaveBeenCalledWith(expect.any(String), 'userA', expect.objectContaining({ userId: 'userA' }));
  });

  it('a brand-new assignment (no existing document for this role) is created directly at the new user\'s ID, no delete attempted', async () => {
    const { deleteDocById, createDoc } = await import('./firestoreHelpers');
    const { assignUser } = await import('../firebase/projectDetailService');

    await assignUser('proj-x', 'ENGINEERING', { userId: 'userC', name: 'User C' }, 'admin');

    expect(deleteDocById).not.toHaveBeenCalled();
    expect(createDoc).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ userId: 'userC', role: 'ENGINEERING' }), 'userC');
  });
});

describe('MP#4 Corrective Fix, Section 8: setProjectManager performs ONE atomic batch (assignment + projectManagerId together)', () => {
  beforeEach(() => {
    existingAssignmentsFixture.length = 0;
    batchCalls.deletes = [];
    batchCalls.sets = [];
    batchCalls.updates = [];
    vi.clearAllMocks();
  });

  it('PM reassignment (A -> B) batches exactly: delete old assignment doc, set new assignment doc at the correct userId, and update project.projectManagerId -- committed once', async () => {
    existingAssignmentsFixture.push({ id: 'userA', role: 'PROJECT_MANAGER', userId: 'userA', name: 'User A' });
    const { setProjectManager } = await import('../firebase/projectDetailService');
    const { writeBatch } = await import('firebase/firestore');

    await setProjectManager('proj-x', { userId: 'userB', name: 'User B' }, 'admin');

    expect(writeBatch).toHaveBeenCalledTimes(1);
    expect(mockBatch.delete).toHaveBeenCalledTimes(1);
    expect(mockBatch.delete.mock.calls[0][0].path).toContain('userA');
    expect(mockBatch.set).toHaveBeenCalledTimes(1);
    expect(mockBatch.set.mock.calls[0][0].path).toContain('userB');
    expect(mockBatch.set.mock.calls[0][1]).toMatchObject({ userId: 'userB', role: 'PROJECT_MANAGER' });
    expect(mockBatch.update).toHaveBeenCalledTimes(1);
    expect(mockBatch.update.mock.calls[0][1]).toMatchObject({ projectManagerId: 'userB' });
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('the FIRST-ever PM assignment for a project batches only set + update -- no delete, since there is no prior assignment to remove', async () => {
    const { setProjectManager } = await import('../firebase/projectDetailService');
    await setProjectManager('proj-x', { userId: 'userA', name: 'User A' }, 'admin');
    expect(mockBatch.delete).not.toHaveBeenCalled();
    expect(mockBatch.set).toHaveBeenCalledTimes(1);
    expect(mockBatch.update).toHaveBeenCalledTimes(1);
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('a batch commit failure propagates as a clear, safe error -- it does not silently report partial success', async () => {
    mockBatch.commit.mockRejectedValueOnce(new Error('simulated network failure'));
    const { setProjectManager } = await import('../firebase/projectDetailService');
    await expect(setProjectManager('proj-x', { userId: 'userA', name: 'User A' }, 'admin')).rejects.toThrow();
  });
});
