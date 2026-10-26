import { describe, it, expect, vi, beforeEach } from 'vitest';

// Final UAT Patch B -- Firebase-mode Draft edit and Amount validation.
//
// Same approach as costService.paymentProjection.test.js: the Firestore SDK is
// MOCKED, so these tests prove the service takes exactly these actions (reads,
// then ONE update inside a transaction, with only the intended fields) -- NOT
// that real Firestore, or Firestore Rules, accept them. No emulator or live
// project is involved, and nothing here proves server-side authorization.
const h = vi.hoisted(() => ({
  tx: { get: vi.fn(), update: vi.fn(), set: vi.fn(), delete: vi.fn() },
  docPaths: [],
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, ...segments) => ({ __type: 'collection', path: segments.join('/') })),
  collectionGroup: vi.fn(),
  doc: vi.fn((_db, ...segments) => { const ref = { __type: 'doc', path: segments.join('/') }; h.docPaths.push(ref.path); return ref; }),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  query: vi.fn((ref) => ref),
  where: vi.fn(),
  orderBy: vi.fn(),
  documentId: vi.fn(),
  writeBatch: vi.fn(),
  runTransaction: vi.fn(async (_db, fn) => fn(h.tx)),
}));
vi.mock('./config', () => ({ db: {}, isLocalMode: false }));

import * as sdk from 'firebase/firestore';
import { updateDraftCostTransaction, createCostTransaction, checkDuplicateTransaction } from './costService';

const TX_PATH = 'projects/p1/costTransactions/CST-1';
const record = (extra = {}) => ({
  projectId: 'p1', status: 'DRAFT', currency: 'IDR', transactionType: 'COST', relatedTransactionId: null, projectionId: null,
  sourceRole: 'SCM', createdBy: 'SCM User', createdAt: '2026-11-01T00:00:00.000Z', category: 'Material Purchase',
  description: 'Original', amount: 1_000_000, transactionDate: '2026-11-02', referenceNumber: 'REF-1', invoiceNumber: '', ...extra,
});
const docSnap = (id, data) => ({ id, data: () => data });
const SCM = { role: 'SCM', name: 'SCM User' };
const SUPER = { role: 'SUPER_ADMIN', name: 'Admin User' };
const INVALID_AMOUNTS = ['', '   ', 0, -1, 'abc', NaN, Infinity, -Infinity, null, undefined];

function listIs(...docs) { sdk.getDocs.mockResolvedValue({ docs }); }
function noWrites() {
  expect(h.tx.set).not.toHaveBeenCalled();
  expect(h.tx.delete).not.toHaveBeenCalled();
  for (const fn of ['setDoc', 'addDoc', 'updateDoc', 'deleteDoc', 'writeBatch']) expect(sdk[fn], fn).not.toHaveBeenCalled();
}
function nothingTouched() {
  expect(sdk.getDocs).not.toHaveBeenCalled();
  expect(sdk.runTransaction).not.toHaveBeenCalled();
  noWrites();
  expect(h.tx.update).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.docPaths.length = 0;
  listIs(docSnap('CST-1', record()));
  h.tx.get.mockResolvedValue({ exists: () => true, data: () => record() });
});

describe('Firebase mode: updateDraftCostTransaction performs exactly one transactional update with only the intended fields', () => {
  it('reads the project, then updates ONE document: the edited fields + duplicate result + audit -- nothing else', async () => {
    const result = await updateDraftCostTransaction('p1', 'CST-1', { description: ' Edited ', amount: '2500000' }, SCM);
    expect(sdk.runTransaction).toHaveBeenCalledTimes(1);
    expect(h.tx.update).toHaveBeenCalledTimes(1);
    const [ref, payload] = h.tx.update.mock.calls[0];
    expect(ref.path).toBe(TX_PATH);
    expect(Object.keys(payload).sort()).toEqual(['amount', 'description', 'duplicateCheck', 'override', 'updatedAt', 'updatedBy']);
    expect(payload).toMatchObject({ description: 'Edited', amount: 2_500_000, duplicateCheck: null, override: null, updatedBy: 'SCM User' });
    expect(new Date(payload.updatedAt).toISOString()).toBe(payload.updatedAt);
    // none of the locked fields is in the payload
    for (const locked of ['status', 'projectId', 'sourceRole', 'createdBy', 'createdAt', 'transactionType', 'relatedTransactionId', 'projectionId', 'transactionId', 'id']) {
      expect(locked in payload, locked).toBe(false);
    }
    expect(result).toMatchObject({ transactionId: 'CST-1', status: 'DRAFT', description: 'Edited', amount: 2_500_000 });
    noWrites();
  });

  it('Super Admin may edit a Draft of any source role; the actor name is the audit trail, sourceRole is untouched', async () => {
    await updateDraftCostTransaction('p1', 'CST-1', { category: 'Procurement' }, SUPER);
    const [, payload] = h.tx.update.mock.calls[0];
    expect(payload.updatedBy).toBe('Admin User');
    expect('sourceRole' in payload).toBe(false);
  });

  it('a missing actor name is stored as null, never undefined (the SDK rejects undefined)', async () => {
    await updateDraftCostTransaction('p1', 'CST-1', { description: 'x' }, { role: 'SCM' });
    const [, payload] = h.tx.update.mock.calls[0];
    expect(payload.updatedBy).toBeNull();
    expect(Object.values(payload).includes(undefined)).toBe(false);
  });
});

