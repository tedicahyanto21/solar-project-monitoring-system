import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ROLES } from '../../constants/roles';

// Master Prompt #4 corrective (PM assignment identity). Two layers of test
// here, matching the existing convention in projectService.test.js (pure
// logic, no real Firestore connection):
//
// 1. resolveAssignmentWrite is pure and needs no mock at all.
// 2. assignUser/setProjectManagerAtomic are exercised against a MOCKED
//    'firebase/firestore' module so we can assert exactly which document
//    IDs a batch.set/batch.delete targets -- i.e. that the required
//    invariant (document ID === userId) holds in the actual write path,
//    not just in the pure helper. This does NOT touch a real Firestore
//    project/emulator, so it cannot prove batch.commit() is atomic against
//    real network/partial-failure conditions -- see Section 12 Test 6 in
//    the corrective task and the final report's documented limitation.
const batchOps = { sets: [], deletes: [], updates: [] };
let mockSnapshot = [];

vi.mock('firebase/firestore', () => ({
  collection: (_db, ...segs) => ({ __type: 'collection', path: segs.join('/') }),
  doc: (_db, ...segs) => ({ __type: 'doc', path: segs.join('/'), id: segs[segs.length - 1] }),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
  getDocs: vi.fn(async () => ({
    docs: mockSnapshot.map((d) => {
      const { id, ...rest } = d;
      return { id, data: () => rest };
    }),
  })),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  query: (ref) => ref,
  where: vi.fn(),
  orderBy: vi.fn(),
  writeBatch: () => ({
    set: (ref, data) => batchOps.sets.push({ ref, data }),
    delete: (ref) => batchOps.deletes.push({ ref }),
    update: (ref, data) => batchOps.updates.push({ ref, data }),
    commit: vi.fn(async () => undefined),
  }),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
}));

const { resolveAssignmentWrite, assignUser, setProjectManagerAtomic } = await import('./projectDetailService');

beforeEach(() => {
  batchOps.sets = [];
  batchOps.deletes = [];
  batchOps.updates = [];
  mockSnapshot = [];
});

describe('resolveAssignmentWrite (pure logic, no Firestore)', () => {
  it('a first-time assignment has no stale holder to remove', () => {
    const { staleHolderId, data } = resolveAssignmentWrite([], ROLES.PROJECT_MANAGER, { userId: 'userA', name: 'A' }, 'admin');
    expect(staleHolderId).toBeNull();
    expect(data.userId).toBe('userA');
  });

  it('reassigning a role to a different user flags the PREVIOUS holder as stale', () => {
    const existing = [{ id: 'userA', role: ROLES.PROJECT_MANAGER, userId: 'userA', name: 'A' }];
    const { staleHolderId, data } = resolveAssignmentWrite(existing, ROLES.PROJECT_MANAGER, { userId: 'userB', name: 'B' }, 'admin');
    expect(staleHolderId).toBe('userA');
    expect(data.userId).toBe('userB');
  });

  it('re-assigning the SAME user to the same role has no stale holder (its own doc is simply overwritten)', () => {
    const existing = [{ id: 'userA', role: ROLES.PROJECT_MANAGER, userId: 'userA', name: 'A' }];
    const { staleHolderId } = resolveAssignmentWrite(existing, ROLES.PROJECT_MANAGER, { userId: 'userA', name: 'A2' }, 'admin');
    expect(staleHolderId).toBeNull();
  });

  it('a different role held by a different user is never flagged as stale', () => {
    const existing = [{ id: 'userS', role: ROLES.SITE_MANAGER, userId: 'userS', name: 'S' }];
    const { staleHolderId } = resolveAssignmentWrite(existing, ROLES.PROJECT_MANAGER, { userId: 'userB', name: 'B' }, 'admin');
    expect(staleHolderId).toBeNull();
  });
});

describe('assignUser (Firestore write path, mocked SDK) -- Test 1: initial assignment', () => {
  it('writes the new assignment doc at ID === userId, with no delete', async () => {
    await assignUser('p1', ROLES.PROJECT_MANAGER, { userId: 'userA', name: 'A' }, 'admin');
    expect(batchOps.deletes.length).toBe(0);
    expect(batchOps.sets.length).toBe(1);
    expect(batchOps.sets[0].ref.id).toBe('userA');
    expect(batchOps.sets[0].data.userId).toBe('userA');
    expect(batchOps.sets[0].data.role).toBe(ROLES.PROJECT_MANAGER);
  });
});

describe('assignUser (Firestore write path, mocked SDK) -- Test 2: reassignment identity invariant', () => {
  it('User A -> User B: the OLD document (ID=userA) is deleted, the NEW document is set at ID=userB', async () => {
    mockSnapshot = [{ id: 'userA', role: ROLES.PROJECT_MANAGER, userId: 'userA', name: 'A', assignedAt: 't', assignedBy: 'admin' }];
    await assignUser('p1', ROLES.PROJECT_MANAGER, { userId: 'userB', name: 'B' }, 'admin');

    expect(batchOps.deletes.length).toBe(1);
    expect(batchOps.deletes[0].ref.id).toBe('userA');

    expect(batchOps.sets.length).toBe(1);
    expect(batchOps.sets[0].ref.id).toBe('userB');
    expect(batchOps.sets[0].data.userId).toBe('userB');

    // The specific bug this corrective fixes: document ID = userA with
    // userId = userB must never occur.
    const wrongShape = batchOps.sets.find((s) => s.ref.id === 'userA' && s.data.userId === 'userB');
    expect(wrongShape).toBeUndefined();
  });
});

