import { describe, it, expect, vi, beforeEach } from 'vitest';

// C-01D.2 R1 -- Firebase-mode counterpart of the approved settlement decision
// ("Option A", docs/07_Decision_Log/Payment_Projection_PAID_Settlement_Decision.md):
// markPaymentProjectionPaid records status/paidDate/paymentReference/paidBy ON
// THE PROJECTION and creates no PAYMENT_ONLY settlement Cost Transaction.
//
// Same approach as projectDetailService.test.js: the Firestore SDK is MOCKED,
// so these tests prove the code takes exactly these actions (one update to
// the projection document, nothing else) -- NOT that real Firestore, or
// Firestore Rules, accept them. No emulator or live project is involved.
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
import { markPaymentProjectionPaid } from './costService';

const PP_PATH = 'projects/p1/paymentProjections/pp-1';
const snapshot = (extra = {}) => ({
  exists: () => true,
  data: () => ({ projectionId: 'pp-1', projectId: 'p1', status: 'PENDING', currency: 'IDR', createdBy: 'SCM User', ...extra }),
});
const SETTLEMENT = { paidDate: '2026-11-12', paymentReference: 'TRF-1', paidBy: 'Finance User' };

// Every way this module could write something other than the one update under test.
function expectNoOtherWrites() {
  expect(h.tx.set).not.toHaveBeenCalled();
  expect(h.tx.delete).not.toHaveBeenCalled();
  for (const fn of ['setDoc', 'addDoc', 'updateDoc', 'deleteDoc', 'writeBatch']) expect(sdk[fn], fn).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.docPaths.length = 0;
  h.tx.get.mockResolvedValue(snapshot());
});

describe('Firebase mode: markPaymentProjectionPaid (Option A -- no automatic settlement transaction)', () => {
  it('PENDING -> PAID performs exactly ONE write: the projection document, with only status and the three settlement fields', async () => {
    const result = await markPaymentProjectionPaid('p1', 'pp-1', SETTLEMENT);
    expect(h.tx.update).toHaveBeenCalledTimes(1);
    const [ref, fields] = h.tx.update.mock.calls[0];
    expect(ref.path).toBe(PP_PATH);
    expect(fields).toEqual({ status: 'PAID', paidDate: '2026-11-12', paymentReference: 'TRF-1', paidBy: 'Finance User' });
    expectNoOtherWrites();
    expect(result).toMatchObject({ projectionId: 'pp-1', status: 'PAID', paidDate: '2026-11-12', paymentReference: 'TRF-1', paidBy: 'Finance User' });
  });

  it('it never addresses a Cost Transaction: the only document reference it builds is the projection itself, so no settlement record can be created', async () => {
    await markPaymentProjectionPaid('p1', 'pp-1', SETTLEMENT);
    expect(h.docPaths).toEqual([PP_PATH]);
    expect(h.docPaths.some((p) => p.includes('costTransactions'))).toBe(false);
  });

  it('composition / amount / status arguments are ignored: the written fields are exactly the four above', async () => {
    await markPaymentProjectionPaid('p1', 'pp-1', { ...SETTLEMENT, totalAmount: 1, amount: 1, costTransactionIds: ['CST-x'], status: 'PENDING' });
    expect(h.tx.update.mock.calls[0][1]).toEqual({ status: 'PAID', paidDate: '2026-11-12', paymentReference: 'TRF-1', paidBy: 'Finance User' });
  });

  it('missing optional settlement values are stored as null, never undefined (Firestore rejects undefined)', async () => {
    await markPaymentProjectionPaid('p1', 'pp-1', {});
    expect(h.tx.update.mock.calls[0][1]).toEqual({ status: 'PAID', paidDate: null, paymentReference: null, paidBy: null });
  });

  it('an already-PAID projection is rejected and nothing is written', async () => {
    h.tx.get.mockResolvedValue(snapshot({ status: 'PAID', paidDate: '2026-11-10', paymentReference: 'FIRST' }));
    await expect(markPaymentProjectionPaid('p1', 'pp-1', SETTLEMENT)).rejects.toThrow('Only a PENDING Payment Projection can be marked PAID (current status: PAID).');
    expect(h.tx.update).not.toHaveBeenCalled();
    expectNoOtherWrites();
  });

  it('a legacy plan record (not a PENDING batch) is rejected and nothing is written', async () => {
    h.tx.get.mockResolvedValue(snapshot({ status: 'PLANNED' }));
    await expect(markPaymentProjectionPaid('p1', 'pp-1', SETTLEMENT)).rejects.toThrow('Only a PENDING Payment Projection can be marked PAID (current status: PLANNED).');
    expect(h.tx.update).not.toHaveBeenCalled();
  });

  it('an unknown projection returns null and nothing is written', async () => {
    h.tx.get.mockResolvedValue({ exists: () => false, data: () => undefined });
    await expect(markPaymentProjectionPaid('p1', 'pp-1', SETTLEMENT)).resolves.toBeNull();
    expect(h.tx.update).not.toHaveBeenCalled();
    expectNoOtherWrites();
  });
});