describe('Firebase mode: rejected before ANY read or write', () => {
  it.each(INVALID_AMOUNTS)('invalid amount %s', async (bad) => {
    await expect(updateDraftCostTransaction('p1', 'CST-1', { amount: bad }, SCM)).rejects.toThrow('Amount must be a number greater than zero.');
    nothingTouched();
  });

  it.each(['status', 'sourceRole', 'projectId', 'transactionType', 'relatedTransactionId', 'projectionId', 'createdBy', 'createdAt', 'transactionId', 'id'])('locked field %s', async (field) => {
    await expect(updateDraftCostTransaction('p1', 'CST-1', { description: 'x', [field]: 'y' }, SCM)).rejects.toThrow(/Cannot edit/);
    nothingTouched();
  });

  it('empty patch, missing required text, and a bad date', async () => {
    await expect(updateDraftCostTransaction('p1', 'CST-1', {}, SCM)).rejects.toThrow('No changes were supplied.');
    await expect(updateDraftCostTransaction('p1', 'CST-1', { description: '  ' }, SCM)).rejects.toThrow('Description is required.');
    await expect(updateDraftCostTransaction('p1', 'CST-1', { transactionDate: '2026-02-30' }, SCM)).rejects.toThrow(/valid date/);
    nothingTouched();
  });
});

describe('Firebase mode: lifecycle and ownership are enforced, no transaction is opened when the read already rejects', () => {
  it('an unrelated role is rejected', async () => {
    await expect(updateDraftCostTransaction('p1', 'CST-1', { description: 'x' }, { role: 'HC', name: 'H' })).rejects.toThrow(/Only the role that created this Draft/);
    expect(sdk.runTransaction).not.toHaveBeenCalled();
    noWrites();
  });

  it('POSTED, VOID and allocated records are rejected', async () => {
    for (const [extra, message] of [
      [{ status: 'POSTED' }, 'current status: POSTED'],
      [{ status: 'VOID' }, 'current status: VOID'],
      [{ projectionId: 'pp-1' }, 'is allocated to Payment Projection "pp-1"'],
    ]) {
      listIs(docSnap('CST-1', record(extra)));
      await expect(updateDraftCostTransaction('p1', 'CST-1', { description: 'x' }, SUPER)).rejects.toThrow(message);
    }
    expect(sdk.runTransaction).not.toHaveBeenCalled();
    noWrites();
  });

  it('an unknown transaction is rejected, never reported as success', async () => {
    listIs();
    await expect(updateDraftCostTransaction('p1', 'CST-1', { description: 'x' }, SCM)).rejects.toThrow('Cost Transaction was not found.');
    expect(sdk.runTransaction).not.toHaveBeenCalled();
  });
});

describe('Firebase mode: a Draft that changes state while the edit is in progress is NOT overwritten', () => {
  it('the list said DRAFT, but the transaction re-read finds it POSTED: rejected and no update is written', async () => {
    h.tx.get.mockResolvedValue({ exists: () => true, data: () => record({ status: 'POSTED' }) });
    await expect(updateDraftCostTransaction('p1', 'CST-1', { description: 'x' }, SCM)).rejects.toThrow('current status: POSTED');
    expect(sdk.runTransaction).toHaveBeenCalledTimes(1);
    expect(h.tx.update).not.toHaveBeenCalled();
    noWrites();
  });

  it('it was allocated in the meantime: rejected and no update is written', async () => {
    h.tx.get.mockResolvedValue({ exists: () => true, data: () => record({ status: 'POSTED', projectionId: 'pp-9' }) });
    await expect(updateDraftCostTransaction('p1', 'CST-1', { amount: 5 }, SCM)).rejects.toThrow(/current status: POSTED|allocated/);
    expect(h.tx.update).not.toHaveBeenCalled();
  });

  it('it was deleted in the meantime, or its source role differs: rejected, no update', async () => {
    h.tx.get.mockResolvedValue({ exists: () => false, data: () => undefined });
    await expect(updateDraftCostTransaction('p1', 'CST-1', { description: 'x' }, SCM)).rejects.toThrow('Cost Transaction was not found.');
    h.tx.get.mockResolvedValue({ exists: () => true, data: () => record({ sourceRole: 'HC' }) });
    await expect(updateDraftCostTransaction('p1', 'CST-1', { description: 'x' }, SCM)).rejects.toThrow(/Only the role that created this Draft/);
    expect(h.tx.update).not.toHaveBeenCalled();
  });
});