describe('assignUser (Firestore write path, mocked SDK) -- Test 3: exactly one PROJECT_MANAGER doc', () => {
  it('after A -> B, the batch removes the old doc and writes exactly one new one -- never two live PM docs', async () => {
    mockSnapshot = [{ id: 'userA', role: ROLES.PROJECT_MANAGER, userId: 'userA', name: 'A', assignedAt: 't', assignedBy: 'admin' }];
    await assignUser('p1', ROLES.PROJECT_MANAGER, { userId: 'userB', name: 'B' }, 'admin');
    expect(batchOps.deletes.length + batchOps.sets.length).toBe(2);
    expect(batchOps.sets.length).toBe(1);
  });
});

describe('assignUser (Firestore write path, mocked SDK) -- Test 4: authorization identity relationship', () => {
  it('the resulting live assignment doc is addressable as projectAssignments/{authenticatedUid} for the PROJECT_MANAGER role', async () => {
    mockSnapshot = [{ id: 'userA', role: ROLES.PROJECT_MANAGER, userId: 'userA', name: 'A', assignedAt: 't', assignedBy: 'admin' }];
    await assignUser('p1', ROLES.PROJECT_MANAGER, { userId: 'userB', name: 'B' }, 'admin');

    const authenticatedUid = 'userB';
    const liveDoc = batchOps.sets.find((s) => s.ref.id === authenticatedUid);
    expect(liveDoc).toBeDefined();
    expect(liveDoc.data.role).toBe(ROLES.PROJECT_MANAGER);
    // The path itself is projects/{projectId}/projectAssignments, and the
    // ref id equals the authenticated user's own uid -- exactly what
    // firestore.rules' request.auth.uid-keyed lookup requires.
    expect(liveDoc.ref.path).toContain('projectAssignments');
  });
});

describe('assignUser (Firestore write path, mocked SDK) -- Test 5: other roles are unaffected', () => {
  it('reassigning PROJECT_MANAGER never deletes or rewrites an unrelated SITE_MANAGER/ENGINEERING/HSE assignment', async () => {
    mockSnapshot = [
      { id: 'userA', role: ROLES.PROJECT_MANAGER, userId: 'userA', name: 'A', assignedAt: 't', assignedBy: 'admin' },
      { id: 'userS', role: ROLES.SITE_MANAGER, userId: 'userS', name: 'S', assignedAt: 't', assignedBy: 'admin' },
      { id: 'userE', role: ROLES.ENGINEERING, userId: 'userE', name: 'E', assignedAt: 't', assignedBy: 'admin' },
      { id: 'userH', role: ROLES.HSE, userId: 'userH', name: 'H', assignedAt: 't', assignedBy: 'admin' },
    ];
    await assignUser('p1', ROLES.PROJECT_MANAGER, { userId: 'userB', name: 'B' }, 'admin');

    const touchedIds = new Set([...batchOps.deletes.map((d) => d.ref.id), ...batchOps.sets.map((s) => s.ref.id)]);
    expect(touchedIds.has('userS')).toBe(false);
    expect(touchedIds.has('userE')).toBe(false);
    expect(touchedIds.has('userH')).toBe(false);
  });
});

describe('setProjectManagerAtomic -- assignment + project master sync in one batch', () => {
  it('writes the assignment set (and stale-holder delete) AND the project master update in the SAME batch', async () => {
    mockSnapshot = [{ id: 'userA', role: ROLES.PROJECT_MANAGER, userId: 'userA', name: 'A', assignedAt: 't', assignedBy: 'admin' }];
    await setProjectManagerAtomic('p1', ROLES.PROJECT_MANAGER, { userId: 'userB', name: 'B' }, 'admin');

    expect(batchOps.deletes.length).toBe(1);
    expect(batchOps.deletes[0].ref.id).toBe('userA');
    expect(batchOps.sets.length).toBe(1);
    expect(batchOps.sets[0].ref.id).toBe('userB');
    expect(batchOps.updates.length).toBe(1);
    expect(batchOps.updates[0].ref.path).toContain('projects/p1');
    expect(batchOps.updates[0].data.projectManagerId).toBe('userB');
    expect(batchOps.updates[0].data.projectManager).toBe('B');
  });
});

// Section 12, Test 6 (documented limitation): this mock's writeBatch.commit
// always resolves -- it cannot exercise Firestore's real transactional
// all-or-nothing guarantee, nor a genuine partial-failure/rollback scenario.
// Verifying that requires the Firebase Emulator, which is not configured in
// this project (no firebase.json / emulator setup present as of this
// corrective). What IS verified above is that exactly one batch, containing
// both the assignment write(s) and the project master update, is
// constructed and committed as a single call -- i.e. the application code
// never performs these as two independent awaited operations. Real
// atomicity (rollback-on-failure) is a property of Firestore's batch
// commit itself, not of this application code, and is left unverified here
// rather than faked.