describe('Firebase mode: duplicate detection on edit (same semantics as creation, the Draft excluded from its own comparison)', () => {
  it('the Draft is not compared with itself: it is in the list with the same reference and the edit still succeeds', async () => {
    listIs(docSnap('CST-1', record({ referenceNumber: 'SAME-REF' })));
    await updateDraftCostTransaction('p1', 'CST-1', { description: 'text only' }, SCM);
    expect(h.tx.update.mock.calls[0][1].duplicateCheck).toBeNull();
  });

  it('a STRONG duplicate of ANOTHER transaction is blocked before any transaction is opened', async () => {
    listIs(docSnap('CST-1', record({ referenceNumber: 'MINE' })), docSnap('CST-2', record({ referenceNumber: 'THEIRS', status: 'POSTED' })));
    const err = await updateDraftCostTransaction('p1', 'CST-1', { referenceNumber: 'theirs' }, SCM).catch((e) => e);
    expect(err.message).toBe('Strong duplicate detected -- edit blocked.');
    expect(err.duplicate.level).toBe('STRONG');
    expect(sdk.runTransaction).not.toHaveBeenCalled();
    noWrites();
  });

  it('the existing Super Admin override applies; a POSSIBLE duplicate is recorded as a warning and saved', async () => {
    listIs(docSnap('CST-1', record({ referenceNumber: 'MINE' })), docSnap('CST-2', record({ referenceNumber: 'THEIRS' })));
    const override = { confirmed: true, reason: 'verified', byRole: 'SUPER_ADMIN' };
    await updateDraftCostTransaction('p1', 'CST-1', { referenceNumber: 'THEIRS' }, SUPER, override);
    const strong = h.tx.update.mock.calls[0][1];
    expect(strong.duplicateCheck.level).toBe('STRONG');
    expect(strong.override).toMatchObject({ confirmed: true, reason: 'verified', byRole: 'SUPER_ADMIN' });
    vi.clearAllMocks();
    h.tx.get.mockResolvedValue({ exists: () => true, data: () => record() });
    listIs(docSnap('CST-1', record({ amount: 111, referenceNumber: 'A' })), docSnap('CST-2', record({ amount: 777, referenceNumber: 'B', transactionDate: '2026-11-03' })));
    await updateDraftCostTransaction('p1', 'CST-1', { amount: 777 }, SCM);
    expect(h.tx.update.mock.calls[0][1].duplicateCheck.level).toBe('POSSIBLE');
  });

  it('checkDuplicateTransaction accepts an optional exclusion and is unchanged without it', async () => {
    listIs(docSnap('CST-1', record({ referenceNumber: 'X1' })));
    const candidate = record({ referenceNumber: 'X1' });
    expect((await checkDuplicateTransaction('p1', candidate)).level).toBe('STRONG');
    expect((await checkDuplicateTransaction('p1', candidate, 'CST-1')).level).toBeNull();
  });
});

describe('Firebase mode: errors propagate -- no fallback, no default, no false success', () => {
  it('a failed read rejects the edit and writes nothing', async () => {
    sdk.getDocs.mockRejectedValue(new Error('unavailable'));
    await expect(updateDraftCostTransaction('p1', 'CST-1', { description: 'x' }, SCM)).rejects.toThrow();
    expect(sdk.runTransaction).not.toHaveBeenCalled();
    noWrites();
  });

  it('a failed transaction rejects the edit with the SDK error', async () => {
    sdk.runTransaction.mockRejectedValueOnce(Object.assign(new Error('permission-denied'), { code: 'permission-denied' }));
    await expect(updateDraftCostTransaction('p1', 'CST-1', { description: 'x' }, SCM)).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('Firebase mode: createCostTransaction applies the same Amount rule at the service boundary', () => {
  const tx = (amount) => ({ projectId: 'p1', category: 'Other', description: 'd', amount, transactionDate: '2026-11-04', sourceRole: 'SCM', referenceNumber: 'NEW-1' });

  it.each(INVALID_AMOUNTS)('invalid amount %s: rejected before any read or write', async (bad) => {
    await expect(createCostTransaction('p1', tx(bad))).rejects.toThrow('Amount must be a number greater than zero.');
    expect(sdk.getDocs).not.toHaveBeenCalled();
    noWrites();
  });

  it('a valid amount (numeric text from a form) is stored as a number', async () => {
    listIs();
    await createCostTransaction('p1', tx('1500'));
    expect(sdk.setDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = sdk.setDoc.mock.calls[0];
    expect(ref.path).toMatch(/^projects\/p1\/costTransactions\/CST-\d{4}-000001$/);
    expect(data.amount).toBe(1500);
    expect(typeof data.amount).toBe('number');
    expect(data.status).toBe('DRAFT');
  });
});
